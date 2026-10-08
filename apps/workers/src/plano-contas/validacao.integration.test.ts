/**
 * Validação do plano de contas sobre a infraestrutura local real (SPEC-013 §6.4, Review Focus 5):
 * PostgreSQL pelo papel `contaia_app` (RLS valendo, contexto técnico da empresa), Redis/BullMQ com
 * prefixo exclusivo desta execução e MinIO com o original na chave endereçada por conteúdo, como a
 * API grava. O leitor do storage é o real, com um desvio injetável para simular indisponibilidade.
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
  FILA_DE_VALIDACAO_PLANO_CONTAS,
  FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA,
  NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
  idDoJobDeValidacao,
} from '@contaia/shared';
import { conexaoDoRedis } from '@contaia/signer-client';
import { Queue } from 'bullmq';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { lerConfigDoArmazenamento } from '../config.js';
import { criarConexaoRedis } from '../redis.js';
import { iniciarConsumidorDoPlanoDeContas, type ConsumidorDoPlano } from './consumidor.js';
import { ErroDoArmazenamento, criarLeitorDoArmazenamento, type LeitorDoArmazenamento } from './leitura-s3.js';
import { registrarFalhaDaValidacao } from './validacao.js';

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
const prefixo = `teste-${process.pid}-${Date.now()}`;
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

const MAPEAMENTO = { codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' };
/** Opções rápidas: o padrão de produção espera segundos entre as tentativas. */
const RAPIDAS = { attempts: 3, backoff: { type: 'fixed', delay: 30 }, removeOnComplete: false, removeOnFail: false } as const;

let leitorReal: LeitorDoArmazenamento;
/** Desvio injetável do leitor: devolve o erro a lançar para a chave, ou `null` para ler de verdade. */
let falhaDaLeitura: (chave: string) => Error | null = () => null;
let fila: Queue;
let morta: Queue;
let consumidor: ConsumidorDoPlano;

let tenantA = '';
let tenantB = '';
let iniciadorA = '';
let iniciadorB = '';
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

const csv = (linhas: readonly string[]): Buffer => Buffer.from(['codigo;nome;tipo;natureza;conta_pai', ...linhas, ''].join('\r\n'), 'utf8');

type Tentativa = Readonly<{ id: string; tenantId: string; empresaId: string; chave: string; comando: Record<string, string> }>;

/** O que a API faz no envio: original no MinIO pela chave do hash e a tentativa RECEBIDA. */
const novaTentativa = async (
  conteudo: Buffer,
  { tenantId = tenantA, empresaId = empresaA, iniciador = iniciadorA, enviar = true } = {},
): Promise<Tentativa> => {
  // O sufixo no conteúdo deixa o hash único por teste (a identidade idempotente é o hash).
  const bytes = Buffer.concat([conteudo, Buffer.from(`\r\n`)]);
  const hash = createHash('sha256').update(bytes).update(randomUUID()).digest('hex');
  const chave = `${tenantId}/${empresaId}/plano-contas/${hash}.csv`;

  if (enviar) {
    await s3.send(new PutObjectCommand({ Bucket: armazenamento.bucket, Key: chave, Body: bytes, ContentType: 'text/csv' }));
  }

  const correlationId = `corr-worker-${sufixo}`;
  const id = await unico(
    `insert into app.importacao_plano_contas
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
        usuario_iniciador_id, correlation_id)
     values ($1, $2, $3, $4::jsonb, 'plano.csv', $5, $6, $7, $8) returning id`,
    [tenantId, empresaId, hash, JSON.stringify(MAPEAMENTO), bytes.length, chave, iniciador, correlationId],
  );

  return { id, tenantId, empresaId, chave, comando: { tenantId, empresaId, tentativaId: id, correlationId } };
};

const enfileirar = (dados: Record<string, string>, jobId: string) =>
  fila.add(NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS, dados, { ...RAPIDAS, jobId });

const estadoDe = async (id: string): Promise<string> =>
  (await admin.query<{ estado: string }>('select estado from app.importacao_plano_contas where id = $1', [id])).rows[0]!.estado;

