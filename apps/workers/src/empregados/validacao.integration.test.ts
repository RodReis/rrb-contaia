/**
 * Validação de empregados sobre a infraestrutura local real (SPEC-014 §3.2–§3.5, §3.10, §6.4,
 * Review Focus 5): PostgreSQL pelo papel `contaia_app` (RLS valendo, contexto técnico da empresa),
 * Redis/BullMQ com prefixo exclusivo desta execução e MinIO com o original na chave endereçada por
 * conteúdo, como a API grava. O leitor do storage é o real, com um desvio injetável para simular
 * indisponibilidade.
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
import {
  FILA_DE_VALIDACAO_EMPREGADOS,
  FILA_DE_VALIDACAO_EMPREGADOS_MORTA,
  NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS,
  idDoJobDeValidacao,
} from '@contaia/shared';
import { conexaoDoRedis } from '@contaia/signer-client';
import { Queue } from 'bullmq';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lerConfigDoArmazenamento } from '../config.js';
import { ErroDoArmazenamento, criarLeitorDoArmazenamento, type LeitorDoArmazenamento } from '../importacao/leitura-s3.js';
import { criarConexaoRedis } from '../redis.js';
import { iniciarConsumidorDeEmpregados, type ConsumidorDeEmpregados } from './consumidor.js';
import { registrarFalhaDaValidacaoDeEmpregados } from './validacao.js';

const admin: Pool = criarPool();
const app: Pool = criarPoolDaAplicacao();

/** Quantas das próximas conexões do worker falham (banco "fora" por um instante). */
let conexoesQueFalham = 0;
const poolDoWorker: Pool = new Proxy(app, {
  get(alvo, propriedade) {
    if (propriedade === 'connect' && conexoesQueFalham > 0) {
      conexoesQueFalham -= 1;

      return () => Promise.reject(new Error('banco fora do ar (simulado)'));
    }
    const valor: unknown = Reflect.get(alvo, propriedade, alvo);

    return typeof valor === 'function' ? (valor as (...args: unknown[]) => unknown).bind(alvo) : valor;
  },
});

const sufixo = `${String(process.pid).slice(-4).padStart(4, '0')}${String(Date.now()).slice(-6)}${randomInt(10, 99)}`;
const prefixo = `teste-emp-${process.pid}-${Date.now()}`;
const conexao = conexaoDoRedis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:36379');
const redisDoTeste = criarConexaoRedis(conexao);

