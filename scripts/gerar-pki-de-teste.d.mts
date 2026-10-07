/** Tipos da PKI de teste do A1 (só consumida por testes; o módulo é `.mjs` puro). */

export type PkiDeTeste = Readonly<{ agora: Date }>;

export type PfxDeTeste = Readonly<{ pfx: Buffer; senha: string; certificadoPem: string }>;

export const SENHA_PADRAO_DE_TESTE: string;
export const CNPJ_PADRAO_DE_TESTE: string;

export function criarPki(opcoes?: { agora?: Date }): PkiDeTeste;

export function emitirPfx(
  pki: PkiDeTeste,
  opcoes?: {
    cnpj?: string;
    tipo?: 'E_CNPJ_A1' | 'E_CNPJ_A3' | 'E_CPF_A1';
    hierarquia?: 'confiavel' | 'desconhecida';
    naoAntes?: Date;
    naoDepois?: Date;
    senha?: string;
    algoritmo?: '3des' | 'aes256';
    incluirRaiz?: boolean;
    semChavePrivada?: boolean;
    ehAutoridade?: boolean;
    nome?: string;
  },
): PfxDeTeste;

export function raizConfiavelEmPem(pki: PkiDeTeste): string;
