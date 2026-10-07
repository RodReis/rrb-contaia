/** Tipos do dublê mTLS (só consumido por testes; o módulo é `.mjs` puro e sem dependências). */

export type EfeitoDoDuble = Readonly<{ duble: string; cnpj: string; protocolo: string }>;

export type Duble = Readonly<{
  ouvir(porta: number, host: string): Promise<number>;
  fechar(): Promise<void>;
  /** Efeitos aceitos (a repetição com a mesma Idempotency-Key não conta). */
  efeitos(): number;
  /** Conexões recusadas já no handshake TLS. */
  recusasDeTls(): number;
}>;

export function criarDuble(opcoes: {
  nome: string;
  certificadoPem: string;
  chavePem: string;
  caDosClientesPem: string | string[];
  registrarEfeito?: (efeito: EfeitoDoDuble) => void;
}): Duble;
