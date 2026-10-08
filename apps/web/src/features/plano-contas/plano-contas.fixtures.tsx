/**
 * Dados e dublês de prova da aba "Plano de contas" (SPEC-013). Só os testes importam este arquivo.
 *
 * A navegação é dublada com estado de verdade: `replace` muda a URL e quem lê `useSearchParams`
 * renderiza de novo, como no App Router. Sem isso, um fluxo que abre a tentativa na URL não teria
 * como ser provado de ponta a ponta.
 */
import {
  PreviaDaImportacaoSchema,
  type ContaDoPlanoDeContas,
  type PreviaDaImportacao,
  type RejeicaoDaImportacao,
  type TentativaDoHistorico,
} from '@contaia/shared';
import { vi } from 'vitest';

import { json, problema, type Roteador } from '../carteira/carteira.fixtures';

export { Envolvido, instalarFetch, json, problema } from '../carteira/carteira.fixtures';
export type { Roteador } from '../carteira/carteira.fixtures';

export const EMPRESA = 'empresa-1';
export const TENTATIVA = '11111111-1111-4111-8111-111111111111';
export const OUTRA_TENTATIVA = '22222222-2222-4222-8222-222222222222';
export const BASE = `/api/proxy/empresas/${EMPRESA}/plano-contas`;

export const TODAS_AS_PERMISSOES = [
  'empresas.plano_contas.consultar',
  'empresas.plano_contas.importar',
  'empresas.plano_contas.confirmar_importacao',
  'empresas.plano_contas.baixar_relatorio',
] as const;

/** `auxiliar` e `auditor_readonly` (SPEC-013 §3.12): consultam e baixam, não importam nem confirmam. */
export const SO_CONSULTA = ['empresas.plano_contas.consultar', 'empresas.plano_contas.baixar_relatorio'] as const;

export const sessao = (permissoes: readonly string[]) => ({
  papeis: ['contador'],
  permissoes,
  escopoDeEmpresas: 'CARTEIRA',
});

/** URL dublada: um armazém que `useSyncExternalStore` observa. */
const criarNavegacao = () => {
  let parametros = new URLSearchParams();
  const ouvintes = new Set<() => void>();

  const ir = (destino: string): void => {
    const consulta = destino.includes('?') ? destino.slice(destino.indexOf('?') + 1) : '';
    parametros = new URLSearchParams(consulta);
    ouvintes.forEach((ouvinte) => ouvinte());
  };

  return {
    ler: (): URLSearchParams => parametros,
    assinar: (ouvinte: () => void): (() => void) => {
      ouvintes.add(ouvinte);

      return () => ouvintes.delete(ouvinte);
    },
    definir: (consulta: string): void => {
      parametros = new URLSearchParams(consulta);
      ouvintes.forEach((ouvinte) => ouvinte());
    },
    /** `replace` troca a entrada do histórico; `push` cria outra (o "voltar" a desfaz). */
    replace: vi.fn(ir),
    push: vi.fn(ir),
  };
};

export const navegacao = criarNavegacao();

export const rejeicao = (sobrescritas: Partial<RejeicaoDaImportacao> = {}): RejeicaoDaImportacao => ({
  numeroDaLinha: 4,
  codigo: '9.9',
  campo: 'conta_pai',
  codigoDeErro: 'CONTA_PAI_INEXISTENTE',
  mensagem: 'A conta-pai não existe no plano de contas nem entre as linhas válidas do arquivo.',
  ...sobrescritas,
});

