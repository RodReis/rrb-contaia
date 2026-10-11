/**
 * Casos de uso da importação de empregados (SPEC-014 §3.2–§3.10, §7; categoria Regras).
 *
 * Banco, storage e fila entram por dublê. O banco dublado guarda tentativas, empregados, eventos,
 * notificações e pendências em memória e REVERTE tudo quando o caso de uso lança dentro de
 * `comContextoHumano` — é o que prova "falha na aplicação não deixa base parcial" sem PostgreSQL.
 * A persistência real (RLS, corrida de confirmação, guards) tem provas no `.integration.test.ts`.
 */
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, MODELO_CSV_DE_EMPREGADOS } from '@contaia/domain';
import type { TentativaDoCiclo } from '@contaia/db';
import { DETALHES_DE_PLANILHA_DO_CSV } from '@contaia/shared';
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmpregadosService } from './empregados.service';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const OUTRA_EMPRESA = '0198f3c2-0000-7000-8000-000000000009';
const USUARIO = '0198f3c2-0000-7000-8000-000000000004';
const ADMIN_1 = '0198f3c2-0000-7000-8000-0000000000a1';
const ADMIN_2 = '0198f3c2-0000-7000-8000-0000000000a2';
const AGORA = new Date('2026-10-08T12:00:00.000Z');
const BOM = String.fromCharCode(0xfeff);
const CONTEXTO = { tenantId: TENANT, usuarioId: USUARIO, correlationId: 'corr-empregados-0001' } as const;
const CPF = '52998224725';

const MAPEAMENTO = {
  cpf: 'cpf',
  nome: 'nome',
  matricula: 'matricula',
  data_nascimento: 'data_nascimento',
  data_admissao: 'data_admissao',
} as const;

type Banco = {
  tentativas: TentativaDoCiclo[];
  empregados: number;
  eventos: Readonly<Record<string, unknown>>[];
  notificacoes: string[];
  pendenciasAbertas: string[];
  sequencia: number;
};

const { db, falhas, chamadas, empresas, admins } = vi.hoisted(() => ({
  db: { atual: null as unknown as Banco },
  empresas: { arquivadas: new Set<string>(), incompletas: new Set<string>() },
  admins: { lista: [] as string[] },
  falhas: {
    aplicar: null as Error | null,
    ignoradas: 0,
    confirmarDeNovo: null as Error | null,
  },
  chamadas: {
    ordem: [] as string[],
    confirmacoes: 0,
    sqls: [] as string[],
    origensConsultadas: [] as (string | null)[],
    descritores: new Set<unknown>(),
  },
}));

const bancoVazio = (): Banco => ({
  tentativas: [],
  empregados: 0,
  eventos: [],
  notificacoes: [],
  pendenciasAbertas: ['empregados:nao-importados'],
  sequencia: 0,
});

const clonar = (banco: Banco): Banco => ({
  ...banco,
  tentativas: banco.tentativas.map((t) => ({ ...t })),
  eventos: [...banco.eventos],
  notificacoes: [...banco.notificacoes],
  pendenciasAbertas: [...banco.pendenciasAbertas],
});

const naoEncontrada = () =>
  new ErroDeDominio(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA, 'Tentativa de importação não encontrada.');
const estadoInvalido = () => new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'Estado inválido.');

const daEmpresa = (empresaId: string, id: string): TentativaDoCiclo | undefined =>
  db.atual.tentativas.find((t) => t.id === id && t.empresaId === empresaId);

const trocar = (id: string, mudanca: Partial<TentativaDoCiclo>): TentativaDoCiclo => {
  const indice = db.atual.tentativas.findIndex((t) => t.id === id);
  const nova = { ...db.atual.tentativas[indice]!, ...mudanca };
  db.atual.tentativas[indice] = nova;

  return nova;
};

