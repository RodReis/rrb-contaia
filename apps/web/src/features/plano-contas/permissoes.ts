/**
 * Permissões de `Empresas → Plano de contas` no catálogo (SPEC-013 §3.12). A tela decide o que
 * oferecer a partir daqui; quem nega é sempre a API, em cada rota.
 */
import type { Sessao } from '../usuarios/api';
import { concede } from '../cofre/permissoes';

export { concede };

export const CONSULTA_DO_PLANO = 'empresas.plano_contas.consultar';
export const IMPORTACAO_DO_PLANO = 'empresas.plano_contas.importar';
export const CONFIRMACAO_DA_IMPORTACAO = 'empresas.plano_contas.confirmar_importacao';
export const DOWNLOAD_DO_RELATORIO = 'empresas.plano_contas.baixar_relatorio';

/** O que a pessoa pode fazer na aba. Empresa arquivada é só consulta (SPEC-003). */
export type PermissoesDoPlano = Readonly<{
  importar: boolean;
  confirmar: boolean;
  baixar: boolean;
}>;

export const permissoesDoPlano = (sessao: Sessao | undefined, somenteLeitura: boolean): PermissoesDoPlano => {
  const pode = (chave: string): boolean => sessao !== undefined && concede(sessao, chave);

  return {
    importar: !somenteLeitura && pode(IMPORTACAO_DO_PLANO),
    confirmar: !somenteLeitura && pode(CONFIRMACAO_DA_IMPORTACAO),
    baixar: pode(DOWNLOAD_DO_RELATORIO),
  };
};
