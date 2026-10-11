/**
 * Validação de XLSX/ODS sobre a infraestrutura local real (SPEC-015 §3.2–§3.7, §6.3, §7, §9), nos
 * dois importadores: PostgreSQL pelo papel `contaia_app` (RLS valendo), Redis/BullMQ com prefixo
 * exclusivo desta execução, MinIO com o original na chave do hash (como a API grava) e o leitor REAL
 * em processo filho. A tentativa nasce como a API a cria no envio: formato, aba, linha de cabeçalho
 * e o mapeamento campo → LETRA. Um desvio injetável troca o leitor (prazo curto, falha técnica,
 * contagem de concorrência).
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { criarPool, criarPoolDaAplicacao } from '@contaia/db';
import { ErroDeInfraestrutura, lerPlanilhaIsolada } from '@contaia/planilhas';
import { cfb, entradaBomba, ods, planilhaOds, planilhaXlsx, xlsxCru, type LinhaDeTeste } from '@contaia/planilhas/testes';
import {
  FILA_DE_VALIDACAO_EMPREGADOS,
  FILA_DE_VALIDACAO_EMPREGADOS_MORTA,
  FILA_DE_VALIDACAO_PLANO_CONTAS,
  FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA,
  NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS,
  NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
} from '@contaia/shared';
import { conexaoDoRedis } from '@contaia/signer-client';
import { Queue } from 'bullmq';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lerConfigDoArmazenamento } from '../config.js';
import { iniciarConsumidorDeEmpregados } from '../empregados/consumidor.js';
import { iniciarConsumidorDoPlanoDeContas } from '../plano-contas/consumidor.js';
import { criarConexaoRedis } from '../redis.js';
import type { Consumidor } from './consumidor.js';
import { criarLeitorDoArmazenamento, type LeitorDoArmazenamento } from './leitura-s3.js';
import { LEITOR_ISOLADO, type LeitorDeAba } from './planilha.js';

const admin: Pool = criarPool();
const app: Pool = criarPoolDaAplicacao();

const sufixo = `${String(process.pid).slice(-4).padStart(4, '0')}${String(Date.now()).slice(-6)}${randomInt(10, 99)}`;
const prefixo = `teste-planilhas-${process.pid}-${Date.now()}`;
const conexao = conexaoDoRedis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:16379');
const redisDoTeste = criarConexaoRedis(conexao);

const armazenamento = lerConfigDoArmazenamento({
  S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://127.0.0.1:19000',
  S3_BUCKET: process.env['S3_BUCKET'] ?? 'contaia-documentos',
  MINIO_ROOT_USER: process.env['MINIO_ROOT_USER'] ?? 'contaia_local',
  MINIO_ROOT_PASSWORD: process.env['MINIO_ROOT_PASSWORD'] ?? 'contaia_local_secret',
})!;
const s3 = new S3Client({
  endpoint: armazenamento.endpoint,
  region: armazenamento.regiao,
  forcePathStyle: true,
  credentials: { accessKeyId: armazenamento.usuario, secretAccessKey: armazenamento.senha },
});

/** Opções rápidas: o padrão de produção espera segundos entre as tentativas. */
const RAPIDAS = { attempts: 3, backoff: { type: 'fixed', delay: 30 }, removeOnComplete: false, removeOnFail: false } as const;

// -- Domínios -------------------------------------------------------------------------------------

const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';
const CPF_C = '390.533.447-05';
/** Valores pessoais que NUNCA podem aparecer em log, evento ou diagnóstico. */
const PII = [CPF_A, CPF_B, CPF_C, '52998224725', '11144477735', 'Maria Souza', 'João Lima', 'Carla Dias'];

type Dominio = Readonly<{
  rotulo: 'plano' | 'empregados';
  tabela: string;
  pasta: string;
  cabecalho: readonly string[];
  porLetra: Readonly<Record<string, string>>;
  /** 5 linhas de dados válidas, distintas. */
  boas: readonly (readonly string[])[];
  /** Linha inválida por regra do domínio (não estrutural). */
  ruim: readonly string[];
  /** Conteúdo com rejeições de domínio (hierarquia / duplicidade) para a equivalência. */
  equivalencia: readonly (readonly string[])[];
  fila: () => Queue;
  morta: () => Queue;
  job: string;
  /** Quem a REJEITADA notifica (F13: iniciador; F14: iniciador + admins autorizados). */
  notificados: () => readonly string[];
}>;

let filaPlano: Queue;
let filaEmpregados: Queue;
let mortaPlano: Queue;
let mortaEmpregados: Queue;
let tenant = '';
let iniciador = '';
let adminDaEmpresa = '';
let empresa = '';

