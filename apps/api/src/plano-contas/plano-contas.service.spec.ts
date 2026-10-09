/**
 * Casos de uso da importação do plano de contas (SPEC-013 §3.2–§3.10, §7; categoria Regras).
 *
 * Banco, storage e fila entram por dublê. O banco dublado guarda as tentativas, as contas, os
 * eventos, as notificações e as pendências em memória e REVERTE tudo quando o caso de uso lança
 * dentro de `comContextoHumano` — é o que permite provar "falha na aplicação não deixa plano
 * parcial" sem PostgreSQL. A persistência real tem provas no `.integration.test.ts`.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, MODELO_CSV } from '@contaia/domain';
import type { TentativaDeImportacao } from '@contaia/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanoContasService } from './plano-contas.service';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const OUTRA_EMPRESA = '0198f3c2-0000-7000-8000-000000000009';
const USUARIO = '0198f3c2-0000-7000-8000-000000000004';
const OUTRO_USUARIO = '0198f3c2-0000-7000-8000-000000000005';
const AGORA = new Date('2026-10-08T12:00:00.000Z');
const BOM = String.fromCharCode(0xfeff);
const CONTEXTO = { tenantId: TENANT, usuarioId: USUARIO, correlationId: 'corr-plano-0001' } as const;

const MAPEAMENTO = { codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' } as const;

type Banco = {
  tentativas: TentativaDeImportacao[];
  contas: string[];
  eventos: Readonly<{ acao: string; estadoNovo: string; usuarioId: string | null }>[];
  eventosCompletos: Readonly<Record<string, unknown>>[];
  notificacoes: string[];
  pendenciasAbertas: string[];
  sequencia: number;
};

const { db, falhas, chamadas, empresas } = vi.hoisted(() => ({
  db: { atual: null as unknown as Banco },
  /** Situação do cadastro: empresa fora dos dois conjuntos é ATIVA e não arquivada. */
  empresas: { arquivadas: new Set<string>(), incompletas: new Set<string>() },
  falhas: {
    aplicar: null as Error | null,
    notificar: null as Error | null,
    ignoradas: [] as string[],
    /** Erro da 2ª chamada de `confirmar` (a da transação que registra a FALHA). */
    confirmarDeNovo: null as Error | null,
  },
  chamadas: {
    ordem: [] as string[],
    confirmacoes: 0,
    sqls: [] as string[],
    clientes: [] as EventEmitter[],
    transacoesAbertas: 0,
    origensConsultadas: [] as (string | null)[],
    relatorioFinalizado: false,
  },
}));

const bancoVazio = (): Banco => ({
  tentativas: [],
  contas: [],
  eventos: [],
  eventosCompletos: [],
  notificacoes: [],
  pendenciasAbertas: ['plano-contas:incompleto'],
  sequencia: 0,
});

const clonar = (banco: Banco): Banco => ({
  ...banco,
  tentativas: banco.tentativas.map((t) => ({ ...t })),
  contas: [...banco.contas],
  eventos: [...banco.eventos],
  eventosCompletos: [...banco.eventosCompletos],
  notificacoes: [...banco.notificacoes],
  pendenciasAbertas: [...banco.pendenciasAbertas],
});

const naoEncontrada = () =>
  new ErroDeDominio(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA, 'Tentativa de importação não encontrada.');
const estadoInvalido = () => new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'Estado inválido.');

const daEmpresa = (empresaId: string, id: string): TentativaDeImportacao | undefined =>
  db.atual.tentativas.find((t) => t.id === id && t.empresaId === empresaId);

const trocar = (id: string, mudanca: Partial<TentativaDeImportacao>): TentativaDeImportacao => {
  const indice = db.atual.tentativas.findIndex((t) => t.id === id);
  const nova = { ...db.atual.tentativas[indice]!, ...mudanca };
  db.atual.tentativas[indice] = nova;

  return nova;
};

