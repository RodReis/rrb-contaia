/** Chamadas ao backend de papéis personalizados e do catálogo de permissões (SPEC-008). */
import type {
  AcaoDoCatalogo,
  ChaveDePermissao,
  ChaveDoCatalogo,
  EstadoDoPapel,
  PapelPadrao,
} from '@contaia/domain';

import { requisitar } from '@/lib/http';

export type AcaoNoCatalogo = Readonly<{
  id: AcaoDoCatalogo;
  rotulo: string;
  chave: ChaveDePermissao;
}>;

export type FuncionalidadeNoCatalogo = Readonly<{
  id: string;
  rotulo: string;
  acoes: readonly AcaoNoCatalogo[];
}>;

export type ModuloNoCatalogo = Readonly<{
  id: string;
  rotulo: string;
  funcionalidades: readonly FuncionalidadeNoCatalogo[];
}>;

/** O que o servidor aplica, lido dele: a interface nunca mantém cópia do catálogo. */
export type CatalogoDePermissoes = Readonly<{
  modulos: readonly ModuloNoCatalogo[];
  areaExclusiva: ModuloNoCatalogo;
  papeisPadrao: ReadonlyArray<
    Readonly<{ papel: PapelPadrao; permissoes: readonly ChaveDePermissao[] }>
  >;
}>;

export type VisaoDePapel = Readonly<{
  id: string;
  nome: string;
  descricao: string | null;
  papelBase: PapelPadrao;
  estado: EstadoDoPapel;
  revisao: number;
  permissoes: readonly ChaveDoCatalogo[];
  /** Permissões preservadas que deixaram de existir no catálogo vigente. */
  incompatibilidades: readonly string[];
  usuariosVinculados: number;
  criadoEm: string;
  atualizadoEm: string;
}>;

export type UsuarioVinculado = Readonly<{ id: string; nome: string }>;

export type DetalheDePapel = VisaoDePapel & Readonly<{ usuarios: readonly UsuarioVinculado[] }>;

export type PaginaDePapeis = Readonly<{ papeis: readonly VisaoDePapel[]; total: number }>;

export type FiltroDePapeis = Readonly<{
  busca: string | null;
  estado: EstadoDoPapel | null;
  limite: number;
  deslocamento: number;
}>;

export type DadosDeNovoPapel = Readonly<{
  nome: string;
  descricao: string | null;
  papelBase: PapelPadrao;
  permissoes: readonly ChaveDoCatalogo[];
}>;

export type DadosDeEdicaoDePapel = Readonly<{
  nome: string;
  descricao: string | null;
  permissoes: readonly ChaveDoCatalogo[];
  revisaoEsperada: number;
  confirmaReducao: boolean;
}>;

export type DadosDeReativacao = Readonly<{
  revisaoEsperada: number;
  permissoes: readonly ChaveDoCatalogo[];
  confirmaIncompatibilidades: boolean;
}>;

const comJson = (corpo: unknown, method: 'PUT' | 'POST' = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

const consulta = (parametros: Readonly<Record<string, string | number | null>>): string => {
  const busca = new URLSearchParams();

  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== '') {
      busca.set(chave, String(valor));
    }
  }

  return busca.toString();
};

export const obterCatalogo = (): Promise<CatalogoDePermissoes> => requisitar('/papeis/catalogo');

export const listarPapeis = (filtro: FiltroDePapeis): Promise<PaginaDePapeis> =>
  requisitar(
    `/papeis?${consulta({
      busca: filtro.busca,
      estado: filtro.estado,
      limite: filtro.limite,
      deslocamento: filtro.deslocamento,
    })}`,
  );

export const obterPapel = (papelId: string): Promise<DetalheDePapel> =>
  requisitar(`/papeis/${papelId}`);

export const criarPapel = (dados: DadosDeNovoPapel): Promise<DetalheDePapel> =>
  requisitar('/papeis', comJson(dados));

export const editarPapel = (
  papelId: string,
  dados: DadosDeEdicaoDePapel,
): Promise<DetalheDePapel> => requisitar(`/papeis/${papelId}`, comJson(dados, 'PUT'));

export const arquivarPapel = (papelId: string, revisaoEsperada: number): Promise<DetalheDePapel> =>
  requisitar(`/papeis/${papelId}/arquivar`, comJson({ revisaoEsperada }));

export const reativarPapel = (
  papelId: string,
  dados: DadosDeReativacao,
): Promise<DetalheDePapel> => requisitar(`/papeis/${papelId}/reativar`, comJson(dados));
