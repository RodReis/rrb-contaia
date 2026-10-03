/**
 * Dados de prova para as telas de papéis e permissões. Montados a partir do
 * domínio — a mesma fonte que a API usa para servir o catálogo —, para que o
 * dublê de `fetch` dos testes de tela diga exatamente o que o servidor diria.
 * Não entra no bundle: só os testes o importam.
 */
import {
  AREA_EXCLUSIVA,
  CATALOGO,
  PAPEIS_PADRAO,
  ROTULO_DA_ACAO,
  permissoesDoPapelPadrao,
  permissoesDosPapeisPadrao,
} from '@contaia/domain';
import type { ChaveDePermissao, PapelPadrao } from '@contaia/domain';

import type { Sessao } from '../usuarios/api';
import type { CatalogoDePermissoes, DetalheDePapel, ModuloNoCatalogo, VisaoDePapel } from './api';

type ModuloDoDominio = Readonly<{
  id: string;
  rotulo: string;
  funcionalidades: ReadonlyArray<
    Readonly<{ id: string; rotulo: string; acoes: readonly (keyof typeof ROTULO_DA_ACAO)[] }>
  >;
}>;

const paraModulo = (modulo: ModuloDoDominio): ModuloNoCatalogo => ({
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

export const catalogoDeTeste = (): CatalogoDePermissoes => ({
  modulos: CATALOGO.map(paraModulo),
  areaExclusiva: paraModulo(AREA_EXCLUSIVA),
  papeisPadrao: PAPEIS_PADRAO.map((papel) => ({
    papel,
    permissoes: permissoesDoPapelPadrao(papel),
  })),
});

export const sessaoDe = (
  papeis: readonly PapelPadrao[],
  permissoesExtras: readonly ChaveDePermissao[] = [],
): Sessao => ({
  papeis,
  permissoes: [...permissoesDosPapeisPadrao(papeis), ...permissoesExtras],
  escopoDeEmpresas: papeis.includes('admin_escritorio') ? 'TODAS' : 'NENHUMA',
});

export const papelDeTeste = (
  sobrescritas: Partial<VisaoDePapel> & Pick<VisaoDePapel, 'id' | 'nome'>,
): VisaoDePapel => ({
  descricao: null,
  papelBase: 'auxiliar',
  estado: 'ATIVO',
  revisao: 1,
  permissoes: ['empresas.cadastro.consultar'],
  incompatibilidades: [],
  usuariosVinculados: 0,
  criadoEm: '2026-10-01T12:00:00.000Z',
  atualizadoEm: '2026-10-02T15:30:00.000Z',
  ...sobrescritas,
});

export const detalheDeTeste = (
  sobrescritas: Partial<DetalheDePapel> & Pick<DetalheDePapel, 'id' | 'nome'>,
): DetalheDePapel => ({
  ...papelDeTeste(sobrescritas),
  usuarios: [],
  ...sobrescritas,
});
