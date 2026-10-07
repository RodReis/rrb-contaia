/**
 * Identidades técnicas e alçadas (SPEC-012 §3.1).
 *
 * Quem chama é decidido pelo URN `urn:contaia:servico:<nome>` do certificado cliente emitido pela
 * CA interna — nunca pela rede Docker. A alçada decide o que cada identidade pode pedir: o worker
 * opera (assina e executa mTLS); a API só consulta e diagnostica; a identidade do próprio Signer
 * existe para o healthcheck do contêiner e só vê a saúde.
 */

export const IDENTIDADES = ['api', 'worker', 'signer'] as const;
export type IdentidadeDeServico = (typeof IDENTIDADES)[number];

export const OPERACOES = ['saude', 'assinar', 'executar-mtls', 'diagnosticar', 'estados', 'historico'] as const;
export type Operacao = (typeof OPERACOES)[number];

export const ALCADAS: Readonly<Record<IdentidadeDeServico, readonly Operacao[]>> = {
  worker: ['saude', 'assinar', 'executar-mtls', 'diagnosticar'],
  api: ['saude', 'estados', 'historico', 'diagnosticar'],
  signer: ['saude'],
};

export const permitido = (identidade: IdentidadeDeServico, operacao: Operacao): boolean =>
  ALCADAS[identidade].includes(operacao);

const URN = /^URI:urn:contaia:servico:([a-z]+)$/u;

const ehIdentidade = (valor: string): valor is IdentidadeDeServico =>
  (IDENTIDADES as readonly string[]).includes(valor);

/**
 * Lê a identidade do SAN do certificado cliente. Exatamente UM URI e ele precisa ser um URN de
 * serviço conhecido: zero, vários ou desconhecido não autentica ninguém.
 */
export const identidadeDoSan = (san: string | undefined): IdentidadeDeServico | null => {
  if (san === undefined) {
    return null;
  }

  const uris = san
    .split(',')
    .map((entrada) => entrada.trim())
    .filter((entrada) => entrada.startsWith('URI:'));

  if (uris.length !== 1) {
    return null;
  }

  const nome = URN.exec(uris[0] ?? '')?.[1];

  return nome !== undefined && ehIdentidade(nome) ? nome : null;
};
