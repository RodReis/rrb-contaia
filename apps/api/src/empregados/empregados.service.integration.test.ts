/**
 * Importação de empregados na API sobre a infraestrutura local real (SPEC-014 §3.6–§3.12,
 * §6.1–§6.4): PostgreSQL pelo papel `contaia_app` (RLS valendo), Redis/BullMQ e MinIO.
 *
 * O worker de validação é da Task 4: aqui ele é simulado no contexto técnico da empresa com o
 * domínio REAL (`lerCsv` → `normalizarLinhasDeEmpregados` → `validarLinhasDeEmpregados`) e o
 * repositório (`iniciarValidacao` + `gravarResultadoDaValidacaoDeEmpregados`). Autorização (chave
 * do catálogo, carteira, tenant) passa pelos guards REAIS sobre HTTP; só a sessão é dublada.
 */
import { randomInt } from 'node:crypto';

import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import {
  DESCRITOR_EMPREGADOS,
  carregarEmpregadosVigentes,
  cicloDeImportacao,
  comContexto,
  comContextoHumano,
  criarPool,
  criarPoolDaAplicacao,
  gravarResultadoDaValidacaoDeEmpregados,
} from '@contaia/db';
import {
  CODIGOS_DE_ERRO,
  MODELO_CSV_DE_EMPREGADOS,
  contextoTecnico,
  normalizarLinhasDeEmpregados,
  permissoesDosPapeisPadrao,
  validarLinhasDeEmpregados,
  type MapeamentoDeEmpregados,
  type PapelPadrao,
} from '@contaia/domain';
import { FILA_DE_VALIDACAO_EMPREGADOS, idDoJobDeValidacao, lerCsv } from '@contaia/shared';
import { Logger, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
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
import { enfileirarValidacao, type FilaDeValidacao } from '../importacao/fila';
import type { ContextoDaImportacao } from '../importacao/orquestrador';
import { EmpregadosDaEmpresaController } from './empregados.controller';
import { JOB_DE_VALIDACAO_DOS_EMPREGADOS } from './empregados.fila';
import { EmpregadosService } from './empregados.service';
import { reconciliarPendenciaDosEmpregados } from './pendencia-dos-empregados';

const admin: Pool = criarPool();
const appPool: Pool = criarPoolDaAplicacao();

const sufixo = `${String(process.pid).slice(-4).padStart(4, '0')}${String(Date.now()).slice(-6)}${randomInt(10, 99)}`;
const PREFIXO_DA_FILA = `teste-empregados-${sufixo}`;
const MAPEAMENTO: MapeamentoDeEmpregados = {
  cpf: 'cpf',
  nome: 'nome',
  matricula: 'matricula',
  data_nascimento: 'data_nascimento',
  data_admissao: 'data_admissao',
};
const BOM = String.fromCharCode(0xfeff);
/** Nome sentinela: a trigger de teste recusa o INSERT do empregado com ele (falha técnica real). */
const NOME_QUE_FALHA = `Falha Tecnica ${sufixo}`;
const CPF_A = '52998224725';
const CPF_B = '11144477735';
const CPF_C = '39053344705';

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
const fila = new Queue(FILA_DE_VALIDACAO_EMPREGADOS, { connection: redis, prefix: PREFIXO_DA_FILA });
const filaDaApi: FilaDeValidacao = {
  enfileirar: (comando) => enfileirarValidacao(fila, comando, undefined, JOB_DE_VALIDACAO_DOS_EMPREGADOS),
};

const storage = new StorageService();
const servico = new EmpregadosService({ instancia: appPool } as PoolDoBanco, storage, filaDaApi);

let tenantA = '';
let tenantB = '';
let adminA = '';
let adminB = '';
let adminSemVinculo = '';
let contador = '';
let auditor = '';
let contadorFora = '';
let usuarioB = '';
let empresa = '';
let outraDaCarteira = '';
let empresaFalha = '';
let empresaConflito = '';
let empresaArquivada = '';
let aAtivar = '';
let empresaB = '';
let http: INestApplication;

const unico = async (sql: string, parametros: unknown[]): Promise<string> =>
  (await admin.query<{ id: string }>(sql, parametros)).rows[0]!.id;

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
  correlationId: `corr-emp-${sufixo}`,
});

