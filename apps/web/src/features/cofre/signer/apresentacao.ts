/**
 * Como o Signer aparece na tela (SPEC-012 §5): rótulos e tons dos estados, código estável →
 * mensagem acionável em PT-BR e formatos. Estado nunca é comunicado só por cor: todo tom tem
 * rótulo textual.
 *
 * Nada aqui descreve material criptográfico, caminho do Vault ou destino: a API só entrega
 * metadados e códigos estáveis (SPEC-012 §3.11).
 */
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import type {
  EstadoDaFinalidadeNoSigner,
  EstadoDeSaudeDoSigner,
  Finalidade,
  ResultadoDoHistorico,
} from '@contaia/shared';

import type { TomDoStatus } from '@/components/ui/status-badge';
import { mensagemDoCodigo } from '@/lib/mensagens';

import { formatarQuando } from '../../carteira/rotulos';

type Apresentacao = Readonly<{ rotulo: string; tom: TomDoStatus }>;

export const APRESENTACAO_DO_SERVICO: Readonly<Record<EstadoDeSaudeDoSigner, Apresentacao>> = {
  OPERACIONAL: { rotulo: 'Operacional', tom: 'conforme' },
  DEGRADADO: { rotulo: 'Degradado', tom: 'atencao' },
  INDISPONIVEL: { rotulo: 'Indisponível', tom: 'critico' },
};

export const APRESENTACAO_DA_FINALIDADE_NO_SIGNER: Readonly<
  Record<EstadoDaFinalidadeNoSigner, Apresentacao>
> = {
  OPERACIONAL: { rotulo: 'Operacional', tom: 'conforme' },
  NAO_TESTADO: { rotulo: 'Não testado', tom: 'neutro' },
  SEM_CERTIFICADO: { rotulo: 'Sem certificado', tom: 'atencao' },
  FALHA: { rotulo: 'Falha', tom: 'critico' },
};

export const ROTULO_DA_FINALIDADE: Readonly<Record<Finalidade, string>> = {
  DFE_TESTE: 'DF-e',
  ESOCIAL_TESTE: 'eSocial',
};

export const APRESENTACAO_DO_RESULTADO: Readonly<Record<ResultadoDoHistorico, Apresentacao>> = {
  SUCESSO: { rotulo: 'Sucesso', tom: 'conforme' },
  FALHA: { rotulo: 'Falha', tom: 'critico' },
  RECUSA: { rotulo: 'Recusa', tom: 'atencao' },
};

const MENSAGEM_GENERICA =
  'O Signer não concluiu a operação. Tente de novo em instantes e, se persistir, informe o código de suporte.';

const MENSAGENS: Readonly<Record<string, string>> = {
  [CODIGOS_DE_ERRO.SIGNER_CERTIFICADO_AUSENTE]:
    'A empresa não tem certificado A1 vigente. Cadastre um no cofre para poder testar.',
  [CODIGOS_DE_ERRO.SIGNER_CERTIFICADO_DESATIVADO]:
    'O certificado vigente foi desativado. Cadastre um novo certificado no cofre.',
  [CODIGOS_DE_ERRO.SIGNER_CERTIFICADO_VENCIDO]:
    'O certificado venceu. Envie um certificado renovado ao cofre.',
  [CODIGOS_DE_ERRO.SIGNER_CERTIFICADO_AINDA_NAO_VIGENTE]:
    'A validade do certificado ainda não começou. Confira as datas do certificado enviado.',
  [CODIGOS_DE_ERRO.SIGNER_XML_INVALIDO]:
    'O documento de teste foi recusado antes da assinatura. Tente de novo; se persistir, informe o código de suporte.',
  [CODIGOS_DE_ERRO.SIGNER_ASSINATURA_INVALIDA]:
    'A assinatura produzida não passou na verificação e nada foi enviado ao destino. Informe o código de suporte.',
  [CODIGOS_DE_ERRO.SIGNER_VAULT_INDISPONIVEL]:
    'O cofre de segredos não respondeu. Tente de novo em instantes.',
  [CODIGOS_DE_ERRO.SIGNER_MTLS_RECUSADO]:
    'O destino simulado recusou a conexão mTLS. Confira o certificado da empresa e teste de novo.',
  [CODIGOS_DE_ERRO.SIGNER_DESTINO_INDISPONIVEL]:
    'O destino simulado não respondeu. Tente de novo em instantes.',
  [CODIGOS_DE_ERRO.SIGNER_INDISPONIVEL]:
    'O Signer não respondeu. Tente de novo em instantes; o último estado conhecido segue na tela.',
  [CODIGOS_DE_ERRO.SIGNER_TESTE_EM_ANDAMENTO]:
    'Já existe um teste em andamento para esta empresa. Aguarde o resultado.',
  [CODIGOS_DE_ERRO.SIGNER_OPERACAO_EM_ANDAMENTO]:
    'A operação ainda está em andamento. Aguarde alguns instantes e consulte de novo.',
  [CODIGOS_DE_ERRO.SIGNER_IDEMPOTENCIA_CONFLITO]:
    'Esta operação conflita com outra já registrada. Informe o código de suporte.',
  [CODIGOS_DE_ERRO.SIGNER_ALCADA_NEGADA]:
    'A operação foi recusada pela alçada técnica do Signer. Informe o código de suporte.',
  [CODIGOS_DE_ERRO.SIGNER_IDENTIDADE_INVALIDA]:
    'A identidade técnica do chamador foi recusada pelo Signer. Informe o código de suporte.',
  [CODIGOS_DE_ERRO.SIGNER_CONTEXTO_INVALIDO]:
    'O contexto da operação foi recusado pelo Signer. Informe o código de suporte.',
  [CODIGOS_DE_ERRO.SIGNER_FINALIDADE_INVALIDA]:
    'Esta finalidade não é permitida no Signer. Informe o código de suporte.',
};

/** Código estável → mensagem. Código sem tratamento cai em texto genérico e acionável. */
export const mensagemDoSigner = (codigo: string): string =>
  MENSAGENS[codigo] ??
  (codigo.startsWith('SIGNER_') ? MENSAGEM_GENERICA : mensagemDoCodigo(codigo));

const SEM_VALOR = '—';

export const textoDaLatencia = (milissegundos: number | null): string =>
  milissegundos === null ? SEM_VALOR : `${milissegundos.toLocaleString('pt-BR')} ms`;

export const descreverVerificacao = (verificadaEm: string | null): string =>
  verificadaEm === null
    ? 'Nenhuma verificação registrada ainda.'
    : `Verificado em ${formatarQuando(verificadaEm).replace(',', '')}`;

/** Quando o último teste da finalidade aconteceu, ou o que falta para haver um. */
export const textoDoUltimoTeste = (ultimoTesteEm: string | null): string =>
  ultimoTesteEm === null ? 'Nunca testado' : formatarQuando(ultimoTesteEm).replace(',', '');