vi.mock('@contaia/db', () => ({
  comContextoHumano: async (_pool: unknown, _contexto: unknown, executar: (c: unknown) => Promise<unknown>) => {
    const antes = clonar(db.atual);
    chamadas.transacoesAbertas += 1;

    const { EventEmitter: Emissor } = await import('node:events');
    const cliente = Object.assign(new Emissor(), {
      query: async (sql: string, parametros: readonly unknown[] = []) => {
        chamadas.sqls.push(`${sql} ${JSON.stringify(parametros)}`);

        return { rows: [], rowCount: 0 };
      },
    });
    chamadas.clientes.push(cliente);

    try {
      return await executar(cliente);
    } catch (erro) {
      db.atual = antes; // ROLLBACK
      throw erro;
    } finally {
      chamadas.transacoesAbertas -= 1;
    }
  },
  criarTentativaDeImportacao: async (_c: unknown, nova: Record<string, unknown>) => {
    const identidade = JSON.stringify(nova['mapeamento']);
    const existente = db.atual.tentativas.find(
      (t) =>
        t.empresaId === nova['empresaId'] &&
        t.hashArquivo === nova['hashArquivo'] &&
        JSON.stringify(t.mapeamento) === identidade &&
        !['FALHA', 'CANCELADA'].includes(t.estado),
    );

    if (existente !== undefined) {
      const reutilizavel = ['CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA'].includes(existente.estado);

      return { ...trocar(existente.id, { reutilizadaPorIdempotencia: existente.reutilizadaPorIdempotencia || reutilizavel }), reutilizada: true };
    }

    db.atual.sequencia += 1;
    const criada: TentativaDeImportacao = {
      id: `0198f3c2-0000-7000-8000-${String(db.atual.sequencia).padStart(12, '0')}`,
      tenantId: nova['tenantId'] as string,
      empresaId: nova['empresaId'] as string,
      hashArquivo: nova['hashArquivo'] as string,
      mapeamento: nova['mapeamento'] as Record<string, string>,
      arquivoNome: nova['arquivoNome'] as string,
      arquivoTamanho: nova['arquivoTamanho'] as number,
      arquivoChave: nova['arquivoChave'] as string,
      estado: 'RECEBIDA',
      planoVersaoNaValidacao: null,
      totais: null,
      usuarioIniciadorId: nova['usuarioIniciadorId'] as string,
      usuarioConfirmadorId: null,
      usuarioCanceladorId: null,
      correlationId: nova['correlationId'] as string,
      reutilizadaPorIdempotencia: false,
      criadoEm: nova['agora'] as Date,
      iniciadoEm: null,
      finalizadoEm: null,
    };
    db.atual.tentativas.push(criada);

    return { ...criada, reutilizada: false };
  },
  buscarTentativaDeImportacao: async (_c: unknown, empresaId: string, id: string) => daEmpresa(empresaId, id) ?? null,
  confirmarImportacao: async (
    _c: unknown,
    entrada: { empresaId: string; tentativaId: string; usuarioId: string; versaoDaPrevia: number },
  ) => {
    chamadas.ordem.push('confirmar');
    chamadas.confirmacoes += 1;
    if (chamadas.confirmacoes > 1 && falhas.confirmarDeNovo !== null) throw falhas.confirmarDeNovo;
    const atual = daEmpresa(entrada.empresaId, entrada.tentativaId);

    if (atual === undefined) throw naoEncontrada();
    if (atual.estado !== 'AGUARDANDO_CONFIRMACAO') throw estadoInvalido();
    if (atual.planoVersaoNaValidacao !== entrada.versaoDaPrevia) {
      throw new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO, 'O plano mudou.');
    }

    return trocar(atual.id, { estado: 'APLICANDO', usuarioConfirmadorId: entrada.usuarioId });
  },
  aplicarLinhasNoPlano: async () => {
    chamadas.ordem.push('aplicar');
    db.atual.contas.push('1', '1.1');

    if (falhas.aplicar !== null) throw falhas.aplicar;

    return { incluidas: 2, atualizadas: 0, ignoradas: falhas.ignoradas, versaoDoPlano: 1 };
  },
  registrarFalhaDaImportacao: async (_c: unknown, empresaId: string, id: string, agora: Date) => {
    chamadas.ordem.push('falha');
    const atual = daEmpresa(empresaId, id);

    if (atual === undefined) throw naoEncontrada();
    if (atual.estado !== 'APLICANDO' && atual.estado !== 'VALIDANDO') throw estadoInvalido();
    trocar(id, { estado: 'FALHA', finalizadoEm: agora });

    return atual.estado;
  },
  registrarEventoDeImportacao: async (
    _c: unknown,
    evento: { acao: string; estadoNovo: string; usuarioId: string | null } & Record<string, unknown>,
  ) => {
    db.atual.eventosCompletos.push(evento);
    chamadas.ordem.push(`evento:${evento.acao}`);
    db.atual.eventos.push({ acao: evento.acao, estadoNovo: evento.estadoNovo, usuarioId: evento.usuarioId });
  },
  finalizarImportacao: async (
    _c: unknown,
    _empresaId: string,
    id: string,
    estadoFinal: TentativaDeImportacao['estado'],
    totais: TentativaDeImportacao['totais'],
    agora: Date,
  ) => {
    chamadas.ordem.push(`finalizar:${estadoFinal}`);
    trocar(id, { estado: estadoFinal, totais, finalizadoEm: agora });
  },
  cancelarImportacao: async (_c: unknown, entrada: { empresaId: string; tentativaId: string; usuarioId: string; agora: Date }) => {
    const atual = daEmpresa(entrada.empresaId, entrada.tentativaId);

    if (atual === undefined) throw naoEncontrada();
    if (atual.estado !== 'AGUARDANDO_CONFIRMACAO') throw estadoInvalido();

    return trocar(atual.id, { estado: 'CANCELADA', usuarioCanceladorId: entrada.usuarioId, finalizadoEm: entrada.agora });
  },
  criarNotificacaoDeImportacao: async (_c: unknown, entrada: { tentativaId: string }) => {
    chamadas.ordem.push('notificar');

    if (falhas.notificar !== null) throw falhas.notificar;
    if (db.atual.notificacoes.includes(entrada.tentativaId)) return false;
    db.atual.notificacoes.push(entrada.tentativaId);

    return true;
  },
  contarContasValidas: async () => db.atual.contas.length,
  carregarSituacaoDaEmpresa: async (_c: unknown, empresaId: string) => ({
    arquivada: empresas.arquivadas.has(empresaId),
    ativa: !empresas.incompletas.has(empresaId),
  }),
  buscarDiagnosticoDaTentativa: async (_c: unknown, _empresaId: string, tentativaId: string) => {
    chamadas.ordem.push('diagnostico');
    const evento = [...db.atual.eventosCompletos]
      .reverse()
      .find((e) => e['tentativaId'] === tentativaId && ['FALHA_TECNICA', 'VALIDACAO_REJEITADA'].includes(String(e['acao'])) && e['codigo'] !== null);

    return evento === undefined ? null : { acao: evento['acao'], codigo: evento['codigo'] };
  },
  listarAbertasDaEmpresa: async (_c: unknown, _empresaId: string, origem: string | null) => {
    chamadas.origensConsultadas.push(origem);

    return db.atual.pendenciasAbertas.map((chave) => ({ chave }));
  },
  reconciliar: async (
    _c: unknown,
    _t: string,
    _e: string,
    paraAbrir: readonly { chave: string }[],
    paraResolver: readonly string[],
  ) => {
    chamadas.ordem.push('pendencia');
    db.atual.pendenciasAbertas = [
      ...db.atual.pendenciasAbertas.filter((chave) => !paraResolver.includes(chave)),
      ...paraAbrir.map((causa) => causa.chave),
    ];

    return new Map();
  },
  listarRejeicoesDaImportacao: async (_c: unknown, _e: string, _id: string, pagina: number, porPagina: number) => ({
    pagina,
    itensPorPagina: porPagina,
    total: 1,
    itens: [{ numeroDaLinha: 4, codigo: '9', campo: 'conta_pai', codigoDeErro: 'CONTA_PAI_INEXISTENTE', mensagem: 'Pai ausente.' }],
  }),
  listarHistoricoDeImportacoes: async (_c: unknown, empresaId: string, pagina: number) => ({
    pagina,
    itensPorPagina: 15,
    total: 0,
    itens: [],
    empresaId,
  }),
  listarPlanoDeContas: async (_c: unknown, _e: string, pagina: number, porPagina: number, busca?: string) => ({
    pagina,
    itensPorPagina: porPagina,
    total: 1,
    busca,
    itens: [
      {
        id: '0198f3c2-0000-7000-8000-0000000000c1',
        codigo: '1',
        nome: 'Ativo',
        tipo: 'sintetica',
        natureza: 'devedora',
        contaPai: null,
        arquivada: false,
        versao: 3,
        atualizadoEm: AGORA,
      },
    ],
  }),
  listarLinhasParaRelatorio: async function* () {
    try {
      for (let linha = 2; linha < 5_000; linha += 1) {
        yield {
          numeroDaLinha: linha,
          codigo: linha === 2 ? '=HYPERLINK("x")' : String(linha),
          nome: 'Conta',
          tipo: 'analitica',
          natureza: 'devedora',
          contaPai: null,
          status: 'VALIDA',
          acao: 'INCLUIR',
          codigoDeErro: null,
          campo: null,
          mensagem: null,
        };
      }
    } finally {
      chamadas.relatorioFinalizado = true;
    }
  },
}));

