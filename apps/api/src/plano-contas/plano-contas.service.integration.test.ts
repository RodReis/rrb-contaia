/**
 * Importação do plano de contas na API sobre a infraestrutura local real (SPEC-013 §3.6–§3.12,
 * §6.1–§6.4): PostgreSQL pelo papel `contaia_app` (RLS valendo), Redis/BullMQ e MinIO.
 *
 * O worker de validação é da Task 9: aqui ele é simulado pelo repositório no contexto técnico da
 * empresa (`iniciarValidacao` + `gravarResultadoDaValidacao`), o mesmo caminho que o worker usará.
 * Autorização (chave do catálogo, carteira, tenant) passa pelos guards REAIS sobre HTTP; só a
 * sessão (token do Keycloak) é dublada.
 */
import { randomInt } from 'node:crypto';

import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import {
  comContexto,
  comContextoHumano,
  criarPool,
  criarPoolDaAplicacao,
  gravarResultadoDaValidacao,
  iniciarValidacaoDaImportacao,
  obterUrlDaAplicacao,
  type LinhaDeStaging,
} from '@contaia/db';
import { CODIGOS_DE_ERRO, MODELO_CSV, contextoTecnico, permissoesDosPapeisPadrao, type PapelPadrao } from '@contaia/domain';
import { FILA_DE_VALIDACAO_PLANO_CONTAS, idDoJobDeValidacao } from '@contaia/shared';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GuardDeAcao } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { PoolDoBanco } from '../banco/pool.provider';
import { CarteiraService } from '../carteira/carteira.service';
import { FiltroDeProblema } from '../comum/problema';
import { StorageService } from '../comum/storage.service';
import { EmpresaService } from '../empresa/empresa.service';
import { reconciliarPendenciaDoPlano } from './pendencia-do-plano';
import { PlanoContasDaEmpresaController } from './plano-contas.controller';
import { criarFilaDeValidacaoDoPlano, enfileirarValidacao, type FilaDeValidacaoDoPlano } from './plano-contas.fila';
import { PlanoContasService, type ContextoDaImportacao } from './plano-contas.service';

const admin: Pool = criarPool();
const appPool: Pool = criarPoolDaAplicacao();

const sufixo = `${String(process.pid).slice(-4).padStart(4, '0')}${String(Date.now()).slice(-6)}${randomInt(10, 99)}`;
const PREFIXO_DA_FILA = `teste-plano-${sufixo}`;
const MAPEAMENTO = { codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' };
const BOM = String.fromCharCode(0xfeff);

const s3 = new S3Client({
  endpoint: process.env['S3_ENDPOINT'] ?? 'http://127.0.0.1:19000',
  region: process.env['S3_REGION'] ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env['MINIO_ROOT_USER'] ?? 'contaia_local',
    secretAccessKey: process.env['MINIO_ROOT_PASSWORD'] ?? 'contaia_local_secret',
  },
});
const BUCKET = process.env['S3_BUCKET'] ?? 'contaia-documentos';

const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:16379', { maxRetriesPerRequest: 3 });
const fila = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS, { connection: redis, prefix: PREFIXO_DA_FILA });
const filaDaApi: FilaDeValidacaoDoPlano = { enfileirar: (comando) => enfileirarValidacao(fila, comando) };

const storage = new StorageService();
const servico = new PlanoContasService({ instancia: appPool } as PoolDoBanco, storage, filaDaApi);

let tenantA = '';
let tenantB = '';
let contador = '';
let contadorFora = '';
let auxiliar = '';
let usuarioB = '';
let empresa = '';
let outraDaCarteira = '';
let aAtivar = '';
let empresaFalha = '';
let empresaArquivada = '';
let empresaGrande = '';
let empresaB = '';
let http: INestApplication;

const unico = async (sql: string, parametros: unknown[]): Promise<string> =>
  (await admin.query<{ id: string }>(sql, parametros)).rows[0]!.id;

