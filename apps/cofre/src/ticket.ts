/**
 * Ticket de ingestão (SPEC-011 §6.2): `base64url(JSON(CargaDoTicket)) + '.' + base64url(hmac)`.
 *
 * A API principal assina; o cofre só verifica. O HMAC-SHA256 cobre exatamente o
 * texto do primeiro segmento (o JSON em base64url), com `COFRE_TICKET_SECRET`
 * (UTF-8) como chave. O navegador carrega o ticket sem interpretá-lo.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CargaDoTicket, OperacaoDeIngestao } from '@contaia/shared';

export const assinarTicket = (carga: CargaDoTicket, segredo: string): string => {
  const corpo = Buffer.from(JSON.stringify(carga), 'utf8').toString('base64url');
  const assinatura = createHmac('sha256', segredo).update(corpo).digest('base64url');
  return `${corpo}.${assinatura}`;
};

const OPERACOES: readonly OperacaoDeIngestao[] = ['CADASTRO', 'SUBSTITUICAO'];

const ehTexto = (valor: unknown): valor is string => typeof valor === 'string' && valor !== '';

const comoCarga = (valor: unknown): CargaDoTicket | null => {
  if (typeof valor !== 'object' || valor === null) return null;
  const c = valor as Record<string, unknown>;
  const operacao = c['operacao'];

  if (
    !ehTexto(c['jti']) ||
    !ehTexto(c['tenantId']) ||
    !ehTexto(c['empresaId']) ||
    !ehTexto(c['usuarioId']) ||
    !ehTexto(c['cnpjDaEmpresa']) ||
    !ehTexto(c['responsavelId']) ||
    !ehTexto(c['correlationId']) ||
    typeof c['exp'] !== 'number' ||
    !Number.isFinite(c['exp']) ||
    !OPERACOES.includes(operacao as OperacaoDeIngestao)
  ) {
    return null;
  }

  return {
    jti: c['jti'],
    tenantId: c['tenantId'],
    empresaId: c['empresaId'],
    usuarioId: c['usuarioId'],
    cnpjDaEmpresa: c['cnpjDaEmpresa'],
    responsavelId: c['responsavelId'],
    correlationId: c['correlationId'],
    operacao: operacao as OperacaoDeIngestao,
    exp: c['exp'],
  };
};

/** `null` para qualquer defeito: assinatura, formato ou expiração (sem dizer qual). */
export const verificarTicket = (
  ticket: string,
  segredo: string,
  agora: Date,
): CargaDoTicket | null => {
  const partes = ticket.split('.');
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes as [string, string];

  const esperada = createHmac('sha256', segredo).update(corpo).digest();
  const recebida = Buffer.from(assinatura, 'base64url');

  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;

  let carga: CargaDoTicket | null;
  try {
    carga = comoCarga(JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')));
  } catch {
    return null;
  }

  if (carga === null || carga.exp * 1000 <= agora.getTime()) return null;
  return carga;
};

/**
 * Consome o `jti` na primeira tentativa, com sucesso ou não (nova tentativa =
 * novo ticket). Memória do processo: o replay entre reinícios é barrado pela
 * transição atômica do ticket na API (`EMITIDO` → `CONSUMIDO`).
 * ponytail: Map em memória; o teto é a janela do ticket (5 min), então a poda
 * por expiração basta.
 */
export const criarRegistroDeJti = () => {
  const vistos = new Map<string, number>();

  return {
    /** `true` se é a primeira vez que o `jti` aparece. */
    consumir(jti: string, expSegundos: number, agora: Date): boolean {
      for (const [id, exp] of vistos) {
        if (exp * 1000 <= agora.getTime()) vistos.delete(id);
      }
      if (vistos.has(jti)) return false;
      vistos.set(jti, expSegundos);
      return true;
    },
  };
};
