/**
 * Quem pode agir no cofre e quem pode ser responsável (SPEC-011 §3.2 e §3.5).
 *
 * A chave do catálogo (SPEC-008) é necessária, mas não basta: a mutação exige
 * também papel padrão `admin_escritorio` ou `contador`. Um papel personalizado
 * pode receber a chave e ainda assim nunca muta o cofre — a SPEC fixa os dois
 * papéis. Carteira e RLS continuam cumulativas e são conferidas fora daqui.
 */
import type { ChaveDePermissao } from '../papeis/catalogo.js';
import type { PapelPadrao } from '../usuarios/papeis.js';

export type AcaoDoCofre = 'CADASTRAR' | 'SUBSTITUIR' | 'TROCAR_RESPONSAVEL' | 'DESATIVAR';

export type SituacaoDoResponsavel = 'ATIVO' | 'INATIVO' | 'FORA_DA_CARTEIRA';

const PAPEIS_QUE_MUTAM: readonly PapelPadrao[] = ['admin_escritorio', 'contador'];

export const podeMutarCofre = (papeis: readonly PapelPadrao[]): boolean =>
  papeis.some((papel) => PAPEIS_QUE_MUTAM.includes(papel));

/**
 * Responsável: usuário ativo, com papel padrão que muta o cofre e a empresa na
 * carteira. Sem papel elegível conta como `INATIVO` (não pode mais responder).
 */
export const situacaoDoResponsavel = (
  responsavel: Readonly<{
    estado: string;
    papeis: readonly PapelPadrao[];
    vinculoAtivo: boolean;
  }>,
): SituacaoDoResponsavel => {
  if (responsavel.estado !== 'ATIVO' || !podeMutarCofre(responsavel.papeis)) {
    return 'INATIVO';
  }

  return responsavel.vinculoAtivo ? 'ATIVO' : 'FORA_DA_CARTEIRA';
};

export const ehResponsavelElegivel = (
  responsavel: Parameters<typeof situacaoDoResponsavel>[0],
): boolean => situacaoDoResponsavel(responsavel) === 'ATIVO';

const CHAVE_DA_ACAO: Readonly<Record<AcaoDoCofre, ChaveDePermissao>> = {
  CADASTRAR: 'certificados.cofre.criar',
  SUBSTITUIR: 'certificados.cofre.substituir',
  TROCAR_RESPONSAVEL: 'certificados.cofre.editar',
  DESATIVAR: 'certificados.cofre.desativar',
};

/**
 * O que o usuário pode fazer diante da empresa: ação coerente com o estado
 * (cadastrar só sem vigente; as demais só com vigente), chave do catálogo, papel
 * padrão que muta e empresa não arquivada.
 */
export const acoesDoCofre = (
  contexto: Readonly<{
    papeis: readonly PapelPadrao[];
    permissoes: readonly ChaveDePermissao[];
    temVigente: boolean;
    empresaArquivada: boolean;
  }>,
): readonly AcaoDoCofre[] => {
  if (contexto.empresaArquivada || !podeMutarCofre(contexto.papeis)) {
    return [];
  }

  const coerentes: readonly AcaoDoCofre[] = contexto.temVigente
    ? ['SUBSTITUIR', 'TROCAR_RESPONSAVEL', 'DESATIVAR']
    : ['CADASTRAR'];

  return coerentes.filter((acao) => contexto.permissoes.includes(CHAVE_DA_ACAO[acao]));
};