const csv = (linhas: readonly string[]): Buffer =>
  Buffer.from(['cpf;nome;matricula;data_nascimento;data_admissao', ...linhas, ''].join('\r\n'));

const enviarCsv = (usuarioId: string, empresaId: string, conteudo: Buffer, nome = 'empregados.csv') =>
  servico.enviar(contexto(usuarioId), empresaId, { buffer: conteudo, nome, mimetype: 'text/csv' }, MAPEAMENTO);

/** O que o worker da Task 4 fará, com o domínio real, no contexto técnico da empresa. */
const validarComoWorker = async (empresaId: string, tentativaId: string, conteudo: Buffer): Promise<void> => {
  await comContexto(
    appPool,
    contextoTecnico({
      identidadeTecnica: 'workers-empregados',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: tenantA,
      empresaId,
      correlationId: `corr-worker-${sufixo}`,
    }),
    async (cliente) => {
      const inicio = await cicloDeImportacao.iniciarValidacao(cliente, DESCRITOR_EMPREGADOS, empresaId, tentativaId, new Date());
      const vigentes = await carregarEmpregadosVigentes(cliente, empresaId);
      const lido = lerCsv(conteudo);
      const linhas = validarLinhasDeEmpregados(normalizarLinhasDeEmpregados(lido.cabecalho, lido.registros, MAPEAMENTO), vigentes);
      await gravarResultadoDaValidacaoDeEmpregados(cliente, empresaId, tentativaId, linhas, inicio.versaoNaValidacao, new Date());
    },
  );
};

const pendenciaDosEmpregados = async (empresaId: string): Promise<string | null> =>
  (
    await admin.query<{ estado: string }>(
      `select estado from app.empresa_pendencia where empresa_id = $1 and origem = 'EMPREGADOS'
        order by criado_em desc limit 1`,
      [empresaId],
    )
  ).rows[0]?.estado ?? null;

const empregadosDa = async (empresaId: string): Promise<Array<{ cpf: string; matricula: string; nome: string }>> =>
  (
    await admin.query<{ cpf: string; matricula: string; nome: string }>(
      `select cpf, matricula, nome from app.empregado where empresa_id = $1 order by cpf, matricula`,
      [empresaId],
    )
  ).rows;

const notificadosDa = async (tentativaId: string): Promise<string[]> =>
  (
    await admin.query<{ usuario_id: string }>(
      `select usuario_id from app.importacao_empregados_notificacao where tentativa_id = $1 order by usuario_id`,
      [tentativaId],
    )
  ).rows.map((r) => r.usuario_id);

const poolLivre = (): void => {
  expect(appPool.waitingCount).toBe(0);
  expect(appPool.idleCount).toBe(appPool.totalCount);
};

const sessaoDublada = {
  canActivate: (ctx: { switchToHttp: () => { getRequest: () => RequisicaoAutenticada } }) => {
    const requisicao = ctx.switchToHttp().getRequest();
    const papel = (requisicao.header('x-papel') ?? 'admin_escritorio') as PapelPadrao;

    requisicao.sessao = {
      tenantId: requisicao.header('x-tenant') ?? tenantA,
      usuarioId: requisicao.header('x-usuario') ?? adminA,
      papeis: [papel],
      permissoes: permissoesDosPapeisPadrao([papel]),
    } as unknown as NonNullable<RequisicaoAutenticada['sessao']>;

    return true;
  },
};

const base = (empresaId: string): string => `/empresas/${empresaId}/empregados`;