/** CNPJ com dígitos verificadores válidos (a ativação confere). */
const cnpjValido = (): string => {
  const base = Array.from({ length: 12 }, () => randomInt(0, 10));
  const digito = (numeros: number[]): number => {
    const pesos = numeros.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const resto = numeros.reduce((soma, n, i) => soma + n * pesos[i]!, 0) % 11;

    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(base);

  return [...base, primeiro, digito([...base, primeiro])].join('');
};

const contexto = (usuarioId: string, tenantId = tenantA): ContextoDaImportacao => ({
  tenantId,
  usuarioId,
  correlationId: `corr-plano-${sufixo}`,
});

const csv = (linhas: readonly string[]): Buffer => Buffer.from(['codigo;nome;tipo;natureza;conta_pai', ...linhas, ''].join('\r\n'));

/** O que o worker da Task 9 fará: iniciar e gravar o staging no contexto técnico da empresa. */
const validarComoWorker = async (empresaId: string, tentativaId: string, linhas: readonly LinhaDeStaging[]): Promise<void> => {
  await comContexto(
    appPool,
    contextoTecnico({
      identidadeTecnica: 'workers-plano-contas',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: tenantA,
      empresaId,
      correlationId: `corr-worker-${sufixo}`,
    }),
    async (cliente) => {
      const { planoVersaoNaValidacao } = await iniciarValidacaoDaImportacao(cliente, empresaId, tentativaId, new Date());
      await gravarResultadoDaValidacao(cliente, empresaId, tentativaId, linhas, planoVersaoNaValidacao, new Date());
    },
  );
};

const valida = (numeroDaLinha: number, codigo: string, contaPai: string | null): LinhaDeStaging => ({
  status: 'VALIDA',
  numeroDaLinha,
  codigo,
  nome: `Conta ${codigo}`,
  tipo: 'sintetica',
  natureza: 'devedora',
  contaPai,
  acao: 'INCLUIR',
});

const rejeitada = (numeroDaLinha: number, codigo: string): LinhaDeStaging => ({
  status: 'REJEITADA',
  numeroDaLinha,
  codigo,
  nome: 'Fórmula',
  tipo: 'sintetica',
  natureza: 'devedora',
  contaPai: '9',
  codigoDeErro: 'CONTA_PAI_INEXISTENTE',
  campo: 'conta_pai',
  mensagem: 'A conta-pai não existe no plano nem no arquivo.',
});

const pendenciaDoPlano = async (empresaId: string): Promise<string | null> =>
  (
    await admin.query<{ estado: string }>(
      `select estado from app.empresa_pendencia where empresa_id = $1 and origem = 'PLANO_CONTAS'
        order by criado_em desc limit 1`,
      [empresaId],
    )
  ).rows[0]?.estado ?? null;

/** Toda conexão do pool da aplicação volta ociosa: nenhuma transação (nem cursor) pendurada. */
const poolLivre = (): void => {
  expect(appPool.waitingCount).toBe(0);
  expect(appPool.idleCount).toBe(appPool.totalCount);
};

/** Sessão dublada pelos cabeçalhos de teste; guards de ação e carteira são os reais. */
const sessaoDublada = {
  canActivate: (ctx: { switchToHttp: () => { getRequest: () => RequisicaoAutenticada } }) => {
    const requisicao = ctx.switchToHttp().getRequest();
    const papel = (requisicao.header('x-papel') ?? 'contador') as PapelPadrao;

    requisicao.sessao = {
      tenantId: requisicao.header('x-tenant') ?? tenantA,
      usuarioId: requisicao.header('x-usuario') ?? contador,
      papeis: [papel],
      permissoes: permissoesDosPapeisPadrao([papel]),
    } as unknown as NonNullable<RequisicaoAutenticada['sessao']>;

    return true;
  },
};

beforeAll(async () => {
  const novoTenant = (rotulo: string): Promise<string> =>
    unico(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
      `Plano ${rotulo} ${sufixo}`,
      `${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'),
    ]);
  const novoUsuario = (tenantId: string, rotulo: string): Promise<string> =>
    unico(
      `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, $4, 'ATIVO') returning id`,
      [tenantId, `sub-${rotulo}-${sufixo}`, `${rotulo}.${sufixo}@plano.local`, `Usuário ${rotulo}`],
    );
  const novaEmpresa = (tenantId: string, rotulo: string): Promise<string> =>
    unico(
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
      [tenantId, `${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa ${rotulo}`],
    );
  const vincular = (tenantId: string, usuarioId: string, empresaId: string): Promise<unknown> =>
    admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
      tenantId,
      usuarioId,
      empresaId,
    ]);

  tenantA = await novoTenant('A');
  tenantB = await novoTenant('B');
  contador = await novoUsuario(tenantA, 'contador');
  contadorFora = await novoUsuario(tenantA, 'fora');
  auxiliar = await novoUsuario(tenantA, 'auxiliar');
  usuarioB = await novoUsuario(tenantB, 'b');
  empresa = await novaEmpresa(tenantA, 'E');
  outraDaCarteira = await novaEmpresa(tenantA, 'O');
  empresaB = await novaEmpresa(tenantB, 'X');
  // Empresa com o cadastro completo, ainda não ativa: a ativação deve abrir a pendência do plano.
  aAtivar = await unico(
    `insert into app.empresa (tenant_id, cnpj, razao_social, nome_fantasia, regime_tributario, cnae_principal,
       inscricao_estadual_situacao, inscricao_municipal_situacao, situacao_cadastral_externa, status, situacao)
     values ($1, $2, 'Ativável Ltda', 'Ativável', 'LUCRO_PRESUMIDO', '6201501', 'ISENTO', 'NAO_SE_APLICA', 'Ativa',
             'CADASTRO_INCOMPLETO', 'ativo') returning id`,
    [tenantA, cnpjValido()],
  );
  await admin.query(
    `insert into app.empresa_endereco (tenant_id, empresa_id, cep, logradouro, numero, bairro, municipio, uf)
     values ($1, $2, '01310100', 'Avenida Paulista', '1000', 'Bela Vista', 'São Paulo', 'SP')`,
    [tenantA, aAtivar],
  );
  empresaFalha = await novaEmpresa(tenantA, 'F');
  empresaArquivada = await novaEmpresa(tenantA, 'Q');
  empresaGrande = await novaEmpresa(tenantA, 'G');
  for (const empresaId of [empresa, outraDaCarteira, aAtivar, empresaFalha, empresaArquivada, empresaGrande]) {
    await vincular(tenantA, contador, empresaId);
  }
  await vincular(tenantA, auxiliar, empresa);
  await vincular(tenantB, usuarioB, empresaB);

  await storage.onModuleInit();

  const modulo = await Test.createTestingModule({
    controllers: [PlanoContasDaEmpresaController],
    providers: [
      { provide: PlanoContasService, useValue: servico },
      { provide: PoolDoBanco, useValue: { instancia: appPool } },
      CarteiraService,
      Reflector,
      GuardDeAcao,
      GuardDeEscopoDeEmpresa,
    ],
  })
    .overrideGuard(GuardDeSessao)
    .useValue(sessaoDublada)
    .overrideGuard(GuardDeCadastro)
    .useValue({ canActivate: () => true })
    .compile();

  http = modulo.createNestApplication();
  http.useGlobalFilters(new FiltroDeProblema());
  await http.init();
}, 60_000);

afterAll(async () => {
  await http?.close();
  await fila.obliterate({ force: true });
  await fila.close();
  // Garantia extra: nenhuma chave do prefixo do teste fica no Redis de desenvolvimento.
  const restantes = await redis.keys(`${PREFIXO_DA_FILA}:*`);
  if (restantes.length > 0) {
    await redis.del(...restantes);
  }
  await redis.quit();

  const objetos = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${tenantA}/` }));
  const chaves = (objetos.Contents ?? []).flatMap((objeto) => (objeto.Key === undefined ? [] : [{ Key: objeto.Key }]));
  if (chaves.length > 0) {
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: chaves } }));
  }

  const c = await admin.connect();

  try {
    await c.query('set session_replication_role = replica');
    const tabelas = (
      await c.query<{ tabela: string }>(
        `select table_name as tabela from information_schema.columns where table_schema = 'app' and column_name = 'tenant_id'`,
      )
    ).rows;
    for (const tenantId of [tenantA, tenantB]) {
      for (const { tabela } of tabelas) {
        await c.query(`delete from app.${tabela} where tenant_id = $1`, [tenantId]);
      }
      await c.query('delete from app.tenant where id = $1', [tenantId]);
    }
  } finally {
    await c.query('reset session_replication_role');
    c.release();
  }
  await Promise.all([admin.end(), appPool.end()]);
});