const tentativaNoBanco = async (id: string) =>
  (
    await admin.query<{ estado: string; totais: unknown; plano_versao_na_validacao: string | null }>(
      'select estado, totais, plano_versao_na_validacao::text from app.importacao_plano_contas where id = $1',
      [id],
    )
  ).rows[0]!;

const stagingDe = async (id: string) =>
  (
    await admin.query<{ numero_linha: number; codigo: string | null; status: string; acao: string | null; codigo_de_erro: string | null; campo: string | null; mensagem: string | null }>(
      `select numero_linha, codigo, status, acao, codigo_de_erro, campo, mensagem
         from app.importacao_plano_contas_linha where tentativa_id = $1 order by numero_linha`,
      [id],
    )
  ).rows;

const eventosDe = async (id: string) =>
  (
    await admin.query<{ acao: string; estado_novo: string; codigo: string | null; correlation_id: string }>(
      'select acao, estado_novo, codigo, correlation_id from app.importacao_plano_contas_evento where tentativa_id = $1 order by sequencia',
      [id],
    )
  ).rows;

const notificacoesDe = async (id: string) =>
  (await admin.query<{ usuario_id: string }>('select usuario_id from app.importacao_plano_contas_notificacao where tentativa_id = $1', [id])).rows;

const terminouOuEsperando = async (id: string): Promise<boolean> =>
  ['AGUARDANDO_CONFIRMACAO', 'REJEITADA', 'FALHA'].includes(await estadoDe(id));

const doJobNaMorta = async (tentativaId: string) =>
  (await morta.getJobs(['waiting', 'completed', 'failed', 'delayed'])).find((job) => job.data?.tentativaId === tentativaId);

