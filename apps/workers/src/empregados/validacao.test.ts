/**
 * Regras do worker de validação de empregados (SPEC-014 §3.2–§3.5, §3.10–§3.11, §6.4), sem
 * infraestrutura: o `@contaia/db` é trocado por um banco em memória que segue o contrato da Task 2
 * (estados, staging idempotente, versão fixada na gravação), e cada `comContexto` é uma "transação"
 * numerada, para provar o que roda junto e o que roda fora (o S3 nunca dentro de uma transação).
 */
import type { LinhaDeStagingDeEmpregado } from '@contaia/domain';
import { CODIGOS_DE_ERRO, ErroDeDominio, type EstadoDaImportacao } from '@contaia/domain';
import { UnrecoverableError } from 'bullmq';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDoArmazenamento } from '../importacao/leitura-s3.js';
import { motivoDaFalhaDaValidacao, processarValidacaoDeEmpregados, registrarFalhaDaValidacaoDeEmpregados } from './validacao.js';

type Evento = Readonly<{ acao: string; estadoAnterior: string | null; estadoNovo: string; codigo: string | null; totais: unknown; correlationId: string }>;
type Transacao = Readonly<{ id: number; tenantId: string; empresaId: string; identidade: string }>;
type Notificacao = Readonly<{ tentativaId: string; destinatarios: readonly string[] }>;

const banco = vi.hoisted(() => ({
  tenantId: '',
  empresaId: '',
  tentativaId: '',
  iniciador: '',
  admins: [] as string[],
  estado: 'RECEBIDA' as string,
  versaoDaBase: 0,
  versaoFixada: null as number | null,
  arquivoChave: 'chave',
  mapeamento: {} as Record<string, string>,
  vigentes: new Map<string, { arquivado: boolean }>(),
  staging: new Map<number, unknown>(),
  totais: null as unknown,
  eventos: [] as unknown[],
  notificacoes: [] as unknown[],
  contextos: [] as unknown[],
  transacoes: 0,
  abertas: 0,
  chamadas: [] as Array<Readonly<{ funcao: string; transacao: number; versao?: number }>>,
}));