const PLANO: Dominio = {
  rotulo: 'plano',
  tabela: 'importacao_plano_contas',
  pasta: 'plano-contas',
  cabecalho: ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'],
  porLetra: { codigo: 'A', nome: 'B', tipo: 'C', natureza: 'D', conta_pai: 'E' },
  boas: [
    ['1', 'Ativo', 'sintética', 'devedora', ''],
    ['1.1', 'Caixa', 'analítica', 'devedora', '1'],
    ['1.2', 'Bancos', 'analítica', 'devedora', '1'],
    ['1.3', 'Aplicações', 'analítica', 'devedora', '1'],
    ['1.4', 'Estoques', 'analítica', 'devedora', '1'],
  ],
  ruim: ['9', 'Sem tipo', 'xpto', 'credora', ''],
  equivalencia: [
    ['1', 'Ativo', 'Sintética', 'Devedora', ''],
    ['1.1', 'Caixa', 'analítica', 'devedora', '1'],
    ['1.1', 'Caixa dup', 'analítica', 'devedora', '1'],
    ['1.2', 'Filha da dup', 'analítica', 'devedora', '1.1'],
    ['2.1', 'Órfã', 'analítica', 'credora', '9'],
    ['3', 'Receitas', 'xpto', 'credora', ''],
    ['3.1', 'Filha rejeitada', 'analítica', 'credora', '3'],
  ],
  fila: () => filaPlano,
  morta: () => mortaPlano,
  job: NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
  notificados: () => [iniciador],
};

const EMPREGADOS: Dominio = {
  rotulo: 'empregados',
  tabela: 'importacao_empregados',
  pasta: 'empregados',
  cabecalho: ['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao'],
  porLetra: { cpf: 'A', nome: 'B', matricula: 'C', data_nascimento: 'D', data_admissao: 'E' },
  boas: [
    [CPF_A, 'Maria Souza', '00123', '15/03/1985', '01/02/2010'],
    [CPF_B, 'João Lima', '77', '20/07/1990', '10/01/2015'],
    [CPF_C, 'Carla Dias', '5', '01/01/1980', '01/01/2000'],
    [CPF_A, 'Maria Souza', '123', '15/03/1985', '01/02/2010'],
    [CPF_B, 'João Lima', '78', '20/07/1990', '10/01/2015'],
  ],
  ruim: ['123.456.789-00', 'CPF ruim', '9', '01/01/1980', '01/01/2000'],
  equivalencia: [
    [CPF_A, 'Maria Souza', '00123', '15/03/1985', '01/02/2010'],
    [CPF_A, 'Maria Souza', '123', '15/03/1985', '01/02/2010'],
    [CPF_B, 'João Lima', '7', '15/03/1985', '01/02/2010'],
    ['11144477735', 'João Lima dup', '7', '15/03/1985', '01/02/2010'],
    ['123.456.789-00', 'CPF ruim', '9', '15/03/1985', '01/02/2010'],
    [CPF_C, 'Carla Dias', '5', '31/02/1980', '01/01/2000'],
  ],
  fila: () => filaEmpregados,
  morta: () => mortaEmpregados,
  job: NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS,
  notificados: () => [iniciador, adminDaEmpresa].sort(),
};

const DOMINIOS = [
  ['plano de contas', PLANO],
  ['empregados', EMPREGADOS],
] as const;

const FORMATOS = [
  ['XLSX', planilhaXlsx, 'xlsx'],
  ['ODS', planilhaOds, 'ods'],
] as const;

// -- Leitor injetável e logs ----------------------------------------------------------------------

let leitorDaVez: LeitorDeAba = LEITOR_ISOLADO;
const logs: string[] = [];

let leitorDoStorage: LeitorDoArmazenamento;
const consumidores: Consumidor[] = [];

// -- Helpers --------------------------------------------------------------------------------------

const unico = async (sql: string, parametros: unknown[]): Promise<string> =>
  (await admin.query<{ id: string }>(sql, parametros)).rows[0]!.id;

const esperar = async (condicao: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> => {
  const limite = Date.now() + ms;
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error('a condição não ocorreu a tempo');
    await new Promise((resolver) => setTimeout(resolver, 25));
  }
};

type Configuracao = Readonly<{ formato: 'CSV' | 'XLSX' | 'ODS'; abaNome?: string; abaPosicao?: number; linhaCabecalho?: number }>;
type Tentativa = Readonly<{ id: string; comando: Record<string, string> }>;

