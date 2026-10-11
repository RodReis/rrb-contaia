/**
 * Permissões de `Empresas → Empregados` no catálogo (SPEC-014 §3.12). A tela decide o que oferecer
 * a partir daqui; quem nega é sempre a API, em cada rota.
 */
import { concede } from '../cofre/permissoes';
import type { PermissoesDaImportacao } from '../importacao/dominio';
import type { Sessao } from '../usuarios/api';

export const CONSULTA_DE_EMPREGADOS = 'empresas.empregados.consultar';
export const IMPORTACAO_DE_EMPREGADOS = 'empresas.empregados.importar';
export const CONFIRMACAO_DA_IMPORTACAO_DE_EMPREGADOS = 'empresas.empregados.confirmar_importacao';
export const DOWNLOAD_DO_RELATORIO_DE_EMPREGADOS = 'empresas.empregados.baixar_relatorio';

export const consultaEmpregados = (sessao: Sessao | undefined): boolean =>
  sessao !== undefined && concede(sessao, CONSULTA_DE_EMPREGADOS);

/** Empresa arquivada é só consulta (SPEC-003): nada de envio nem decisão sobre prévia. */
export const permissoesDeEmpregados = (sessao: Sessao | undefined, somenteLeitura: boolean): PermissoesDaImportacao => {
  const pode = (chave: string): boolean => sessao !== undefined && concede(sessao, chave);

  return {
    importar: !somenteLeitura && pode(IMPORTACAO_DE_EMPREGADOS),
    confirmar: !somenteLeitura && pode(CONFIRMACAO_DA_IMPORTACAO_DE_EMPREGADOS),
    baixar: pode(DOWNLOAD_DO_RELATORIO_DE_EMPREGADOS),
  };
};