describe('envio real (MinIO + BullMQ)', () => {
  it('guarda o original pela chave do hash e enfileira um job com o id determinístico', async () => {
    const conteudo = Buffer.from(MODELO_CSV, 'utf8');

    const visao = await servico.enviar(contexto(contador), empresa, { buffer: conteudo, nome: 'modelo.csv', mimetype: 'text/csv' }, MAPEAMENTO);

    const objeto = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${tenantA}/${empresa}/plano-contas/${visao.arquivo.hash}.csv` }),
    );
    expect(Buffer.from(await objeto.Body!.transformToByteArray()).equals(conteudo)).toBe(true);

    const job = await fila.getJob(idDoJobDeValidacao(visao.tentativaId));
    expect(job?.data).toEqual({
      tenantId: tenantA,
      empresaId: empresa,
      tentativaId: visao.tentativaId,
      correlationId: `corr-plano-${sufixo}`,
    });

    // Reenvio idêntico enquanto RECEBIDA: mesma tentativa, o job continua um só.
    const repetido = await servico.enviar(contexto(contador), empresa, { buffer: conteudo, nome: 'modelo.csv', mimetype: 'text/csv' }, MAPEAMENTO);
    expect(repetido.tentativaId).toBe(visao.tentativaId);
    expect((await fila.getJobs(['waiting', 'delayed', 'active'])).filter((j) => j.id === job?.id)).toHaveLength(1);
    poolLivre();
  });
});

describe('confirmação, pendência e relatório', () => {
  let tentativaId = '';

  it('duas confirmações simultâneas: uma aplica, a outra recebe ESTADO_INVALIDO_PARA_ACAO; nada duplica', async () => {
    // Sem conta válida a pendência do plano fica aberta (o que a ativação faria).
    await comContextoHumano(appPool, { tenantId: tenantA, usuarioId: contador }, (cliente) =>
      reconciliarPendenciaDoPlano(cliente, { tenantId: tenantA, empresaId: empresa, usuarioId: contador, agora: new Date() }),
    );
    expect(await pendenciaDoPlano(empresa)).toBe('ABERTA');

    const enviada = await servico.enviar(
      contexto(contador),
      empresa,
      { buffer: csv(['1;Ativo;sintetica;devedora;', '1.1;Circulante;sintetica;devedora;1', '=SOMA(1);x;sintetica;devedora;9']), nome: 'plano.csv', mimetype: 'text/csv' },
      MAPEAMENTO,
    );
    tentativaId = enviada.tentativaId;
    await validarComoWorker(empresa, tentativaId, [valida(2, '1', null), valida(3, '1.1', '1'), rejeitada(4, '=SOMA(1)')]);

    const previa = await servico.previa(contexto(contador), empresa, tentativaId);
    expect(previa).toMatchObject({ estado: 'AGUARDANDO_CONFIRMACAO', podeConfirmar: true, versaoDaPrevia: 0 });

    const resultados = await Promise.allSettled([
      servico.confirmar(contexto(contador), empresa, tentativaId, previa.versaoDaPrevia!),
      servico.confirmar(contexto(contador), empresa, tentativaId, previa.versaoDaPrevia!),
    ]);

    const aplicadas = resultados.filter((r) => r.status === 'fulfilled');
    const recusadas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(aplicadas).toHaveLength(1);
    expect(recusadas.map((r) => (r.reason as { codigo?: string }).codigo)).toEqual([CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO]);
    expect((aplicadas[0] as PromiseFulfilledResult<{ estado: string; totais: unknown }>).value).toMatchObject({
      estado: 'CONCLUIDA_COM_REJEICOES',
      totais: { lidas: 3, novas: 2, atualizadas: 0, rejeitadas: 1 },
    });

    const contas = await admin.query<{ codigo: string }>(
      `select codigo from app.conta_contabil where empresa_id = $1 order by codigo`,
      [empresa],
    );
    expect(contas.rows.map((r) => r.codigo)).toEqual(['1', '1.1']);
    const notificacoes = await admin.query(`select usuario_id from app.importacao_plano_contas_notificacao where tentativa_id = $1`, [
      tentativaId,
    ]);
    expect(notificacoes.rows).toEqual([{ usuario_id: contador }]);
    expect(await pendenciaDoPlano(empresa)).toBe('RESOLVIDA');
    poolLivre();
  });

  it('reenvio idêntico depois da conclusão reutiliza o resultado e não notifica de novo', async () => {
    const repetido = await servico.enviar(
      contexto(contador),
      empresa,
      { buffer: csv(['1;Ativo;sintetica;devedora;', '1.1;Circulante;sintetica;devedora;1', '=SOMA(1);x;sintetica;devedora;9']), nome: 'plano.csv', mimetype: 'text/csv' },
      MAPEAMENTO,
    );

    expect(repetido).toMatchObject({ tentativaId, estado: 'CONCLUIDA_COM_REJEICOES', reutilizadaPorIdempotencia: true });
    const notificacoes = await admin.query(`select 1 from app.importacao_plano_contas_notificacao where tentativa_id = $1`, [tentativaId]);
    expect(notificacoes.rowCount).toBe(1);
  });

  it('relatório por HTTP: CSV com BOM, fórmula neutralizada e conexão devolvida ao pool', async () => {
    const resposta = await request(http.getHttpServer())
      .get(`/empresas/${empresa}/plano-contas/importacoes/${tentativaId}/relatorio`)
      .set('x-papel', 'auxiliar')
      .set('x-usuario', auxiliar)
      .expect(200);

    expect(resposta.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(resposta.text.startsWith(BOM)).toBe(true);
    expect(resposta.text).toContain(`'=SOMA(1)`);
    expect(resposta.text).not.toMatch(/;=SOMA/u);
    await vi.waitFor(poolLivre);
  });

  it('relatório abandonado no meio: o cursor fecha e a conexão volta ao pool', async () => {
    const { conteudo } = await servico.relatorio(contexto(contador), empresa, tentativaId);
    await new Promise((resolver) => conteudo.once('data', resolver));
    conteudo.destroy();

    await vi.waitFor(poolLivre);
    expect(conteudo.destroyed).toBe(true);
  });

  it('a ativação de uma empresa sem conta abre a pendência do plano de contas', async () => {
    const empresas = new EmpresaService({ instancia: appPool } as PoolDoBanco, {} as never);

    await empresas.ativar(tenantA, contador, aAtivar, true);

    expect(await pendenciaDoPlano(aAtivar)).toBe('ABERTA');
  });
});