/** O que a API faz no envio: original no MinIO pela chave do hash e a tentativa RECEBIDA com a configuração. */
const novaTentativa = async (d: Dominio, bytes: Buffer, config: Configuracao, mapeamento: Readonly<Record<string, string>> = d.porLetra): Promise<Tentativa> => {
  const hash = createHash('sha256').update(bytes).update(randomUUID()).digest('hex');
  const extensao = config.formato.toLowerCase();
  const chave = `${tenant}/${empresa}/${d.pasta}/${hash}.${extensao}`;
  await s3.send(new PutObjectCommand({ Bucket: armazenamento.bucket, Key: chave, Body: bytes }));

  const correlationId = `corr-planilha-${sufixo}`;
  const planilha = config.formato !== 'CSV';
  const id = await unico(
    `insert into app.${d.tabela}
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
        usuario_iniciador_id, correlation_id, formato, aba_nome, aba_posicao, linha_cabecalho)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [
      tenant, empresa, hash, JSON.stringify(mapeamento), `arquivo.${extensao}`, bytes.length, chave, iniciador, correlationId,
      config.formato, planilha ? (config.abaNome ?? 'Dados') : null, planilha ? (config.abaPosicao ?? 1) : 0, planilha ? (config.linhaCabecalho ?? 1) : 1,
    ],
  );

  return { id, comando: { tenantId: tenant, empresaId: empresa, tentativaId: id, correlationId } };
};

const enfileirar = (d: Dominio, t: Tentativa, jobId = `${t.id}-1`) => d.fila().add(d.job, t.comando, { ...RAPIDAS, jobId });

const tentativaNoBanco = async (d: Dominio, id: string) =>
  (
    await admin.query<{
      estado: string;
      totais: unknown;
      linhas_ignoradas_antes_do_cabecalho: number;
      linhas_ocultas: number;
      diagnosticos: { codigo: string; mensagem: string; quantidade: number }[];
    }>(`select estado, totais, linhas_ignoradas_antes_do_cabecalho, linhas_ocultas, diagnosticos from app.${d.tabela} where id = $1`, [id])
  ).rows[0]!;

const estadoDe = async (d: Dominio, id: string) => (await tentativaNoBanco(d, id)).estado;

const terminou = (d: Dominio, id: string) => async () => ['AGUARDANDO_CONFIRMACAO', 'REJEITADA', 'FALHA'].includes(await estadoDe(d, id));

/** Staging sem as colunas que mudam de uma tentativa para outra (ids e sequência). */
const stagingDe = async (d: Dominio, id: string) =>
  (
    await admin.query<{ linha: Record<string, unknown> }>(
      `select to_jsonb(l) - 'id' - 'tenant_id' - 'empresa_id' - 'tentativa_id' - 'sequencia' as linha
         from app.${d.tabela}_linha l where tentativa_id = $1 order by numero_linha`,
      [id],
    )
  ).rows.map((r) => r.linha);

const eventosDe = async (d: Dominio, id: string) =>
  (
    await admin.query<{ evento: Record<string, unknown> }>(
      `select to_jsonb(e) - 'id' - 'tenant_id' - 'empresa_id' - 'tentativa_id' - 'sequencia' - 'ocorrido_em' as evento
         from app.${d.tabela}_evento e where tentativa_id = $1 order by sequencia`,
      [id],
    )
  ).rows.map((r) => r.evento);

const acoesDe = async (d: Dominio, id: string) => (await eventosDe(d, id)).map((e) => e['acao']);

const notificadosDe = async (d: Dominio, id: string) =>
  (await admin.query<{ usuario_id: string }>(`select usuario_id from app.${d.tabela}_notificacao where tentativa_id = $1`, [id])).rows
    .map((r) => r.usuario_id)
    .sort();

const resumoDaLinha = (l: Record<string, unknown>) => [l['numero_linha'], l['status'], l['codigo_de_erro'], l['campo']];

/** Aba com título, linha em branco, cabeçalho na 3, oculta, fórmula e mescla em coluna mapeada. */
const abaParcial = (d: Dominio): { nome: string; linhas: LinhaDeTeste[]; mesclas: string[] } => ({
  nome: 'Dados',
  linhas: [
    { numero: 1, valores: ['Relatório gerado pelo sistema antigo'] },
    { numero: 3, valores: d.cabecalho },
    { numero: 4, valores: d.boas[0]! },
    { numero: 5, valores: d.boas[1]!, oculta: true },
    { numero: 6, valores: d.boas[2]!, formulaEm: 'B' },
    { numero: 7, valores: d.boas[3]! },
    { numero: 8, valores: d.boas[4]! },
  ],
  mesclas: ['B7:C7'],
});

const abaSimples = (d: Dominio, registros: readonly (readonly string[])[]) => ({
  nome: 'Dados',
  linhas: [{ numero: 1, valores: d.cabecalho }, ...registros.map((valores, i) => ({ numero: i + 2, valores }))],
});

const csv = (d: Dominio, registros: readonly (readonly string[])[]): Buffer =>
  Buffer.from([d.cabecalho.join(';'), ...registros.map((r) => r.join(';')), ''].join('\r\n'), 'utf8');

// -- Ciclo de vida --------------------------------------------------------------------------------

beforeAll(async () => {
  // Captura toda saída de console do processo (a varredura de PII no fim da suíte lê daqui).
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    // eslint-disable-next-line no-console -- só repassa a saída original, sem escrever nada novo.
    const original = console[metodo].bind(console);
    vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      original(...args);
    });
  }

  tenant = await unico(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
    `Worker Planilhas ${sufixo}`,
    `P${sufixo}`.slice(0, 14).padEnd(14, '0'),
  ]);
  const novoUsuario = (rotulo: string): Promise<string> =>
    unico(`insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, $4, 'ATIVO') returning id`, [
      tenant, `sub-wp-${rotulo}-${sufixo}`, `wp.${rotulo}.${sufixo}@planilhas.local`, `Usuário ${rotulo}`,
    ]);
  iniciador = await novoUsuario('ini');
  adminDaEmpresa = await novoUsuario('adm');
  empresa = await unico(
    `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, 'Empresa Planilhas', 'ATIVA', 'ativo') returning id`,
    [tenant, `Q${sufixo}`.slice(0, 14).padEnd(14, '0')],
  );
  await admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [tenant, adminDaEmpresa, empresa]);
  await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'admin_escritorio')`, [tenant, adminDaEmpresa]);

  try {
    await s3.send(new HeadBucketCommand({ Bucket: armazenamento.bucket }));
  } catch {
    // Suítes paralelas criam o mesmo bucket: "já é seu" aqui é sucesso.
    try {
      await s3.send(new CreateBucketCommand({ Bucket: armazenamento.bucket }));
    } catch (erro: unknown) {
      const nome = erro instanceof Error ? erro.name : '';
      if (nome !== 'BucketAlreadyOwnedByYou' && nome !== 'BucketAlreadyExists') throw erro;
    }
  }

  leitorDoStorage = criarLeitorDoArmazenamento(armazenamento);
  filaPlano = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS, { connection: redisDoTeste, prefix: prefixo });
  filaEmpregados = new Queue(FILA_DE_VALIDACAO_EMPREGADOS, { connection: redisDoTeste, prefix: prefixo });
  mortaPlano = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA, { connection: redisDoTeste, prefix: prefixo });
  mortaEmpregados = new Queue(FILA_DE_VALIDACAO_EMPREGADOS_MORTA, { connection: redisDoTeste, prefix: prefixo });
  // Como no main.ts: os dois consumidores no mesmo processo (2 × concorrência 2).
  const opcoes = {
    conexao,
    prefixo,
    pool: app,
    agora: () => new Date(),
    esperaParaRegistrarFalhaMs: 50,
    ler: (chave: string) => leitorDoStorage.ler(chave),
    lerPlanilha: (bytes: Uint8Array, aba: number) => leitorDaVez(bytes, aba),
  };
  consumidores.push(await iniciarConsumidorDoPlanoDeContas(opcoes), await iniciarConsumidorDeEmpregados(opcoes));
}, 60_000);