class ServicoComRelogio extends PlanoContasService {
  protected override agora(): Date {
    return AGORA;
  }
}

const montar = (prazos?: Readonly<{ ociosidadeMs: number; totalMs: number }>) => {
  const storage = {
    enviarComChave: vi.fn().mockResolvedValue(undefined),
    obter: vi.fn().mockResolvedValue({ conteudo: Buffer.from('codigo;nome\n'), tipoConteudo: 'text/csv' }),
  };
  const fila = { enfileirar: vi.fn().mockResolvedValue(undefined) };
  const servico = new ServicoComRelogio({ instancia: {} } as never, storage as never, fila, prazos);

  return { storage, fila, servico };
};

const csv = (texto: string): Buffer => Buffer.from(texto, 'utf8');
const arquivo = (conteudo: Buffer = csv(MODELO_CSV), mimetype = 'text/csv') => ({ buffer: conteudo, nome: 'plano.csv', mimetype });
const sha256 = (conteudo: Buffer): string => createHash('sha256').update(conteudo).digest('hex');

const codigoDo = async (acao: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `OUTRO: ${String(erro)}`;
  }

  return undefined;
};

/** Leva a tentativa recém-criada ao estado de prévia pronta (o que o worker faria). */
const validada = (id: string, rejeitadas = 1): void => {
  trocar(id, {
    estado: 'AGUARDANDO_CONFIRMACAO',
    planoVersaoNaValidacao: 0,
    totais: { lidas: 2 + rejeitadas, novas: 2, atualizadas: 0, rejeitadas },
  });
};

beforeEach(() => {
  db.atual = bancoVazio();
  empresas.arquivadas.clear();
  empresas.incompletas.clear();
  falhas.aplicar = null;
  falhas.notificar = null;
  falhas.ignoradas = [];
  falhas.confirmarDeNovo = null;
  chamadas.confirmacoes = 0;
  chamadas.sqls = [];
  chamadas.clientes = [];
  chamadas.ordem = [];
  chamadas.transacoesAbertas = 0;
  chamadas.origensConsultadas = [];
  chamadas.relatorioFinalizado = false;
});

describe('enviar: arquivo aceito (SPEC-013 §3.2, §6.1)', () => {
  it('guarda o original pelo hash, cria a tentativa RECEBIDA com o mapeamento e enfileira', async () => {
    const { storage, fila, servico } = montar();
    const conteudo = csv(MODELO_CSV);

    const visao = await servico.enviar(CONTEXTO, EMPRESA, arquivo(conteudo), MAPEAMENTO);

    const hash = sha256(conteudo);
    const chave = `${TENANT}/${EMPRESA}/plano-contas/${hash}.csv`;
    expect(storage.enviarComChave).toHaveBeenCalledWith(chave, conteudo, 'text/csv');
    expect(db.atual.tentativas).toHaveLength(1);
    expect(db.atual.tentativas[0]).toMatchObject({
      hashArquivo: hash,
      mapeamento: MAPEAMENTO,
      arquivoChave: chave,
      arquivoNome: 'plano.csv',
      arquivoTamanho: conteudo.byteLength,
      usuarioIniciadorId: USUARIO,
      correlationId: CONTEXTO.correlationId,
      criadoEm: AGORA,
    });
    expect(fila.enfileirar).toHaveBeenCalledWith({
      tenantId: TENANT,
      empresaId: EMPRESA,
      tentativaId: visao.tentativaId,
      correlationId: CONTEXTO.correlationId,
    });
    expect(db.atual.eventos.map((e) => e.acao)).toEqual(['CRIACAO']);
    expect(visao).toMatchObject({
      estado: 'RECEBIDA',
      totais: null,
      versaoDaPrevia: null,
      amostraRejeicoes: [],
      podeConfirmar: false,
      podeCancelar: false,
      relatorioDisponivel: false,
      arquivo: { nome: 'plano.csv', tamanho: conteudo.byteLength, hash },
    });
  });

  it('mapeamento com espaços é normalizado antes de virar identidade', async () => {
    const { servico } = montar();

    await servico.enviar(CONTEXTO, EMPRESA, arquivo(), { ...MAPEAMENTO, nome: '  nome ' });

    expect(db.atual.tentativas[0]!.mapeamento).toEqual(MAPEAMENTO);
  });
});