const armazenamento = lerConfigDoArmazenamento({
  S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://127.0.0.1:39000',
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

const MAPEAMENTO = { cpf: 'cpf', nome: 'nome', matricula: 'matricula', data_nascimento: 'data_nascimento', data_admissao: 'data_admissao' };
const CABECALHO = 'cpf;nome;matricula;data_nascimento;data_admissao';
const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';
/** Opções rápidas: o padrão de produção espera segundos entre as tentativas. */
const RAPIDAS = { attempts: 3, backoff: { type: 'fixed', delay: 30 }, removeOnComplete: false, removeOnFail: false } as const;

let leitorReal: LeitorDoArmazenamento;
/** Desvio injetável do leitor: devolve o erro a lançar para a chave, ou `null` para ler de verdade. */
let falhaDaLeitura: (chave: string) => Error | null = () => null;
let fila: Queue;
let morta: Queue;
let consumidor: ConsumidorDeEmpregados;

let tenantA = '';
let tenantB = '';
let iniciadorA = '';
let iniciadorB = '';
let adminA = '';
let adminSuspensoA = '';
let colegaA = '';
let empresaA = '';
let empresaB = '';

const unico = async (sql: string, parametros: unknown[]): Promise<string> =>
  (await admin.query<{ id: string }>(sql, parametros)).rows[0]!.id;

const esperar = async (condicao: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> => {
  const limite = Date.now() + ms;

  while (!(await condicao())) {
    if (Date.now() > limite) {
      throw new Error('a condição não ocorreu a tempo');
    }
    await new Promise((resolver) => setTimeout(resolver, 25));
  }
};

const csv = (linhas: readonly string[]): Buffer => Buffer.from([CABECALHO, ...linhas, ''].join('\r\n'), 'utf8');

type Tentativa = Readonly<{ id: string; tenantId: string; empresaId: string; chave: string; comando: Record<string, string> }>;

/** O que a API faz no envio: original no MinIO pela chave do hash e a tentativa RECEBIDA. */
const novaTentativa = async (
  conteudo: Buffer,
  { tenantId = tenantA, empresaId = empresaA, iniciador = iniciadorA, enviar = true } = {},
): Promise<Tentativa> => {
  // O sufixo no conteúdo deixa o hash único por teste (a identidade idempotente é o hash).
  const bytes = Buffer.concat([conteudo, Buffer.from(`\r\n`)]);
  const hash = createHash('sha256').update(bytes).update(randomUUID()).digest('hex');
  const chave = `${tenantId}/${empresaId}/empregados/${hash}.csv`;

  if (enviar) {
    await s3.send(new PutObjectCommand({ Bucket: armazenamento.bucket, Key: chave, Body: bytes, ContentType: 'text/csv' }));
  }

  const correlationId = `corr-emp-${sufixo}`;
  const id = await unico(
    `insert into app.importacao_empregados
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
        usuario_iniciador_id, correlation_id)
     values ($1, $2, $3, $4::jsonb, 'empregados.csv', $5, $6, $7, $8) returning id`,
    [tenantId, empresaId, hash, JSON.stringify(MAPEAMENTO), bytes.length, chave, iniciador, correlationId],
  );

  return { id, tenantId, empresaId, chave, comando: { tenantId, empresaId, tentativaId: id, correlationId } };
};

const enfileirar = (dados: Record<string, string>, jobId: string) =>
  fila.add(NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS, dados, { ...RAPIDAS, jobId });

const estadoDe = async (id: string): Promise<string> =>
  (await admin.query<{ estado: string }>('select estado from app.importacao_empregados where id = $1', [id])).rows[0]!.estado;

const tentativaNoBanco = async (id: string) =>
  (
    await admin.query<{ estado: string; totais: unknown; empregados_versao_na_validacao: string | null }>(
      'select estado, totais, empregados_versao_na_validacao::text from app.importacao_empregados where id = $1',
      [id],
    )
  ).rows[0]!;

const stagingDe = async (id: string) =>
  (
    await admin.query<{
      numero_linha: number;
      cpf: string | null;
      cpf_normalizado: string | null;
      nome: string | null;
      matricula: string | null;
      data_nascimento: string | null;
      data_admissao: string | null;
      status: string;
      acao: string | null;
      codigo_de_erro: string | null;
      campo: string | null;
      mensagem: string | null;
    }>(
      `select numero_linha, cpf, cpf_normalizado, nome, matricula, data_nascimento, data_admissao,
              status, acao, codigo_de_erro, campo, mensagem
         from app.importacao_empregados_linha where tentativa_id = $1 order by numero_linha`,
      [id],
    )
  ).rows;

const eventosDe = async (id: string) =>
  (
    await admin.query<{ acao: string; estado_novo: string; codigo: string | null; correlation_id: string }>(
      'select acao, estado_novo, codigo, correlation_id from app.importacao_empregados_evento where tentativa_id = $1 order by sequencia',
      [id],
    )
  ).rows;

const notificadosDe = async (id: string): Promise<string[]> =>
  (await admin.query<{ usuario_id: string }>('select usuario_id from app.importacao_empregados_notificacao where tentativa_id = $1', [id])).rows
    .map((linha) => linha.usuario_id)
    .sort();

const empregadosDa = async (empresaId: string) =>
  (await admin.query<{ cpf: string; matricula: string; nome: string }>('select cpf, matricula, nome from app.empregado where empresa_id = $1 order by cpf, matricula', [empresaId])).rows;

const versaoDaBase = async (empresaId: string): Promise<string> =>
  (await admin.query<{ versao: string }>('select coalesce(max(versao), 0)::text as versao from app.empresa_empregados_versao where empresa_id = $1', [empresaId])).rows[0]!.versao;

const terminouOuEsperando = async (id: string): Promise<boolean> =>
  ['AGUARDANDO_CONFIRMACAO', 'REJEITADA', 'FALHA'].includes(await estadoDe(id));

const doJobNaMorta = async (tentativaId: string) =>
  (await morta.getJobs(['waiting', 'completed', 'failed', 'delayed'])).find((job) => job.data?.tentativaId === tentativaId);

const ordenados = (...ids: string[]): string[] => [...ids].sort();

beforeAll(async () => {
  const novoTenant = (rotulo: string): Promise<string> =>
    unico(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
      `Worker Empregados ${rotulo} ${sufixo}`,
      `X${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'),
    ]);
  const novoUsuario = (tenantId: string, rotulo: string, estado = 'ATIVO'): Promise<string> =>
    unico(
      `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, $4, $5) returning id`,
      [tenantId, `sub-we-${rotulo}-${sufixo}`, `we.${rotulo}.${sufixo}@empregados.local`, `Usuário ${rotulo}`, estado],
    );
  const novaEmpresa = (tenantId: string, rotulo: string): Promise<string> =>
    unico(
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
      [tenantId, `F${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa ${rotulo}`],
    );

  tenantA = await novoTenant('A');
  tenantB = await novoTenant('B');
  iniciadorA = await novoUsuario(tenantA, 'a');
  iniciadorB = await novoUsuario(tenantB, 'b');
  adminA = await novoUsuario(tenantA, 'adm');
  adminSuspensoA = await novoUsuario(tenantA, 'sus', 'SUSPENSO');
  colegaA = await novoUsuario(tenantA, 'col');
  empresaA = await novaEmpresa(tenantA, 'A');
  empresaB = await novaEmpresa(tenantB, 'B');

  // Carteira da empresa A: o admin ativo e o suspenso (ambos admin_escritorio) e um colega comum.
  for (const usuario of [adminA, adminSuspensoA, colegaA]) {
    await admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [tenantA, usuario, empresaA]);
  }
  for (const usuario of [adminA, adminSuspensoA]) {
    await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'admin_escritorio')`, [tenantA, usuario]);
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: armazenamento.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: armazenamento.bucket }));
  }

  leitorReal = criarLeitorDoArmazenamento(armazenamento);
  fila = new Queue(FILA_DE_VALIDACAO_EMPREGADOS, { connection: redisDoTeste, prefix: prefixo });
  morta = new Queue(FILA_DE_VALIDACAO_EMPREGADOS_MORTA, { connection: redisDoTeste, prefix: prefixo });
  consumidor = await iniciarConsumidorDeEmpregados({
    conexao,
    prefixo,
    pool: poolDoWorker,
    agora: () => new Date(),
    esperaParaRegistrarFalhaMs: 50,
    ler: async (chave) => {
      const falha = falhaDaLeitura(chave);
      if (falha !== null) {
        throw falha;
      }

      return leitorReal.ler(chave);
    },
  });
}, 60_000);