vi.mock('@contaia/db', async () => {
  const { ErroDeDominio: Erro, CODIGOS_DE_ERRO: C } = await import('@contaia/domain');
  const naoEncontrada = () => new Erro(C.TENTATIVA_NAO_ENCONTRADA, 'não encontrada');
  const invalido = () => new Erro(C.ESTADO_INVALIDO_PARA_ACAO, 'estado inválido');
  // A RLS do contexto técnico: só a tentativa do tenant e da empresa da transação existe.
  const visivel = (c: Transacao, empresaId: string, id: string) =>
    c.tenantId === banco.tenantId && c.empresaId === banco.empresaId && empresaId === banco.empresaId && id === banco.tentativaId;
  const anotar = (funcao: string, c: Transacao, versao?: number) =>
    banco.chamadas.push(versao === undefined ? { funcao, transacao: c.id } : { funcao, transacao: c.id, versao });
  const DESCRITOR = Object.freeze({ tabela: 'importacao_empregados' });

  return {
    DESCRITOR_EMPREGADOS: DESCRITOR,
    comContexto: async (_pool: unknown, contexto: { tenantId: string; empresaId: string; identidadeTecnica: string }, executar: (c: Transacao) => Promise<unknown>) => {
      banco.transacoes += 1;
      banco.abertas += 1;
      banco.contextos.push(contexto);
      try {
        return await executar({ id: banco.transacoes, tenantId: contexto.tenantId, empresaId: contexto.empresaId, identidade: contexto.identidadeTecnica });
      } finally {
        banco.abertas -= 1;
      }
    },
    cicloDeImportacao: {
      iniciarValidacao: async (c: Transacao, d: unknown, empresaId: string, id: string) => {
        anotar('iniciar', c);
        if (d !== DESCRITOR) throw new Error('descritor errado');
        if (!visivel(c, empresaId, id)) throw naoEncontrada();
        if (banco.estado !== 'RECEBIDA' && banco.estado !== 'VALIDANDO') throw invalido();
        const transicionou = banco.estado === 'RECEBIDA';
        banco.estado = 'VALIDANDO';

        return { transicionou, versaoNaValidacao: banco.versaoDaBase };
      },
      buscarTentativa: async (c: Transacao, _d: unknown, empresaId: string, id: string) =>
        visivel(c, empresaId, id)
          ? { id, estado: banco.estado, arquivoChave: banco.arquivoChave, mapeamento: banco.mapeamento, usuarioIniciadorId: banco.iniciador }
          : null,
      registrarEvento: async (c: Transacao, _d: unknown, evento: Evento) => {
        anotar('evento', c);
        banco.eventos.push(evento);
      },
      registrarFalha: async (c: Transacao, _d: unknown, empresaId: string, id: string) => {
        if (!visivel(c, empresaId, id)) throw naoEncontrada();
        if (banco.estado !== 'VALIDANDO' && banco.estado !== 'APLICANDO') throw invalido();
        const anterior = banco.estado;
        banco.estado = 'FALHA';

        return anterior;
      },
    },
    carregarEmpregadosVigentes: async (c: Transacao) => {
      anotar('carregarVigentes', c);

      return banco.vigentes;
    },
    gravarResultadoDaValidacaoDeEmpregados: async (
      c: Transacao,
      empresaId: string,
      id: string,
      linhas: readonly LinhaDeStagingDeEmpregado[],
      versao: number,
    ) => {
      anotar('gravar', c, versao);
      if (!visivel(c, empresaId, id)) throw naoEncontrada();
      if (banco.estado === 'RECEBIDA' || banco.estado === 'FALHA') throw invalido();
      if (banco.estado !== 'VALIDANDO') return { estado: banco.estado, totais: banco.totais, transicionou: false };
      for (const linha of linhas) {
        if (!banco.staging.has(linha.numeroDaLinha)) banco.staging.set(linha.numeroDaLinha, linha);
      }
      const todas = [...banco.staging.values()] as LinhaDeStagingDeEmpregado[];
      const valida = (acao: string) => todas.filter((l) => l.status === 'VALIDA' && l.acao === acao).length;
      const totais = { lidas: todas.length, novas: valida('INCLUIR'), atualizadas: valida('ATUALIZAR'), rejeitadas: todas.filter((l) => l.status === 'REJEITADA').length };
      banco.estado = totais.novas + totais.atualizadas > 0 ? 'AGUARDANDO_CONFIRMACAO' : 'REJEITADA';
      banco.totais = totais;
      banco.versaoFixada = versao;

      return { estado: banco.estado, totais, transicionou: true };
    },
    listarAdminsAutorizadosDaEmpresa: async (c: Transacao) => {
      anotar('admins', c);

      return banco.admins;
    },
    criarNotificacoesDeImportacaoDeEmpregados: async (c: Transacao, nova: Notificacao) => {
      anotar('notificar', c);
      banco.notificacoes.push(nova);

      return nova.destinatarios.length;
    },
  };
});

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const TENTATIVA = '0198f3c2-0000-7000-8000-000000000003';
const OUTRO_TENANT = '0198f3c2-0000-7000-8000-000000000009';
const INICIADOR = '0198f3c2-0000-7000-8000-0000000000a1';
const ADMIN = '0198f3c2-0000-7000-8000-0000000000a2';
const MAPEAMENTO = { cpf: 'cpf', nome: 'nome', matricula: 'matricula', data_nascimento: 'data_nascimento', data_admissao: 'data_admissao' };
const comando = { tenantId: TENANT, empresaId: EMPRESA, tentativaId: TENTATIVA, correlationId: 'corr-emp-0001' } as const;

