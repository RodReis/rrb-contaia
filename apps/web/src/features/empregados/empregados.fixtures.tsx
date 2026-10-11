/**
 * Dados e dublês de prova da aba "Empregados" (SPEC-014). Só os testes importam este arquivo.
 * A URL dublada, o `fetch` e os downloads são os mesmos da F13.
 */
import {
  PreviaDaImportacaoDeEmpregadosSchema,
  type EmpregadoDaBase,
  type PreviaDaImportacaoDeEmpregados,
  type RejeicaoDeEmpregado,
  type TentativaDoHistorico,
} from '@contaia/shared';

import { json, problema, type Roteador } from '../carteira/carteira.fixtures';

export {
  Envolvido,
  desinstalarDownloads,
  instalarDownloads,
  instalarFetch,
  json,
  navegacao,
  problema,
} from '../plano-contas/plano-contas.fixtures';
export type { Roteador } from '../carteira/carteira.fixtures';

export const EMPRESA = 'empresa-1';
export const TENTATIVA = '55555555-5555-4555-8555-555555555555';
export const BASE = `/api/proxy/empresas/${EMPRESA}/empregados`;

export const TODAS_AS_PERMISSOES = [
  'empresas.empregados.consultar',
  'empresas.empregados.importar',
  'empresas.empregados.confirmar_importacao',
  'empresas.empregados.baixar_relatorio',
] as const;

/** `contador` e `auditor_readonly` (SPEC-014 §3.12): consultam e baixam, não importam nem confirmam. */
export const SO_CONSULTA = ['empresas.empregados.consultar', 'empresas.empregados.baixar_relatorio'] as const;

export const sessao = (permissoes: readonly string[]) => ({
  papeis: ['contador'],
  permissoes,
  escopoDeEmpresas: 'CARTEIRA',
});

const MAPEAMENTO = {
  cpf: 'cpf',
  nome: 'nome',
  matricula: 'matricula',
  data_nascimento: 'data_nascimento',
  data_admissao: 'data_admissao',
};

export const rejeicao = (sobrescritas: Partial<RejeicaoDeEmpregado> = {}): RejeicaoDeEmpregado => ({
  numeroDaLinha: 4,
  cpf: '529.982.247-25',
  matricula: '00123',
  campo: 'matricula',
  codigoDeErro: 'CHAVE_DUPLICADA_NO_ARQUIVO',
  mensagem: null,
  ...sobrescritas,
});

export const previa = (
  sobrescritas: Partial<PreviaDaImportacaoDeEmpregados> = {},
): PreviaDaImportacaoDeEmpregados => ({
  tentativaId: TENTATIVA,
  estado: 'AGUARDANDO_CONFIRMACAO',
  arquivo: { nome: 'empregados-legado.csv', tamanho: 2048, hash: 'b'.repeat(64) },
  mapeamento: MAPEAMENTO,
  totais: { lidas: 6, novas: 4, atualizadas: 2, rejeitadas: 0 },
  amostraRejeicoes: [],
  criadoEm: '2026-10-08T12:30:00.000Z',
  finalizadoEm: null,
  correlationId: 'corr-empregados-001',
  versaoDaPrevia: 3,
  reutilizadaPorIdempotencia: false,
  podeConfirmar: true,
  podeCancelar: true,
  relatorioDisponivel: true,
  diagnostico: null,
  ...sobrescritas,
});

/** Aceitação parcial: duas linhas rejeitadas de seis (duplicata de chave e CPF inválido). */
export const previaParcial = (
  sobrescritas: Partial<PreviaDaImportacaoDeEmpregados> = {},
): PreviaDaImportacaoDeEmpregados =>
  previa({
    totais: { lidas: 6, novas: 3, atualizadas: 1, rejeitadas: 2 },
    amostraRejeicoes: [
      rejeicao(),
      rejeicao({
        numeroDaLinha: 6,
        cpf: '123.456.789-00',
        matricula: '77',
        campo: 'cpf',
        codigoDeErro: 'CPF_INVALIDO',
        mensagem: 'CPF com dígito verificador inválido.',
      }),
    ],
    ...sobrescritas,
  });