afterAll(async () => {
  await consumidor?.fechar();
  await fila?.obliterate({ force: true });
  await morta?.obliterate({ force: true });
  await Promise.all([fila?.close(), morta?.close()]);
  const restantes = await redisDoTeste.keys(`${prefixo}:*`);
  if (restantes.length > 0) {
    await redisDoTeste.del(...restantes);
  }
  redisDoTeste.disconnect();
  leitorReal?.fechar();

  for (const tenantId of [tenantA, tenantB].filter((t) => t !== '')) {
    const objetos = await s3.send(new ListObjectsV2Command({ Bucket: armazenamento.bucket, Prefix: `${tenantId}/` }));
    const chaves = (objetos.Contents ?? []).flatMap((objeto) => (objeto.Key === undefined ? [] : [{ Key: objeto.Key }]));
    if (chaves.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: armazenamento.bucket, Delete: { Objects: chaves } }));
    }
  }
  s3.destroy();

  const c = await admin.connect();
  try {
    await c.query('drop trigger if exists teste_falha_no_staging on app.importacao_empregados_linha');
    await c.query('drop function if exists app.teste_falha_no_staging()');
    await c.query('set session_replication_role = replica');
    const tabelas = (
      await c.query<{ tabela: string }>(
        `select table_name as tabela from information_schema.columns where table_schema = 'app' and column_name = 'tenant_id'`,
      )
    ).rows;
    for (const tenantId of [tenantA, tenantB].filter((t) => t !== '')) {
      for (const { tabela } of tabelas) {
        await c.query(`delete from app.${tabela} where tenant_id = $1`, [tenantId]);
      }
      await c.query('delete from app.tenant where id = $1', [tenantId]);
    }
  } finally {
    await c.query('reset session_replication_role');
    c.release();
  }
  await Promise.all([admin.end(), app.end()]);
}, 60_000);