export const previa = (sobrescritas: Partial<PreviaDaImportacao> = {}): PreviaDaImportacao => ({
  tentativaId: TENTATIVA,
  estado: 'AGUARDANDO_CONFIRMACAO',
  arquivo: { nome: 'plano-legado.csv', tamanho: 2048, hash: 'a'.repeat(64) },
  mapeamento: { codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' },
  totais: { lidas: 6, novas: 4, atualizadas: 2, rejeitadas: 0 },
  amostraRejeicoes: [],
  criadoEm: '2026-10-08T12:30:00.000Z',
  finalizadoEm: null,
  correlationId: 'corr-tentativa-001',
  versaoDaPrevia: 3,
  reutilizadaPorIdempotencia: false,
  podeConfirmar: true,
  podeCancelar: true,
  relatorioDisponivel: true,
  diagnostico: null,
  ...sobrescritas,
});

/** Prévia com aceitação parcial: duas linhas rejeitadas de seis. */
export const previaParcial = (sobrescritas: Partial<PreviaDaImportacao> = {}): PreviaDaImportacao =>
  previa({
    totais: { lidas: 6, novas: 3, atualizadas: 1, rejeitadas: 2 },
    amostraRejeicoes: [
      rejeicao(),
      rejeicao({
        numeroDaLinha: 6,
        codigo: '1.1',
        campo: null,
        codigoDeErro: 'CODIGO_DUPLICADO_NO_ARQUIVO',
        mensagem: null,
      }),
    ],
    ...sobrescritas,
  });

export const tentativaDoHistorico = (
  sobrescritas: Partial<TentativaDoHistorico> = {},
): TentativaDoHistorico => ({
  id: TENTATIVA,
  arquivo: { nome: 'plano-legado.csv', tamanho: 2048, hash: 'a'.repeat(64) },
  mapeamento: { codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' },
  usuarioIniciador: { id: '33333333-3333-4333-8333-333333333333', nome: 'Ana Lima' },
  usuarioConfirmadorOuCancelador: null,
  estado: 'CONCLUIDA',
  totais: { lidas: 6, novas: 4, atualizadas: 2, rejeitadas: 0 },
  inicioEm: '2026-10-07T15:00:00.000Z',
  fimEm: '2026-10-07T15:02:00.000Z',
  correlationId: 'corr-historico-001',
  reutilizadaPorIdempotencia: false,
  ...sobrescritas,
});

export const conta = (sobrescritas: Partial<ContaDoPlanoDeContas> = {}): ContaDoPlanoDeContas => ({
  id: '44444444-4444-4444-8444-444444444444',
  codigo: '1',
  nome: 'Ativo',
  tipo: 'sintetica',
  natureza: 'devedora',
  contaPai: null,
  arquivada: false,
  atualizadoEm: '2026-10-07T15:02:00.000Z',
  ...sobrescritas,
});

export const paginaDoHistorico = (itens: readonly TentativaDoHistorico[], total = itens.length, pagina = 1) => ({
  pagina,
  itensPorPagina: 15,
  total,
  itens,
});

export const paginaDeContas = (itens: readonly ContaDoPlanoDeContas[], total = itens.length, pagina = 1) => ({
  pagina,
  itensPorPagina: 50,
  total,
  itens,
});

const utf8 = (texto: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(texto));

/** O modelo do ContaIA, como o Excel pt-BR o grava: BOM, `;` e CRLF. */
export const csvDoModelo = (nome = 'plano-legado.csv'): File =>
  new File(
    [utf8('﻿codigo;nome;tipo;natureza;conta_pai\r\n1;Ativo;sintetica;devedora;\r\n1.1;Caixa;analitica;devedora;1\r\n')],
    nome,
    { type: 'application/vnd.ms-excel' },
  );

/** Arquivo legado com colunas de outros nomes: só Tipo e Natureza casam com o modelo. */
export const csvLegado = (): File =>
  new File([utf8('Cod;Descricao;Tipo;Natureza;Pai\n1;Ativo;sintetica;devedora;\n')], 'legado.csv', {
    type: 'text/csv',
  });

/** Corpo de um `FormData` enviado no `fetch` dublado. */
export const corpoEnviado = (init: RequestInit | undefined): FormData | null =>
  init?.body instanceof FormData ? init.body : null;

const LINHA_DO_RELATORIO = 'linha;codigo';

type Responder = (init?: RequestInit) => Response | Promise<Response>;

/**
 * API dublada com estado: cada teste ajusta só o que prova. A tentativa lida em `GET` é a que o
 * último comando (envio, confirmação, cancelamento) deixou, como no servidor.
 */
type EstadoDoBackend = {
  permissoes: string[];
  tentativa: PreviaDaImportacao | null;
  lerTentativa: Responder | null;
  historico: TentativaDoHistorico[];
  lerHistorico: Responder | null;
  contas: ContaDoPlanoDeContas[];
  enviar: Responder;
  confirmar: Responder;
  cancelar: Responder;
  rejeicoes: Responder;
  baixar: Responder;
};

export const criarBackend = () => {
  const estado: EstadoDoBackend = {
    permissoes: [...TODAS_AS_PERMISSOES],
    tentativa: null,
    lerTentativa: null,
    historico: [],
    lerHistorico: null,
    contas: [],
    enviar: () => json(previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null }), 202),
    confirmar: () => json(previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' })),
    cancelar: () => json(previa({ estado: 'CANCELADA', finalizadoEm: '2026-10-08T12:35:00.000Z' })),
    rejeicoes: () => json({ pagina: 2, itensPorPagina: 20, total: 21, itens: [rejeicao({ numeroDaLinha: 99 })] }),
    baixar: () =>
      new Response(LINHA_DO_RELATORIO, {
        status: 200,
        headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="relatorio-plano.csv"' },
      }),
  };

  /** O comando devolve a tentativa e ela passa a ser a lida em `GET`. */
  const comando = async (responder: Responder, init?: RequestInit): Promise<Response> => {
    const resposta = await responder(init);

    if (resposta.ok) {
      estado.tentativa = PreviaDaImportacaoSchema.parse(await resposta.clone().json());
    }

    return resposta;
  };

  const roteador: Roteador = (url, init) => {
    const metodo = init?.method ?? 'GET';

    if (url.endsWith('/api/proxy/usuarios/eu')) {
      return json(sessao(estado.permissoes));
    }
    if (!url.startsWith(BASE)) {
      return undefined;
    }

    const caminho = url.slice(BASE.length);

    if (caminho.startsWith('/importacoes?')) {
      return estado.lerHistorico?.(init) ?? json(paginaDoHistorico(estado.historico));
    }
    if (caminho.startsWith('/contas?')) {
      return json(paginaDeContas(estado.contas));
    }
    if (metodo === 'POST' && caminho === '/importacoes') {
      return comando(estado.enviar, init);
    }
    if (metodo === 'POST' && caminho.endsWith('/confirmar')) {
      return comando(estado.confirmar, init);
    }
    if (metodo === 'POST' && caminho.endsWith('/cancelar')) {
      return comando(estado.cancelar, init);
    }
    if (caminho.includes('/rejeicoes?')) {
      return estado.rejeicoes(init);
    }
    if (/\/(relatorio|arquivo|modelo)$/u.test(caminho)) {
      return estado.baixar(init);
    }
    if (caminho.startsWith('/importacoes/')) {
      if (estado.lerTentativa !== null) {
        return estado.lerTentativa(init);
      }

      return estado.tentativa === null ? problema(404, 'TENTATIVA_NAO_ENCONTRADA') : json(estado.tentativa);
    }

    return undefined;
  };

  return { estado, roteador };
};

/**
 * `URL.createObjectURL` não existe no jsdom: o download real termina num clique de âncora, que
 * aqui não navega. `desinstalarDownloads` devolve o jsdom ao estado original (chamar no `afterEach`).
 */
export const instalarDownloads = () => {
  const criar = vi.fn(() => 'blob:relatorio');
  const revogar = vi.fn();

  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: criar });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revogar });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

  return { criar, revogar };
};

export const desinstalarDownloads = (): void => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.restoreAllMocks();
};