beforeAll(async () => {
  const novoTenant = (rotulo: string): Promise<string> =>
    unico(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
      `Empregados ${rotulo} ${sufixo}`,
      `${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'),
    ]);
  const novoUsuario = (tenantId: string, rotulo: string): Promise<string> =>
    unico(
      `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, $4, 'ATIVO') returning id`,
      [tenantId, `sub-emp-${rotulo}-${sufixo}`, `${rotulo}.${sufixo}@empregados.local`, `Usuário ${rotulo}`],
    );
  const comPapel = async (tenantId: string, usuarioId: string, papel: PapelPadrao): Promise<void> => {
    await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, $3)`, [tenantId, usuarioId, papel]);
  };
  const novaEmpresa = (tenantId: string, rotulo: string, situacao = 'ativo'): Promise<string> =>
    unico(
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, $3, 'ATIVA', $4) returning id`,
      [tenantId, `M${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa ${rotulo}`, situacao],
    );
  const vincular = (tenantId: string, usuarioId: string, empresaId: string): Promise<unknown> =>
    admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
      tenantId,
      usuarioId,
      empresaId,
    ]);

  tenantA = await novoTenant('A');
  tenantB = await novoTenant('B');
  adminA = await novoUsuario(tenantA, 'admin-a');
  adminB = await novoUsuario(tenantA, 'admin-b');
  adminSemVinculo = await novoUsuario(tenantA, 'admin-sem');
  contador = await novoUsuario(tenantA, 'contador');
  auditor = await novoUsuario(tenantA, 'auditor');
  contadorFora = await novoUsuario(tenantA, 'fora');
  usuarioB = await novoUsuario(tenantB, 'b');
  for (const usuario of [adminA, adminB, adminSemVinculo]) {
    await comPapel(tenantA, usuario, 'admin_escritorio');
  }
  await comPapel(tenantA, contador, 'contador');
  await comPapel(tenantA, auditor, 'auditor_readonly');
  await comPapel(tenantA, contadorFora, 'contador');
  await comPapel(tenantB, usuarioB, 'admin_escritorio');

  empresa = await novaEmpresa(tenantA, 'E');
  outraDaCarteira = await novaEmpresa(tenantA, 'O');
  empresaFalha = await novaEmpresa(tenantA, 'F');
  empresaConflito = await novaEmpresa(tenantA, 'C');
  empresaArquivada = await novaEmpresa(tenantA, 'Q', 'arquivado');
  empresaB = await novaEmpresa(tenantB, 'X');
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
  for (const empresaId of [empresa, outraDaCarteira, empresaFalha, empresaConflito, aAtivar]) {
    for (const usuario of [adminA, adminB, contador, auditor]) {
      await vincular(tenantA, usuario, empresaId);
    }
  }
  await vincular(tenantB, usuarioB, empresaB);

  // Falha técnica determinística na aplicação, com CPF e nome no `detail` (como um 23514 real).
  await admin.query(`
    create or replace function app.teste_falha_empregado_${sufixo}() returns trigger language plpgsql as $$
    begin
      if new.nome = '${NOME_QUE_FALHA}' then
        raise exception using errcode = '23514', message = 'violação de teste',
          detail = 'Failing row contains (' || new.cpf || ', ' || new.nome || ')';
      end if;
      return new;
    end $$`);
  await admin.query(
    `create trigger teste_falha_empregado_${sufixo} before insert on app.empregado
       for each row execute function app.teste_falha_empregado_${sufixo}()`,
  );

  await storage.onModuleInit();

  const modulo = await Test.createTestingModule({
    controllers: [EmpregadosDaEmpresaController],
    providers: [
      { provide: EmpregadosService, useValue: servico },
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
  await admin.query(`drop trigger if exists teste_falha_empregado_${sufixo} on app.empregado`);
  await admin.query(`drop function if exists app.teste_falha_empregado_${sufixo}()`);
  await fila.obliterate({ force: true });
  await fila.close();
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
  it('guarda o original em <tenant>/<empresa>/empregados/<hash>.csv e enfileira só ids', async () => {
    const conteudo = Buffer.from(MODELO_CSV_DE_EMPREGADOS, 'utf8');

    const visao = await enviarCsv(adminA, outraDaCarteira, conteudo, 'modelo.csv');

    const objeto = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${tenantA}/${outraDaCarteira}/empregados/${visao.arquivo.hash}.csv` }),
    );
    expect(Buffer.from(await objeto.Body!.transformToByteArray()).equals(conteudo)).toBe(true);
    const job = await fila.getJob(idDoJobDeValidacao(visao.tentativaId));
    expect(job?.name).toBe('validar-importacao');
    expect(job?.data).toEqual({
      tenantId: tenantA,
      empresaId: outraDaCarteira,
      tentativaId: visao.tentativaId,
      correlationId: `corr-emp-${sufixo}`,
    });
    expect(JSON.stringify(job?.data)).not.toContain('Maria');
    poolLivre();
  });
});