vi.mock('@contaia/db', () => {
  const DESCRITOR_EMPREGADOS = Object.freeze({ tabela: 'importacao_empregados' });
  const comDescritor = <A extends unknown[], R>(f: (...a: A) => R) => (_c: unknown, d: unknown, ...a: A): R => {
    chamadas.descritores.add(d);

    return f(...a);
  };

  return {
    DESCRITOR_EMPREGADOS,
    comContextoHumano: async (_pool: unknown, _contexto: unknown, executar: (c: unknown) => Promise<unknown>) => {
      const antes = clonar(db.atual);
      const cliente = {
        query: async (sql: string, parametros: readonly unknown[] = []) => {
          chamadas.sqls.push(`${sql} ${JSON.stringify(parametros)}`);

          return { rows: [], rowCount: 0 };
        },
        on: () => undefined,
        removeListener: () => undefined,
      };

      try {
        return await executar(cliente);
      } catch (erro) {
        db.atual = antes; // ROLLBACK
        throw erro;
      }
    },
    carregarSituacaoDaEmpresa: async (_c: unknown, empresaId: string) => ({
      arquivada: empresas.arquivadas.has(empresaId),
      ativa: !empresas.incompletas.has(empresaId),
    }),
    criarTentativaDeEmpregados: async (_c: unknown, nova: Record<string, unknown>) => {
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
      const criada: TentativaDoCiclo = {
        id: `0198f3c2-0000-7000-8000-${String(db.atual.sequencia).padStart(12, '0')}`,
        tenantId: nova['tenantId'] as string,
        empresaId: nova['empresaId'] as string,
        hashArquivo: nova['hashArquivo'] as string,
        mapeamento: nova['mapeamento'] as Record<string, string>,
        arquivoNome: nova['arquivoNome'] as string,
        arquivoTamanho: nova['arquivoTamanho'] as number,
        arquivoChave: nova['arquivoChave'] as string,
        estado: 'RECEBIDA',
        versaoNaValidacao: null,
        totais: null,
        usuarioIniciadorId: nova['usuarioIniciadorId'] as string,
        usuarioConfirmadorId: null,
        usuarioCanceladorId: null,
        correlationId: nova['correlationId'] as string,
        reutilizadaPorIdempotencia: false,
        criadoEm: nova['agora'] as Date,
        iniciadoEm: null,
        finalizadoEm: null,
        // SPEC-015: a tentativa traz formato, aba, cabeçalho e leitura; o dublê cria CSV.
        ...DETALHES_DE_PLANILHA_DO_CSV,
      };
      db.atual.tentativas.push(criada);

      return { ...criada, reutilizada: false };
    },
    cicloDeImportacao: {
      buscarTentativa: comDescritor(async (empresaId: string, id: string) => daEmpresa(empresaId, id) ?? null),
      confirmar: comDescritor(async (entrada: { empresaId: string; tentativaId: string; usuarioId: string; versaoDaPrevia: number }) => {
        chamadas.ordem.push('confirmar');
        chamadas.confirmacoes += 1;
        if (chamadas.confirmacoes > 1 && falhas.confirmarDeNovo !== null) throw falhas.confirmarDeNovo;
        const atual = daEmpresa(entrada.empresaId, entrada.tentativaId);

        if (atual === undefined) throw naoEncontrada();
        if (atual.estado !== 'AGUARDANDO_CONFIRMACAO') throw estadoInvalido();
        if (atual.versaoNaValidacao !== entrada.versaoDaPrevia) {
          throw new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO, 'A base mudou.');
        }

        return trocar(atual.id, { estado: 'APLICANDO', usuarioConfirmadorId: entrada.usuarioId });
      }),
      cancelar: comDescritor(async (entrada: { empresaId: string; tentativaId: string; usuarioId: string; agora: Date }) => {
        const atual = daEmpresa(entrada.empresaId, entrada.tentativaId);

        if (atual === undefined) throw naoEncontrada();
        if (atual.estado !== 'AGUARDANDO_CONFIRMACAO') throw estadoInvalido();

        return trocar(atual.id, { estado: 'CANCELADA', usuarioCanceladorId: entrada.usuarioId, finalizadoEm: entrada.agora });
      }),
      registrarEvento: comDescritor(async (evento: Record<string, unknown>) => {
        chamadas.ordem.push(`evento:${String(evento['acao'])}`);
        db.atual.eventos.push(evento);
      }),
      registrarFalha: comDescritor(async (empresaId: string, id: string, agora: Date) => {
        chamadas.ordem.push('falha');
        const atual = daEmpresa(empresaId, id);

        if (atual === undefined) throw naoEncontrada();
        if (atual.estado !== 'APLICANDO') throw estadoInvalido();
        trocar(id, { estado: 'FALHA', finalizadoEm: agora });

        return atual.estado;
      }),
      finalizar: comDescritor(
        async (_e: string, id: string, estado: TentativaDoCiclo['estado'], totais: TentativaDoCiclo['totais'], agora: Date) => {
          chamadas.ordem.push(`finalizar:${estado}`);
          trocar(id, { estado, totais, finalizadoEm: agora });
        },
      ),
    },
    consultasDeImportacao: {
      listarHistorico: comDescritor(async (empresaId: string, pagina: number) => ({ pagina, itensPorPagina: 15, total: 0, itens: [], empresaId })),
      buscarDiagnosticoDaTentativa: comDescritor(async (_e: string, tentativaId: string) => {
        const evento = [...db.atual.eventos]
          .reverse()
          .find((e) => e['tentativaId'] === tentativaId && e['acao'] === 'FALHA_TECNICA' && e['codigo'] !== null);

        return evento === undefined ? null : { acao: 'FALHA_TECNICA', codigo: evento['codigo'] };
      }),
    },
    aplicarLinhasDeEmpregados: async () => {
      chamadas.ordem.push('aplicar');
      db.atual.empregados += 2;

      if (falhas.aplicar !== null) throw falhas.aplicar;

      return { incluidas: 2, atualizadas: 0, ignoradas: falhas.ignoradas, versaoDaBase: 1 };
    },
    listarAdminsAutorizadosDaEmpresa: async () => {
      chamadas.ordem.push('admins');

      return admins.lista;
    },
    criarNotificacoesDeImportacaoDeEmpregados: async (
      _c: unknown,
      entrada: { tentativaId: string; destinatarios: readonly string[] },
    ) => {
      chamadas.ordem.push('notificar');
      let novas = 0;

      for (const usuario of new Set(entrada.destinatarios)) {
        const chave = `${entrada.tentativaId}|${usuario}`;

        if (!db.atual.notificacoes.includes(chave)) {
          db.atual.notificacoes.push(chave);
          novas += 1;
        }
      }

      return novas;
    },
    contarEmpregadosConfirmados: async () => db.atual.empregados,
    listarAbertasDaEmpresa: async (_c: unknown, _empresaId: string, origem: string | null) => {
      chamadas.origensConsultadas.push(origem);

      return db.atual.pendenciasAbertas.map((chave) => ({ chave }));
    },
    reconciliar: async (_c: unknown, _t: string, _e: string, paraAbrir: readonly { chave: string }[], paraResolver: readonly string[]) => {
      chamadas.ordem.push('pendencia');
      db.atual.pendenciasAbertas = [
        ...db.atual.pendenciasAbertas.filter((chave) => !paraResolver.includes(chave)),
        ...paraAbrir.map((causa) => causa.chave),
      ];

      return new Map();
    },
    listarRejeicoesDeEmpregados: async (_c: unknown, _e: string, _id: string, pagina: number, porPagina: number) => ({
      pagina,
      itensPorPagina: porPagina,
      total: 1,
      itens: [{ numeroDaLinha: 4, cpf: '111', matricula: '7', campo: 'cpf', codigoDeErro: 'CPF_INVALIDO', mensagem: 'CPF inválido.' }],
    }),
    listarEmpregados: async (_c: unknown, _e: string, pagina: number, porPagina: number, busca?: string) => ({
      pagina,
      itensPorPagina: porPagina,
      total: 0,
      itens: [],
      busca,
    }),
    listarLinhasParaRelatorioDeEmpregados: async function* () {
      yield {
        numeroDaLinha: 2,
        cpf: CPF,
        nome: '=HYPERLINK("x")',
        matricula: '+0012',
        dataNascimento: '1990-03-15',
        dataAdmissao: '2015-02-01',
        status: 'VALIDA',
        acao: 'INCLUIR',
        codigoDeErro: null,
        campo: null,
        mensagem: null,
      };
      yield {
        numeroDaLinha: 3,
        cpf: '123',
        nome: 'Fulano',
        matricula: '00124',
        dataNascimento: '1990-03-15',
        dataAdmissao: '2015-02-01',
        status: 'REJEITADA',
        acao: null,
        codigoDeErro: 'CPF_INVALIDO',
        campo: 'cpf',
        mensagem: 'O CPF não é válido.',
      };
    },
  };
});