describe('enviar: rejeição antes do staging não cria nada (SPEC-013 §3.2, §7)', () => {
  const linhas = (n: number): string =>
    ['codigo;nome;tipo;natureza;conta_pai', ...Array.from({ length: n }, (_v, i) => `${i + 1};Conta;analitica;devedora;`)].join('\n');

  it.each([
    ['acima de 10 MB', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE],
    ['10.001 linhas de dados', csv(linhas(10_001)), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE],
    ['arquivo vazio', Buffer.alloc(0), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_VAZIO],
    ['só cabeçalho', csv('codigo;nome;tipo;natureza;conta_pai\n'), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_VAZIO],
    ['cabeçalho repetido', csv('codigo;codigo;tipo\n1;2;3\n'), 'text/csv', CODIGOS_DE_ERRO.CABECALHO_INVALIDO],
    ['formato não CSV (PDF)', csv('%PDF-1.7 qualquer coisa'), 'application/pdf', CODIGOS_DE_ERRO.ARQUIVO_INVALIDO],
    ['conteúdo binário com extensão .csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_INVALIDO],
  ])('%s → %s', async (_caso, conteudo, mimetype, esperado) => {
    const { storage, fila, servico } = montar();

    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(conteudo, mimetype), MAPEAMENTO))).toBe(esperado);
    expect(storage.enviarComChave).not.toHaveBeenCalled();
    expect(fila.enfileirar).not.toHaveBeenCalled();
    expect(db.atual.tentativas).toEqual([]);
  });

  it('exatamente 10.000 linhas passa', async () => {
    const { servico } = montar();

    await servico.enviar(CONTEXTO, EMPRESA, arquivo(csv(linhas(10_000))), MAPEAMENTO);

    expect(db.atual.tentativas).toHaveLength(1);
  });

  it('mapeamento incompleto → MAPEAMENTO_INCOMPLETO com os campos ausentes, sem tentativa', async () => {
    const { storage, fila, servico } = montar();
    const incompleto = { codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza' };

    const erro = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), incompleto).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect(erro).toMatchObject({
      codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
      campos: [{ campo: 'conta_pai', codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO }],
      detalhes: { pendencias: [{ campo: 'conta_pai', motivo: 'AUSENTE' }] },
    });
    expect(storage.enviarComChave).not.toHaveBeenCalled();
    expect(fila.enfileirar).not.toHaveBeenCalled();
    expect(db.atual.tentativas).toEqual([]);
  });

  it('coluna inexistente ou repetida no mapeamento também é incompleto', async () => {
    const { servico } = montar();

    expect(
      await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), { ...MAPEAMENTO, tipo: 'Inexistente' })),
    ).toBe(CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO);
    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), { ...MAPEAMENTO, natureza: 'tipo' }))).toBe(
      CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
    );
    expect(db.atual.tentativas).toEqual([]);
  });
});

describe('enviar: idempotência (SPEC-013 §3.7)', () => {
  it('mesmo arquivo e mapeamento depois da validação: reutiliza, sem novo job', async () => {
    const { fila, servico } = montar();
    const primeira = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(primeira.tentativaId);

    const segunda = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(segunda.tentativaId).toBe(primeira.tentativaId);
    expect(segunda.estado).toBe('AGUARDANDO_CONFIRMACAO');
    expect(fila.enfileirar).toHaveBeenCalledTimes(1);
    expect(db.atual.eventos.map((e) => e.acao)).toEqual(['CRIACAO', 'REUTILIZACAO']);
  });

  it('reenvio de tentativa terminal devolve o resultado com a marca de reuso', async () => {
    const { fila, servico } = montar();
    const primeira = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    trocar(primeira.tentativaId, { estado: 'CONCLUIDA', totais: { lidas: 6, novas: 6, atualizadas: 0, rejeitadas: 0 } });

    const segunda = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(segunda).toMatchObject({ tentativaId: primeira.tentativaId, estado: 'CONCLUIDA', reutilizadaPorIdempotencia: true });
    expect(fila.enfileirar).toHaveBeenCalledTimes(1);
    expect(db.atual.notificacoes).toEqual([]);
  });

  it('reuso de tentativa ainda RECEBIDA reenfileira (id de job determinístico)', async () => {
    const { fila, servico } = montar();

    const primeira = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    const segunda = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(segunda.tentativaId).toBe(primeira.tentativaId);
    expect(fila.enfileirar).toHaveBeenCalledTimes(2);
    expect(fila.enfileirar.mock.calls[1]![0]).toMatchObject({ tentativaId: primeira.tentativaId });
  });

  it('reuso de tentativa presa em VALIDANDO reenfileira (sem job vivo, o worker refaz a validação)', async () => {
    const { fila, servico } = montar();

    const primeira = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    trocar(primeira.tentativaId, { estado: 'VALIDANDO', iniciadoEm: AGORA });
    const segunda = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(segunda).toMatchObject({ tentativaId: primeira.tentativaId, estado: 'VALIDANDO' });
    // O helper da fila decide: job vivo (waiting/active/delayed) → nada; terminado → remove e adiciona.
    expect(fila.enfileirar).toHaveBeenCalledTimes(2);
    expect(fila.enfileirar.mock.calls[1]![0]).toMatchObject({ tentativaId: primeira.tentativaId });
  });

  it.each(['AGUARDANDO_CONFIRMACAO', 'CONCLUIDA', 'REJEITADA'] as const)(
    'reuso de tentativa em %s não reenfileira: a validação já terminou',
    async (estado) => {
      const { fila, servico } = montar();

      const primeira = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
      trocar(primeira.tentativaId, { estado, totais: { lidas: 1, novas: 1, atualizadas: 0, rejeitadas: 0 }, planoVersaoNaValidacao: 0 });
      await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

      expect(fila.enfileirar).toHaveBeenCalledTimes(1);
    },
  );

  it('mesmo arquivo com mapeamento diferente é nova tentativa', async () => {
    const { fila, servico } = montar();
    const legado = 'Cod;Descricao;Tipo;Natureza;Pai\n1;Ativo;sintetica;devedora;\n';
    const mapeamentoA = { codigo: 'Cod', nome: 'Descricao', tipo: 'Tipo', natureza: 'Natureza', conta_pai: 'Pai' };
    const mapeamentoB = { ...mapeamentoA, nome: 'Cod', codigo: 'Descricao' };

    const a = await servico.enviar(CONTEXTO, EMPRESA, arquivo(csv(legado)), mapeamentoA);
    const b = await servico.enviar(CONTEXTO, EMPRESA, arquivo(csv(legado)), mapeamentoB);

    expect(b.tentativaId).not.toBe(a.tentativaId);
    expect(b.arquivo.hash).toBe(a.arquivo.hash);
    expect(fila.enfileirar).toHaveBeenCalledTimes(2);
  });

  it('fila fora do ar → FILA_INDISPONIVEL; a tentativa fica RECEBIDA e o reenvio retoma', async () => {
    const { fila, servico } = montar();
    fila.enfileirar.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO))).toBe(
      CODIGOS_DE_ERRO.FILA_INDISPONIVEL,
    );
    expect(db.atual.tentativas.map((t) => t.estado)).toEqual(['RECEBIDA']);

    const retomada = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(retomada.tentativaId).toBe(db.atual.tentativas[0]!.id);
    expect(fila.enfileirar).toHaveBeenCalledTimes(2);
  });
});

