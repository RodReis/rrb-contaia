/**
 * Visão de leitura do catálogo (SPEC-008 §3.2, §5.1): a interface monta o editor
 * e a seção "Papéis padrão" a partir daqui, em vez de reimplementar o catálogo
 * ou as matrizes dos papéis.
 */
import {
  AREA_EXCLUSIVA,
  CATALOGO,
  PAPEIS_PADRAO,
  ROTULO_DA_ACAO,
  permissoesDoPapelPadrao,
  type AcaoDoCatalogo,
  type ChaveDePermissao,
  type PapelPadrao,
} from '@contaia/domain';

type ModuloDef = Readonly<{
  id: string;
  rotulo: string;
  funcionalidades: ReadonlyArray<
    Readonly<{ id: string; rotulo: string; acoes: readonly AcaoDoCatalogo[] }>
  >;
}>;

export type AcaoNoCatalogo = Readonly<{ id: AcaoDoCatalogo; rotulo: string; chave: ChaveDePermissao }>;

export type ModuloNoCatalogo = Readonly<{
  id: string;
  rotulo: string;
  funcionalidades: ReadonlyArray<
    Readonly<{ id: string; rotulo: string; acoes: readonly AcaoNoCatalogo[] }>
  >;
}>;

export type CatalogoDePermissoes = Readonly<{
  modulos: readonly ModuloNoCatalogo[];
  /** Visível e bloqueada no editor: só o papel padrão `admin_escritorio` a exerce. */
  areaExclusiva: ModuloNoCatalogo;
  papeisPadrao: ReadonlyArray<
    Readonly<{ papel: PapelPadrao; permissoes: readonly ChaveDePermissao[] }>
  >;
}>;

const paraModulo = (modulo: ModuloDef): ModuloNoCatalogo => ({
  id: modulo.id,
  rotulo: modulo.rotulo,
  funcionalidades: modulo.funcionalidades.map((funcionalidade) => ({
    id: funcionalidade.id,
    rotulo: funcionalidade.rotulo,
    acoes: funcionalidade.acoes.map((acao) => ({
      id: acao,
      rotulo: ROTULO_DA_ACAO[acao],
      chave: `${modulo.id}.${funcionalidade.id}.${acao}` as ChaveDePermissao,
    })),
  })),
});

export const catalogoDePermissoes = (): CatalogoDePermissoes => ({
  modulos: CATALOGO.map(paraModulo),
  areaExclusiva: paraModulo(AREA_EXCLUSIVA),
  papeisPadrao: PAPEIS_PADRAO.map((papel) => ({
    papel,
    permissoes: permissoesDoPapelPadrao(papel),
  })),
});
