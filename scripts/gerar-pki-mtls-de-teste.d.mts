/** Tipos da PKI mTLS de teste (só consumida por testes; o módulo é `.mjs` puro). */

export type AutoridadeDeTeste = Readonly<{
  certificadoPem: string;
  chavePem: string;
}>;

export type PkiMtls = Readonly<{
  agora: Date;
  interna: AutoridadeDeTeste;
  dubles: AutoridadeDeTeste;
}>;

export type CredencialPem = Readonly<{ certificadoPem: string; chavePem: string }>;

export const URN_DE_SERVICO: (nome: string) => string;

export function criarPkiMtls(opcoes?: { agora?: Date }): PkiMtls;

export function emitirIdentidade(
  pki: PkiMtls,
  opcoes: {
    nome: string;
    papel: 'cliente' | 'servidor';
    dns?: readonly string[];
    naoAntes?: Date;
    naoDepois?: Date;
  },
): CredencialPem;

export function emitirServidorDoDuble(
  pki: PkiMtls,
  opcoes: { dns: string; naoAntes?: Date; naoDepois?: Date },
): CredencialPem;

export function escreverPkiMtls(saida: string, opcoes?: { agora?: Date }): Promise<void>;