describe('confirmar (SPEC-013 §3.6, §3.10)', () => {
  const preparar = async () => {
    const montado = montar();
    const visao = await montado.servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    chamadas.ordem = [];

    return { ...montado, id: visao.tentativaId };
  };

  it('aplica numa transação: confirma, aplica, registra, finaliza, resolve a pendência e notifica', async () => {
    const { servico, id } = await preparar();
    validada(id, 1);

    const visao = await servico.confirmar(CONTEXTO, EMPRESA, id, 0);

    expect(chamadas.ordem).toEqual([
      'confirmar',
      'evento:CONFIRMAR',
      'aplicar',
      'evento:APLICACAO_SUCESSO_COM_REJEICOES',
      'finalizar:CONCLUIDA_COM_REJEICOES',
      'pendencia',
      'notificar',
    ]);
    expect(visao).toMatchObject({
      estado: 'CONCLUIDA_COM_REJEICOES',
      totais: { lidas: 3, novas: 2, atualizadas: 0, rejeitadas: 1 },
      podeConfirmar: false,
      podeCancelar: false,
      relatorioDisponivel: true,
      finalizadoEm: AGORA.toISOString(),
    });
    expect(db.atual.pendenciasAbertas).toEqual([]);
    expect(chamadas.origensConsultadas).toEqual(['PLANO_CONTAS']);
    expect(db.atual.notificacoes).toEqual([id]);
    expect(chamadas.transacoesAbertas).toBe(0);
  });

  it('sem rejeição termina CONCLUIDA', async () => {
    const { servico, id } = await preparar();
    validada(id, 0);

    expect((await servico.confirmar(CONTEXTO, EMPRESA, id, 0)).estado).toBe('CONCLUIDA');
  });

  it('quem confirma não precisa ser o iniciador (usuário autorizado, §3.8)', async () => {
    const { servico, id } = await preparar();
    validada(id);

    await servico.confirmar({ ...CONTEXTO, usuarioId: OUTRO_USUARIO }, EMPRESA, id, 0);

    expect(db.atual.tentativas[0]!.usuarioConfirmadorId).toBe(OUTRO_USUARIO);
  });

  it('tentativa de outra empresa → TENTATIVA_NAO_ENCONTRADA', async () => {
    const { servico, id } = await preparar();
    validada(id);

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, OUTRA_EMPRESA, id, 0))).toBe(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA);
    expect(db.atual.contas).toEqual([]);
  });

  it.each(['RECEBIDA', 'VALIDANDO', 'CANCELADA', 'REJEITADA', 'FALHA'] as const)(
    'fora de AGUARDANDO_CONFIRMACAO (%s) → ESTADO_INVALIDO_PARA_ACAO, nada aplicado',
    async (estado) => {
      const { servico, id } = await preparar();
      trocar(id, { estado, planoVersaoNaValidacao: 0 });

      expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, id, 0))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
      expect(chamadas.ordem).not.toContain('aplicar');
      expect(db.atual.notificacoes).toEqual([]);
    },
  );

  it('confirmação repetida não reaplica nem notifica de novo', async () => {
    const { servico, id } = await preparar();
    validada(id);
    await servico.confirmar(CONTEXTO, EMPRESA, id, 0);

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, id, 0))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
    expect(chamadas.ordem.filter((passo) => passo === 'aplicar')).toHaveLength(1);
    expect(db.atual.notificacoes).toEqual([id]);
    expect(db.atual.contas).toEqual(['1', '1.1']);
  });

  it('prévia obsoleta → CONFLITO_DE_VERSAO (409); tudo revertido e a tentativa segue aguardando', async () => {
    const { servico, id } = await preparar();
    validada(id);
    falhas.aplicar = new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO, 'O plano mudou.');

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, id, 0))).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
    expect(db.atual.tentativas[0]!.estado).toBe('AGUARDANDO_CONFIRMACAO');
    expect(db.atual.contas).toEqual([]);
    expect(db.atual.notificacoes).toEqual([]);
  });

  it('versão da prévia diferente da validada → CONFLITO_DE_VERSAO', async () => {
    const { servico, id } = await preparar();
    validada(id);

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, id, 7))).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
  });

  it('falha técnica na aplicação: tudo revertido e, numa 2ª transação, a tentativa vai a FALHA com o código estável', async () => {
    const { servico, id } = await preparar();
    validada(id);
    falhas.aplicar = new Error('conexão com o banco caiu');

    const erro = await servico.confirmar(CONTEXTO, EMPRESA, id, 0).catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.FALHA_TECNICA, detalhes: { tentativaId: id } });
    expect((erro as Error).message).toContain('Nenhuma conta foi alterada');
    expect((erro as Error).message).not.toContain('conexão com o banco caiu');
    expect(db.atual.contas).toEqual([]);
    expect(db.atual.pendenciasAbertas).toEqual(['plano-contas:incompleto']);
    expect(db.atual.tentativas[0]).toMatchObject({ estado: 'FALHA', usuarioConfirmadorId: USUARIO, finalizadoEm: AGORA });
    expect(db.atual.eventos.map((e) => [e.acao, e.estadoNovo])).toEqual([
      ['CRIACAO', 'RECEBIDA'],
      ['CONFIRMAR', 'APLICANDO'],
      ['FALHA_TECNICA', 'FALHA'],
    ]);
    expect(db.atual.eventosCompletos.at(-1)).toMatchObject({ codigo: 'FALHA_NA_APLICACAO', correlationId: CONTEXTO.correlationId });
    // Terminal: o iniciador é avisado da falha, como no resultado da validação.
    expect(db.atual.notificacoes).toEqual([id]);
    expect(chamadas.transacoesAbertas).toBe(0);
  });

  it('a FALHA só é gravada se a tentativa ainda estiver na mesma prévia; senão, só a resposta 500', async () => {
    const { servico, id } = await preparar();
    validada(id);
    falhas.aplicar = new Error('conexão com o banco caiu');
    falhas.confirmarDeNovo = estadoInvalido();

    const erro = await servico.confirmar(CONTEXTO, EMPRESA, id, 0).catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.FALHA_TECNICA, detalhes: { tentativaId: id } });
    // Sem a FALHA registrada não há prova de que nada mudou (commit ambíguo, confirmação
    // concorrente vencedora): a mensagem não promete isso e manda consultar o estado atual.
    expect((erro as Error).message).not.toContain('Nenhuma conta foi alterada');
    expect((erro as Error).message).toContain('Consulte o estado atual');
    expect(db.atual.tentativas[0]!.estado).toBe('AGUARDANDO_CONFIRMACAO');
    expect(db.atual.eventos.map((e) => e.acao)).toEqual(['CRIACAO']);
    expect(chamadas.transacoesAbertas).toBe(0);
  });

  it('se a 2ª transação também falhar, a resposta continua FALHA_TECNICA (sem rejeição solta)', async () => {
    const { servico, id } = await preparar();
    validada(id);
    falhas.notificar = new Error('conexão com o banco caiu');

    const erro = await servico.confirmar(CONTEXTO, EMPRESA, id, 0).catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.FALHA_TECNICA, detalhes: { tentativaId: id } });
    expect((erro as Error).message).not.toContain('Nenhuma conta foi alterada');
    expect(db.atual.contas).toEqual([]);
    expect(db.atual.tentativas[0]!.estado).toBe('AGUARDANDO_CONFIRMACAO');
    expect(chamadas.transacoesAbertas).toBe(0);
  });

  it('linha válida que achou conta arquivada na aplicação: o plano mudou sob a prévia → CONFLITO_DE_VERSAO', async () => {
    const { servico, id } = await preparar();
    validada(id);
    falhas.ignoradas = ['1.1'];

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, id, 0))).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
    expect(db.atual.contas).toEqual([]);
    expect(db.atual.tentativas[0]!.estado).toBe('AGUARDANDO_CONFIRMACAO');
    expect(db.atual.notificacoes).toEqual([]);
  });
});