const csv = (linhas: readonly string[]): Buffer =>
  Buffer.from(['cpf;nome;matricula;data_nascimento;data_admissao', ...linhas, ''].join('\r\n'), 'utf8');

const ler = vi.fn<(chave: string) => Promise<Buffer>>();
const deps = { pool: {} as Pool, ler, agora: () => new Date('2026-10-08T12:00:00Z') };

const staging = (): LinhaDeStagingDeEmpregado[] =>
  ([...banco.staging.values()] as LinhaDeStagingDeEmpregado[]).sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);
const eventos = (): Evento[] => banco.eventos as Evento[];
const notificacoes = (): Notificacao[] => banco.notificacoes as Notificacao[];

const comArquivo = (bytes: Buffer): void => {
  ler.mockImplementation(async () => {
    // O storage é lido FORA de qualquer transação.
    expect(banco.abertas).toBe(0);

    return bytes;
  });
};

const BOAS = ['529.982.247-25;Maria Souza;00123;15/03/1985;01/02/2010', '111.444.777-35;João Lima;77;20/07/1990;10/01/2015'];

beforeEach(() => {
  Object.assign(banco, {
    tenantId: TENANT,
    empresaId: EMPRESA,
    tentativaId: TENTATIVA,
    iniciador: INICIADOR,
    admins: [ADMIN, INICIADOR],
    estado: 'RECEBIDA' as EstadoDaImportacao,
    versaoDaBase: 0,
    versaoFixada: null,
    arquivoChave: `${TENANT}/${EMPRESA}/empregados/abc.csv`,
    mapeamento: MAPEAMENTO,
    vigentes: new Map(),
    staging: new Map(),
    totais: null,
    eventos: [],
    notificacoes: [],
    contextos: [],
    transacoes: 0,
    abertas: 0,
    chamadas: [],
  });
  ler.mockReset();
});

