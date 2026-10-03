/**
 * Textos da área de papéis (SPEC-008 §5). Módulo, funcionalidade e ação vêm do
 * catálogo do servidor; aqui só se monta o que a tela mostra a partir dele.
 */
import type { ChaveDePermissao } from '@contaia/domain';

import type { TomDoStatus } from '@/components/ui/status-badge';
import type { CatalogoDePermissoes, ModuloNoCatalogo } from './api';

export const ESTADO_DO_PAPEL: Readonly<
  Record<'ATIVO' | 'ARQUIVADO', { rotulo: string; tom: TomDoStatus }>
> = {
  ATIVO: { rotulo: 'Ativo', tom: 'conforme' },
  ARQUIVADO: { rotulo: 'Arquivado', tom: 'neutro' },
};

const todosOsModulos = (catalogo: CatalogoDePermissoes): readonly ModuloNoCatalogo[] => [
  ...catalogo.modulos,
  catalogo.areaExclusiva,
];

/** "Documentos da empresa › Arquivos e versões › Baixar". Chave desconhecida volta como veio. */
export const rotuloDaChave = (catalogo: CatalogoDePermissoes, chave: string): string => {
  for (const modulo of todosOsModulos(catalogo)) {
    for (const funcionalidade of modulo.funcionalidades) {
      const acao = funcionalidade.acoes.find((candidata) => candidata.chave === chave);

      if (acao !== undefined) {
        return `${modulo.rotulo} › ${funcionalidade.rotulo} › ${acao.rotulo}`;
      }
    }
  }

  return chave;
};

export type ResumoDeModulo = Readonly<{
  id: string;
  rotulo: string;
  funcionalidades: ReadonlyArray<Readonly<{ rotulo: string; acoes: readonly string[] }>>;
}>;

/**
 * Só o que a matriz concede, por módulo e funcionalidade, com os nomes por
 * extenso. Módulo sem nenhuma permissão não aparece: está oculto para o papel.
 */
export const resumirMatriz = (
  catalogo: CatalogoDePermissoes,
  permissoes: readonly ChaveDePermissao[],
): readonly ResumoDeModulo[] =>
  todosOsModulos(catalogo).flatMap((modulo) => {
    const funcionalidades = modulo.funcionalidades.flatMap((funcionalidade) => {
      const acoes = funcionalidade.acoes
        .filter((acao) => permissoes.includes(acao.chave))
        .map((acao) => acao.rotulo);

      return acoes.length === 0 ? [] : [{ rotulo: funcionalidade.rotulo, acoes }];
    });

    return funcionalidades.length === 0
      ? []
      : [{ id: modulo.id, rotulo: modulo.rotulo, funcionalidades }];
  });

export const contarPermissoesDoModulo = (
  modulo: ModuloNoCatalogo,
  permissoes: readonly ChaveDePermissao[],
): Readonly<{ marcadas: number; total: number }> => {
  const chaves = modulo.funcionalidades.flatMap((funcionalidade) =>
    funcionalidade.acoes.map((acao) => acao.chave),
  );

  return {
    marcadas: chaves.filter((chave) => permissoes.includes(chave)).length,
    total: chaves.length,
  };
};

/** Data e hora em `America/Sao_Paulo` (I-11). */
export const formatarInstante = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

export const textoDeUsuarios = (quantidade: number): string =>
  quantidade === 1 ? '1 usuário' : `${quantidade.toLocaleString('pt-BR')} usuários`;