describe('cancelar (SPEC-013 §3.8)', () => {
  it('cancela a prévia sem tocar o plano, com o autor e o evento', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);

    const visao = await servico.cancelar({ ...CONTEXTO, usuarioId: OUTRO_USUARIO }, EMPRESA, tentativaId);

    expect(visao).toMatchObject({ estado: 'CANCELADA', podeConfirmar: false, podeCancelar: false, relatorioDisponivel: true });
    expect(db.atual.tentativas[0]!.usuarioCanceladorId).toBe(OUTRO_USUARIO);
    expect(db.atual.eventos.at(-1)).toEqual({ acao: 'CANCELAR', estadoNovo: 'CANCELADA', usuarioId: OUTRO_USUARIO });
    expect(db.atual.contas).toEqual([]);
  });

  it('terminal ou em validação não cancela; outra empresa não encontra', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(await codigoDo(() => servico.cancelar(CONTEXTO, EMPRESA, tentativaId))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
    expect(await codigoDo(() => servico.cancelar(CONTEXTO, OUTRA_EMPRESA, tentativaId))).toBe(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA);
  });
});

describe('empresa arquivada ou em cadastro é somente consulta (SPEC-003 §3.5, SPEC-013 §3.12)', () => {
  it('enviar em empresa arquivada → EMPRESA_ARQUIVADA, sem storage, tentativa nem job', async () => {
    const { storage, fila, servico } = montar();
    empresas.arquivadas.add(EMPRESA);

    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO))).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);
    expect(storage.enviarComChave).not.toHaveBeenCalled();
    expect(fila.enfileirar).not.toHaveBeenCalled();
    expect(db.atual.tentativas).toEqual([]);
  });

  it('enviar em empresa com cadastro incompleto → EMPRESA_NAO_ATIVA, sem tentativa', async () => {
    const { storage, servico } = montar();
    empresas.incompletas.add(EMPRESA);

    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO))).toBe(CODIGOS_DE_ERRO.EMPRESA_NAO_ATIVA);
    expect(storage.enviarComChave).not.toHaveBeenCalled();
    expect(db.atual.tentativas).toEqual([]);
  });

  it('confirmar depois que a empresa foi arquivada → EMPRESA_ARQUIVADA; nada aplicado e a prévia segue aguardando', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);
    empresas.arquivadas.add(EMPRESA);
    chamadas.ordem = [];

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0))).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);
    expect(chamadas.ordem).toEqual([]);
    expect(db.atual.contas).toEqual([]);
    expect(db.atual.notificacoes).toEqual([]);
    expect(db.atual.tentativas[0]!.estado).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('cancelar em empresa arquivada → EMPRESA_ARQUIVADA; a prévia não muda', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);
    empresas.arquivadas.add(EMPRESA);

    expect(await codigoDo(() => servico.cancelar(CONTEXTO, EMPRESA, tentativaId))).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);
    expect(db.atual.tentativas[0]!.estado).toBe('AGUARDANDO_CONFIRMACAO');
    expect(db.atual.eventos.map((e) => e.acao)).toEqual(['CRIACAO']);
  });

  it('leituras continuam em empresa arquivada: prévia, histórico, rejeições e plano', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);
    empresas.arquivadas.add(EMPRESA);

    expect((await servico.previa(CONTEXTO, EMPRESA, tentativaId)).estado).toBe('AGUARDANDO_CONFIRMACAO');
    expect((await servico.historico(CONTEXTO, EMPRESA, 1)).pagina).toBe(1);
    expect((await servico.rejeicoes(CONTEXTO, EMPRESA, tentativaId, 1)).total).toBe(1);
    expect((await servico.plano(CONTEXTO, EMPRESA, 1)).total).toBe(1);
  });
});