describe('confirmação, notificação, pendência e relatório', () => {
  const CONTEUDO = csv([
    `${CPF_A};Maria da Silva;00123;15/03/1990;01/02/2015`,
    `${CPF_B};João de Souza;00124;22/11/1985;10/06/2018`,
    `123;Inválido;9;15/03/1990;01/02/2015`,
    `${CPF_C};=SOMA(1);+0012;31/02/2020;01/02/2015`,
  ]);
  let tentativaId = '';

  it('duas confirmações simultâneas: uma aplica, a outra ESTADO_INVALIDO_PARA_ACAO; sem duplicar empregado nem aviso', async () => {
    await comContextoHumano(appPool, { tenantId: tenantA, usuarioId: adminA }, (cliente) =>
      reconciliarPendenciaDosEmpregados(cliente, { tenantId: tenantA, empresaId: empresa, usuarioId: adminA, agora: new Date() }),
    );
    expect(await pendenciaDosEmpregados(empresa)).toBe('ABERTA');

    const enviada = await enviarCsv(adminA, empresa, CONTEUDO);
    tentativaId = enviada.tentativaId;
    await validarComoWorker(empresa, tentativaId, CONTEUDO);
    const previa = await servico.previa(contexto(adminB), empresa, tentativaId);
    expect(previa).toMatchObject({
      estado: 'AGUARDANDO_CONFIRMACAO',
      versaoDaPrevia: 0,
      totais: { lidas: 4, novas: 2, atualizadas: 0, rejeitadas: 2 },
    });
    expect(previa.amostraRejeicoes.map((r) => r.codigoDeErro).sort()).toEqual(['CPF_INVALIDO', 'DATA_NASCIMENTO_INVALIDA']);
    // Nada muda antes da confirmação humana.
    expect(await empregadosDa(empresa)).toEqual([]);

    const resultados = await Promise.allSettled([
      servico.confirmar(contexto(adminB), empresa, tentativaId, 0),
      servico.confirmar(contexto(adminB), empresa, tentativaId, 0),
    ]);

    const aplicadas = resultados.filter((r) => r.status === 'fulfilled');
    const recusadas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(aplicadas).toHaveLength(1);
    expect(recusadas.map((r) => (r.reason as { codigo?: string }).codigo)).toEqual([CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO]);
    expect(await empregadosDa(empresa)).toEqual([
      { cpf: CPF_B, matricula: '00124', nome: 'João de Souza' },
      { cpf: CPF_A, matricula: '00123', nome: 'Maria da Silva' },
    ]);
    // Iniciador + admins autorizados (com a empresa na carteira); contador, auditor e admin sem vínculo, não.
    expect(await notificadosDa(tentativaId)).toEqual([adminA, adminB].sort());
    expect(await pendenciaDosEmpregados(empresa)).toBe('RESOLVIDA');
    poolLivre();
  });

  it('reenvio idêntico depois da conclusão reutiliza o resultado: sem job novo nem aviso novo', async () => {
    const jobs = async (): Promise<number> => (await fila.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'])).length;
    const antes = await jobs();

    const repetido = await enviarCsv(adminA, empresa, CONTEUDO);

    expect(repetido).toMatchObject({ tentativaId, estado: 'CONCLUIDA_COM_REJEICOES', reutilizadaPorIdempotencia: true });
    expect(await notificadosDa(tentativaId)).toHaveLength(2);
    expect(await jobs()).toBe(antes);
  });

  it('relatório por HTTP (auditor): BOM, `;`, CPF, matrícula, código e fórmula neutralizada', async () => {
    const resposta = await request(http.getHttpServer())
      .get(`${base(empresa)}/importacoes/${tentativaId}/relatorio`)
      .set('x-papel', 'auditor_readonly')
      .set('x-usuario', auditor)
      .expect(200);

    expect(resposta.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(resposta.text.startsWith(BOM)).toBe(true);
    expect(resposta.text).toContain(`${CPF_A};Maria da Silva;00123`);
    expect(resposta.text).toContain('CPF_INVALIDO');
    expect(resposta.text).toContain(`'=SOMA(1)`);
    expect(resposta.text).toContain(`'+0012`);
    await vi.waitFor(poolLivre);
  });

  it('base paginada por HTTP (contador): ordem por nome, busca por nome, matrícula e CPF com máscara', async () => {
    const consultar = (consulta: string) =>
      request(http.getHttpServer()).get(`${base(empresa)}${consulta}`).set('x-papel', 'contador').set('x-usuario', contador).expect(200);

    expect((await consultar('')).body).toMatchObject({ pagina: 1, itensPorPagina: 50, total: 2 });
    expect((await consultar('')).body.itens.map((e: { nome: string }) => e.nome)).toEqual(['João de Souza', 'Maria da Silva']);
    expect((await consultar('?busca=maria')).body.itens).toEqual([expect.objectContaining({ cpf: CPF_A, matricula: '00123' })]);
    expect((await consultar('?busca=529.982.247-25')).body.total).toBe(1);
    expect((await consultar('?busca=00124')).body.itens).toEqual([expect.objectContaining({ cpf: CPF_B })]);
  });

  it('a ativação de uma empresa sem empregado abre a pendência EMPREGADOS', async () => {
    const empresas = new EmpresaService({ instancia: appPool } as PoolDoBanco, {} as never);

    await empresas.ativar(tenantA, adminA, aAtivar, true);

    expect(await pendenciaDosEmpregados(aAtivar)).toBe('ABERTA');
  });
});

describe('falhas, conflito e cancelamento', () => {
  it('falha técnica por HTTP: base intacta, FALHA com código estável, nada de CPF/nome na resposta nem no log', async () => {
    const conteudo = csv([`${CPF_A};${NOME_QUE_FALHA};1;15/03/1990;01/02/2015`]);
    const enviada = await enviarCsv(adminA, empresaFalha, conteudo);
    await validarComoWorker(empresaFalha, enviada.tentativaId, conteudo);
    const log = vi.spyOn(Logger.prototype, 'error');

    const resposta = await request(http.getHttpServer())
      .post(`${base(empresaFalha)}/importacoes/${enviada.tentativaId}/confirmar`)
      .set('x-correlation-id', `corr-http-falha-${sufixo}`)
      .send({ versaoDaPrevia: 0 })
      .expect(500);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.FALHA_TECNICA, correlationId: `corr-http-falha-${sufixo}` });
    expect(resposta.body.title).toContain('Nenhum empregado foi alterado');
    const tudo = `${JSON.stringify(resposta.body)} ${JSON.stringify(log.mock.calls)}`;
    expect(tudo).not.toContain(CPF_A);
    expect(tudo).not.toContain(NOME_QUE_FALHA);
    log.mockRestore();
    expect(await empregadosDa(empresaFalha)).toEqual([]);
    const eventos = await admin.query<{ codigo: string; correlation_id: string }>(
      `select codigo, correlation_id from app.importacao_empregados_evento where tentativa_id = $1 and acao = 'FALHA_TECNICA'`,
      [enviada.tentativaId],
    );
    expect(eventos.rows).toEqual([{ codigo: 'FALHA_NA_APLICACAO', correlation_id: `corr-http-falha-${sufixo}` }]);
    expect((await servico.previa(contexto(adminA), empresaFalha, enviada.tentativaId)).diagnostico).toMatchObject({
      codigo: 'FALHA_NA_APLICACAO',
    });
    expect(await notificadosDa(enviada.tentativaId)).toEqual([adminA, adminB].sort());
    poolLivre();
  });

  it('versão velha por HTTP → 409 CONFLITO_DE_VERSAO sem aplicar; base que mudou depois da prévia também', async () => {
    const x = csv([`${CPF_A};Xis;1;15/03/1990;01/02/2015`]);
    const y = csv([`${CPF_B};Ipsilon;2;15/03/1990;01/02/2015`]);
    const primeira = await enviarCsv(adminA, empresaConflito, x, 'x.csv');
    const segunda = await enviarCsv(adminA, empresaConflito, y, 'y.csv');
    await validarComoWorker(empresaConflito, primeira.tentativaId, x);
    await validarComoWorker(empresaConflito, segunda.tentativaId, y);

    const velha = await request(http.getHttpServer())
      .post(`${base(empresaConflito)}/importacoes/${primeira.tentativaId}/confirmar`)
      .send({ versaoDaPrevia: 5 })
      .expect(409);
    expect(velha.body).toMatchObject({ code: CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO });
    expect(await empregadosDa(empresaConflito)).toEqual([]);

    await servico.confirmar(contexto(adminA), empresaConflito, primeira.tentativaId, 0);
    const obsoleta = await servico.confirmar(contexto(adminA), empresaConflito, segunda.tentativaId, 0).catch((e: unknown) => e);

    expect(obsoleta).toMatchObject({ codigo: CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO });
    expect(await empregadosDa(empresaConflito)).toEqual([{ cpf: CPF_A, matricula: '1', nome: 'Xis' }]);
    expect((await servico.previa(contexto(adminA), empresaConflito, segunda.tentativaId)).estado).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('cancelar só em AGUARDANDO_CONFIRMACAO: não altera a base e mantém arquivo, relatório e eventos', async () => {
    const conteudo = csv([`${CPF_C};Cancelado;77;15/03/1990;01/02/2015`]);
    const enviada = await enviarCsv(adminA, empresaConflito, conteudo, 'cancelar.csv');

    const cedo = await request(http.getHttpServer()).post(`${base(empresaConflito)}/importacoes/${enviada.tentativaId}/cancelar`).expect(409);
    expect(cedo.body).toMatchObject({ code: CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO });

    await validarComoWorker(empresaConflito, enviada.tentativaId, conteudo);
    const cancelada = await request(http.getHttpServer())
      .post(`${base(empresaConflito)}/importacoes/${enviada.tentativaId}/cancelar`)
      .set('x-usuario', adminB)
      .expect(200);

    expect(cancelada.body).toMatchObject({ estado: 'CANCELADA', relatorioDisponivel: true, podeConfirmar: false });
    expect(await empregadosDa(empresaConflito)).not.toContainEqual(expect.objectContaining({ cpf: CPF_C }));
    await request(http.getHttpServer()).get(`${base(empresaConflito)}/importacoes/${enviada.tentativaId}/arquivo`).expect(200);
    await request(http.getHttpServer()).get(`${base(empresaConflito)}/importacoes/${enviada.tentativaId}/relatorio`).expect(200);
    const tentativa = await admin.query<{ usuario_cancelador_id: string }>(
      `select usuario_cancelador_id from app.importacao_empregados where id = $1`,
      [enviada.tentativaId],
    );
    expect(tentativa.rows[0]!.usuario_cancelador_id).toBe(adminB);
    const acoes = await admin.query<{ acao: string }>(
      `select acao from app.importacao_empregados_evento where tentativa_id = $1 order by ocorrido_em, acao`,
      [enviada.tentativaId],
    );
    expect(acoes.rows.map((r) => r.acao)).toContain('CANCELAR');
    await request(http.getHttpServer()).post(`${base(empresaConflito)}/importacoes/${enviada.tentativaId}/cancelar`).expect(409);
    await vi.waitFor(poolLivre);
  });
});

describe('autorização pelos guards reais (HTTP)', () => {
  it('contador e auditor não importam nem confirmam (403), mas consultam e baixam o modelo', async () => {
    for (const [papel, usuario] of [
      ['contador', contador],
      ['auditor_readonly', auditor],
    ] as const) {
      await request(http.getHttpServer())
        .post(`${base(empresa)}/importacoes`)
        .set('x-papel', papel)
        .set('x-usuario', usuario)
        .attach('arquivo', csv([`${CPF_A};Maria;1;15/03/1990;01/02/2015`]), { filename: 'e.csv', contentType: 'text/csv' })
        .field('mapeamento', JSON.stringify(MAPEAMENTO))
        .expect(403)
        .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.SEM_AUTORIZACAO }));
      await request(http.getHttpServer())
        .post(`${base(empresa)}/importacoes/${'0'.repeat(8)}-0000-7000-8000-000000000000/confirmar`)
        .set('x-papel', papel)
        .set('x-usuario', usuario)
        .send({ versaoDaPrevia: 0 })
        .expect(403);
      await request(http.getHttpServer()).get(`${base(empresa)}/importacoes`).set('x-papel', papel).set('x-usuario', usuario).expect(200);
      await request(http.getHttpServer()).get(`${base(empresa)}/modelo`).set('x-papel', papel).set('x-usuario', usuario).expect(200);
    }
  });

  it('fora da carteira → 403 EMPRESA_FORA_DA_CARTEIRA, sem dado da importação', async () => {
    const resposta = await request(http.getHttpServer())
      .get(`${base(empresa)}/importacoes`)
      .set('x-papel', 'contador')
      .set('x-usuario', contadorFora)
      .expect(403);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA });
    expect(JSON.stringify(resposta.body)).not.toContain('empregados.csv');
  });

  it('outro tenant → 404 sem revelar a empresa; tentativa de outra empresa → 404 TENTATIVA_NAO_ENCONTRADA', async () => {
    const resposta = await request(http.getHttpServer())
      .get(`${base(empresa)}`)
      .set('x-tenant', tenantB)
      .set('x-usuario', usuarioB)
      .expect(404);
    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA });

    const tentativa = (await admin.query<{ id: string }>(`select id from app.importacao_empregados where empresa_id = $1 limit 1`, [empresa]))
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
        .expect(404);
    }
  });

  it('empresa arquivada recusa o envio (409 EMPRESA_ARQUIVADA) sem criar tentativa', async () => {
    // Arquivada e sem vínculo: só o administrador a alcança (SPEC-009), e para consulta.
    const resposta = await request(http.getHttpServer())
      .post(`${base(empresaArquivada)}/importacoes`)
      .set('x-usuario', adminSemVinculo)
      .attach('arquivo', csv([`${CPF_A};Maria;1;15/03/1990;01/02/2015`]), { filename: 'e.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(409);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA });
    const tentativas = await admin.query(`select 1 from app.importacao_empregados where empresa_id = $1`, [empresaArquivada]);
    expect(tentativas.rowCount).toBe(0);
  });

  it('admin importa pela API: 202, tentativa RECEBIDA e correlationId da requisição na trilha', async () => {
    const resposta = await request(http.getHttpServer())
      .post(`${base(outraDaCarteira)}/importacoes`)
      .set('x-correlation-id', `corr-http-envio-${sufixo}`)
      .attach('arquivo', csv([`${CPF_B};Sete;7;15/03/1990;01/02/2015`]), { filename: 'sete.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(202);

    expect(resposta.body).toMatchObject({ estado: 'RECEBIDA', arquivo: { nome: 'sete.csv' }, correlationId: `corr-http-envio-${sufixo}` });
  });
});