describe('falhas na confirmação e no relatório', () => {
  it('falha técnica na aplicação: nada aplicado, tentativa em FALHA com um evento de código estável, reenvio cria nova', async () => {
    const arquivo = { buffer: csv(['5;Cinco;sintetica;devedora;FANTASMA']), nome: 'falha.csv', mimetype: 'text/csv' };
    const enviada = await servico.enviar(contexto(contador), empresaFalha, arquivo, MAPEAMENTO);
    // Staging "válido" com pai inexistente: a FK diferida da conta-pai recusa na aplicação (23503),
    // falha técnica determinística (a validação real nunca deixaria passar).
    await validarComoWorker(empresaFalha, enviada.tentativaId, [valida(2, '5', 'FANTASMA')]);

    const erro = await servico.confirmar(contexto(contador), empresaFalha, enviada.tentativaId, 0).catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.FALHA_TECNICA, detalhes: { tentativaId: enviada.tentativaId } });
    const tentativa = await admin.query<{ estado: string; usuario_confirmador_id: string; finalizado_em: Date | null }>(
      `select estado, usuario_confirmador_id, finalizado_em from app.importacao_plano_contas where id = $1`,
      [enviada.tentativaId],
    );
    expect(tentativa.rows[0]).toMatchObject({ estado: 'FALHA', usuario_confirmador_id: contador });
    expect(tentativa.rows[0]!.finalizado_em).not.toBeNull();
    const falhas = await admin.query<{ codigo: string; correlation_id: string; estado_anterior: string }>(
      `select codigo, correlation_id, estado_anterior from app.importacao_plano_contas_evento
        where tentativa_id = $1 and acao = 'FALHA_TECNICA'`,
      [enviada.tentativaId],
    );
    expect(falhas.rows).toEqual([{ codigo: 'FALHA_NA_APLICACAO', correlation_id: `corr-plano-${sufixo}`, estado_anterior: 'APLICANDO' }]);
    const contas = await admin.query(`select 1 from app.conta_contabil where empresa_id = $1`, [empresaFalha]);
    expect(contas.rowCount).toBe(0);
    // Desfecho acionável: a prévia da FALHA expõe o código estável e a mensagem fechada (SPEC-013 §7).
    expect((await servico.previa(contexto(contador), empresaFalha, enviada.tentativaId)).diagnostico).toEqual({
      codigo: 'FALHA_NA_APLICACAO',
      mensagem: 'Uma falha técnica interrompeu a aplicação e nenhuma conta foi alterada. Envie o arquivo de novo.',
    });

    // O índice de idempotência ignora FALHA: o mesmo arquivo com o mesmo mapeamento vira tentativa nova.
    const nova = await servico.enviar(contexto(contador), empresaFalha, arquivo, MAPEAMENTO);
    expect(nova.tentativaId).not.toBe(enviada.tentativaId);
    expect(nova.estado).toBe('RECEBIDA');
    poolLivre();
  });

  it('conta arquivada depois da prévia: CONFLITO_DE_VERSAO, nada aplicado e a tentativa segue aguardando', async () => {
    await admin.query(
      `insert into app.conta_contabil (tenant_id, empresa_id, codigo, nome, tipo, natureza, arquivada, arquivada_em)
       values ($1, $2, 'Z', 'Zeta original', 'sintetica', 'devedora', true, now())`,
      [tenantA, empresaArquivada],
    );
    const enviada = await servico.enviar(
      contexto(contador),
      empresaArquivada,
      { buffer: csv(['Z;Zeta nova;sintetica;devedora;']), nome: 'arquivada.csv', mimetype: 'text/csv' },
      MAPEAMENTO,
    );
    await validarComoWorker(empresaArquivada, enviada.tentativaId, [valida(2, 'Z', null)]);

    const erro = await servico.confirmar(contexto(contador), empresaArquivada, enviada.tentativaId, 0).catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO });
    const estado = await admin.query<{ estado: string }>(`select estado from app.importacao_plano_contas where id = $1`, [
      enviada.tentativaId,
    ]);
    expect(estado.rows[0]!.estado).toBe('AGUARDANDO_CONFIRMACAO');
    const conta = await admin.query<{ nome: string }>(`select nome from app.conta_contabil where empresa_id = $1`, [empresaArquivada]);
    expect(conta.rows).toEqual([{ nome: 'Zeta original' }]);
  });

  it('leitores que nunca consomem o relatório não esgotam o pool: o servidor encerra a sessão ociosa', async () => {
    const enviada = await servico.enviar(
      contexto(contador),
      empresaGrande,
      { buffer: csv(['1;Grande;sintetica;devedora;']), nome: 'grande.csv', mimetype: 'text/csv' },
      MAPEAMENTO,
    );
    await validarComoWorker(
      empresaGrande,
      enviada.tentativaId,
      Array.from({ length: 3_000 }, (_v, i) => valida(i + 2, `G${String(i).padStart(5, '0')}`, null)),
    );

    // Pool de 2: se as duas conexões ficassem presas, a terceira consulta esperaria para sempre.
    const pequeno = new Pool({ connectionString: obterUrlDaAplicacao(), max: 2 });
    pequeno.on('error', () => undefined);
    const lento = new PlanoContasService({ instancia: pequeno } as PoolDoBanco, storage, filaDaApi, {
      ociosidadeMs: 300,
      totalMs: 60_000,
    });

    try {
      const relatorios = await Promise.all([
        lento.relatorio(contexto(contador), empresaGrande, enviada.tentativaId),
        lento.relatorio(contexto(contador), empresaGrande, enviada.tentativaId),
      ]);
      for (const { conteudo } of relatorios) {
        conteudo.on('error', () => undefined);
      }

      await vi.waitFor(
        () => {
          expect(relatorios.every(({ conteudo }) => conteudo.destroyed)).toBe(true);
          expect(pequeno.waitingCount).toBe(0);
          expect(pequeno.idleCount).toBe(pequeno.totalCount);
        },
        { timeout: 10_000, interval: 100 },
      );

      const previa = await lento.previa(contexto(contador), empresaGrande, enviada.tentativaId);
      expect(previa.totais).toMatchObject({ lidas: 3_000 });
    } finally {
      await pequeno.end();
    }
  });

  it('a fila do provider fecha a conexão Redis no shutdown, mesmo depois de usada', async () => {
    const provida = criarFilaDeValidacaoDoPlano({ REDIS_URL: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:16379' });

    // Comando fora do contrato: cria a fila (e a conexão) e é recusado antes de qualquer job.
    await expect(provida.enfileirar({ tenantId: 'x' } as never)).rejects.toThrow();
    await expect(provida.onModuleDestroy()).resolves.toBeUndefined();
  });
});