beforeEach(() => {
  falhaDaLeitura = () => null;
  conexoesQueFalham = 0;
});

describe('caminho completo com o original real no MinIO', () => {
  it('2 linhas boas e 1 ruim → AGUARDANDO_CONFIRMACAO; o staging guarda as 3, a base NÃO é tocada e a prévia não notifica', async () => {
    const empresaAntes = await empregadosDa(empresaA);
    const versaoAntes = await versaoDaBase(empresaA);
    const tentativa = await novaTentativa(
      csv([`${CPF_A};Maria Souza;00123;15/03/1985;01/02/2010`, `${CPF_B};João Lima;77;1990-07-20;2015-01-10`, '123.456.789-00;Pedro Reis;9;01/01/1980;01/01/2000']),
    );

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await tentativaNoBanco(tentativa.id)).toEqual({
      estado: 'AGUARDANDO_CONFIRMACAO',
      totais: { lidas: 3, novas: 2, atualizadas: 0, rejeitadas: 1 },
      empregados_versao_na_validacao: versaoAntes,
    });
    expect(await stagingDe(tentativa.id)).toEqual([
      expect.objectContaining({ numero_linha: 2, status: 'VALIDA', acao: 'INCLUIR', cpf_normalizado: '52998224725', nome: 'Maria Souza', matricula: '00123', data_nascimento: '1985-03-15', data_admissao: '2010-02-01' }),
      expect.objectContaining({ numero_linha: 3, status: 'VALIDA', acao: 'INCLUIR', cpf_normalizado: '11144477735', matricula: '77', data_nascimento: '1990-07-20' }),
      expect.objectContaining({ numero_linha: 4, status: 'REJEITADA', acao: null, codigo_de_erro: 'CPF_INVALIDO', campo: 'cpf', mensagem: expect.stringMatching(/\S/u) }),
    ]);
    expect((await eventosDe(tentativa.id)).map((e) => [e.acao, e.estado_novo, e.correlation_id])).toEqual([
      ['INICIAR_VALIDACAO', 'VALIDANDO', `corr-emp-${sufixo}`],
      ['VALIDACAO_SUCESSO', 'AGUARDANDO_CONFIRMACAO', `corr-emp-${sufixo}`],
    ]);
    // O worker nunca aplica: a base e a versão seguem como estavam.
    expect(await empregadosDa(empresaA)).toEqual(empresaAntes);
    expect(await versaoDaBase(empresaA)).toBe(versaoAntes);
    expect(await notificadosDe(tentativa.id)).toEqual([]);
  });

  it('empregado já na base vira ATUALIZAR; arquivado vira EMPREGADO_ARQUIVADO; chave repetida rejeita todas; 00123 ≠ 123', async () => {
    const empresa = await unico(
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, 'Empresa base', 'ATIVA', 'ativo') returning id`,
      [tenantA, `H${randomInt(1_000_000, 9_999_999)}${sufixo}`.slice(0, 14).padEnd(14, '0')],
    );
    await admin.query(
      `insert into app.empregado (tenant_id, empresa_id, cpf, nome, matricula, data_nascimento, data_admissao, arquivado, arquivado_em)
       values ($1, $2, '52998224725', 'Maria Antiga', '00123', '1980-01-01', '2000-01-01', false, null),
              ($1, $2, '11144477735', 'João Arquivado', '5', '1980-01-01', '2000-01-01', true, now())`,
      [tenantA, empresa],
    );
    const tentativa = await novaTentativa(
      csv([
        `${CPF_A};Maria Nova;00123;15/03/1985;01/02/2010`,
        `${CPF_A};Maria Outra Matrícula;123;15/03/1985;01/02/2010`,
        `${CPF_B};João;5;20/07/1990;10/01/2015`,
        '390.533.447-05;Dup Um;8;01/01/1980;01/01/2000',
        '39053344705;Dup Dois;8;01/01/1981;01/01/2001',
      ]),
      { empresaId: empresa },
    );

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect((await stagingDe(tentativa.id)).map((l) => [l.numero_linha, l.status, l.acao, l.codigo_de_erro])).toEqual([
      [2, 'VALIDA', 'ATUALIZAR', null],
      [3, 'VALIDA', 'INCLUIR', null],
      [4, 'REJEITADA', null, 'EMPREGADO_ARQUIVADO'],
      [5, 'REJEITADA', null, 'CHAVE_DUPLICADA_NO_ARQUIVO'],
      [6, 'REJEITADA', null, 'CHAVE_DUPLICADA_NO_ARQUIVO'],
    ]);
    // O arquivado e o antigo seguem exatamente como estavam.
    expect((await empregadosDa(empresa)).map((e) => e.nome)).toEqual(['João Arquivado', 'Maria Antiga']);
  });

  it('nenhuma válida → REJEITADA com as rejeições preservadas no staging e notificação ao iniciador e ao admin ativo (sem repetir, sem suspenso nem colega)', async () => {
    const tentativa = await novaTentativa(csv(['123.456.789-00;Pedro;9;01/01/1980;01/01/2000', `${CPF_A};   ;2;15/03/1985;01/02/2010`]));

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await tentativaNoBanco(tentativa.id)).toMatchObject({ estado: 'REJEITADA', totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 } });
    expect((await stagingDe(tentativa.id)).map((l) => [l.status, l.codigo_de_erro, l.campo])).toEqual([
      ['REJEITADA', 'CPF_INVALIDO', 'cpf'],
      ['REJEITADA', 'CAMPO_OBRIGATORIO_AUSENTE', 'nome'],
    ]);
    expect((await eventosDe(tentativa.id)).at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', estado_novo: 'REJEITADA' });
    expect(await notificadosDe(tentativa.id)).toEqual(ordenados(iniciadorA, adminA));
  });

  it('o iniciador que também é admin autorizado recebe UMA notificação só', async () => {
    const tentativa = await novaTentativa(csv(['x;;1;31/02/2020;01/01/2020']), { iniciador: adminA });

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await estadoDe(tentativa.id)).toBe('REJEITADA');
    expect(await notificadosDe(tentativa.id)).toEqual([adminA]);
  });

  it('arquivo só com cabeçalho → REJEITADA sem staging, evento com ARQUIVO_VAZIO e notificação', async () => {
    const tentativa = await novaTentativa(Buffer.from(CABECALHO));

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await estadoDe(tentativa.id)).toBe('REJEITADA');
    expect(await stagingDe(tentativa.id)).toEqual([]);
    expect((await eventosDe(tentativa.id)).at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', codigo: 'ARQUIVO_VAZIO' });
    expect(await notificadosDe(tentativa.id)).toEqual(ordenados(iniciadorA, adminA));
  });

  it('arquivo brasileiro real vindo do MinIO: Latin-1, ";" e linhas em branco no fim', async () => {
    const latin1 = Buffer.from(`${CABECALHO}\r\n${CPF_A};José da Conceição;7;15/03/1985;01/02/2010\r\n\r\n\r\n`, 'latin1');
    const tentativa = await novaTentativa(latin1);

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await stagingDe(tentativa.id)).toEqual([expect.objectContaining({ status: 'VALIDA', nome: 'José da Conceição', matricula: '7' })]);
  });
});

describe('reentrega e recuperação (SPEC-014 §6.4)', () => {
  it('o mesmo job entregue duas vezes não duplica staging, eventos nem notificação; o resultado é o mesmo (REJEITADA e AGUARDANDO)', async () => {
    const boa = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`, `${CPF_B};João;2;15/03/1985;01/02/2010`, '123.456.789-00;Pedro;9;01/01/1980;01/01/2000']));
    const ruim = await novaTentativa(csv(['x;;1;31/02/2020;01/01/2020']));

    for (const tentativa of [boa, ruim]) {
      const jobId = idDoJobDeValidacao(tentativa.id);
      await enfileirar(tentativa.comando, jobId);
      await esperar(async () => (await fila.getJobState(jobId)) === 'completed');
      const primeira = {
        tentativa: await tentativaNoBanco(tentativa.id),
        staging: await stagingDe(tentativa.id),
        eventos: await eventosDe(tentativa.id),
        notificados: await notificadosDe(tentativa.id),
      };

      // Como a API faz ao reenfileirar um job concluído: remove e adiciona com o mesmo id.
      await (await fila.getJob(jobId))!.remove();
      await enfileirar(tentativa.comando, jobId);
      await esperar(async () => (await fila.getJobState(jobId)) === 'completed');

      expect((await fila.getJob(jobId))!.returnvalue).toEqual({ desfecho: 'JA_PROCESSADA' });
      expect({
        tentativa: await tentativaNoBanco(tentativa.id),
        staging: await stagingDe(tentativa.id),
        eventos: await eventosDe(tentativa.id),
        notificados: await notificadosDe(tentativa.id),
      }).toEqual(primeira);
    }
    expect(await notificadosDe(ruim.id)).toHaveLength(2);
    expect(await notificadosDe(boa.id)).toHaveLength(0);
  });

  it('duas entregas simultâneas da mesma tentativa: uma grava, a outra não duplica nada', async () => {
    const tentativa = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`, `${CPF_B};João;2;15/03/1985;01/02/2010`]));
    const base = idDoJobDeValidacao(tentativa.id);

    await Promise.all([enfileirar(tentativa.comando, `${base}-a`), enfileirar(tentativa.comando, `${base}-b`)]);
    await esperar(async () => {
      const estados = await Promise.all(['a', 'b'].map((l) => fila.getJobState(`${base}-${l}`)));

      return estados.every((estado) => estado === 'completed');
    });

    expect(await stagingDe(tentativa.id)).toHaveLength(2);
    expect((await eventosDe(tentativa.id)).map((e) => e.acao)).toEqual(['INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO']);
    expect((await tentativaNoBanco(tentativa.id)).totais).toEqual({ lidas: 2, novas: 2, atualizadas: 0, rejeitadas: 0 });
  });

  it('queda no meio: tentativa deixada em VALIDANDO com staging parcial conclui certo, sem duplicar', async () => {
    const tentativa = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`, `${CPF_B};João;2;15/03/1985;01/02/2010`]));
    await admin.query(`update app.importacao_empregados set estado = 'VALIDANDO', iniciado_em = now() where id = $1`, [tentativa.id]);
    await admin.query(
      `insert into app.importacao_empregados_linha
         (tenant_id, empresa_id, tentativa_id, numero_linha, cpf, cpf_normalizado, nome, matricula, data_nascimento, data_admissao, status, acao)
       values ($1, $2, $3, 2, '529.982.247-25', '52998224725', 'Maria', '1', '1985-03-15', '2010-02-01', 'VALIDA', 'INCLUIR')`,
      [tenantA, empresaA, tentativa.id],
    );

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await tentativaNoBanco(tentativa.id)).toMatchObject({ estado: 'AGUARDANDO_CONFIRMACAO', totais: { lidas: 2, novas: 2, atualizadas: 0, rejeitadas: 0 } });
    expect((await stagingDe(tentativa.id)).map((l) => l.numero_linha)).toEqual([2, 3]);
    expect((await eventosDe(tentativa.id)).map((e) => e.acao)).toEqual(['VALIDACAO_SUCESSO']);
  });
});

