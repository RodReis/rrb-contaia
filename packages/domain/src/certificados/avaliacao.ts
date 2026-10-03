/**
 * Avaliação do certificado A1 enviado ao cofre (SPEC-011 §3.1).
 *
 * O cofre faz a parte criptográfica (abrir o PKCS#12, validar a cadeia e extrair
 * os campos); aqui mora a decisão, pura: o que torna um certificado aceitável
 * para uma empresa. Nada consulta banco, rede ou relógio — o "agora" entra por
 * parâmetro e a validade é data civil em `America/Sao_Paulo` (I-11).
 */
import { dataCivilEmSaoPaulo } from '../empresa/manutencao.js';
import { normalizarCnpj } from '../validadores/cnpj.js';

export const CODIGOS_DE_RECUSA_DA_INGESTAO = [
  'CERTIFICADO_TICKET_INVALIDO',
  'CERTIFICADO_EXTENSAO_INVALIDA',
  'CERTIFICADO_TAMANHO_EXCEDIDO',
  'CERTIFICADO_ARQUIVO_VAZIO',
  'CERTIFICADO_CONTEINER_INVALIDO',
  'CERTIFICADO_SENHA_INCORRETA',
  'CERTIFICADO_EXPIRADO',
  'CERTIFICADO_AINDA_NAO_VIGENTE',
  'CERTIFICADO_TIPO_INCOMPATIVEL',
  'CERTIFICADO_CNPJ_DIVERGENTE',
  'CERTIFICADO_RESPONSAVEL_INVALIDO',
  'COFRE_INDISPONIVEL',
] as const;

export type CodigoDeRecusaDaIngestao = (typeof CODIGOS_DE_RECUSA_DA_INGESTAO)[number];

/** Política ICP-Brasil de certificado A1: `2.16.76.1.2.1.<n>` (A3 é `2.16.76.1.2.3.<n>`). */
export const PREFIXO_DA_POLITICA_A1 = '2.16.76.1.2.1.';

/** O que o cofre extrai do PKCS#12 depois de abri-lo e validar a cadeia. */
export type CertificadoExtraido = Readonly<{
  /** CNPJs do campo `otherName` `2.16.76.1.3.3` (e-CNPJ) do SubjectAltName, como vierem. */
  cnpjsDoTitular: readonly string[];
  /** OIDs de `certificatePolicies` do certificado do titular. */
  oidsDePoliticas: readonly string[];
  /** O certificado do titular é uma AC (`basicConstraints.cA`). */
  ehAutoridade: boolean;
  /** `keyUsage` inclui assinatura digital (ou a extensão não restringe). */
  permiteAssinaturaDigital: boolean;
  /** A cadeia do PFX leva a uma raiz ICP-Brasil configurada como confiável. */
  cadeiaIcpValidada: boolean;
  /** O contêiner trouxe a chave privada correspondente ao certificado. */
  possuiChavePrivada: boolean;
  naoAntes: Date;
  naoDepois: Date;
}>;

export type ResultadoDaAvaliacao =
  | Readonly<{ ok: true; validoDe: string; validoAte: string }>
  | Readonly<{ ok: false; codigo: CodigoDeRecusaDaIngestao }>;

const recusar = (codigo: CodigoDeRecusaDaIngestao): ResultadoDaAvaliacao => ({ ok: false, codigo });

/**
 * Ordem da SPEC §3.1: primeiro o que o certificado É (tipo), depois de quem é
 * (CNPJ) e por fim a vigência. Assim um certificado de outro tipo nunca é
 * reportado como "expirado" e a mensagem aponta o problema que o usuário precisa
 * corrigir primeiro.
 */
export const avaliarCertificado = (
  extraido: CertificadoExtraido,
  contexto: Readonly<{ cnpjDaEmpresa: string; agora: Date }>,
): ResultadoDaAvaliacao => {
  const ehA1 = extraido.oidsDePoliticas.some((oid) => oid.startsWith(PREFIXO_DA_POLITICA_A1));
  const ehECnpj = extraido.cnpjsDoTitular.length > 0;

  if (
    !ehA1 ||
    !ehECnpj ||
    extraido.ehAutoridade ||
    !extraido.permiteAssinaturaDigital ||
    !extraido.cadeiaIcpValidada ||
    !extraido.possuiChavePrivada
  ) {
    return recusar('CERTIFICADO_TIPO_INCOMPATIVEL');
  }

  const alvo = normalizarCnpj(contexto.cnpjDaEmpresa);

  if (!extraido.cnpjsDoTitular.some((cnpj) => normalizarCnpj(cnpj) === alvo)) {
    return recusar('CERTIFICADO_CNPJ_DIVERGENTE');
  }

  const validoDe = dataCivilEmSaoPaulo(extraido.naoAntes);
  const validoAte = dataCivilEmSaoPaulo(extraido.naoDepois);
  const hoje = dataCivilEmSaoPaulo(contexto.agora);

  // `YYYY-MM-DD` ordena como texto; o último dia de validade ainda vale inteiro.
  if (validoAte < hoje) {
    return recusar('CERTIFICADO_EXPIRADO');
  }

  if (validoDe > hoje) {
    return recusar('CERTIFICADO_AINDA_NAO_VIGENTE');
  }

  return { ok: true, validoDe, validoAte };
};