afterAll(async () => {
  await Promise.all(consumidores.map((c) => c.fechar()));
  for (const fila of [filaPlano, filaEmpregados, mortaPlano, mortaEmpregados]) {
    await fila?.obliterate({ force: true });
    await fila?.close();
  }
  const restantes = await redisDoTeste.keys(`${prefixo}:*`);
  if (restantes.length > 0) await redisDoTeste.del(...restantes);
  redisDoTeste.disconnect();
  leitorDoStorage?.fechar();

  if (tenant !== '') {
    const objetos = await s3.send(new ListObjectsV2Command({ Bucket: armazenamento.bucket, Prefix: `${tenant}/` }));
    const chaves = (objetos.Contents ?? []).flatMap((o) => (o.Key === undefined ? [] : [{ Key: o.Key }]));
    if (chaves.length > 0) await s3.send(new DeleteObjectsCommand({ Bucket: armazenamento.bucket, Delete: { Objects: chaves } }));
  }
  s3.destroy();

  const c = await admin.connect();
  try {
    await c.query('set session_replication_role = replica');
    const tabelas = (
      await c.query<{ tabela: string }>(`select table_name as tabela from information_schema.columns where table_schema = 'app' and column_name = 'tenant_id'`)
    ).rows;
    if (tenant !== '') {
      for (const { tabela } of tabelas) await c.query(`delete from app.${tabela} where tenant_id = $1`, [tenant]);
      await c.query('delete from app.tenant where id = $1', [tenant]);
    }
  } finally {
    await c.query('reset session_replication_role');
    c.release();
  }
  await Promise.all([admin.end(), app.end()]);
  vi.restoreAllMocks();
}, 60_000);