describe('falha técnica e fila morta', () => {
  it('storage indisponível em todas as tentativas → FALHA acionável com correlationId, um evento e uma notificação por destinatário; a fila morta guarda só os 4 ids, o código e as tentativas', async () => {
    const tentativa = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`]));
    falhaDaLeitura = (chave) => (chave === tentativa.chave ? new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL') : null);

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(async () => (await doJobNaMorta(tentativa.id)) !== undefined);

    expect(await estadoDe(tentativa.id)).toBe('FALHA');
    expect(await stagingDe(tentativa.id)).toEqual([]);
    expect((await eventosDe(tentativa.id)).filter((e) => e.acao === 'FALHA_TECNICA')).toEqual([
      { acao: 'FALHA_TECNICA', estado_novo: 'FALHA', codigo: 'ARMAZENAMENTO_INDISPONIVEL', correlation_id: `corr-emp-${sufixo}` },
    ]);
    expect(await notificadosDe(tentativa.id)).toEqual(ordenados(iniciadorA, adminA));
    expect((await doJobNaMorta(tentativa.id))!.data).toEqual({ ...tentativa.comando, motivo: 'ARMAZENAMENTO_INDISPONIVEL', tentativas: 3 });
  });

  it('original ausente no MinIO (chave sem objeto) → definitivo: FALHA na primeira tentativa', async () => {
    const tentativa = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`]), { enviar: false });

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(async () => (await doJobNaMorta(tentativa.id)) !== undefined);

    expect((await doJobNaMorta(tentativa.id))!.data).toMatchObject({ motivo: 'ORIGINAL_NAO_ENCONTRADO', tentativas: 1 });
    expect(await estadoDe(tentativa.id)).toBe('FALHA');
    expect((await eventosDe(tentativa.id)).at(-1)).toMatchObject({ acao: 'FALHA_TECNICA', codigo: 'ORIGINAL_NAO_ENCONTRADO' });
  });

  it('erro do banco com CPF e nome no detalhe: a gravação é revertida (nada de staging parcial) e nenhum dado pessoal chega à fila morta, ao evento, ao Redis nem ao log', async () => {
    const logs: string[] = [];
    const espiao = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const nomeSentinela = `Sentinela Gatilho ${sufixo}`;
    await admin.query(
      `create or replace function app.teste_falha_no_staging() returns trigger language plpgsql as $$
       begin
         if new.nome = '${nomeSentinela}' then
           raise exception 'falha injetada para % %', new.cpf, new.nome using detail = new.cpf || ' ' || new.nome;
         end if;
         return new;
       end $$`,
    );
    await admin.query(
      `create trigger teste_falha_no_staging before insert on app.importacao_empregados_linha
         for each row execute function app.teste_falha_no_staging()`,
    );

    try {
      const tentativa = await novaTentativa(csv([`${CPF_A};Maria Boa;1;15/03/1985;01/02/2010`, `${CPF_B};${nomeSentinela};2;15/03/1985;01/02/2010`]));
      await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
      await esperar(async () => (await doJobNaMorta(tentativa.id)) !== undefined);

      expect(await estadoDe(tentativa.id)).toBe('FALHA');
      // Tudo-ou-nada: a linha boa que veio antes na mesma instrução não ficou.
      expect(await stagingDe(tentativa.id)).toEqual([]);
      expect((await doJobNaMorta(tentativa.id))!.data).toEqual({ ...tentativa.comando, motivo: 'FALHA_NA_VALIDACAO', tentativas: 3 });
      const job = (await fila.getJob(idDoJobDeValidacao(tentativa.id)))!;
      const rastro = JSON.stringify([
        await eventosDe(tentativa.id),
        job.failedReason,
        job.stacktrace,
        job.data,
        (await doJobNaMorta(tentativa.id))!.data,
        logs,
      ]);
      for (const proibido of [nomeSentinela, 'Sentinela', '52998224725', '529.982.247-25', '111.444.777-35', '11144477735', 'Maria Boa']) {
        expect(rastro).not.toContain(proibido);
      }
      expect(job.failedReason).toBe('FALHA_NA_VALIDACAO');
    } finally {
      espiao.mockRestore();
      await admin.query('drop trigger if exists teste_falha_no_staging on app.importacao_empregados_linha');
    }
  });
});