class ServicoComRelogio extends EmpregadosService {
  protected override agora(): Date {
    return AGORA;
  }
}

const montar = () => {
  const storage = {
    enviarComChave: vi.fn().mockResolvedValue(undefined),
    obter: vi.fn().mockResolvedValue({ conteudo: Buffer.from('cpf;nome\n'), tipoConteudo: 'text/csv' }),
  };
  const fila = { enfileirar: vi.fn().mockResolvedValue(undefined) };
  const servico = new ServicoComRelogio({ instancia: {} } as never, storage as never, fila);

  return { storage, fila, servico };
};

const csv = (texto: string): Buffer => Buffer.from(texto, 'utf8');
const arquivo = (conteudo: Buffer = csv(MODELO_CSV_DE_EMPREGADOS), mimetype = 'text/csv') => ({
  buffer: conteudo,
  nome: 'empregados.csv',
  mimetype,
});
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
    versaoNaValidacao: 0,
    totais: { lidas: 2 + rejeitadas, novas: 2, atualizadas: 0, rejeitadas },
  });
};

const ler = async (fluxo: Readable): Promise<string> => {
  let texto = '';

  for await (const parte of fluxo) {
    texto += String(parte);
  }

  return texto;
};

beforeEach(() => {
  db.atual = bancoVazio();
  empresas.arquivadas.clear();
  empresas.incompletas.clear();
  admins.lista = [ADMIN_1, ADMIN_2];
  falhas.aplicar = null;
  falhas.ignoradas = 0;
  falhas.confirmarDeNovo = null;
  chamadas.ordem = [];
  chamadas.confirmacoes = 0;
  chamadas.sqls = [];
  chamadas.origensConsultadas = [];
  chamadas.descritores.clear();
});