beforeEach(() => {
  leitorDaVez = LEITOR_ISOLADO;
});

// -- Cenários -------------------------------------------------------------------------------------

describe.each(DOMINIOS)('%s: XLSX e ODS até a prévia', (_rotulo, d) => {
  describe.each(FORMATOS)('%s', (formato, montar) => {
    it('aceitação parcial: título ignorado, oculta contada, fórmula e mescla rejeitam SÓ a linha (número original da aba); LEITURA_PLANILHA sem PII; prévia não notifica', async () => {
      const t = await novaTentativa(d, montar(abaParcial(d)), { formato, linhaCabecalho: 3 });

      await enfileirar(d, t);
      await esperar(terminou(d, t.id));

      const tentativa = await tentativaNoBanco(d, t.id);
      const staging = await stagingDe(d, t.id);
      expect(tentativa.estado).toBe('AGUARDANDO_CONFIRMACAO');
      expect(tentativa.totais).toEqual({ lidas: 5, novas: 3, atualizadas: 0, rejeitadas: 2 });
      expect(staging.map(resumoDaLinha)).toEqual([
        [4, 'VALIDA', null, null],
        [5, 'VALIDA', null, null],
        [6, 'REJEITADA', 'CELULA_COM_FORMULA', 'nome'],
        [7, 'REJEITADA', 'CELULA_MESCLADA', 'nome'],
        [8, 'VALIDA', null, null],
      ]);
      // Nem o resultado salvo da fórmula nem o valor da mescla entram no staging; mensagem fixa.
      expect(staging[2]!['nome']).toBeNull();
      expect(staging[3]!['nome']).toBeNull();
      expect(String(staging[2]!['mensagem'])).toMatch(/fórmula/u);
      expect(String(staging[3]!['mensagem'])).toMatch(/mesclada/u);

      expect(tentativa.linhas_ignoradas_antes_do_cabecalho).toBe(1);
      expect(tentativa.linhas_ocultas).toBe(1);
      expect(tentativa.diagnosticos.map((x) => [x.codigo, x.quantidade])).toEqual([
        ['LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS', 1],
        ['LINHAS_OCULTAS_PROCESSADAS', 1],
        ['LINHAS_COM_FORMULA_REJEITADAS', 1],
        ['LINHAS_COM_CELULA_MESCLADA_REJEITADAS', 1],
      ]);

      const eventos = await eventosDe(d, t.id);
      expect(eventos.map((e) => e['acao'])).toEqual(['INICIAR_VALIDACAO', 'LEITURA_PLANILHA', 'VALIDACAO_SUCESSO']);
      expect(eventos[1]).toMatchObject({ estado_anterior: 'VALIDANDO', estado_novo: 'VALIDANDO', usuario_id: null, totais: null, codigo: null, correlation_id: t.comando['correlationId'] });
      const rastro = JSON.stringify({ eventos, diagnosticos: tentativa.diagnosticos });
      for (const valor of PII) expect(rastro).not.toContain(valor);

      expect(await notificadosDe(d, t.id)).toEqual([]);
    });

    it('nenhuma linha válida → REJEITADA com as rejeições no staging, leitura registrada e os MESMOS destinatários das F13/F14', async () => {
      const t = await novaTentativa(d, montar(abaSimples(d, [d.ruim, d.ruim.map((v, i) => (i === 2 ? `${v}x` : v))])), { formato });

      await enfileirar(d, t);
      await esperar(terminou(d, t.id));

      expect(await estadoDe(d, t.id)).toBe('REJEITADA');
      expect((await stagingDe(d, t.id)).every((l) => l['status'] === 'REJEITADA')).toBe(true);
      const eventos = await eventosDe(d, t.id);
      expect(eventos.map((e) => [e['acao'], e['codigo']])).toEqual([
        ['INICIAR_VALIDACAO', null],
        ['LEITURA_PLANILHA', null],
        ['VALIDACAO_REJEITADA', null],
      ]);
      expect(await notificadosDe(d, t.id)).toEqual(d.notificados());
    });
  });

  it('equivalência: o mesmo conteúdo em CSV, XLSX e ODS → mesmo estado, totais, códigos e staging', async () => {
    const mapeamentoCsv = Object.fromEntries(d.cabecalho.map((c) => [c, c]));
    const tentativas = [
      await novaTentativa(d, csv(d, d.equivalencia), { formato: 'CSV' }, mapeamentoCsv),
      await novaTentativa(d, planilhaXlsx(abaSimples(d, d.equivalencia)), { formato: 'XLSX' }),
      await novaTentativa(d, planilhaOds(abaSimples(d, d.equivalencia)), { formato: 'ODS' }),
    ];

    await Promise.all(tentativas.map((t) => enfileirar(d, t)));
    for (const t of tentativas) await esperar(terminou(d, t.id));

    const resultados = await Promise.all(
      tentativas.map(async (t) => ({ tentativa: await tentativaNoBanco(d, t.id), staging: await stagingDe(d, t.id) })),
    );
    const [doCsv, doXlsx, doOds] = resultados.map((r) => ({ estado: r.tentativa.estado, totais: r.tentativa.totais, staging: r.staging }));
    expect(doXlsx).toEqual(doCsv);
    expect(doOds).toEqual(doCsv);
    expect(doCsv!.estado).toBe('AGUARDANDO_CONFIRMACAO');
    // As rejeições de domínio (hierarquia do plano / duplicidade de empregados) estão lá.
    const codigos = doCsv!.staging.map((l) => l['codigo_de_erro']).filter((c) => c !== null);
    expect(codigos).toEqual(
      d.rotulo === 'plano'
        ? ['CODIGO_DUPLICADO_NO_ARQUIVO', 'CODIGO_DUPLICADO_NO_ARQUIVO', 'CONTA_PAI_REJEITADA', 'CONTA_PAI_INEXISTENTE', 'VALOR_FORA_DO_DOMINIO', 'CONTA_PAI_REJEITADA']
        : ['CHAVE_DUPLICADA_NO_ARQUIVO', 'CHAVE_DUPLICADA_NO_ARQUIVO', 'CPF_INVALIDO', 'DATA_NASCIMENTO_INVALIDA'],
    );
    // O CSV não ganha leitura de planilha.
    expect(await acoesDe(d, tentativas[0]!.id)).toEqual(['INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO']);
    expect(resultados[0]!.tentativa.diagnosticos).toEqual([]);
  });
});

