/**
 * Regras da matriz de permissões de um papel personalizado (SPEC-008 §3.3).
 *
 * A matriz é um conjunto de chaves do catálogo. Funções puras e imutáveis: o
 * servidor valida com `normalizarMatriz` e a interface edita com as mesmas
 * funções, então as duas leem a mesma regra.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import {
  CHAVES_DO_CATALOGO,
  chavesDoModulo,
  consultaImplicada,
  dependentesDeConsulta,
  ehChaveDoCatalogo,
  ehChaveExclusiva,
  moduloDa,
  type ChaveDePermissao,
  type ChaveDoCatalogo,
} from './catalogo.js';

const ORDEM: ReadonlyMap<string, number> = new Map(
  CHAVES_DO_CATALOGO.map((chave, indice) => [chave, indice]),
);

const emOrdemDoCatalogo = (chaves: Iterable<ChaveDoCatalogo>): readonly ChaveDoCatalogo[] =>
  [...new Set(chaves)].sort((a, b) => (ORDEM.get(a) ?? 0) - (ORDEM.get(b) ?? 0));

/** Acrescenta o `Consultar` implícito de cada ação e ordena pelo catálogo. */
const comConsultasImplicadas = (chaves: readonly ChaveDoCatalogo[]): readonly ChaveDoCatalogo[] =>
  emOrdemDoCatalogo(
    chaves.flatMap((chave) => {
      const consulta = consultaImplicada(chave);

      return consulta === null ? [chave] : [chave, consulta as ChaveDoCatalogo];
    }),
  );

/**
 * Valida a entrada do servidor. Chave livre ou obsoleta é `422`; área exclusiva
 * é `403` e nada é concedido; matriz vazia não cria nem atualiza papel.
 */
export const normalizarMatriz = (entrada: unknown): readonly ChaveDoCatalogo[] => {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.MATRIZ_INVALIDA,
      'A matriz precisa conter ao menos uma permissão.',
    );
  }

  const valores: readonly unknown[] = entrada;

  if (valores.some(ehChaveExclusiva)) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.PERMISSAO_EXCLUSIVA,
      'A área de usuários e papéis é exclusiva do administrador do escritório.',
    );
  }

  const invalidas = valores.filter((valor) => !ehChaveDoCatalogo(valor));

  if (invalidas.length > 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.PERMISSAO_INEXISTENTE,
      'A matriz contém permissão que não existe no catálogo.',
    );
  }

  return comConsultasImplicadas(valores.filter(ehChaveDoCatalogo));
};

export type DiferencaDeMatriz = Readonly<{
  adicionadas: readonly ChaveDoCatalogo[];
  retiradas: readonly ChaveDoCatalogo[];
}>;

export const diferencaDeMatriz = (
  antes: readonly ChaveDoCatalogo[],
  depois: readonly ChaveDoCatalogo[],
): DiferencaDeMatriz => {
  const anteriores = new Set(antes);
  const posteriores = new Set(depois);

  return {
    adicionadas: emOrdemDoCatalogo(depois.filter((chave) => !anteriores.has(chave))),
    retiradas: emOrdemDoCatalogo(antes.filter((chave) => !posteriores.has(chave))),
  };
};

export const ehReducao = (diferenca: DiferencaDeMatriz): boolean => diferenca.retiradas.length > 0;

/** Conceder ação dependente concede `Consultar` da funcionalidade. */
export const concederPermissao = (
  matriz: readonly ChaveDoCatalogo[],
  chave: ChaveDoCatalogo,
): readonly ChaveDoCatalogo[] => comConsultasImplicadas([...matriz, chave]);

/** Retirar `Consultar` revoga as ações dependentes da mesma funcionalidade. */
export const revogarPermissao = (
  matriz: readonly ChaveDoCatalogo[],
  chave: ChaveDoCatalogo,
): readonly ChaveDoCatalogo[] => {
  const retiradas = new Set<ChaveDePermissao>([chave, ...dependentesDeConsulta(chave)]);

  return matriz.filter((existente) => !retiradas.has(existente));
};

/** Módulo visível = alguma funcionalidade do módulo com `Consultar`. */
export const moduloVisivel = (matriz: readonly ChaveDoCatalogo[], moduloId: string): boolean =>
  matriz.some((chave) => moduloDa(chave) === moduloId && chave.endsWith('.consultar'));

export type ResultadoDeOcultacao = Readonly<{
  matriz: readonly ChaveDoCatalogo[];
  removidas: number;
}>;

/** Ocultar o módulo revoga toda a subárvore; `removidas` alimenta a confirmação. */
export const ocultarModulo = (
  matriz: readonly ChaveDoCatalogo[],
  moduloId: string,
): ResultadoDeOcultacao => {
  const doModulo = new Set<ChaveDePermissao>(chavesDoModulo(moduloId));
  const restante = matriz.filter((chave) => !doModulo.has(chave));

  return { matriz: restante, removidas: matriz.length - restante.length };
};

export type MatrizParaRevisao = Readonly<{
  /** Permissões salvas que ainda existem no catálogo vigente. */
  vigentes: readonly ChaveDoCatalogo[];
  /** Permissões salvas que deixaram de existir: não são restauradas. */
  incompativeis: readonly string[];
}>;

/** Reativação: separa o que o catálogo vigente ainda aceita do que ficou obsoleto (§3.5). */
export const matrizParaRevisao = (salva: readonly string[]): MatrizParaRevisao => ({
  vigentes: comConsultasImplicadas(salva.filter(ehChaveDoCatalogo)),
  incompativeis: salva.filter((chave) => !ehChaveDoCatalogo(chave)),
});