describe('enviar: arquivo aceito (SPEC-014 §3.2, §6.1)', () => {
  it('guarda o original pela chave de empregados, cria a tentativa RECEBIDA e enfileira só ids', async () => {
    const { storage, fila, servico } = montar();
    const conteudo = csv(MODELO_CSV_DE_EMPREGADOS);

    const visao = await servico.enviar(CONTEXTO, EMPRESA, arquivo(conteudo), MAPEAMENTO);

    const hash = sha256(conteudo);
    const chave = `${TENANT}/${EMPRESA}/empregados/${hash}.csv`;
    expect(storage.enviarComChave).toHaveBeenCalledWith(chave, conteudo, 'text/csv');
    expect(db.atual.tentativas[0]).toMatchObject({
      hashArquivo: hash,
      mapeamento: MAPEAMENTO,
      arquivoChave: chave,
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
    expect(db.atual.eventos.map((e) => e['acao'])).toEqual(['CRIACAO']);
    expect(visao).toMatchObject({ estado: 'RECEBIDA', totais: null, versaoDaPrevia: null, podeConfirmar: false });
    expect(chamadas.descritores.size).toBe(1);
  });

  it('mapeamento com espaços vira identidade canônica', async () => {
    const { servico } = montar();

    await servico.enviar(CONTEXTO, EMPRESA, arquivo(), { ...MAPEAMENTO, cpf: '  cpf ' });

    expect(db.atual.tentativas[0]!.mapeamento).toEqual(MAPEAMENTO);
  });
});

describe('enviar: rejeição antes do staging não deixa rastro (SPEC-014 §3.2, §7)', () => {
  const CABECALHO = 'cpf;nome;matricula;data_nascimento;data_admissao';
  const linhas = (n: number): string =>
    [CABECALHO, ...Array.from({ length: n }, (_v, i) => `${CPF};Nome;${i};15/03/1990;01/02/2015`)].join('\n');

  it.each([
    ['acima de 10 MB', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE],
    ['10.001 linhas de dados', csv(linhas(10_001)), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE],
    ['arquivo vazio', Buffer.alloc(0), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_VAZIO],
    ['só cabeçalho', csv(`${CABECALHO}\n`), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_VAZIO],
    ['formato não CSV (PDF)', csv('%PDF-1.7 qualquer coisa'), 'application/pdf', CODIGOS_DE_ERRO.ARQUIVO_INVALIDO],
    ['ZIP com extensão .csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'text/csv', CODIGOS_DE_ERRO.ARQUIVO_INVALIDO],
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
    const { storage, servico } = montar();
    const incompleto = { cpf: 'cpf', nome: 'nome', matricula: 'matricula', data_nascimento: 'data_nascimento' };

    const erro = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), incompleto).catch((e: unknown) => e);

    expect(erro).toMatchObject({
      codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
      campos: [{ campo: 'data_admissao', codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO }],
      detalhes: { pendencias: [{ campo: 'data_admissao', motivo: 'AUSENTE' }] },
    });
    expect(storage.enviarComChave).not.toHaveBeenCalled();
    expect(db.atual.tentativas).toEqual([]);
  });

  it('coluna inexistente ou repetida no mapeamento também é incompleto', async () => {
    const { servico } = montar();

    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), { ...MAPEAMENTO, cpf: 'CPF do empregado' }))).toBe(
      CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
    );
    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), { ...MAPEAMENTO, nome: 'cpf' }))).toBe(
      CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
    );
    expect(db.atual.tentativas).toEqual([]);
  });

  it.each([
    ['arquivada', 'arquivadas', CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA],
    ['em cadastro', 'incompletas', CODIGOS_DE_ERRO.EMPRESA_NAO_ATIVA],
  ] as const)('empresa %s → %s, sem storage nem tentativa', async (_caso, conjunto, esperado) => {
    const { storage, servico } = montar();
    empresas[conjunto].add(EMPRESA);

    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO))).toBe(esperado);
    expect(storage.enviarComChave).not.toHaveBeenCalled();
    expect(db.atual.tentativas).toEqual([]);
  });
});

