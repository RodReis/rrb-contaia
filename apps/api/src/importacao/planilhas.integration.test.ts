/**
 * Envio de XLSX/ODS pela API sobre a infraestrutura local real (SPEC-015 §3.7–§3.9, §6.3, §10), nos
 * dois domínios: PostgreSQL pelo papel `contaia_app` (RLS valendo), Redis/BullMQ, MinIO e o leitor
 * REAL em processo filho. Guards reais (chave do catálogo, carteira, tenant) sobre HTTP; só a sessão
 * é dublada. O worker (Task 5) é simulado pelo repositório no contexto técnico, como nas F13/F14.
 */
import { randomInt } from 'node:crypto';

import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import {
  comContexto,
  criarPool,
  criarPoolDaAplicacao,
  gravarResultadoDaValidacao,
  iniciarValidacaoDaImportacao,
  registrarLeituraDaPlanilhaDaImportacao,
} from '@contaia/db';
import { CODIGOS_DE_ERRO, contextoTecnico, permissoesDosPapeisPadrao, type PapelPadrao } from '@contaia/domain';
import {
  FILA_DE_VALIDACAO_EMPREGADOS,
  FILA_DE_VALIDACAO_PLANO_CONTAS,
  TIPO_DE_CONTEUDO_ODS,
  TIPO_DE_CONTEUDO_XLSX,
  idDoJobDeValidacao,
} from '@contaia/shared';
import type { INestApplication } from '@nestjs/common';
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
import { EmpregadosDaEmpresaController } from '../empregados/empregados.controller';
import { JOB_DE_VALIDACAO_DOS_EMPREGADOS } from '../empregados/empregados.fila';
import { EmpregadosService } from '../empregados/empregados.service';
import { PlanoContasDaEmpresaController } from '../plano-contas/plano-contas.controller';
import { enfileirarValidacao as enfileirarNoPlano } from '../plano-contas/plano-contas.fila';
import { PlanoContasService } from '../plano-contas/plano-contas.service';
import { enfileirarValidacao, type FilaDeValidacao } from './fila';
import { planilhaOds, planilhaXlsx, type AbaDeTeste } from './planilhas-de-teste';

const admin: Pool = criarPool();
const appPool: Pool = criarPoolDaAplicacao();

const sufixo = `${String(process.pid).slice(-4).padStart(4, '0')}${String(Date.now()).slice(-6)}${randomInt(10, 99)}`;
const CPF = '529.982.247-25';
const NOME = `Maria Sigilosa ${sufixo}`;

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
const filaDoPlano = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS, { connection: redis, prefix: `teste-planilha-plano-${sufixo}` });
const filaDosEmpregados = new Queue(FILA_DE_VALIDACAO_EMPREGADOS, { connection: redis, prefix: `teste-planilha-emp-${sufixo}` });
const apiDoPlano: FilaDeValidacao = { enfileirar: (comando) => enfileirarNoPlano(filaDoPlano, comando) };
const apiDosEmpregados: FilaDeValidacao = {
  enfileirar: (comando) => enfileirarValidacao(filaDosEmpregados, comando, undefined, JOB_DE_VALIDACAO_DOS_EMPREGADOS),
};

const storage = new StorageService();
const pool = { instancia: appPool } as PoolDoBanco;
const planoService = new PlanoContasService(pool, storage, apiDoPlano);
const empregadosService = new EmpregadosService(pool, storage, apiDosEmpregados);

let tenantA = '';
let tenantB = '';
let adminA = '';
let contador = '';
let contadorFora = '';
let usuarioB = '';
let empresaP = '';
let empresaE = '';
let outraDaCarteira = '';
let empresaB = '';
let http: INestApplication;

const saida: string[] = [];

const unico = async (sql: string, parametros: unknown[]): Promise<string> =>
  (await admin.query<{ id: string }>(sql, parametros)).rows[0]!.id;

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

