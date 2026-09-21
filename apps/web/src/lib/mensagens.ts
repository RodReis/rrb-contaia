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
  [CODIGOS_DE_ERRO.CNPJ_JA_CADASTRADO_NO_TENANT]:
    'Esta empresa já está cadastrada neste escritório.',
  [CODIGOS_DE_ERRO.REGIME_INVALIDO]: 'Selecione o regime tributário.',
  [CODIGOS_DE_ERRO.ENQUADRAMENTO_OBRIGATORIO]:
    'Informe o enquadramento no Simples Nacional (MEI ou não MEI).',
  [CODIGOS_DE_ERRO.CNAE_OBRIGATORIO]: 'Informe o CNAE principal.',
  [CODIGOS_DE_ERRO.INSCRICAO_INVALIDA]: 'Situação de inscrição inválida.',
  [CODIGOS_DE_ERRO.INSCRICAO_NUMERO_OBRIGATORIO]:
    'Informe o número da inscrição quando a situação for “Possui”.',
  [CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA]: 'Empresa não encontrada neste escritório.',
  [CODIGOS_DE_ERRO.TENANT_NAO_ENCONTRADO]: 'Escritório não encontrado para a sessão atual.',
  [CODIGOS_DE_ERRO.TENANT_DIVERGENTE]: 'Você não tem acesso a este escritório.',
  [CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO]:
    'Conclua o cadastro do escritório para acessar esta área.',
  [CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO]:
    'Estes dados mudaram enquanto você editava. Recarregue e tente de novo.',
  [CODIGOS_DE_ERRO.EXIGENCIA_NAO_ENCONTRADA]:
    'Exigência documental não encontrada nesta empresa.',
  [CODIGOS_DE_ERRO.EXIGENCIA_NAO_APLICAVEL]:
    'Esta exigência não se aplica à empresa no cadastro atual.',
  [CODIGOS_DE_ERRO.EXIGENCIA_DUPLICADA]: 'Já existe uma exigência com este nome.',
  [CODIGOS_DE_ERRO.NOME_DA_EXIGENCIA_OBRIGATORIO]: 'Informe o nome da exigência.',
  [CODIGOS_DE_ERRO.TRANSICAO_DOCUMENTAL_INVALIDA]:
    'Esta ação não é possível no estado atual do documento. Recarregue e veja como ele está.',
  [CODIGOS_DE_ERRO.DOCUMENTO_SEM_ARQUIVO]: 'Não há arquivo enviado para analisar.',
  [CODIGOS_DE_ERRO.VERSAO_NAO_VIGENTE]: 'Esta versão não é a vigente e não aceita a ação.',
  [CODIGOS_DE_ERRO.VERSAO_NAO_ENCONTRADA]: 'Versão do documento não encontrada.',
  [CODIGOS_DE_ERRO.ARQUIVO_INDISPONIVEL]:
    'O arquivo não está disponível agora. Tente de novo em instantes.',
  [CODIGOS_DE_ERRO.VALIDADE_INVALIDA]: 'Informe a validade no formato DD/MM/AAAA.',
  [CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA]: 'Informe a justificativa.',
  FALHA_DE_REDE: 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.',
  HTTP_401: 'Sua sessão expirou. Entre novamente para continuar.',
  HTTP_403: 'Você não tem alçada para esta ação.',
};

export const mensagemDoCodigo = (codigo: string): string =>
  MENSAGENS[codigo] ?? 'Não foi possível concluir a operação. Tente de novo em instantes.';