describe('enviar: idempotência (SPEC-014 §3.7)', () => {
  it('reenvio idêntico de resultado terminal: reutiliza, sem job e sem notificação nova', async () => {
    const { fila, servico } = montar();
    const primeira = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    trocar(primeira.tentativaId, { estado: 'CONCLUIDA', totais: { lidas: 2, novas: 2, atualizadas: 0, rejeitadas: 0 } });
    fila.enfileirar.mockClear();

    const repetida = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(repetida).toMatchObject({ tentativaId: primeira.tentativaId, estado: 'CONCLUIDA', reutilizadaPorIdempotencia: true });
    expect(fila.enfileirar).not.toHaveBeenCalled();
    expect(db.atual.notificacoes).toEqual([]);
    expect(db.atual.eventos.map((e) => e['acao'])).toEqual(['CRIACAO', 'REUTILIZACAO']);
  });

  it('mesmo arquivo com mapeamento diferente é nova tentativa', async () => {
    const { servico } = montar();
    const conteudo = csv('cpf;nome;matricula;nascimento;admissao\n52998224725;Maria;1;15/03/1990;01/02/2015\n');

    const a = await servico.enviar(CONTEXTO, EMPRESA, arquivo(conteudo), { ...MAPEAMENTO, data_nascimento: 'nascimento', data_admissao: 'admissao' });
    const b = await servico.enviar(CONTEXTO, EMPRESA, arquivo(conteudo), { ...MAPEAMENTO, data_nascimento: 'admissao', data_admissao: 'nascimento' });

    expect(b.tentativaId).not.toBe(a.tentativaId);
    expect(db.atual.tentativas).toHaveLength(2);
  });

  it('fila fora do ar → FILA_INDISPONIVEL; a tentativa fica RECEBIDA', async () => {
    const { fila, servico } = montar();
    fila.enfileirar.mockRejectedValueOnce(new Error('redis caiu'));

    expect(await codigoDo(() => servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO))).toBe(CODIGOS_DE_ERRO.FILA_INDISPONIVEL);
    expect(db.atual.tentativas[0]!.estado).toBe('RECEBIDA');
  });
});

