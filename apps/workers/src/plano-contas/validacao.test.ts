/**
 * Regras do worker de validação do plano de contas (SPEC-013 §3.2–§3.5, §3.10–§3.11, §6.4), sem
 * infraestrutura: o repositório do `@contaia/db` é trocado por um banco em memória que segue o
 * contrato construído na Task 4 (estados, staging idempotente, versão fixada na gravação), e cada
 * `comContexto` é uma "transação" numerada, para provar o que roda junto e o que roda fora.
 */
import type { LinhaDeStaging, TotaisDaPrevia } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio, type ContaVigente, type EstadoDaImportacao } from '@contaia/domain';
import { UnrecoverableError } from 'bullmq';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDoArmazenamento } from './leitura-s3.js';
import { mensagemPadraoDaRejeicao } from './mensagens.js';
import { motivoDaFalhaDaValidacao, processarValidacao, registrarFalhaDaValidacao } from './validacao.js';

type Evento = Readonly<{ acao: string; estadoAnterior: string | null; estadoNovo: string; codigo: string | null; totais: unknown }>;
type Transacao = Readonly<{ id: number; tenantId: string; empresaId: string }>;

const banco = vi.hoisted(() => ({
  tenantId: '',
  empresaId: '',
  tentativaId: '',
  estado: 'RECEBIDA' as string,
  versaoDoPlano: 0,
  versaoFixada: null as number | null,
  arquivoChave: 'chave',
  mapeamento: {} as Record<string, string>,
  contas: [] as unknown[],
  staging: new Map<number, unknown>(),
  totais: null as unknown,
  eventos: [] as unknown[],
  notificacoes: 0,
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

  return {
    comContexto: async (_pool: unknown, contexto: { tenantId: string; empresaId: string }, executar: (c: Transacao) => Promise<unknown>) => {
      banco.transacoes += 1;
      banco.abertas += 1;
      try {
        return await executar({ id: banco.transacoes, tenantId: contexto.tenantId, empresaId: contexto.empresaId });
      } finally {
        banco.abertas -= 1;
      }
    },
    iniciarValidacaoDaImportacao: async (c: Transacao, empresaId: string, id: string) => {
      anotar('iniciar', c);
      if (!visivel(c, empresaId, id)) throw naoEncontrada();
      if (banco.estado !== 'RECEBIDA' && banco.estado !== 'VALIDANDO') throw invalido();
      const transicionou = banco.estado === 'RECEBIDA';
      banco.estado = 'VALIDANDO';

      return { transicionou, planoVersaoNaValidacao: banco.versaoDoPlano };
    },
    buscarTentativaDeImportacao: async (c: Transacao, empresaId: string, id: string) =>
      visivel(c, empresaId, id)
        ? { id, estado: banco.estado, arquivoChave: banco.arquivoChave, mapeamento: banco.mapeamento }
        : null,
    carregarContasVigentes: async (c: Transacao) => {
      anotar('carregarContas', c);

      return banco.contas;
    },
    gravarResultadoDaValidacao: async (c: Transacao, empresaId: string, id: string, linhas: readonly LinhaDeStaging[], versao: number) => {
      anotar('gravar', c, versao);
      if (!visivel(c, empresaId, id)) throw naoEncontrada();
      if (banco.estado === 'RECEBIDA' || banco.estado === 'FALHA') throw invalido();
      if (banco.estado !== 'VALIDANDO') return { estado: banco.estado, totais: banco.totais, transicionou: false };
      for (const linha of linhas) {
        if (!banco.staging.has(linha.numeroDaLinha)) banco.staging.set(linha.numeroDaLinha, linha);
      }
      const todas = [...banco.staging.values()] as LinhaDeStaging[];
      const valida = (acao: string) => todas.filter((l) => l.status === 'VALIDA' && l.acao === acao).length;
      const totais = { lidas: todas.length, novas: valida('INCLUIR'), atualizadas: valida('ATUALIZAR'), rejeitadas: todas.filter((l) => l.status === 'REJEITADA').length };
      banco.estado = totais.novas + totais.atualizadas > 0 ? 'AGUARDANDO_CONFIRMACAO' : 'REJEITADA';
      banco.totais = totais;
      banco.versaoFixada = versao;

      return { estado: banco.estado, totais, transicionou: true };
    },
    registrarEventoDeImportacao: async (c: Transacao, evento: Evento) => {
      anotar('evento', c);
      banco.eventos.push(evento);
    },
    criarNotificacaoDeImportacao: async (c: Transacao) => {
      anotar('notificar', c);
      banco.notificacoes += 1;

      return true;
    },
    registrarFalhaDaImportacao: async (c: Transacao, empresaId: string, id: string) => {
      if (!visivel(c, empresaId, id)) throw naoEncontrada();
      if (banco.estado !== 'VALIDANDO' && banco.estado !== 'APLICANDO') throw invalido();
      const anterior = banco.estado;
      banco.estado = 'FALHA';

      return anterior;
    },
  };
});

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const TENTATIVA = '0198f3c2-0000-7000-8000-000000000003';
const OUTRO_TENANT = '0198f3c2-0000-7000-8000-000000000009';
const MAPEAMENTO = { codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' };
const comando = { tenantId: TENANT, empresaId: EMPRESA, tentativaId: TENTATIVA, correlationId: 'corr-plano-0001' } as const;

const csv = (linhas: readonly string[]): Buffer => Buffer.from(['codigo;nome;tipo;natureza;conta_pai', ...linhas, ''].join('\r\n'), 'utf8');

const ler = vi.fn<(chave: string) => Promise<Buffer>>();
const deps = { pool: {} as Pool, ler, agora: () => new Date('2026-10-08T12:00:00Z') };

const staging = (): LinhaDeStaging[] =>
  ([...banco.staging.values()] as LinhaDeStaging[]).sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);
const eventos = (): Evento[] => banco.eventos as Evento[];
const rejeicoes = () =>
  staging().flatMap((l) => (l.status === 'REJEITADA' ? [{ linha: l.numeroDaLinha, erro: l.codigoDeErro, campo: l.campo }] : []));

const comArquivo = (bytes: Buffer): void => {
  ler.mockImplementation(async () => {
    // O storage é lido FORA de qualquer transação.
    expect(banco.abertas).toBe(0);

    return bytes;
  });
};

beforeEach(() => {
  Object.assign(banco, {
    tenantId: TENANT,
    empresaId: EMPRESA,
    tentativaId: TENTATIVA,
    estado: 'RECEBIDA' as EstadoDaImportacao,
    versaoDoPlano: 0,
    versaoFixada: null,
    arquivoChave: `${TENANT}/${EMPRESA}/plano-contas/abc.csv`,
    mapeamento: MAPEAMENTO,
    contas: [] as ContaVigente[],
    staging: new Map(),
    totais: null,
    eventos: [],
    notificacoes: 0,
    transacoes: 0,
    abertas: 0,
    chamadas: [],
  });
  ler.mockReset();
});

describe('processarValidacao: desfechos da validação', () => {
  it('CSV bom → AGUARDANDO_CONFIRMACAO com totais, linhas no staging e ação INCLUIR/ATUALIZAR; sem notificação', async () => {
    banco.contas = [{ codigo: '1', tipo: 'sintetica', arquivada: false, temFilhas: false, contaPai: null }];
    comArquivo(csv(['1;Ativo;sintetica;devedora;', '1.1;Caixa;analitica;devedora;1', '2;Passivo;sintética;Credora;']));

    const resultado = await processarValidacao(deps, comando);

    const totais: TotaisDaPrevia = { lidas: 3, novas: 2, atualizadas: 1, rejeitadas: 0 };
    expect(resultado).toEqual({ desfecho: 'AGUARDANDO_CONFIRMACAO', totais });
    expect(ler).toHaveBeenCalledWith(banco.arquivoChave);
    expect(staging()).toEqual([
      { status: 'VALIDA', numeroDaLinha: 2, codigo: '1', nome: 'Ativo', tipo: 'sintetica', natureza: 'devedora', contaPai: null, acao: 'ATUALIZAR' },
      { status: 'VALIDA', numeroDaLinha: 3, codigo: '1.1', nome: 'Caixa', tipo: 'analitica', natureza: 'devedora', contaPai: '1', acao: 'INCLUIR' },
      { status: 'VALIDA', numeroDaLinha: 4, codigo: '2', nome: 'Passivo', tipo: 'sintetica', natureza: 'credora', contaPai: null, acao: 'INCLUIR' },
    ]);
    expect(eventos()).toEqual([
      expect.objectContaining({ acao: 'INICIAR_VALIDACAO', estadoAnterior: 'RECEBIDA', estadoNovo: 'VALIDANDO', codigo: null }),
      expect.objectContaining({ acao: 'VALIDACAO_SUCESSO', estadoAnterior: 'VALIDANDO', estadoNovo: 'AGUARDANDO_CONFIRMACAO', totais, codigo: null }),
    ]);
    expect(banco.notificacoes).toBe(0);
  });

  it('ciclo → as linhas do ciclo são rejeitadas com a mensagem padrão e o restante segue válido', async () => {
    comArquivo(csv(['1;Ativo;sintetica;devedora;', '5;A;sintetica;devedora;6', '6;B;sintetica;devedora;5']));

    const resultado = await processarValidacao(deps, comando);

    expect(resultado).toEqual({ desfecho: 'AGUARDANDO_CONFIRMACAO', totais: { lidas: 3, novas: 1, atualizadas: 0, rejeitadas: 2 } });
    expect(rejeicoes()).toEqual([
      { linha: 3, erro: 'CICLO_HIERARQUICO', campo: 'conta_pai' },
      { linha: 4, erro: 'CICLO_HIERARQUICO', campo: 'conta_pai' },
    ]);
    expect(staging()[1]).toMatchObject({ mensagem: mensagemPadraoDaRejeicao('CICLO_HIERARQUICO', null), codigo: '5', contaPai: '6' });
  });

  it('nenhuma linha válida → REJEITADA com totais, evento VALIDACAO_REJEITADA e notificação ao iniciador', async () => {
    comArquivo(csv(['1;Ativo;xyz;devedora;', '2;;sintetica;devedora;']));

    const resultado = await processarValidacao(deps, comando);

    expect(resultado).toEqual({ desfecho: 'REJEITADA', totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 } });
    expect(eventos().at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', estadoNovo: 'REJEITADA', codigo: null });
    expect(banco.notificacoes).toBe(1);
    // A rejeitada guarda o valor cru da linha (tipo fora do domínio; nome vazio vira nulo).
    expect(staging()).toEqual([
      expect.objectContaining({ numeroDaLinha: 2, codigo: '1', tipo: 'xyz', codigoDeErro: 'VALOR_FORA_DO_DOMINIO', campo: 'tipo', mensagem: 'O tipo deve ser "analítica" ou "sintética".' }),
      expect.objectContaining({ numeroDaLinha: 3, codigo: '2', nome: null, codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE', campo: 'nome', mensagem: 'Preencha o campo nome: ele é obrigatório.' }),
    ]);
  });

  it.each([
    ['vazio', Buffer.alloc(0), 'ARQUIVO_VAZIO'],
    ['só o cabeçalho', Buffer.from('codigo;nome;tipo;natureza;conta_pai\r\n'), 'ARQUIVO_VAZIO'],
    ['ilegível (aspas sem fechar)', Buffer.from('codigo;nome;tipo;natureza;conta_pai\r\n1;"Ativo;sintetica;devedora;\r\n'), 'ARQUIVO_INVALIDO'],
    ['cabeçalho repetido', Buffer.from('codigo;codigo;tipo;natureza;conta_pai\r\n1;Ativo;sintetica;devedora;\r\n'), 'CABECALHO_INVALIDO'],
  ])('arquivo %s → REJEITADA sem staging, evento com o código estável e notificação', async (_rotulo, bytes, codigo) => {
    comArquivo(bytes);

    const resultado = await processarValidacao(deps, comando);

    expect(resultado).toEqual({ desfecho: 'REJEITADA', totais: { lidas: 0, novas: 0, atualizadas: 0, rejeitadas: 0 } });
    expect(banco.estado).toBe('REJEITADA');
    expect(staging()).toEqual([]);
    expect(eventos().at(-1)).toMatchObject({ acao: 'VALIDACAO_REJEITADA', estadoAnterior: 'VALIDANDO', estadoNovo: 'REJEITADA', codigo });
    expect(banco.notificacoes).toBe(1);
  });

  it('mapeamento gravado que não confere com o arquivo → REJEITADA com MAPEAMENTO_INCOMPLETO', async () => {
    banco.mapeamento = { ...MAPEAMENTO, conta_pai: 'Pai' };
    comArquivo(csv(['1;Ativo;sintetica;devedora;']));

    await expect(processarValidacao(deps, comando)).resolves.toMatchObject({ desfecho: 'REJEITADA' });
    expect(eventos().at(-1)).toMatchObject({ codigo: 'MAPEAMENTO_INCOMPLETO' });
  });

  it('limites de coluna: código com 65 e nome com 256 caracteres viram rejeição da linha, nunca erro de gravação', async () => {
    const codigo = 'C'.repeat(65);
    comArquivo(csv([`${codigo};Longo;sintetica;devedora;`, `2;${'N'.repeat(256)};sintetica;devedora;`, '3;Ok;sintetica;devedora;']));

    await processarValidacao(deps, comando);

    expect(staging().filter((l) => l.status === 'REJEITADA')).toEqual([
      expect.objectContaining({ numeroDaLinha: 2, codigo, codigoDeErro: 'VALOR_FORA_DO_DOMINIO', campo: 'codigo', mensagem: 'O código tem 65 caracteres; o limite é 64.' }),
      expect.objectContaining({ numeroDaLinha: 3, codigo: '2', codigoDeErro: 'VALOR_FORA_DO_DOMINIO', campo: 'nome', mensagem: 'O nome tem 256 caracteres; o limite é 255.' }),
    ]);
    expect(banco.estado).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('linha com campos a mais: a mensagem do domínio vence a padrão, na linha física certa', async () => {
    comArquivo(csv(['1;Ativo;sintetica;devedora;', '3;Caixa; Bancos;analitica;devedora;1']));

    await processarValidacao(deps, comando);

    expect(staging()[1]).toMatchObject({
      numeroDaLinha: 3,
      codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
      campo: null,
      mensagem: "A linha tem mais campos do que o cabeçalho; confira ';' ou aspas no texto.",
    });
  });
});

describe('processarValidacao: consistência da versão e transações curtas', () => {
  it('a versão e as contas vigentes saem da MESMA transação do início; a gravação fixa a versão lida, mesmo se o plano mudou depois', async () => {
    banco.versaoDoPlano = 4;
    ler.mockImplementation(async () => {
      expect(banco.abertas).toBe(0);
      banco.versaoDoPlano = 5; // outra importação aplicada enquanto o arquivo era lido

      return csv(['1;Ativo;sintetica;devedora;']);
    });

    await processarValidacao(deps, comando);

    const transacaoDe = (funcao: string) => banco.chamadas.find((c) => c.funcao === funcao)?.transacao;
    expect(transacaoDe('carregarContas')).toBe(transacaoDe('iniciar'));
    expect(transacaoDe('gravar')).not.toBe(transacaoDe('iniciar'));
    expect(banco.chamadas.find((c) => c.funcao === 'gravar')?.versao).toBe(4);
    expect(banco.versaoFixada).toBe(4);
  });
});

describe('processarValidacao: payload, storage e reentrega', () => {
  it('payload fora do contrato → UnrecoverableError(PAYLOAD_INVALIDO), sem tocar banco nem storage', async () => {
    for (const ruim of [null, {}, { ...comando, tentativaId: 'x' }, { ...comando, mapeamento: {} }]) {
      const erro = await processarValidacao(deps, ruim).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(UnrecoverableError);
      expect((erro as Error).message).toBe('PAYLOAD_INVALIDO');
    }
    expect(banco.transacoes).toBe(0);
    expect(ler).not.toHaveBeenCalled();
  });

  it('storage indisponível → o erro volta (o BullMQ repete), a tentativa segue VALIDANDO e nada é gravado', async () => {
    const indisponivel = new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL');
    ler.mockRejectedValue(indisponivel);

    await expect(processarValidacao(deps, comando)).rejects.toBe(indisponivel);
    expect(banco.estado).toBe('VALIDANDO');
    expect(banco.chamadas.some((c) => c.funcao === 'gravar')).toBe(false);
    expect(banco.notificacoes).toBe(0);
  });

  it('original ausente no storage → UnrecoverableError(ORIGINAL_NAO_ENCONTRADO): repetir não faz o objeto aparecer', async () => {
    ler.mockRejectedValue(new ErroDoArmazenamento('ORIGINAL_NAO_ENCONTRADO'));

    const erro = await processarValidacao(deps, comando).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnrecoverableError);
    expect((erro as Error).message).toBe('ORIGINAL_NAO_ENCONTRADO');
  });

  it('reentrega depois da validação concluída → ack sem efeito (sem ler o storage nem gravar evento)', async () => {
    comArquivo(csv(['1;Ativo;sintetica;devedora;']));
    await processarValidacao(deps, comando);
    const antes = { eventos: banco.eventos.length, staging: banco.staging.size };
    ler.mockClear();

    await expect(processarValidacao(deps, comando)).resolves.toEqual({ desfecho: 'JA_PROCESSADA' });
    expect(ler).not.toHaveBeenCalled();
    expect({ eventos: banco.eventos.length, staging: banco.staging.size }).toEqual(antes);
  });

  it.each(['REJEITADA', 'CANCELADA', 'CONCLUIDA', 'FALHA', 'APLICANDO'])('tentativa em %s → JA_PROCESSADA, sem retry', async (estado) => {
    banco.estado = estado;

    await expect(processarValidacao(deps, comando)).resolves.toEqual({ desfecho: 'JA_PROCESSADA' });
    expect(banco.estado).toBe(estado);
  });

  it('queda no meio (tentativa já em VALIDANDO) → refaz e conclui, sem evento de início repetido', async () => {
    banco.estado = 'VALIDANDO';
    comArquivo(csv(['1;Ativo;sintetica;devedora;']));

    await expect(processarValidacao(deps, comando)).resolves.toMatchObject({ desfecho: 'AGUARDANDO_CONFIRMACAO' });
    expect(eventos().map((e) => e.acao)).toEqual(['VALIDACAO_SUCESSO']);
  });

  it('job com o tenant de outro escritório → UnrecoverableError(TENTATIVA_NAO_ENCONTRADA), sem ler o original', async () => {
    const erro = await processarValidacao(deps, { ...comando, tenantId: OUTRO_TENANT }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnrecoverableError);
    expect((erro as Error).message).toBe('TENTATIVA_NAO_ENCONTRADA');
    expect(ler).not.toHaveBeenCalled();
    expect(banco.estado).toBe('RECEBIDA');
  });
});

describe('registrarFalhaDaValidacao: tentativas esgotadas', () => {
  it('VALIDANDO → FALHA, um evento FALHA_TECNICA com o código estável e uma notificação; repetir não duplica', async () => {
    banco.estado = 'VALIDANDO';

    await expect(registrarFalhaDaValidacao(deps, comando, 'ARMAZENAMENTO_INDISPONIVEL')).resolves.toBe(true);
    await expect(registrarFalhaDaValidacao(deps, comando, 'ARMAZENAMENTO_INDISPONIVEL')).resolves.toBe(false);

    expect(banco.estado).toBe('FALHA');
    expect(eventos()).toEqual([
      expect.objectContaining({ acao: 'FALHA_TECNICA', estadoAnterior: 'VALIDANDO', estadoNovo: 'FALHA', codigo: 'ARMAZENAMENTO_INDISPONIVEL' }),
    ]);
    expect(banco.notificacoes).toBe(1);
  });

  it.each(['RECEBIDA', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO', 'REJEITADA'])('tentativa em %s não vira FALHA pelo worker', async (estado) => {
    banco.estado = estado;

    await expect(registrarFalhaDaValidacao(deps, comando, 'FALHA_NA_VALIDACAO')).resolves.toBe(false);
    expect(banco.estado).toBe(estado);
    expect(banco.eventos).toEqual([]);
  });

  it('sem tentativa identificável (payload inválido, outro tenant) não grava nada', async () => {
    banco.estado = 'VALIDANDO';

    await expect(registrarFalhaDaValidacao(deps, { lixo: true }, 'FALHA_NA_VALIDACAO')).resolves.toBe(false);
    await expect(registrarFalhaDaValidacao(deps, comando, 'PAYLOAD_INVALIDO')).resolves.toBe(false);
    await expect(registrarFalhaDaValidacao(deps, { ...comando, tenantId: OUTRO_TENANT }, 'FALHA_NA_VALIDACAO')).resolves.toBe(false);
    expect(banco.estado).toBe('VALIDANDO');
  });
});

describe('motivoDaFalhaDaValidacao: só código estável', () => {
  it('mensagem crua de exceção nunca vira motivo', () => {
    expect(motivoDaFalhaDaValidacao(new Error('SENHA-SENTINELA'))).toBe('FALHA_NA_VALIDACAO');
    expect(motivoDaFalhaDaValidacao(new UnrecoverableError('SENHA-SENTINELA'))).toBe('FALHA_NA_VALIDACAO');
    expect(motivoDaFalhaDaValidacao(new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'x'))).toBe('FALHA_NA_VALIDACAO');
  });

  it('códigos conhecidos passam: armazenamento e irrecuperáveis do worker', () => {
    expect(motivoDaFalhaDaValidacao(new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL'))).toBe('ARMAZENAMENTO_INDISPONIVEL');
    expect(motivoDaFalhaDaValidacao(new UnrecoverableError('ORIGINAL_NAO_ENCONTRADO'))).toBe('ORIGINAL_NAO_ENCONTRADO');
    expect(motivoDaFalhaDaValidacao(new UnrecoverableError('PAYLOAD_INVALIDO'))).toBe('PAYLOAD_INVALIDO');
  });
});

describe('mensagemPadraoDaRejeicao: texto acionável para cada código', () => {
  it.each([
    ['CAMPO_OBRIGATORIO_AUSENTE', 'conta_pai', 'Preencha a conta-pai: ela é obrigatória para conta que não é raiz.'],
    ['CAMPO_OBRIGATORIO_AUSENTE', 'codigo', 'Preencha o campo código: ele é obrigatório.'],
    ['CAMPO_OBRIGATORIO_AUSENTE', null, 'Preencha os campos obrigatórios da linha.'],
    ['VALOR_FORA_DO_DOMINIO', 'natureza', 'A natureza deve ser "devedora" ou "credora".'],
    ['VALOR_FORA_DO_DOMINIO', null, 'A linha tem um valor fora do permitido.'],
    ['CONTA_ARQUIVADA', null, 'A conta está arquivada e a importação não a altera; reative-a separadamente antes de importar.'],
  ] as const)('%s / %s', (codigo, campo, esperado) => {
    expect(mensagemPadraoDaRejeicao(codigo, campo)).toBe(esperado);
  });

  it('todo código de erro de linha tem mensagem não vazia', () => {
    const codigos = [
      'CAMPO_OBRIGATORIO_AUSENTE', 'VALOR_FORA_DO_DOMINIO', 'CODIGO_DUPLICADO_NO_ARQUIVO', 'CONTA_PAI_INEXISTENTE',
      'CONTA_PAI_REJEITADA', 'CICLO_HIERARQUICO', 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA', 'CONTA_ARQUIVADA',
    ] as const;

    for (const codigo of codigos) {
      expect(mensagemPadraoDaRejeicao(codigo, null).length).toBeGreaterThan(10);
    }
  });
});