export const tentativaDoHistorico = (sobrescritas: Partial<TentativaDoHistorico> = {}): TentativaDoHistorico => ({
  id: TENTATIVA,
  arquivo: { nome: 'empregados-legado.csv', tamanho: 2048, hash: 'b'.repeat(64) },
  mapeamento: MAPEAMENTO,
  usuarioIniciador: { id: '33333333-3333-4333-8333-333333333333', nome: 'Ana Lima' },
  usuarioConfirmadorOuCancelador: null,
  estado: 'CONCLUIDA',
  totais: { lidas: 6, novas: 4, atualizadas: 2, rejeitadas: 0 },
  inicioEm: '2026-10-07T15:00:00.000Z',
  fimEm: '2026-10-07T15:02:00.000Z',
  correlationId: 'corr-historico-emp',
  reutilizadaPorIdempotencia: false,
  ...sobrescritas,
});

export const empregado = (sobrescritas: Partial<EmpregadoDaBase> = {}): EmpregadoDaBase => ({
  id: '66666666-6666-4666-8666-666666666666',
  cpf: '52998224725',
  nome: 'Ana Beatriz Lima',
  matricula: '00123',
  dataNascimento: '1990-02-14',
  dataAdmissao: '2015-03-02',
  arquivado: false,
  ...sobrescritas,
});

const utf8 = (texto: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(texto));

/** O modelo do ContaIA como o Excel pt-BR grava: BOM, `;` e CRLF. */
export const csvDoModelo = (nome = 'empregados-legado.csv'): File =>
  new File(
    [
      utf8(
        '﻿cpf;nome;matricula;data_nascimento;data_admissao\r\n529.982.247-25;Ana Beatriz Lima;00123;14/02/1990;02/03/2015\r\n',
      ),
    ],
    nome,
    { type: 'application/vnd.ms-excel' },
  );

/** Arquivo legado com colunas de outros nomes: só "Matrícula" casa com o modelo (acento e caixa à parte). */
export const csvLegado = (): File =>
  new File(
    [utf8('CPF do funcionário;Nome;Matrícula;Nascimento;Admissão\n52998224725;Ana;00123;1990-02-14;2015-03-02\n')],
    'folha-legada.csv',
    { type: 'text/csv' },
  );

type Responder = (init?: RequestInit) => Response | Promise<Response>;

type EstadoDoBackend = {
  permissoes: string[];
  tentativa: PreviaDaImportacaoDeEmpregados | null;
  lerTentativa: Responder | null;
  historico: TentativaDoHistorico[];
  lerHistorico: Responder | null;
  empregados: EmpregadoDaBase[];
  totalDeEmpregados: number | null;
  lerBase: ((url: string) => Response | Promise<Response>) | null;
  enviar: Responder;
  confirmar: Responder;
  cancelar: Responder;
  rejeicoes: Responder;
  baixar: Responder;
};

/** API dublada com estado, como a da F13: a tentativa lida em `GET` é a que o último comando deixou. */
export const criarBackend = () => {
  const estado: EstadoDoBackend = {
    permissoes: [...TODAS_AS_PERMISSOES],
    tentativa: null,
    lerTentativa: null,
    historico: [],
    lerHistorico: null,
    empregados: [],
    totalDeEmpregados: null,
    lerBase: null,
    enviar: () => json(previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null }), 202),
    confirmar: () => json(previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' })),
    cancelar: () => json(previa({ estado: 'CANCELADA', finalizadoEm: '2026-10-08T12:35:00.000Z' })),
    rejeicoes: () => json({ pagina: 2, itensPorPagina: 20, total: 21, itens: [rejeicao({ numeroDaLinha: 99 })] }),
    baixar: () =>
      new Response('linha;cpf', {
        status: 200,
        headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="relatorio-empregados.csv"' },
      }),
  };

  const comando = async (responder: Responder, init?: RequestInit): Promise<Response> => {
    const resposta = await responder(init);

    if (resposta.ok) {
      estado.tentativa = PreviaDaImportacaoDeEmpregadosSchema.parse(await resposta.clone().json());
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

    if (caminho.startsWith('?')) {
      if (estado.lerBase !== null) {
        return estado.lerBase(url);
      }
      const pagina = Number(new URLSearchParams(caminho.slice(1)).get('pagina') ?? '1');

      return json({
        pagina,
        itensPorPagina: 50,
        total: estado.totalDeEmpregados ?? estado.empregados.length,
        itens: estado.empregados,
      });
    }
    if (caminho.startsWith('/importacoes?')) {
      return estado.lerHistorico?.(init) ?? json({ pagina: 1, itensPorPagina: 15, total: estado.historico.length, itens: estado.historico });
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