describe('confirmar (SPEC-014 §3.6, §3.10)', () => {
  const preparar = async (rejeitadas = 1) => {
    const montado = montar();
    const visao = await montado.servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(visao.tentativaId, rejeitadas);
    chamadas.ordem = [];

    return { ...montado, tentativaId: visao.tentativaId };
  };

  it('uma transação: confirma, aplica, registra, finaliza, resolve a pendência EMPREGADOS e notifica iniciador + admins', async () => {
    const { servico, tentativaId } = await preparar();

    const visao = await servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0);

    expect(chamadas.ordem).toEqual([
      'confirmar',
      'evento:CONFIRMAR',
      'aplicar',
      'evento:APLICACAO_SUCESSO_COM_REJEICOES',
      'finalizar:CONCLUIDA_COM_REJEICOES',
      'pendencia',
      'admins',
      'notificar',
    ]);
    expect(visao).toMatchObject({ estado: 'CONCLUIDA_COM_REJEICOES', totais: { lidas: 3, novas: 2, atualizadas: 0, rejeitadas: 1 } });
    expect(chamadas.origensConsultadas).toEqual(['EMPREGADOS']);
    expect(db.atual.pendenciasAbertas).toEqual([]);
    expect(db.atual.notificacoes.sort()).toEqual([`${tentativaId}|${USUARIO}`, `${tentativaId}|${ADMIN_1}`, `${tentativaId}|${ADMIN_2}`].sort());
  });

  it('iniciador que também é admin recebe uma notificação só', async () => {
    const { servico, tentativaId } = await preparar(0);
    admins.lista = [USUARIO, ADMIN_1];

    const visao = await servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0);

    expect(visao.estado).toBe('CONCLUIDA');
    expect(db.atual.notificacoes.sort()).toEqual([`${tentativaId}|${USUARIO}`, `${tentativaId}|${ADMIN_1}`].sort());
  });

  it('confirmação repetida → ESTADO_INVALIDO_PARA_ACAO; não reaplica nem notifica de novo', async () => {
    const { servico, tentativaId } = await preparar();
    await servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0);
    const antes = { empregados: db.atual.empregados, notificacoes: db.atual.notificacoes.length };

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
    expect(db.atual.empregados).toBe(antes.empregados);
    expect(db.atual.notificacoes).toHaveLength(antes.notificacoes);
  });

  it('versão velha → CONFLITO_DE_VERSAO (409) sem aplicar nada', async () => {
    const { servico, tentativaId } = await preparar();

    const erro = await servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 7).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeConflito);
    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO });
    expect(db.atual.empregados).toBe(0);
    expect(daEmpresa(EMPRESA, tentativaId)!.estado).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('linha válida que achou empregado arquivado na aplicação → CONFLITO_DE_VERSAO; tudo revertido', async () => {
    const { servico, tentativaId } = await preparar();
    falhas.ignoradas = 1;

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0))).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
    expect(db.atual.empregados).toBe(0);
    expect(db.atual.notificacoes).toEqual([]);
    expect(daEmpresa(EMPRESA, tentativaId)!.estado).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('falha técnica: base intacta; numa 2ª transação a tentativa vai a FALHA (FALHA_NA_APLICACAO) e avisa', async () => {
    const { servico, tentativaId } = await preparar();
    falhas.aplicar = Object.assign(new Error('violação com 52998224725 e Maria'), {
      code: '23514',
      detail: 'Failing row contains (52998224725, Maria)',
    });
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const erro = await servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0).catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.FALHA_TECNICA, detalhes: { tentativaId } });
    expect((erro as Error).message).toContain('Nenhum empregado foi alterado');
    expect(db.atual.empregados).toBe(0);
    expect(daEmpresa(EMPRESA, tentativaId)).toMatchObject({ estado: 'FALHA', usuarioConfirmadorId: USUARIO });
    expect(db.atual.eventos.filter((e) => e['acao'] === 'FALHA_TECNICA')).toEqual([
      expect.objectContaining({ codigo: 'FALHA_NA_APLICACAO', correlationId: CONTEXTO.correlationId }),
    ]);
    expect(db.atual.notificacoes).toHaveLength(3);
    // PII: nem CPF nem nome chegam ao log (só tipo e código técnico).
    const registrado = JSON.stringify(log.mock.calls);
    expect(registrado).not.toContain(CPF);
    expect(registrado).not.toContain('Maria');
    log.mockRestore();
  });

  it('se a FALHA não puder ser gravada, a resposta não promete que nada mudou', async () => {
    const { servico, tentativaId } = await preparar();
    falhas.aplicar = new Error('caiu');
    falhas.confirmarDeNovo = new Error('caiu de novo');
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const erro = await servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0).catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.FALHA_TECNICA });
    expect((erro as Error).message).not.toContain('Nenhum empregado');
    expect(daEmpresa(EMPRESA, tentativaId)!.estado).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('empresa arquivada depois da prévia → EMPRESA_ARQUIVADA; nada aplicado', async () => {
    const { servico, tentativaId } = await preparar();
    empresas.arquivadas.add(EMPRESA);

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, EMPRESA, tentativaId, 0))).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);
    expect(db.atual.empregados).toBe(0);
  });

  it('tentativa de outra empresa → TENTATIVA_NAO_ENCONTRADA', async () => {
    const { servico, tentativaId } = await preparar();

    expect(await codigoDo(() => servico.confirmar(CONTEXTO, OUTRA_EMPRESA, tentativaId, 0))).toBe(
      CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA,
    );
  });
});