beforeAll(async () => {
  const novoTenant = (rotulo: string): Promise<string> =>
    unico(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
      `Worker Plano ${rotulo} ${sufixo}`,
      `W${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'),
    ]);
  const novoUsuario = (tenantId: string, rotulo: string): Promise<string> =>
    unico(
      `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, $4, 'ATIVO') returning id`,
      [tenantId, `sub-wp-${rotulo}-${sufixo}`, `wp.${rotulo}.${sufixo}@plano.local`, `Usuário ${rotulo}`],
    );
  const novaEmpresa = (tenantId: string, rotulo: string): Promise<string> =>
    unico(
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
      [tenantId, `E${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa ${rotulo}`],
    );

  tenantA = await novoTenant('A');
  tenantB = await novoTenant('B');
  iniciadorA = await novoUsuario(tenantA, 'a');
  iniciadorB = await novoUsuario(tenantB, 'b');
  empresaA = await novaEmpresa(tenantA, 'A');
  empresaB = await novaEmpresa(tenantB, 'B');

  try {
    await s3.send(new HeadBucketCommand({ Bucket: armazenamento.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: armazenamento.bucket }));
  }

  leitorReal = criarLeitorDoArmazenamento(armazenamento);
  fila = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS, { connection: redisDoTeste, prefix: prefixo });
  morta = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA, { connection: redisDoTeste, prefix: prefixo });
  consumidor = await iniciarConsumidorDoPlanoDeContas({
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
  it('o staging sai como esperado: válidas, rejeitadas com mensagem PT-BR e a linha física certa (inclusive campos a mais)', async () => {
    const tentativa = await novaTentativa(
      csv([
        '1;Ativo;sintetica;devedora;',
        '1.1;Caixa;analitica;devedora;1',
        '3;Caixa; Bancos;analitica;devedora;1',
        '9;Órfã;analitica;devedora;8',
        `${'C'.repeat(65)};Longo;sintetica;devedora;`,
      ]),
    );

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await tentativaNoBanco(tentativa.id)).toEqual({
      estado: 'AGUARDANDO_CONFIRMACAO',
      totais: { lidas: 5, novas: 2, atualizadas: 0, rejeitadas: 3 },
      plano_versao_na_validacao: '0',
    });
    expect(await stagingDe(tentativa.id)).toEqual([
      expect.objectContaining({ numero_linha: 2, codigo: '1', status: 'VALIDA', acao: 'INCLUIR' }),
      expect.objectContaining({ numero_linha: 3, codigo: '1.1', status: 'VALIDA', acao: 'INCLUIR' }),
      expect.objectContaining({
        numero_linha: 4,
        codigo: '3',
        status: 'REJEITADA',
        codigo_de_erro: 'VALOR_FORA_DO_DOMINIO',
        campo: null,
        mensagem: "A linha tem mais campos do que o cabeçalho; confira ';' ou aspas no texto.",
      }),
      expect.objectContaining({ numero_linha: 5, codigo: '9', codigo_de_erro: 'CONTA_PAI_INEXISTENTE', mensagem: expect.stringContaining('conta-pai') }),
      expect.objectContaining({ numero_linha: 6, codigo: 'C'.repeat(65), codigo_de_erro: 'VALOR_FORA_DO_DOMINIO', campo: 'codigo' }),
    ]);
    expect((await eventosDe(tentativa.id)).map((e) => [e.acao, e.estado_novo, e.correlation_id])).toEqual([
      ['INICIAR_VALIDACAO', 'VALIDANDO', `corr-worker-${sufixo}`],
      ['VALIDACAO_SUCESSO', 'AGUARDANDO_CONFIRMACAO', `corr-worker-${sufixo}`],
    ]);
    // A prévia não notifica: só a confirmação (API) ou um desfecho terminal do worker.
    expect(await notificacoesDe(tentativa.id)).toEqual([]);
  });

  it('nenhuma válida → REJEITADA com uma notificação ao iniciador', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;xyz;devedora;']));

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await estadoDe(tentativa.id)).toBe('REJEITADA');
    expect(await notificacoesDe(tentativa.id)).toEqual([{ usuario_id: iniciadorA }]);
  });

  it('arquivo só com cabeçalho → REJEITADA sem staging, evento com ARQUIVO_VAZIO e notificação', async () => {
    const tentativa = await novaTentativa(Buffer.from('codigo;nome;tipo;natureza;conta_pai'));

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await estadoDe(tentativa.id)).toBe('REJEITADA');
    expect(await stagingDe(tentativa.id)).toEqual([]);
    expect((await eventosDe(tentativa.id)).at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', codigo: 'ARQUIVO_VAZIO' });
    expect(await notificacoesDe(tentativa.id)).toHaveLength(1);
  });
});

describe('reentrega e recuperação (SPEC-013 §6.4)', () => {
  it('o mesmo job entregue duas vezes não duplica staging, eventos nem notificação; o resultado é o mesmo', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;', '2;Passivo;sintetica;credora;', '2;Dup;sintetica;credora;']));
    const jobId = idDoJobDeValidacao(tentativa.id);

    await enfileirar(tentativa.comando, jobId);
    await esperar(async () => (await fila.getJobState(jobId)) === 'completed');
    const primeira = { tentativa: await tentativaNoBanco(tentativa.id), staging: await stagingDe(tentativa.id), eventos: await eventosDe(tentativa.id) };

    // Como a API faz ao reenfileirar um job concluído: remove e adiciona com o mesmo id.
    await (await fila.getJob(jobId))!.remove();
    await enfileirar(tentativa.comando, jobId);
    await esperar(async () => (await fila.getJobState(jobId)) === 'completed');

    expect((await fila.getJob(jobId))!.returnvalue).toEqual({ desfecho: 'JA_PROCESSADA' });
    expect({ tentativa: await tentativaNoBanco(tentativa.id), staging: await stagingDe(tentativa.id), eventos: await eventosDe(tentativa.id) }).toEqual(primeira);
    expect(primeira.tentativa.totais).toEqual({ lidas: 3, novas: 1, atualizadas: 0, rejeitadas: 2 });
  });

  it('duas entregas simultâneas da mesma tentativa: uma grava, a outra não duplica nada', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;', '1.1;Caixa;analitica;devedora;1']));

    await Promise.all([enfileirar(tentativa.comando, `${idDoJobDeValidacao(tentativa.id)}-a`), enfileirar(tentativa.comando, `${idDoJobDeValidacao(tentativa.id)}-b`)]);
    await esperar(async () => {
      const estados = await Promise.all(['a', 'b'].map((l) => fila.getJobState(`${idDoJobDeValidacao(tentativa.id)}-${l}`)));

      return estados.every((estado) => estado === 'completed');
    });

    expect(await stagingDe(tentativa.id)).toHaveLength(2);
    expect((await eventosDe(tentativa.id)).map((e) => e.acao)).toEqual(['INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO']);
    expect((await tentativaNoBanco(tentativa.id)).totais).toEqual({ lidas: 2, novas: 2, atualizadas: 0, rejeitadas: 0 });
  });

  it('queda no meio: tentativa deixada em VALIDANDO com staging parcial conclui certo, sem duplicar', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;', '1.1;Caixa;analitica;devedora;1']));
    await admin.query(`update app.importacao_plano_contas set estado = 'VALIDANDO', iniciado_em = now() where id = $1`, [tentativa.id]);
    await admin.query(
      `insert into app.importacao_plano_contas_linha
         (tenant_id, empresa_id, tentativa_id, numero_linha, codigo, nome, tipo, natureza, conta_pai, status, acao)
       values ($1, $2, $3, 2, '1', 'Ativo', 'sintetica', 'devedora', null, 'VALIDA', 'INCLUIR')`,
      [tenantA, empresaA, tentativa.id],
    );

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(() => terminouOuEsperando(tentativa.id));

    expect(await tentativaNoBanco(tentativa.id)).toMatchObject({
      estado: 'AGUARDANDO_CONFIRMACAO',
      totais: { lidas: 2, novas: 2, atualizadas: 0, rejeitadas: 0 },
    });
    expect((await stagingDe(tentativa.id)).map((l) => l.numero_linha)).toEqual([2, 3]);
    expect((await eventosDe(tentativa.id)).map((e) => e.acao)).toEqual(['VALIDACAO_SUCESSO']);
  });
});

describe('falha técnica e fila morta', () => {
  it('storage indisponível em todas as tentativas → FALHA, um evento e uma notificação; a fila morta guarda só o código e as tentativas', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;']));
    falhaDaLeitura = (chave) => (chave === tentativa.chave ? new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL') : null);

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(async () => (await doJobNaMorta(tentativa.id)) !== undefined);

    expect(await estadoDe(tentativa.id)).toBe('FALHA');
    expect((await eventosDe(tentativa.id)).filter((e) => e.acao === 'FALHA_TECNICA')).toEqual([
      { acao: 'FALHA_TECNICA', estado_novo: 'FALHA', codigo: 'ARMAZENAMENTO_INDISPONIVEL', correlation_id: `corr-worker-${sufixo}` },
    ]);
    expect(await notificacoesDe(tentativa.id)).toEqual([{ usuario_id: iniciadorA }]);
    expect((await doJobNaMorta(tentativa.id))!.data).toEqual({ ...tentativa.comando, motivo: 'ARMAZENAMENTO_INDISPONIVEL', tentativas: 3 });
  });

  it('a mensagem crua de uma exceção qualquer nunca chega à fila morta nem ao evento', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;']));
    falhaDaLeitura = (chave) => (chave === tentativa.chave ? new Error('SENHA-SENTINELA-NAO-PODE-VAZAR') : null);

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(async () => (await doJobNaMorta(tentativa.id)) !== undefined);

    const naMorta = await doJobNaMorta(tentativa.id);
    expect(JSON.stringify(naMorta!.data)).not.toContain('SENTINELA');
    expect(naMorta!.data).toMatchObject({ motivo: 'FALHA_NA_VALIDACAO' });
    expect(JSON.stringify(await eventosDe(tentativa.id))).not.toContain('SENTINELA');
    expect(await estadoDe(tentativa.id)).toBe('FALHA');
  });

  it('original ausente no MinIO (chave sem objeto) → definitivo: FALHA na primeira tentativa', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;']), { enviar: false });

    await enfileirar(tentativa.comando, idDoJobDeValidacao(tentativa.id));
    await esperar(async () => (await doJobNaMorta(tentativa.id)) !== undefined);

    expect((await doJobNaMorta(tentativa.id))!.data).toMatchObject({ motivo: 'ORIGINAL_NAO_ENCONTRADO', tentativas: 1 });
    expect(await estadoDe(tentativa.id)).toBe('FALHA');
    expect((await eventosDe(tentativa.id)).at(-1)).toMatchObject({ acao: 'FALHA_TECNICA', codigo: 'ORIGINAL_NAO_ENCONTRADO' });
  });
});

describe('FALHA gravada com o job ainda ativo (SPEC-013 §6.4)', () => {
  it('banco fora ao gravar a FALHA na última tentativa: o job é ADIADO, volta, e a FALHA sai uma vez só', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;']));
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
    expect(await notificacoesDe(tentativa.id)).toEqual([{ usuario_id: iniciadorA }]);
    const naMorta = (await morta.getJobs(['waiting'])).filter((job) => job.data?.tentativaId === tentativa.id);
    expect(naMorta.map((job) => job.data)).toEqual([{ ...tentativa.comando, motivo: 'ARMAZENAMENTO_INDISPONIVEL', tentativas: 3 }]);
  });

  it('falha transitória que NÃO é a última não grava FALHA: a tentativa seguinte conclui a validação', async () => {
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;']));
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
    const tentativa = await novaTentativa(csv(['1;Ativo;sintetica;devedora;']));
    await admin.query(`update app.importacao_plano_contas set estado = 'VALIDANDO', iniciado_em = now() where id = $1`, [tentativa.id]);
    // O que o processo gravou antes de morrer.
    await expect(registrarFalhaDaValidacao({ pool: app, agora: () => new Date() }, tentativa.comando, 'FALHA_NA_VALIDACAO')).resolves.toBe(true);

    const jobId = idDoJobDeValidacao(tentativa.id);
    await enfileirar(tentativa.comando, jobId);
    await esperar(async () => (await fila.getJobState(jobId)) === 'completed');

    expect((await fila.getJob(jobId))!.returnvalue).toEqual({ desfecho: 'JA_PROCESSADA' });
    expect((await eventosDe(tentativa.id)).map((e) => e.acao)).toEqual(['FALHA_TECNICA']);
    expect(await notificacoesDe(tentativa.id)).toHaveLength(1);
    expect(await doJobNaMorta(tentativa.id)).toBeUndefined();
  });
});

describe('isolamento de tenant (RLS no contexto técnico)', () => {
  it('job com o tenant A apontando para a tentativa do tenant B: nada é lido nem alterado; vai à fila morta como não encontrada', async () => {
    const deB = await novaTentativa(csv(['1;Ativo;sintetica;devedora;']), { tenantId: tenantB, empresaId: empresaB, iniciador: iniciadorB });
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
    const motivos = (await morta.getJobs(['waiting'])).filter((job) => job.data?.tentativaId === deB.id).map((job) => job.data);
    expect(motivos).toEqual([
      expect.objectContaining({ motivo: 'TENTATIVA_NAO_ENCONTRADA', tentativas: 1 }),
      expect.objectContaining({ motivo: 'TENTATIVA_NAO_ENCONTRADA', tentativas: 1 }),
    ]);
  });

  it('payload fora do contrato vai à fila morta como PAYLOAD_INVALIDO, só com os identificadores (nada arbitrário)', async () => {
    await fila.add(NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS, { tentativaId: 'nao-e-uuid', conteudo: 'SENHA-SENTINELA' }, { ...RAPIDAS, jobId: `lixo-${sufixo}` });

    await esperar(async () => (await morta.getJobs(['waiting'])).some((job) => job.data?.tentativaId === 'nao-e-uuid'));

    const item = (await morta.getJobs(['waiting'])).find((job) => job.data?.tentativaId === 'nao-e-uuid');
    expect(item?.data).toEqual({ tentativaId: 'nao-e-uuid', motivo: 'PAYLOAD_INVALIDO', tentativas: 1 });
  });
});
