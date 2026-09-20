/**
 * `code` do problema → mensagem em PT-BR (FRONTEND.md §14).
 *
 * Nunca se exibe `title` cru do backend. Sem mapeamento, a mensagem é genérica
 * mas acionável, sempre acompanhada do `correlationId`.
 */
import { CODIGOS_DE_ERRO } from '@contaia/domain';

const MENSAGENS: Readonly<Record<string, string>> = {
  [CODIGOS_DE_ERRO.CNPJ_INVALIDO]: 'CNPJ inválido',
  [CODIGOS_DE_ERRO.CNPJ_JA_UTILIZADO]: 'Este CNPJ já está em uso por outro escritório.',
  [CODIGOS_DE_ERRO.CPF_INVALIDO]: 'CPF inválido',
  [CODIGOS_DE_ERRO.EMAIL_INVALIDO]: 'E-mail inválido',
  [CODIGOS_DE_ERRO.TELEFONE_INVALIDO]: 'Telefone inválido',
  [CODIGOS_DE_ERRO.CEP_INVALIDO]: 'CEP inválido',
  [CODIGOS_DE_ERRO.UF_INVALIDA]: 'UF inválida',
  [CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO]: 'Campo obrigatório',
  [CODIGOS_DE_ERRO.ETAPA_INCOMPLETA]: 'Conclua as etapas anteriores para finalizar o cadastro.',
  [CODIGOS_DE_ERRO.LOGO_OBRIGATORIO]: 'Envie o logo do escritório.',
  [CODIGOS_DE_ERRO.DOCUMENTO_OBRIGATORIO]: 'Envie ao menos um documento do escritório.',
  [CODIGOS_DE_ERRO.ENDERECO_PRINCIPAL_OBRIGATORIO]: 'Informe o endereço principal.',
  [CODIGOS_DE_ERRO.ARQUIVO_INVALIDO]: 'Não foi possível usar este arquivo.',
  [CODIGOS_DE_ERRO.TENANT_NAO_ENCONTRADO]: 'Escritório não encontrado para a sessão atual.',
  [CODIGOS_DE_ERRO.TENANT_DIVERGENTE]: 'Você não tem acesso a este escritório.',
  [CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO]:
    'Conclua o cadastro do escritório para acessar esta área.',
  [CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO]:
    'Estes dados mudaram enquanto você editava. Recarregue e tente de novo.',
  FALHA_DE_REDE: 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.',
  HTTP_401: 'Sua sessão expirou. Entre novamente para continuar.',
  HTTP_403: 'Você não tem alçada para esta ação.',
};

export const mensagemDoCodigo = (codigo: string): string =>
  MENSAGENS[codigo] ?? 'Não foi possível concluir a operação. Tente de novo em instantes.';