describe('processarValidacaoDeEmpregados: desfechos da validação', () => {
  it('CSV bom → AGUARDANDO_CONFIRMACAO com totais, linhas no staging e ação INCLUIR/ATUALIZAR; sem notificação', async () => {
    banco.vigentes = new Map([['52998224725|00123', { arquivado: false }]]);
    comArquivo(csv(BOAS));

    const resultado = await processarValidacaoDeEmpregados(deps, comando);

    const totais = { lidas: 2, novas: 1, atualizadas: 1, rejeitadas: 0 };
    expect(resultado).toEqual({ desfecho: 'AGUARDANDO_CONFIRMACAO', totais });
    expect(ler).toHaveBeenCalledWith(banco.arquivoChave);
    expect(staging().map((l) => [l.numeroDaLinha, l.status, l.acao])).toEqual([[2, 'VALIDA', 'ATUALIZAR'], [3, 'VALIDA', 'INCLUIR']]);
    expect(eventos()).toEqual([
      expect.objectContaining({ acao: 'INICIAR_VALIDACAO', estadoAnterior: 'RECEBIDA', estadoNovo: 'VALIDANDO', codigo: null, correlationId: 'corr-emp-0001' }),
      expect.objectContaining({ acao: 'VALIDACAO_SUCESSO', estadoAnterior: 'VALIDANDO', estadoNovo: 'AGUARDANDO_CONFIRMACAO', totais, codigo: null, correlationId: 'corr-emp-0001' }),
    ]);
    // A prévia não é conclusão: quem notifica é a confirmação/cancelamento (API).
    expect(notificacoes()).toEqual([]);
  });

  it('2 linhas boas e 1 ruim → 2 VALIDA + 1 rejeição preservada; o arquivo segue para a confirmação', async () => {
    comArquivo(csv([...BOAS, '123.456.789-00;Pedro;9;01/01/1980;01/01/2000']));

    const resultado = await processarValidacaoDeEmpregados(deps, comando);

    expect(resultado).toEqual({ desfecho: 'AGUARDANDO_CONFIRMACAO', totais: { lidas: 3, novas: 2, atualizadas: 0, rejeitadas: 1 } });
    expect(staging()[2]).toMatchObject({ numeroDaLinha: 4, status: 'REJEITADA', codigoDeErro: 'CPF_INVALIDO', campo: 'cpf' });
    expect(notificacoes()).toEqual([]);
  });

  it('nenhuma linha válida → REJEITADA com as rejeições no staging, evento VALIDACAO_REJEITADA e notificação ao iniciador e aos admins', async () => {
    comArquivo(csv(['123.456.789-00;Pedro;9;01/01/1980;01/01/2000', '529.982.247-25;;2;15/03/1985;01/02/2010']));

    const resultado = await processarValidacaoDeEmpregados(deps, comando);

    expect(resultado).toEqual({ desfecho: 'REJEITADA', totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 } });
    expect(staging().map((l) => l.codigoDeErro)).toEqual(['CPF_INVALIDO', 'CAMPO_OBRIGATORIO_AUSENTE']);
    expect(eventos().at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', estadoNovo: 'REJEITADA', codigo: null });
    // Iniciador primeiro e sem repetir o admin que também é o iniciador.
    expect(notificacoes()).toEqual([{ empresaId: EMPRESA, tentativaId: TENTATIVA, destinatarios: [INICIADOR, ADMIN], agora: new Date('2026-10-08T12:00:00Z') }]);
  });

  it.each([
    ['vazio', Buffer.alloc(0), 'ARQUIVO_VAZIO'],
    ['só o cabeçalho', Buffer.from('cpf;nome;matricula;data_nascimento;data_admissao\r\n'), 'ARQUIVO_VAZIO'],
    ['ilegível (aspas sem fechar)', Buffer.from('cpf;nome;matricula;data_nascimento;data_admissao\r\n1;"x;1;1;1\r\n'), 'ARQUIVO_INVALIDO'],
    ['cabeçalho repetido', Buffer.from('cpf;cpf;matricula;data_nascimento;data_admissao\r\nx\r\n'), 'CABECALHO_INVALIDO'],
  ])('arquivo %s → REJEITADA sem staging, evento com o código estável e notificação', async (_rotulo, bytes, codigo) => {
    comArquivo(bytes);

    const resultado = await processarValidacaoDeEmpregados(deps, comando);

    expect(resultado).toEqual({ desfecho: 'REJEITADA', totais: { lidas: 0, novas: 0, atualizadas: 0, rejeitadas: 0 } });
    expect(banco.estado).toBe('REJEITADA');
    expect(staging()).toEqual([]);
    expect(eventos().at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', estadoAnterior: 'VALIDANDO', estadoNovo: 'REJEITADA', codigo });
    expect(notificacoes()).toHaveLength(1);
  });

  it('mapeamento gravado que não confere com o arquivo → REJEITADA com MAPEAMENTO_INCOMPLETO', async () => {
    banco.mapeamento = { ...MAPEAMENTO, matricula: 'Registro' };
    comArquivo(csv(BOAS));

    await expect(processarValidacaoDeEmpregados(deps, comando)).resolves.toMatchObject({ desfecho: 'REJEITADA' });
    expect(eventos().at(-1)).toMatchObject({ codigo: 'MAPEAMENTO_INCOMPLETO' });
  });
});

describe('processarValidacaoDeEmpregados: contexto, transações curtas e versão', () => {
  it('toda transação do worker usa a identidade técnica workers-empregados e a finalidade da empresa', async () => {
    comArquivo(csv(BOAS));

    await processarValidacaoDeEmpregados(deps, comando);

    expect(banco.contextos).not.toHaveLength(0);
    for (const contexto of banco.contextos) {
      expect(contexto).toMatchObject({ identidadeTecnica: 'workers-empregados', finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId: TENANT, empresaId: EMPRESA });
    }
  });

  it('a versão e os empregados vigentes saem da MESMA transação do início; a gravação fixa a versão lida, mesmo se a base mudou depois', async () => {
    banco.versaoDaBase = 4;
    ler.mockImplementation(async () => {
      expect(banco.abertas).toBe(0);
      banco.versaoDaBase = 5; // outra importação aplicada enquanto o arquivo era lido

      return csv(BOAS);
    });

    await processarValidacaoDeEmpregados(deps, comando);

    const transacaoDe = (funcao: string) => banco.chamadas.find((c) => c.funcao === funcao)?.transacao;
    expect(transacaoDe('carregarVigentes')).toBe(transacaoDe('iniciar'));
    expect(transacaoDe('gravar')).not.toBe(transacaoDe('iniciar'));
    expect(banco.chamadas.find((c) => c.funcao === 'gravar')?.versao).toBe(4);
    expect(banco.versaoFixada).toBe(4);
  });
});

describe('processarValidacaoDeEmpregados: payload, storage e reentrega', () => {
  it('payload fora do contrato → UnrecoverableError(PAYLOAD_INVALIDO), sem tocar banco nem storage; CPF extra no payload é recusado', async () => {
    for (const ruim of [null, {}, { ...comando, tentativaId: 'x' }, { ...comando, cpf: '52998224725' }]) {
      const erro = await processarValidacaoDeEmpregados(deps, ruim).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(UnrecoverableError);
      expect((erro as Error).message).toBe('PAYLOAD_INVALIDO');
    }
    expect(banco.transacoes).toBe(0);
    expect(ler).not.toHaveBeenCalled();
  });

  it('storage indisponível → o erro volta (o BullMQ repete), a tentativa segue VALIDANDO e nada é gravado', async () => {
    const indisponivel = new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL');
    ler.mockRejectedValue(indisponivel);

    await expect(processarValidacaoDeEmpregados(deps, comando)).rejects.toBe(indisponivel);
    expect(banco.estado).toBe('VALIDANDO');
    expect(banco.chamadas.some((c) => c.funcao === 'gravar')).toBe(false);
    expect(notificacoes()).toEqual([]);
  });

  it('original ausente no storage → UnrecoverableError(ORIGINAL_NAO_ENCONTRADO): repetir não faz o objeto aparecer', async () => {
    ler.mockRejectedValue(new ErroDoArmazenamento('ORIGINAL_NAO_ENCONTRADO'));

    const erro = await processarValidacaoDeEmpregados(deps, comando).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnrecoverableError);
    expect((erro as Error).message).toBe('ORIGINAL_NAO_ENCONTRADO');
  });

  it('reentrega depois da validação concluída → JA_PROCESSADA (sem ler o storage nem gravar evento ou notificação)', async () => {
    comArquivo(csv(BOAS));
    await processarValidacaoDeEmpregados(deps, comando);
    const antes = { eventos: banco.eventos.length, staging: banco.staging.size, notificacoes: banco.notificacoes.length };
    ler.mockClear();

    await expect(processarValidacaoDeEmpregados(deps, comando)).resolves.toEqual({ desfecho: 'JA_PROCESSADA' });
    expect(ler).not.toHaveBeenCalled();
    expect({ eventos: banco.eventos.length, staging: banco.staging.size, notificacoes: banco.notificacoes.length }).toEqual(antes);
  });

  it.each(['REJEITADA', 'CANCELADA', 'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'FALHA', 'APLICANDO', 'AGUARDANDO_CONFIRMACAO'])(
    'tentativa em %s → JA_PROCESSADA, sem retry nem efeito',
    async (estado) => {
      banco.estado = estado;

      await expect(processarValidacaoDeEmpregados(deps, comando)).resolves.toEqual({ desfecho: 'JA_PROCESSADA' });
      expect(banco.estado).toBe(estado);
      expect(banco.eventos).toEqual([]);
      expect(ler).not.toHaveBeenCalled();
    },
  );

  it('queda no meio (tentativa já em VALIDANDO) → refaz e conclui, sem evento de início repetido', async () => {
    banco.estado = 'VALIDANDO';
    comArquivo(csv(BOAS));

    await expect(processarValidacaoDeEmpregados(deps, comando)).resolves.toMatchObject({ desfecho: 'AGUARDANDO_CONFIRMACAO' });
    expect(eventos().map((e) => e.acao)).toEqual(['VALIDACAO_SUCESSO']);
  });

  it('job com o tenant de outro escritório → UnrecoverableError(TENTATIVA_NAO_ENCONTRADA), sem ler o original', async () => {
    const erro = await processarValidacaoDeEmpregados(deps, { ...comando, tenantId: OUTRO_TENANT }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnrecoverableError);
    expect((erro as Error).message).toBe('TENTATIVA_NAO_ENCONTRADA');
    expect(ler).not.toHaveBeenCalled();
    expect(banco.estado).toBe('RECEBIDA');
  });
});

describe('registrarFalhaDaValidacaoDeEmpregados: tentativas esgotadas', () => {
  it('VALIDANDO → FALHA, um evento FALHA_TECNICA com o código estável e a correlationId, e uma notificação (iniciador + admins); repetir não duplica', async () => {
    banco.estado = 'VALIDANDO';

    await expect(registrarFalhaDaValidacaoDeEmpregados(deps, comando, 'ARMAZENAMENTO_INDISPONIVEL')).resolves.toBe(true);
    await expect(registrarFalhaDaValidacaoDeEmpregados(deps, comando, 'ARMAZENAMENTO_INDISPONIVEL')).resolves.toBe(false);

    expect(banco.estado).toBe('FALHA');
    expect(eventos()).toEqual([
      expect.objectContaining({ acao: 'FALHA_TECNICA', estadoAnterior: 'VALIDANDO', estadoNovo: 'FALHA', codigo: 'ARMAZENAMENTO_INDISPONIVEL', correlationId: 'corr-emp-0001' }),
    ]);
    expect(notificacoes()).toEqual([expect.objectContaining({ destinatarios: [INICIADOR, ADMIN] })]);
  });

  it.each(['RECEBIDA', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO', 'REJEITADA'])('tentativa em %s não vira FALHA pelo worker', async (estado) => {
    banco.estado = estado;

    await expect(registrarFalhaDaValidacaoDeEmpregados(deps, comando, 'FALHA_NA_VALIDACAO')).resolves.toBe(false);
    expect(banco.estado).toBe(estado);
    expect(banco.eventos).toEqual([]);
  });

  it('sem tentativa identificável (payload inválido, outro tenant) não grava nada', async () => {
    banco.estado = 'VALIDANDO';

    await expect(registrarFalhaDaValidacaoDeEmpregados(deps, { lixo: true }, 'FALHA_NA_VALIDACAO')).resolves.toBe(false);
    await expect(registrarFalhaDaValidacaoDeEmpregados(deps, comando, 'PAYLOAD_INVALIDO')).resolves.toBe(false);
    await expect(registrarFalhaDaValidacaoDeEmpregados(deps, { ...comando, tenantId: OUTRO_TENANT }, 'FALHA_NA_VALIDACAO')).resolves.toBe(false);
    expect(banco.estado).toBe('VALIDANDO');
  });
});

describe('motivoDaFalhaDaValidacao: só código estável', () => {
  it('mensagem crua de exceção (inclusive com CPF/nome) nunca vira motivo', () => {
    expect(motivoDaFalhaDaValidacao(new Error('Failing row contains (52998224725, Maria Souza)'))).toBe('FALHA_NA_VALIDACAO');
    expect(motivoDaFalhaDaValidacao(new UnrecoverableError('Maria Souza'))).toBe('FALHA_NA_VALIDACAO');
    expect(motivoDaFalhaDaValidacao(new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'x'))).toBe('FALHA_NA_VALIDACAO');
  });
});