beforeAll(async () => {
  for (const fluxo of [process.stdout, process.stderr]) {
    const original = fluxo.write.bind(fluxo);
    vi.spyOn(fluxo, 'write').mockImplementation(((pedaco: string | Uint8Array, ...resto: never[]) => {
      saida.push(String(pedaco));
      return original(pedaco, ...resto);
    }) as typeof fluxo.write);
  }

  const novoTenant = (rotulo: string): Promise<string> =>
    unico(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
      `Planilha ${rotulo} ${sufixo}`,
      `P${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'),
    ]);
  const novoUsuario = async (tenantId: string, rotulo: string, papel: PapelPadrao): Promise<string> => {
    const id = await unico(
      `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, $4, 'ATIVO') returning id`,
      [tenantId, `sub-pl-${rotulo}-${sufixo}`, `${rotulo}.${sufixo}@planilha.local`, `Usuário ${rotulo}`],
    );
    await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, $3)`, [tenantId, id, papel]);
    return id;
  };
  const novaEmpresa = (tenantId: string, rotulo: string): Promise<string> =>
    unico(
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
      [tenantId, `L${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa ${rotulo}`],
    );
  const vincular = (tenantId: string, usuarioId: string, empresaId: string): Promise<unknown> =>
    admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
      tenantId,
      usuarioId,
      empresaId,
    ]);

  tenantA = await novoTenant('A');
  tenantB = await novoTenant('B');
  adminA = await novoUsuario(tenantA, 'admin', 'admin_escritorio');
  contador = await novoUsuario(tenantA, 'contador', 'contador');
  contadorFora = await novoUsuario(tenantA, 'fora', 'contador');
  usuarioB = await novoUsuario(tenantB, 'b', 'admin_escritorio');
  empresaP = await novaEmpresa(tenantA, 'P');
  empresaE = await novaEmpresa(tenantA, 'E');
  outraDaCarteira = await novaEmpresa(tenantA, 'O');
  empresaB = await novaEmpresa(tenantB, 'X');
  for (const empresaId of [empresaP, empresaE, outraDaCarteira]) {
    await vincular(tenantA, adminA, empresaId);
    await vincular(tenantA, contador, empresaId);
  }
  await vincular(tenantB, usuarioB, empresaB);

  await storage.onModuleInit().catch((erro: unknown) => {
    // Suítes em paralelo criam o mesmo bucket ao mesmo tempo.
    if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/u.test(String((erro as Error).name))) throw erro;
  });

  const modulo = await Test.createTestingModule({
    controllers: [PlanoContasDaEmpresaController, EmpregadosDaEmpresaController],
    providers: [
      { provide: PlanoContasService, useValue: planoService },
      { provide: EmpregadosService, useValue: empregadosService },
      { provide: PoolDoBanco, useValue: pool },
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
  vi.restoreAllMocks();
  await http?.close();
  for (const fila of [filaDoPlano, filaDosEmpregados]) {
    await fila.obliterate({ force: true });
    await fila.close();
  }
  for (const prefixo of [`teste-planilha-plano-${sufixo}`, `teste-planilha-emp-${sufixo}`]) {
    const restantes = await redis.keys(`${prefixo}:*`);
    if (restantes.length > 0) await redis.del(...restantes);
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

  // Nada do conteúdo da planilha passou pelo log (CPF, nome, valor de célula).
  const tudo = saida.join('');
  expect(tudo).not.toContain(CPF);
  expect(tudo).not.toContain(NOME);
});

const DOMINIOS = [
  {
    dominio: 'plano de contas',
    rota: 'plano-contas',
    tabela: 'importacao_plano_contas',
    evento: 'importacao_plano_contas_evento',
    notificacao: 'importacao_plano_contas_notificacao',
    papel: 'contador' as PapelPadrao,
    usuario: () => contador,
    empresa: () => empresaP,
    fila: filaDoPlano,
    cabecalho: ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'],
    dados: [
      // A 5ª coluna preenchida deixa a linha 4 servir de cabeçalho alternativo no teste das variações.
      ['1', 'Ativo', 'sintetica', 'devedora', 'raiz'],
      ['1.1', NOME, 'analitica', 'devedora', '1'],
    ],
    mapeamento: { codigo: 'A', nome: 'B', tipo: 'C', natureza: 'D', conta_pai: 'E' },
  },
  {
    dominio: 'empregados',
    rota: 'empregados',
    tabela: 'importacao_empregados',
    evento: 'importacao_empregados_evento',
    notificacao: 'importacao_empregados_notificacao',
    papel: 'admin_escritorio' as PapelPadrao,
    usuario: () => adminA,
    empresa: () => empresaE,
    fila: filaDosEmpregados,
    cabecalho: ['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao'],
    dados: [
      [CPF, NOME, '00123', '15/03/1990', '01/02/2015'],
      ['111.444.777-35', 'João', '00124', '22/11/1985', '10/06/2018'],
    ],
    mapeamento: { cpf: 'A', nome: 'B', matricula: 'C', data_nascimento: 'D', data_admissao: 'E' },
  },
] as const;

/** Título na linha 1, cabeçalho na 3, dados na 4 e na 5 (oculta); e uma segunda aba igual a partir da linha 1. */
const abas = (cabecalho: readonly string[], dados: readonly (readonly string[])[], titulo: string): AbaDeTeste[] => [
  {
    nome: 'Cadastro',
    linhas: [
      // O título muda o hash: cada teste tem a sua planilha (sem reuso acidental entre testes).
      { numero: 1, valores: [titulo] },
      { numero: 3, valores: cabecalho },
      { numero: 4, valores: dados[0]! },
      // Linha oculta e com fórmula em coluna mapeada: rejeição de LINHA (worker), nunca do envio.
      { numero: 5, valores: dados[1]!, oculta: true, formulaEm: 'C' },
    ],
  },
  { nome: 'Cópia', linhas: [{ numero: 1, valores: cabecalho }, ...dados.map((valores, i) => ({ numero: i + 2, valores }))] },
];

describe.each(DOMINIOS)('$dominio: envio de planilha até a prévia', (d) => {
  const base = (empresaId: string): string => `/empresas/${empresaId}/${d.rota}`;
  const enviar = (conteudo: Buffer, nome: string, aba: number, linhaCabecalho: number, mapeamento: object = d.mapeamento, empresaId = d.empresa()) =>
    request(http.getHttpServer())
      .post(`${base(empresaId)}/importacoes`)
      .set('x-papel', d.papel)
      .set('x-usuario', d.usuario())
      .set('x-correlation-id', `corr-planilha-${sufixo}`)
      .attach('arquivo', conteudo, { filename: nome, contentType: 'application/octet-stream' })
      .field('mapeamento', JSON.stringify(mapeamento))
      .field('aba', String(aba))
      .field('linhaCabecalho', String(linhaCabecalho));
  const tentativa = async (id: string) =>
    (
      await admin.query<{ formato: string; aba_nome: string | null; aba_posicao: number; linha_cabecalho: number; arquivo_chave: string; mapeamento: unknown }>(
        `select formato, aba_nome, aba_posicao, linha_cabecalho, arquivo_chave, mapeamento from app.${d.tabela} where id = $1`,
        [id],
      )
    ).rows[0]!;
  const acoes = async (id: string): Promise<string[]> =>
    (await admin.query<{ acao: string }>(`select acao from app.${d.evento} where tentativa_id = $1 order by sequencia`, [id])).rows.map(
      (linha) => linha.acao,
    );

  it.each([
    ['XLSX', 'cadastro.xlsx', TIPO_DE_CONTEUDO_XLSX, planilhaXlsx],
    ['ODS', 'cadastro.ods', TIPO_DE_CONTEUDO_ODS, planilhaOds],
  ] as const)('%s: 202 RECEBIDA com a configuração, original pelo hash com o tipo certo, job só com ids, SELECAO_DE_PLANILHA', async (formato, nome, tipo, montar) => {
    const conteudo = montar(...abas(d.cabecalho, d.dados, `envio ${formato}`));
    const resposta = await enviar(conteudo, nome, 1, 3).expect(202);

    expect(resposta.body).toMatchObject({
      estado: 'RECEBIDA',
      formato,
      aba: { nome: 'Cadastro', posicao: 1 },
      linhaCabecalho: 3,
      linhasIgnoradasAntesDoCabecalho: 0,
      linhasOcultas: 0,
      diagnosticosDaPlanilha: [],
      mapeamento: d.mapeamento,
      arquivo: { nome },
    });
    const id = resposta.body.tentativaId as string;
    const linha = await tentativa(id);
    expect(linha).toMatchObject({ formato, aba_nome: 'Cadastro', aba_posicao: 1, linha_cabecalho: 3, mapeamento: d.mapeamento });
    expect(linha.arquivo_chave).toBe(`${tenantA}/${d.empresa()}/${d.rota}/${resposta.body.arquivo.hash}.${formato.toLowerCase()}`);
    expect(await acoes(id)).toEqual(['CRIACAO', 'SELECAO_DE_PLANILHA']);

    const objeto = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: linha.arquivo_chave }));
    expect(objeto.ContentType).toBe(tipo);

    const job = await d.fila.getJob(idDoJobDeValidacao(id));
    expect(job?.data).toEqual({ tenantId: tenantA, empresaId: d.empresa(), tentativaId: id, correlationId: `corr-planilha-${sufixo}` });

    // Original como foi enviado, com o tipo e a extensão do formato.
    const original = await request(http.getHttpServer())
      .get(`${base(d.empresa())}/importacoes/${id}/arquivo`)
      .set('x-papel', d.papel)
      .set('x-usuario', d.usuario())
      .buffer(true)
      .parse((r, pronto) => {
        const partes: Buffer[] = [];
        r.on('data', (parte: Buffer) => partes.push(parte));
        r.on('end', () => pronto(null, Buffer.concat(partes)));
      })
      .expect(200);
    expect(original.headers['content-type']).toBe(tipo);
    expect(original.headers['content-disposition']).toBe(`attachment; filename="${nome}"`);
    expect(original.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(original.body as Buffer, conteudo)).toBe(0);
  });

  it('mesma planilha + mesma configuração + mesmo mapeamento → reutiliza (sem tentativa, job ou seleção novos)', async () => {
    const conteudo = planilhaXlsx(...abas(d.cabecalho, d.dados, 'reuso'));
    const primeira = await enviar(conteudo, 'repetida.xlsx', 1, 3).expect(202);
    const segunda = await enviar(conteudo, 'repetida.xlsx', 1, 3).expect(202);

    expect(segunda.body.tentativaId).toBe(primeira.body.tentativaId);
    expect(await acoes(primeira.body.tentativaId as string)).toEqual(['CRIACAO', 'SELECAO_DE_PLANILHA', 'REUTILIZACAO']);
    const notificacoes = await admin.query(`select 1 from app.${d.notificacao} where tentativa_id = $1`, [primeira.body.tentativaId]);
    expect(notificacoes.rowCount).toBe(0);
  });

  it('aba, cabeçalho ou mapeamento diferentes → tentativa nova, ligada ao MESMO original', async () => {
    const conteudo = planilhaXlsx(...abas(d.cabecalho, d.dados, 'variações'));
    const base1 = await enviar(conteudo, 'variacoes.xlsx', 1, 3).expect(202);
    const outraAba = await enviar(conteudo, 'variacoes.xlsx', 2, 1).expect(202);
    const outroCabecalho = await enviar(conteudo, 'variacoes.xlsx', 1, 4).expect(202);
    const invertido = Object.fromEntries(
      Object.entries(d.mapeamento).map(([campo, letra]) => [campo, campo === Object.keys(d.mapeamento)[0] ? 'B' : letra === 'B' ? 'A' : letra]),
    );
    const outroMapeamento = await enviar(conteudo, 'variacoes.xlsx', 1, 3, invertido).expect(202);

    const ids = [base1, outraAba, outroCabecalho, outroMapeamento].map((r) => r.body.tentativaId as string);
    expect(new Set(ids).size).toBe(4);
    const chaves = await Promise.all(ids.map(async (id) => (await tentativa(id)).arquivo_chave));
    expect(new Set(chaves).size).toBe(1);
    expect(outraAba.body).toMatchObject({ aba: { nome: 'Cópia', posicao: 2 }, linhaCabecalho: 1 });
    for (const id of ids.slice(1)) {
      expect(await acoes(id)).toEqual(['CRIACAO', 'SELECAO_DE_PLANILHA']);
    }
  });

  it('recusa estrutural no envio não deixa rastro (tentativa, storage, job)', async () => {
    const antes = (await admin.query(`select count(*)::int as n from app.${d.tabela} where empresa_id = $1`, [d.empresa()])).rows[0]
      .n as number;
    const conteudo = planilhaXlsx({ ...abas(d.cabecalho, d.dados, 'mesclado')[0]!, mesclas: ['A3:B3'] });

    await enviar(conteudo, 'mesclado.xlsx', 1, 3)
      .expect(422)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.CABECALHO_MESCLADO }));
    await request(http.getHttpServer())
      .post(`${base(d.empresa())}/importacoes`)
      .set('x-papel', d.papel)
      .set('x-usuario', d.usuario())
      .attach('arquivo', conteudo, { filename: 'sem-config.xlsx' })
      .field('mapeamento', JSON.stringify(d.mapeamento))
      .expect(400)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.CONFIGURACAO_DE_PLANILHA_INCOMPLETA }));

    const depois = (await admin.query(`select count(*)::int as n from app.${d.tabela} where empresa_id = $1`, [d.empresa()])).rows[0]
      .n as number;
    expect(depois).toBe(antes);
  });

  it('autorização nas rotas novas: outro tenant 404, fora da carteira 403, tentativa de outra empresa 404', async () => {
    const xlsx = planilhaXlsx(...abas(d.cabecalho, d.dados, 'autorização'));
    await request(http.getHttpServer())
      .post(`${base(d.empresa())}/planilhas/inspecao`)
      .set('x-tenant', tenantB)
      .set('x-usuario', usuarioB)
      .attach('arquivo', xlsx, { filename: 'c.xlsx' })
      .expect(404)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA }));
    await request(http.getHttpServer())
      .post(`${base(d.empresa())}/planilhas/inspecao`)
      .set('x-papel', 'contador')
      .set('x-usuario', contadorFora)
      .attach('arquivo', xlsx, { filename: 'c.xlsx' })
      .expect(403);
    await request(http.getHttpServer())
      .get(`${base(d.empresa())}/modelo?formato=xlsx`)
      .set('x-tenant', tenantB)
      .set('x-usuario', usuarioB)
      .expect(404);

    const enviada = await enviar(xlsx, 'cruzada.xlsx', 1, 3).expect(202);
    await request(http.getHttpServer())
      .get(`${base(outraDaCarteira)}/importacoes/${enviada.body.tentativaId}/arquivo`)
      .set('x-papel', d.papel)
      .set('x-usuario', d.usuario())
      .expect(404)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA }));
  });
});