describe('cancelar (SPEC-014 §3.8)', () => {
  it('cancela a prévia sem tocar a base, com autor e evento; arquivo e relatório continuam', async () => {
    const { servico } = montar();
    const visao = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(visao.tentativaId);

    const cancelada = await servico.cancelar(CONTEXTO, EMPRESA, visao.tentativaId);

    expect(cancelada).toMatchObject({ estado: 'CANCELADA', podeConfirmar: false, relatorioDisponivel: true });
    expect(daEmpresa(EMPRESA, visao.tentativaId)!.usuarioCanceladorId).toBe(USUARIO);
    expect(db.atual.eventos.at(-1)).toMatchObject({ acao: 'CANCELAR', estadoNovo: 'CANCELADA' });
    expect(db.atual.empregados).toBe(0);
  });

  it('terminal ou em validação não cancela', async () => {
    const { servico } = montar();
    const visao = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(await codigoDo(() => servico.cancelar(CONTEXTO, EMPRESA, visao.tentativaId))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
  });
});

describe('consultas', () => {
  it('prévia traz a amostra das rejeições com CPF e matrícula; FALHA traz o diagnóstico de empregados', async () => {
    const { servico } = montar();
    const visao = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(visao.tentativaId);

    expect((await servico.previa(CONTEXTO, EMPRESA, visao.tentativaId)).amostraRejeicoes).toEqual([
      { numeroDaLinha: 4, cpf: '111', matricula: '7', campo: 'cpf', codigoDeErro: 'CPF_INVALIDO', mensagem: 'CPF inválido.' },
    ]);

    trocar(visao.tentativaId, { estado: 'FALHA' });
    db.atual.eventos.push({ tentativaId: visao.tentativaId, acao: 'FALHA_TECNICA', codigo: 'FALHA_NA_APLICACAO' });
    expect((await servico.previa(CONTEXTO, EMPRESA, visao.tentativaId)).diagnostico).toEqual({
      codigo: 'FALHA_NA_APLICACAO',
      mensagem: 'Uma falha técnica interrompeu a aplicação e nenhum empregado foi alterado. Envie o arquivo de novo.',
    });
  });

  it('base paginada repassa página, 50 por página e a busca', async () => {
    const { servico } = montar();

    expect(await servico.empregados(CONTEXTO, EMPRESA, 2, 'maria')).toMatchObject({ pagina: 2, itensPorPagina: 50 });
  });

  it('relatório CSV: BOM, `;`, colunas de empregado e fórmula neutralizada', async () => {
    const { servico } = montar();
    const visao = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);
    validada(visao.tentativaId);

    const { nomeDoArquivo, conteudo } = await servico.relatorio(CONTEXTO, EMPRESA, visao.tentativaId);
    const texto = await ler(conteudo);

    expect(nomeDoArquivo).toBe('relatorio-empregados.csv');
    expect(texto.startsWith(BOM)).toBe(true);
    const [cabecalho, primeira, segunda] = texto.slice(1).trimEnd().split('\r\n');
    expect(cabecalho).toBe('linha;cpf;nome;matricula;data_nascimento;data_admissao;status;acao;codigo_de_erro;campo;mensagem');
    expect(primeira).toContain(`'=HYPERLINK`);
    expect(primeira).toContain(`'+0012`);
    expect(segunda).toContain('CPF_INVALIDO');
    expect(chamadas.sqls.some((sql) => sql.includes('idle_in_transaction_session_timeout'))).toBe(true);
  });

  it('relatório antes da validação → ESTADO_INVALIDO_PARA_ACAO', async () => {
    const { servico } = montar();
    const visao = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    expect(await codigoDo(() => servico.relatorio(CONTEXTO, EMPRESA, visao.tentativaId))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
  });

  it('arquivo original sai do storage pela chave da tentativa', async () => {
    const { servico, storage } = montar();
    const visao = await servico.enviar(CONTEXTO, EMPRESA, arquivo(), MAPEAMENTO);

    const original = await servico.arquivoOriginal(CONTEXTO, EMPRESA, visao.tentativaId);

    expect(storage.obter).toHaveBeenCalledWith(db.atual.tentativas[0]!.arquivoChave);
    expect(original.nome).toBe('empregados.csv');
  });
});