describe.each(DOMINIOS)('%s: arquivo hostil no worker → REJEITADA com código estável, sem staging, processo vivo', (_rotulo, d) => {
  const BOM = (dominio: Dominio) => planilhaXlsx(abaSimples(dominio, [dominio.boas[0]!]));

  it.each([
    ['bomba de ZIP com tamanho mentiroso', 'XLSX', () => Buffer.from(xlsxCru([entradaBomba('xl/sharedStrings.xml', 200, 4096)])), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO'],
    ['XLSX cifrado (CFB)', 'XLSX', () => Buffer.from(cfb('EncryptionInfo', 'EncryptedPackage')), 'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO'],
    ['ODS cifrado', 'ODS', () => Buffer.from(ods('', { cifrado: true })), 'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO'],
    ['.xls renomeado .xlsx', 'XLSX', () => Buffer.from(cfb('Workbook')), 'FORMATO_XLS_NAO_SUPORTADO'],
    ['ZIP truncado', 'XLSX', () => BOM(d).subarray(0, 200), 'ARQUIVO_CORROMPIDO'],
  ] as const)('%s → %s', async (_caso, formato, bytes, codigo) => {
    const t = await novaTentativa(d, bytes(), { formato });

    await enfileirar(d, t);
    await esperar(terminou(d, t.id));

    expect(await estadoDe(d, t.id)).toBe('REJEITADA');
    expect(await stagingDe(d, t.id)).toEqual([]);
    expect((await eventosDe(d, t.id)).map((e) => [e['acao'], e['codigo']])).toEqual([
      ['INICIAR_VALIDACAO', null],
      ['VALIDACAO_REJEITADA', codigo],
    ]);
    expect(await tentativaNoBanco(d, t.id)).toMatchObject({ linhas_ignoradas_antes_do_cabecalho: 0, linhas_ocultas: 0, diagnosticos: [] });
    expect(await notificadosDe(d, t.id)).toEqual(d.notificados());
  });

  it('aba que sumiu do arquivo e cabeçalho mesclado (rede de segurança do worker) → ABA_INEXISTENTE / CABECALHO_MESCLADO', async () => {
    const semAba = await novaTentativa(d, BOM(d), { formato: 'XLSX', abaPosicao: 7 });
    const mesclado = await novaTentativa(d, planilhaXlsx({ ...abaSimples(d, [d.boas[0]!]), mesclas: ['D1:E1'] }), { formato: 'XLSX' });

    await Promise.all([enfileirar(d, semAba), enfileirar(d, mesclado)]);
    await esperar(terminou(d, semAba.id));
    await esperar(terminou(d, mesclado.id));

    expect((await eventosDe(d, semAba.id)).at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', codigo: 'ABA_INEXISTENTE' });
    expect((await eventosDe(d, mesclado.id)).at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', codigo: 'CABECALHO_MESCLADO' });
  });

  it('processo filho morto por tempo → REJEITADA LIMITE_DE_PROCESSAMENTO_EXCEDIDO (não FALHA, sem retry)', async () => {
    const muitas = Array.from({ length: 6000 }, (_, i) => d.boas[i % d.boas.length]!);
    const t = await novaTentativa(d, planilhaXlsx(abaSimples(d, muitas)), { formato: 'XLSX' });
    let leituras = 0;
    leitorDaVez = (bytes, aba) => {
      leituras += 1;
      return lerPlanilhaIsolada(bytes, { tipo: 'ler-aba', abaPosicao: aba }, { timeoutMs: 1 });
    };

    await enfileirar(d, t);
    await esperar(terminou(d, t.id));

    expect(await estadoDe(d, t.id)).toBe('REJEITADA');
    expect((await eventosDe(d, t.id)).at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', codigo: 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO' });
    expect(leituras).toBe(1);
  });

  it('depois dos hostis, o mesmo processo de workers lê uma planilha boa', async () => {
    const t = await novaTentativa(d, BOM(d), { formato: 'XLSX' });

    await enfileirar(d, t);
    await esperar(terminou(d, t.id));

    expect(await estadoDe(d, t.id)).toBe('AGUARDANDO_CONFIRMACAO');
  });
});

describe.each(DOMINIOS)('%s: falha técnica do leitor, reentrega e concorrência', (_rotulo, d) => {
  it('falha técnica do filho na 1ª tentativa → retry; a 2ª conclui sem duplicar staging, LEITURA_PLANILHA nem eventos', async () => {
    const t = await novaTentativa(d, planilhaOds(abaSimples(d, d.boas)), { formato: 'ODS' });
    let chamadas = 0;
    leitorDaVez = (bytes, aba) => {
      chamadas += 1;
      return chamadas === 1 ? Promise.reject(new ErroDeInfraestrutura('o processo filho não subiu')) : LEITOR_ISOLADO(bytes, aba);
    };

    await enfileirar(d, t);
    await esperar(terminou(d, t.id));

    expect(chamadas).toBe(2);
    expect(await estadoDe(d, t.id)).toBe('AGUARDANDO_CONFIRMACAO');
    expect(await stagingDe(d, t.id)).toHaveLength(5);
    expect(await acoesDe(d, t.id)).toEqual(['INICIAR_VALIDACAO', 'LEITURA_PLANILHA', 'VALIDACAO_SUCESSO']);
  });

  it('falha técnica em todas as tentativas → FALHA com FALHA_NA_VALIDACAO e correlationId (nunca REJEITADA); fila morta só com os ids', async () => {
    const t = await novaTentativa(d, planilhaXlsx(abaSimples(d, d.boas)), { formato: 'XLSX' });
    leitorDaVez = () => Promise.reject(new ErroDeInfraestrutura(`canal quebrado ${CPF_A}`));

    await enfileirar(d, t);
    await esperar(terminou(d, t.id));
    await esperar(async () => (await d.morta().getJobs(['waiting', 'completed', 'failed', 'delayed'])).some((j) => j.data?.tentativaId === t.id));

    expect(await estadoDe(d, t.id)).toBe('FALHA');
    expect((await eventosDe(d, t.id)).map((e) => [e['acao'], e['codigo'], e['correlation_id']])).toEqual([
      ['INICIAR_VALIDACAO', null, t.comando['correlationId']],
      ['FALHA_TECNICA', 'FALHA_NA_VALIDACAO', t.comando['correlationId']],
    ]);
    const morto = (await d.morta().getJobs(['waiting', 'completed', 'failed', 'delayed'])).find((j) => j.data?.tentativaId === t.id)!;
    expect(morto.data).toEqual({ ...t.comando, motivo: 'FALHA_NA_VALIDACAO', tentativas: 3 });
    const job = await d.fila().getJob(`${t.id}-1`);
    expect(JSON.stringify({ falha: job?.failedReason, pilha: job?.stacktrace })).not.toContain(CPF_A);
    expect(await notificadosDe(d, t.id)).toEqual(d.notificados());
  });

  it('o mesmo job entregue de novo (e duas entregas simultâneas) não duplicam staging, eventos, leitura nem notificação', async () => {
    const t = await novaTentativa(d, planilhaXlsx(abaSimples(d, [d.ruim])), { formato: 'XLSX' });

    await Promise.all([enfileirar(d, t, `${t.id}-a`), enfileirar(d, t, `${t.id}-b`)]);
    await esperar(async () => (await d.fila().getJobState(`${t.id}-a`)) === 'completed' && (await d.fila().getJobState(`${t.id}-b`)) === 'completed');
    const primeira = { tentativa: await tentativaNoBanco(d, t.id), staging: await stagingDe(d, t.id), eventos: await eventosDe(d, t.id), notificados: await notificadosDe(d, t.id) };

    await enfileirar(d, t, `${t.id}-c`);
    await esperar(async () => (await d.fila().getJobState(`${t.id}-c`)) === 'completed');

    expect((await d.fila().getJob(`${t.id}-c`))!.returnvalue).toEqual({ desfecho: 'JA_PROCESSADA' });
    expect({ tentativa: await tentativaNoBanco(d, t.id), staging: await stagingDe(d, t.id), eventos: await eventosDe(d, t.id), notificados: await notificadosDe(d, t.id) }).toEqual(primeira);
    expect(primeira.eventos.map((e) => e['acao'])).toEqual(['INICIAR_VALIDACAO', 'LEITURA_PLANILHA', 'VALIDACAO_REJEITADA']);
    expect(primeira.staging).toHaveLength(1);
    expect(primeira.notificados).toEqual(d.notificados());
  });
});

describe('limite de leituras do processo (dois importadores, 2 × concorrência 2)', () => {
  it('4 planilhas ao mesmo tempo: no máximo 2 leituras simultâneas; as demais esperam a vez e todas concluem', async () => {
    let emCurso = 0;
    let pico = 0;
    // Trinco: nenhuma leitura termina até o teste ver as 2 vagas ocupadas com os 4 jobs ativos.
    let soltar!: () => void;
    const trinco = new Promise<void>((ok) => {
      soltar = ok;
    });
    leitorDaVez = async (bytes, aba) => {
      emCurso += 1;
      pico = Math.max(pico, emCurso);
      try {
        await trinco;
        return await LEITOR_ISOLADO(bytes, aba);
      } finally {
        emCurso -= 1;
      }
    };
    const tentativas = await Promise.all(
      [PLANO, PLANO, EMPREGADOS, EMPREGADOS].map(async (d) => ({ d, t: await novaTentativa(d, planilhaXlsx(abaSimples(d, d.boas)), { formato: 'XLSX' }) })),
    );

    try {
      await Promise.all(tentativas.map(({ d, t }) => enfileirar(d, t)));
      const todosAtivos = async () => (await Promise.all(tentativas.map(({ d, t }) => d.fila().getJobState(`${t.id}-1`)))).every((estado) => estado === 'active');
      await esperar(async () => emCurso === 2 && (await todosAtivos()));
      // Os 4 jobs em curso, só 2 lendo: os outros 2 esperam a vaga (sem depender de tempo).
      expect(emCurso).toBe(2);
    } finally {
      soltar();
    }
    for (const { d, t } of tentativas) await esperar(terminou(d, t.id));

    expect(pico).toBe(2);
    for (const { d, t } of tentativas) expect(await estadoDe(d, t.id)).toBe('AGUARDANDO_CONFIRMACAO');
  });
});

describe('PII', () => {
  it('nenhum CPF, nome ou valor de célula nos logs do worker, nem quando o erro técnico carrega PII', async () => {
    const t = await novaTentativa(PLANO, planilhaXlsx(abaSimples(PLANO, PLANO.boas)), { formato: 'XLSX' });
    leitorDaVez = () => Promise.reject(new ErroDeInfraestrutura(`canal quebrado ${CPF_A} Maria Souza`));

    await enfileirar(PLANO, t);
    await esperar(terminou(PLANO, t.id));
    expect(await estadoDe(PLANO, t.id)).toBe('FALHA');

    // `logs` tem tudo desde o início da suíte (inclui o caminho de falha acima, que rodou aqui dentro).
    const tudo = logs.join('\n');
    for (const valor of PII) expect(tudo).not.toContain(valor);
  });
});