describe('FALHA gravada com o job ainda ativo (SPEC-014 §6.4)', () => {
  it('banco fora ao gravar a FALHA na última tentativa: o job é ADIADO, volta, e a FALHA sai uma vez só', async () => {
    const tentativa = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`]));
    let leituras = 0;
    falhaDaLeitura = (chave) => {
      if (chave !== tentativa.chave) {
        return null;
      }
      leituras += 1;
      if (leituras === 3) {
        // Última tentativa: a próxima conexão do worker é a da FALHA, e ela cai.
        conexoesQueFalham = 1;
      }

      return new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL');
    };

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(async () => (await doJobNaMorta(tentativa.id)) !== undefined);

    // 3 tentativas + 1 volta do adiamento (que não gastou tentativa).
    expect(leituras).toBe(4);
    expect(await estadoDe(tentativa.id)).toBe('FALHA');
    expect((await eventosDe(tentativa.id)).filter((e) => e.acao === 'FALHA_TECNICA')).toHaveLength(1);
    expect(await notificadosDe(tentativa.id)).toEqual(ordenados(iniciadorA, adminA));
    const naMorta = (await morta.getJobs(['waiting'])).filter((job) => job.data?.tentativaId === tentativa.id);
    expect(naMorta.map((job) => job.data)).toEqual([{ ...tentativa.comando, motivo: 'ARMAZENAMENTO_INDISPONIVEL', tentativas: 3 }]);
  });

  it('falha transitória que NÃO é a última não grava FALHA: a tentativa seguinte conclui a validação', async () => {
    const tentativa = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`]));
    let leituras = 0;
    falhaDaLeitura = (chave) => {
      if (chave !== tentativa.chave) {
        return null;
      }
      leituras += 1;

      return leituras <= 2 ? new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL') : null;
    };

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await estadoDe(tentativa.id)).toBe('AGUARDANDO_CONFIRMACAO');
    expect((await eventosDe(tentativa.id)).map((e) => e.acao)).toEqual(['INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO']);
    expect(await doJobNaMorta(tentativa.id)).toBeUndefined();
  });

  it('queda do processo depois do commit da FALHA (job ainda ativo): a reentrega é ack sem efeito', async () => {
    const tentativa = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`]));
    await admin.query(`update app.importacao_empregados set estado = 'VALIDANDO', iniciado_em = now() where id = $1`, [tentativa.id]);
    // O que o processo gravou antes de morrer.
    await expect(registrarFalhaDaValidacaoDeEmpregados({ pool: app, agora: () => new Date() }, tentativa.comando, 'FALHA_NA_VALIDACAO')).resolves.toBe(true);

    const jobId = idDoJobDeValidacao(tentativa.id);
    await enfileirar(tentativa.comando, jobId);
    await esperar(async () => (await fila.getJobState(jobId)) === 'completed');

    expect((await fila.getJob(jobId))!.returnvalue).toEqual({ desfecho: 'JA_PROCESSADA' });
    expect((await eventosDe(tentativa.id)).map((e) => e.acao)).toEqual(['FALHA_TECNICA']);
    expect(await notificadosDe(tentativa.id)).toEqual(ordenados(iniciadorA, adminA));
    expect(await doJobNaMorta(tentativa.id)).toBeUndefined();
  });
});

describe('isolamento de tenant (RLS no contexto técnico)', () => {
  it('job com o tenant A apontando para a tentativa do tenant B: nada é lido nem alterado; vai à fila morta como não encontrada', async () => {
    const deB = await novaTentativa(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`]), { tenantId: tenantB, empresaId: empresaB, iniciador: iniciadorB });
    const lidas: string[] = [];
    falhaDaLeitura = (chave) => {
      lidas.push(chave);

      return null;
    };

    for (const [rotulo, dados] of [
      ['empresa de B', { ...deB.comando, tenantId: tenantA }],
      ['empresa de A', { ...deB.comando, tenantId: tenantA, empresaId: empresaA }],
    ] as const) {
      await enfileirar(dados, `${idDoJobDeValidacao(deB.id)}-${rotulo === 'empresa de B' ? 'b' : 'a'}`);
    }
    await esperar(async () => (await morta.getJobs(['waiting'])).filter((job) => job.data?.tentativaId === deB.id).length === 2);

    expect(lidas).toEqual([]);
    expect(await estadoDe(deB.id)).toBe('RECEBIDA');
    expect(await eventosDe(deB.id)).toEqual([]);
    expect(await notificadosDe(deB.id)).toEqual([]);
    const motivos = (await morta.getJobs(['waiting'])).filter((job) => job.data?.tentativaId === deB.id).map((job) => job.data);
    expect(motivos).toEqual([
      expect.objectContaining({ motivo: 'TENTATIVA_NAO_ENCONTRADA', tentativas: 1 }),
      expect.objectContaining({ motivo: 'TENTATIVA_NAO_ENCONTRADA', tentativas: 1 }),
    ]);
  });

  it('payload fora do contrato (inclusive com CPF no job) vai à fila morta como PAYLOAD_INVALIDO, só com os identificadores', async () => {
    await fila.add(NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS, { tentativaId: 'nao-e-uuid', cpf: '52998224725', nome: 'Maria Sigilo' }, { ...RAPIDAS, jobId: `lixo-${sufixo}` });

    await esperar(async () => (await morta.getJobs(['waiting'])).some((job) => job.data?.tentativaId === 'nao-e-uuid'));

    const item = (await morta.getJobs(['waiting'])).find((job) => job.data?.tentativaId === 'nao-e-uuid');
    expect(item?.data).toEqual({ tentativaId: 'nao-e-uuid', motivo: 'PAYLOAD_INVALIDO', tentativas: 1 });
  });
});