describe('prévia e histórico mostram a leitura da planilha (plano de contas, worker simulado)', () => {
  it('formato, aba, cabeçalho, ignoradas, ocultas e diagnósticos chegam à prévia e ao histórico', async () => {
    const d = DOMINIOS[0];
    const resposta = await request(http.getHttpServer())
      .post(`/empresas/${empresaP}/plano-contas/importacoes`)
      .set('x-papel', 'contador')
      .set('x-usuario', contador)
      .attach('arquivo', planilhaOds(...abas(d.cabecalho, d.dados, 'prévia')), { filename: 'previa.ods' })
      .field('mapeamento', JSON.stringify(d.mapeamento))
      .field('aba', '1')
      .field('linhaCabecalho', '3')
      .expect(202);
    const id = resposta.body.tentativaId as string;
    const diagnosticos = [
      { codigo: 'LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS' as const, mensagem: 'Linhas acima do cabeçalho escolhido foram ignoradas.', quantidade: 1 },
      { codigo: 'LINHAS_OCULTAS_PROCESSADAS' as const, mensagem: 'Linhas ocultas foram encontradas e processadas normalmente.', quantidade: 1 },
    ];

    await comContexto(
      appPool,
      contextoTecnico({
        identidadeTecnica: 'workers-plano-contas',
        finalidade: 'PROCESSAMENTO_DE_EMPRESA',
        tenantId: tenantA,
        empresaId: empresaP,
        correlationId: `corr-worker-${sufixo}`,
      }),
      async (cliente) => {
        const { planoVersaoNaValidacao } = await iniciarValidacaoDaImportacao(cliente, empresaP, id, new Date());
        await registrarLeituraDaPlanilhaDaImportacao(cliente, {
          empresaId: empresaP,
          tentativaId: id,
          linhasIgnoradasAntesDoCabecalho: 1,
          linhasOcultas: 1,
          diagnosticos,
        });
        await gravarResultadoDaValidacao(
          cliente,
          empresaP,
          id,
          [
            { status: 'VALIDA', numeroDaLinha: 4, codigo: '1', nome: 'Ativo', tipo: 'sintetica', natureza: 'devedora', contaPai: null, acao: 'INCLUIR' },
            { status: 'VALIDA', numeroDaLinha: 5, codigo: '1.1', nome: 'X', tipo: 'analitica', natureza: 'devedora', contaPai: '1', acao: 'INCLUIR' },
          ],
          planoVersaoNaValidacao,
          new Date(),
        );
      },
    );

    const esperado = {
      formato: 'ODS',
      aba: { nome: 'Cadastro', posicao: 1 },
      linhaCabecalho: 3,
      linhasIgnoradasAntesDoCabecalho: 1,
      linhasOcultas: 1,
      diagnosticosDaPlanilha: diagnosticos,
    };
    const previa = await request(http.getHttpServer())
      .get(`/empresas/${empresaP}/plano-contas/importacoes/${id}`)
      .set('x-papel', 'contador')
      .set('x-usuario', contador)
      .expect(200);
    expect(previa.body).toMatchObject({ estado: 'AGUARDANDO_CONFIRMACAO', ...esperado });

    const historico = await request(http.getHttpServer())
      .get(`/empresas/${empresaP}/plano-contas/importacoes`)
      .set('x-papel', 'contador')
      .set('x-usuario', contador)
      .expect(200);
    expect(historico.body.itens.find((item: { tentativaId?: string; id?: string }) => (item.tentativaId ?? item.id) === id)).toMatchObject(
      esperado,
    );

    // Relatório continua CSV, com o nome base sem a extensão da planilha.
    const relatorio = await request(http.getHttpServer())
      .get(`/empresas/${empresaP}/plano-contas/importacoes/${id}/relatorio`)
      .set('x-papel', 'contador')
      .set('x-usuario', contador)
      .expect(200);
    expect(relatorio.headers['content-disposition']).toBe('attachment; filename="relatorio-previa.csv"');
  });

  it('o CSV continua nascendo com os padrões (formato CSV, sem aba, linha 1) e sem SELECAO_DE_PLANILHA', async () => {
    const resposta = await request(http.getHttpServer())
      .post(`/empresas/${empresaP}/plano-contas/importacoes`)
      .set('x-papel', 'contador')
      .set('x-usuario', contador)
      .attach('arquivo', Buffer.from('codigo;nome;tipo;natureza;conta_pai\r\n9;Nove;sintetica;devedora;\r\n'), {
        filename: 'nove.csv',
        contentType: 'text/csv',
      })
      .field('mapeamento', JSON.stringify({ codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' }))
      .expect(202);

    expect(resposta.body).toMatchObject({ formato: 'CSV', aba: null, linhaCabecalho: 1 });
    const { rows } = await admin.query<{ arquivo_chave: string }>(`select arquivo_chave from app.importacao_plano_contas where id = $1`, [
      resposta.body.tentativaId,
    ]);
    expect(rows[0]?.arquivo_chave.endsWith('.csv')).toBe(true);
    const original = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: rows[0]!.arquivo_chave }));
    expect(original.ContentType).toBe('text/csv');
    const eventos = await admin.query<{ acao: string }>(`select acao from app.importacao_plano_contas_evento where tentativa_id = $1`, [
      resposta.body.tentativaId,
    ]);
    expect(eventos.rows.map((e) => e.acao)).toEqual(['CRIACAO']);
  });
});