describe('consultas', () => {
  it('prévia traz a amostra das rejeições (1ª página, 20) e as flags do estado', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);

    const visao = await servico.previa(CONTEXTO, EMPRESA, tentativaId);

    expect(visao).toMatchObject({
      estado: 'AGUARDANDO_CONFIRMACAO',
      versaoDaPrevia: 0,
      podeConfirmar: true,
      podeCancelar: true,
      relatorioDisponivel: true,
      amostraRejeicoes: [{ numeroDaLinha: 4, codigoDeErro: 'CONTA_PAI_INEXISTENTE', mensagem: 'Pai ausente.' }],
    });
  });

  describe('diagnóstico acionável (SPEC-013 §3.10, §7)', () => {
    const comEvento = (tentativaId: string, acao: string, codigo: string | null) =>
      db.atual.eventosCompletos.push({ tentativaId, acao, codigo, estadoNovo: acao === 'FALHA_TECNICA' ? 'FALHA' : 'REJEITADA' });

    it('FALHA traz o código estável do último evento e a mensagem PT-BR fechada', async () => {
      const { servico } = montar();
      const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
      trocar(tentativaId, { estado: 'FALHA', totais: null, finalizadoEm: AGORA });
      comEvento(tentativaId, 'FALHA_TECNICA', 'ARMAZENAMENTO_INDISPONIVEL');

      expect((await servico.previa(CONTEXTO, EMPRESA, tentativaId)).diagnostico).toEqual({
        codigo: 'ARMAZENAMENTO_INDISPONIVEL',
        mensagem: 'O armazenamento de arquivos ficou indisponível durante a validação. Envie o arquivo de novo em instantes.',
      });
    });

    it('REJEITADA pelo arquivo inteiro traz o código; REJEITADA só por linhas não tem diagnóstico', async () => {
      const { servico } = montar();
      const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
      const zerados = { lidas: 0, novas: 0, atualizadas: 0, rejeitadas: 0 };
      trocar(tentativaId, { estado: 'REJEITADA', totais: zerados, planoVersaoNaValidacao: 0, finalizadoEm: AGORA });

      expect((await servico.previa(CONTEXTO, EMPRESA, tentativaId)).diagnostico).toBeNull();

      comEvento(tentativaId, 'VALIDACAO_REJEITADA', 'CABECALHO_INVALIDO');
      expect((await servico.previa(CONTEXTO, EMPRESA, tentativaId)).diagnostico).toEqual({
        codigo: 'CABECALHO_INVALIDO',
        mensagem: 'O cabeçalho do arquivo tem coluna sem nome ou repetida. Corrija o cabeçalho e envie de novo.',
      });
    });

    it('código desconhecido sai com a mensagem genérica (nunca texto vindo do evento)', async () => {
      const { servico } = montar();
      const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
      trocar(tentativaId, { estado: 'FALHA', totais: null, finalizadoEm: AGORA });
      comEvento(tentativaId, 'FALHA_TECNICA', 'CODIGO_NOVO_QUALQUER');

      expect((await servico.previa(CONTEXTO, EMPRESA, tentativaId)).diagnostico).toEqual({
        codigo: 'CODIGO_NOVO_QUALQUER',
        mensagem: 'A importação não pôde ser concluída. Envie o arquivo de novo; se persistir, informe o código de correlação ao suporte.',
      });
    });

    it.each(['RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'CONCLUIDA', 'CANCELADA'] as const)(
      'em %s não há diagnóstico nem consulta à trilha',
      async (estado) => {
        const { servico } = montar();
        const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
        trocar(tentativaId, { estado });
        comEvento(tentativaId, 'FALHA_TECNICA', 'FALHA_NA_VALIDACAO');
        chamadas.ordem.length = 0;

        expect((await servico.previa(CONTEXTO, EMPRESA, tentativaId)).diagnostico).toBeNull();
        expect(chamadas.ordem).not.toContain('diagnostico');
      },
    );
  });

  it('prévia de outra empresa → TENTATIVA_NAO_ENCONTRADA', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(await codigoDo(() => servico.previa(CONTEXTO, OUTRA_EMPRESA, tentativaId))).toBe(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA);
    expect(await codigoDo(() => servico.rejeicoes(CONTEXTO, OUTRA_EMPRESA, tentativaId, 1))).toBe(
      CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA,
    );
    expect(await codigoDo(() => servico.arquivoOriginal(CONTEXTO, OUTRA_EMPRESA, tentativaId))).toBe(
      CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA,
    );
  });

  it('rejeições paginam de 20 em 20', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(await servico.rejeicoes(CONTEXTO, EMPRESA, tentativaId, 3)).toMatchObject({ pagina: 3, itensPorPagina: 20 });
  });

  it('plano devolve datas em ISO e não expõe a versão interna da conta', async () => {
    const { servico } = montar();

    const pagina = await servico.plano(CONTEXTO, EMPRESA, 2, 'ati');

    expect(pagina).toMatchObject({ pagina: 2, itensPorPagina: 50, total: 1 });
    expect(pagina.itens[0]).toEqual({
      id: '0198f3c2-0000-7000-8000-0000000000c1',
      codigo: '1',
      nome: 'Ativo',
      tipo: 'sintetica',
      natureza: 'devedora',
      contaPai: null,
      arquivada: false,
      atualizadoEm: AGORA.toISOString(),
    });
  });

  it('arquivo original sai do storage pela chave da tentativa', async () => {
    const { storage, servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    const original = await servico.arquivoOriginal(CONTEXTO, EMPRESA, tentativaId);

    expect(storage.obter).toHaveBeenCalledWith(db.atual.tentativas[0]!.arquivoChave);
    expect(original.nome).toBe('plano.csv');
  });
});

