/**
 * Permissão efetiva de uma identidade (SPEC-008 §3.4): união aditiva dos papéis
 * padrão e dos personalizados. Chave obsoleta no snapshot de um papel não concede
 * nada — só o catálogo vigente vale. Compartilhada pela sessão e por quem age em
 * nome de um usuário sem sessão (ticket de ingestão do cofre).
 */
import type { IdentidadeResolvida } from '@contaia/db';
import {
  ehChaveDoCatalogo,
  permissoesDosPapeisPadrao,
  uniaoDePermissoes,
  type ChaveDePermissao,
} from '@contaia/domain';

export const permissoesEfetivas = (
  identidade: Pick<IdentidadeResolvida, 'papeis' | 'permissoesPersonalizadas'>,
): readonly ChaveDePermissao[] =>
  uniaoDePermissoes(
    permissoesDosPapeisPadrao(identidade.papeis),
    identidade.permissoesPersonalizadas.filter(ehChaveDoCatalogo),
  );
