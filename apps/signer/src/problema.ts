/**
 * `application/problem+json` do Signer (CLAUDE.md, convenções; SPEC-012 §6.2).
 * Só código estável e texto fixo: nunca detalhe criptográfico, caminho do Vault, valor de campo
 * ou mensagem de exceção.
 */
import type { CodigoDoSigner } from './erro.js';

const TIPO_BASE = 'https://contaia.local/erros';

const TITULOS: Readonly<Record<CodigoDoSigner, string>> = {
  SIGNER_IDENTIDADE_INVALIDA: 'Identidade de serviço ausente, desconhecida ou inválida.',
  SIGNER_ALCADA_NEGADA: 'A identidade de serviço não tem alçada para esta operação.',
  SIGNER_CONTEXTO_INVALIDO: 'Contexto da operação ausente, incompleto ou incompatível.',
  SIGNER_FINALIDADE_INVALIDA: 'Finalidade fora do catálogo do Signer.',
  SIGNER_CERTIFICADO_AUSENTE: 'A empresa não tem certificado vigente.',
  SIGNER_CERTIFICADO_DESATIVADO: 'O certificado da empresa está desativado.',
  SIGNER_CERTIFICADO_VENCIDO: 'O certificado da empresa está vencido.',
  SIGNER_CERTIFICADO_AINDA_NAO_VIGENTE: 'O certificado da empresa ainda não está vigente.',
  SIGNER_XML_INVALIDO: 'O XML não pôde ser assinado.',
  SIGNER_ASSINATURA_INVALIDA: 'A assinatura produzida não passou na verificação.',
  SIGNER_VAULT_INDISPONIVEL: 'O cofre de certificados está indisponível.',
  SIGNER_MTLS_RECUSADO: 'O destino recusou a conexão mTLS.',
  SIGNER_DESTINO_INDISPONIVEL: 'O destino local está indisponível.',
  SIGNER_IDEMPOTENCIA_CONFLITO: 'A chave idempotente já foi usada com outro conteúdo ou contexto.',
  SIGNER_OPERACAO_EM_ANDAMENTO: 'A operação com esta chave ainda está em andamento.',
  SIGNER_INDISPONIVEL: 'O Signer não conseguiu concluir a operação.',
  ROTA_NAO_ENCONTRADA: 'Rota inexistente.',
  REQUISICAO_INVALIDA: 'A requisição está malformada.',
};

export type CorpoDoProblema = Readonly<{
  type: string;
  title: string;
  status: number;
  code: CodigoDoSigner;
  correlationId: string;
}>;

export const montarProblema = (
  codigo: CodigoDoSigner,
  status: number,
  correlationId: string,
): CorpoDoProblema => ({
  type: `${TIPO_BASE}/${codigo}`,
  title: TITULOS[codigo],
  status,
  code: codigo,
  correlationId,
});