describe('relatório CSV (SPEC-013 §3.9)', () => {
  const lerTudo = async (conteudo: Readable): Promise<string> => {
    let texto = '';

    for await (const pedaco of conteudo) {
      texto += String(pedaco);
    }

    return texto;
  };

  it.each(['RECEBIDA', 'VALIDANDO'] as const)('tentativa %s ainda não tem relatório → ESTADO_INVALIDO_PARA_ACAO', async (estado) => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    trocar(tentativaId, { estado });

    expect(await codigoDo(() => servico.relatorio(CONTEXTO, EMPRESA, tentativaId))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
    expect(chamadas.transacoesAbertas).toBe(0);
  });

  it('outra empresa → TENTATIVA_NAO_ENCONTRADA, sem transação pendurada', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(await codigoDo(() => servico.relatorio(CONTEXTO, OUTRA_EMPRESA, tentativaId))).toBe(
      CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA,
    );
    expect(chamadas.transacoesAbertas).toBe(0);
  });

  it('gera o CSV inteiro com BOM e fórmula neutralizada, e fecha a transação no fim', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);

    const relatorio = await servico.relatorio(CONTEXTO, EMPRESA, tentativaId);
    const texto = await lerTudo(relatorio.conteudo);

    expect(texto.startsWith(BOM)).toBe(true);
    expect(texto).toContain(`'=HYPERLINK`);
    expect(texto.trimEnd().split('\r\n')).toHaveLength(1 + 4_998);
    expect(relatorio.nomeDoArquivo).toMatch(/^relatorio-.*\.csv$/u);
    await vi.waitFor(() => expect(chamadas.transacoesAbertas).toBe(0));
  });

  it('cliente que aborta no meio: o cursor é encerrado e a conexão volta ao pool', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);

    const { conteudo } = await servico.relatorio(CONTEXTO, EMPRESA, tentativaId);
    const primeiro: unknown = await new Promise((resolver) => conteudo.once('data', resolver));
    conteudo.destroy();

    expect(String(primeiro).startsWith(BOM)).toBe(true);
    await vi.waitFor(() => {
      expect(chamadas.transacoesAbertas).toBe(0);
      expect(chamadas.relatorioFinalizado).toBe(true);
    });
  });

  it('a transação do relatório tem teto de ociosidade (leitor lento não segura a conexão)', async () => {
    const { servico } = montar({ ociosidadeMs: 1_234, totalMs: 60_000 });
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);

    const { conteudo } = await servico.relatorio(CONTEXTO, EMPRESA, tentativaId);
    conteudo.resume();

    expect(chamadas.sqls).toContain(`select set_config($1, $2, true) ["idle_in_transaction_session_timeout","1234ms"]`);
    await vi.waitFor(() => expect(chamadas.transacoesAbertas).toBe(0));
  });

  it('leitor que nunca consome: o prazo total destrói o fluxo e a transação é encerrada', async () => {
    const { servico } = montar({ ociosidadeMs: 60_000, totalMs: 30 });
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);

    const { conteudo } = await servico.relatorio(CONTEXTO, EMPRESA, tentativaId);
    const erros: unknown[] = [];
    conteudo.on('error', (erro) => erros.push(erro));

    await vi.waitFor(() => {
      expect(conteudo.destroyed).toBe(true);
      expect(chamadas.transacoesAbertas).toBe(0);
      expect(chamadas.relatorioFinalizado).toBe(true);
    });
    expect(String(erros[0])).toMatch(/prazo/u);
  });

  it('conexão derrubada pelo servidor no meio do fluxo: encerra o fluxo sem derrubar o processo', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(tentativaId);

    const { conteudo } = await servico.relatorio(CONTEXTO, EMPRESA, tentativaId);
    conteudo.on('error', () => undefined);
    chamadas.clientes.at(-1)!.emit('error', new Error('terminating connection due to idle-in-transaction timeout'));

    await vi.waitFor(() => {
      expect(conteudo.destroyed).toBe(true);
      expect(chamadas.transacoesAbertas).toBe(0);
    });
  });

  it('FALHA sem staging (nunca validada) não tem relatório', async () => {
    const { servico } = montar();
    const { tentativaId } = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    trocar(tentativaId, { estado: 'FALHA', totais: null, finalizadoEm: AGORA });

    expect((await servico.previa(CONTEXTO, EMPRESA, tentativaId)).relatorioDisponivel).toBe(false);
    expect(await codigoDo(() => servico.relatorio(CONTEXTO, EMPRESA, tentativaId))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
  });
});