describe('autorização pelos guards reais (HTTP)', () => {
  const base = (empresaId: string): string => `/empresas/${empresaId}/plano-contas`;

  it('auxiliar não importa pela API direta (403), mesmo na própria carteira', async () => {
    const resposta = await request(http.getHttpServer())
      .post(`${base(empresa)}/importacoes`)
      .set('x-papel', 'auxiliar')
      .set('x-usuario', auxiliar)
      .attach('arquivo', csv(['9;Nova;sintetica;devedora;']), { filename: 'plano.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(403);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.SEM_AUTORIZACAO });
  });

  it('contador de empresa fora da carteira → 403 EMPRESA_FORA_DA_CARTEIRA, sem dado da importação', async () => {
    const resposta = await request(http.getHttpServer())
      .get(`${base(empresa)}/importacoes`)
      .set('x-usuario', contadorFora)
      .expect(403);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA });
    expect(JSON.stringify(resposta.body)).not.toContain('plano.csv');
  });

  it('outro tenant → 404, sem revelar que a empresa existe', async () => {
    const resposta = await request(http.getHttpServer())
      .get(`${base(empresa)}/importacoes/${'0'.repeat(8)}-0000-7000-8000-000000000000`)
      .set('x-tenant', tenantB)
      .set('x-usuario', usuarioB)
      .expect(404);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA });
  });

  it('id de tentativa de outra empresa (mesma carteira ou outro tenant) → 404 TENTATIVA_NAO_ENCONTRADA', async () => {
    const tentativa = (await admin.query<{ id: string }>(`select id from app.importacao_plano_contas where empresa_id = $1 limit 1`, [empresa]))
      .rows[0]!.id;

    for (const rota of ['', '/relatorio', '/arquivo', '/rejeicoes']) {
      await request(http.getHttpServer())
        .get(`${base(outraDaCarteira)}/importacoes/${tentativa}${rota}`)
        .expect(404)
        .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA }));
      await request(http.getHttpServer())
        .get(`${base(empresaB)}/importacoes/${tentativa}${rota}`)
        .set('x-tenant', tenantB)
        .set('x-usuario', usuarioB)
        .expect(404)
        .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA }));
    }
    await request(http.getHttpServer())
      .post(`${base(outraDaCarteira)}/importacoes/${tentativa}/cancelar`)
      .expect(404);
  });

  it('contador importa pela API: 202 com a tentativa RECEBIDA', async () => {
    const resposta = await request(http.getHttpServer())
      .post(`${base(outraDaCarteira)}/importacoes`)
      .attach('arquivo', csv(['7;Sete;sintetica;devedora;']), { filename: 'sete.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(202);

    expect(resposta.body).toMatchObject({ estado: 'RECEBIDA', arquivo: { nome: 'sete.csv' }, podeConfirmar: false });
  });
});
