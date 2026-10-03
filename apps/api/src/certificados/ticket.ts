/**
 * Ticket de ingestão (SPEC-011 §6.2): a API principal autoriza, o cofre confere.
 *
 * Formato: `base64url(JSON(CargaDoTicket)) + '.' + base64url(HMAC-SHA256(segredo, parte1))`,
 * com o segredo `COFRE_TICKET_SECRET` (≥ 32 bytes) compartilhado só entre a API e o cofre.
 * O navegador só carrega o ticket; não o interpreta. Uso único é garantido pelo `jti`
 * (linha em `empresa_certificado_ingestao`, consumida atomicamente) e, no cofre, por um
 * registro em memória do mesmo `jti`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import type { CargaDoTicket } from '@contaia/shared';
import { z } from 'zod';

const identificador = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

const cargaSchema = z.object({
  jti: identificador,
  tenantId: identificador,
  empresaId: identificador,
  usuarioId: identificador,
  cnpjDaEmpresa: z.string().min(1).max(20),
  responsavelId: identificador,
  operacao: z.enum(['CADASTRO', 'SUBSTITUICAO']),
  correlationId: z.string().min(1).max(128),
  exp: z.number().int().positive(),
});

/** Menor segredo aceito: 32 bytes. Abaixo disso o HMAC não protege nada. */
export const TAMANHO_MINIMO_DO_SEGREDO = 32;

const ticketInvalido = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO,
    'A autorização para enviar o certificado expirou ou já foi usada. Tente enviar novamente.',
  );

const assinar = (parteUm: string, segredo: string): Buffer =>
  createHmac('sha256', segredo).update(parteUm).digest();

export const assinarTicket = (carga: CargaDoTicket, segredo: string): string => {
  const parteUm = Buffer.from(JSON.stringify(carga), 'utf8').toString('base64url');

  return `${parteUm}.${assinar(parteUm, segredo).toString('base64url')}`;
};

/**
 * Confere assinatura (tempo constante) e formato. A validade NÃO é conferida aqui: quem consome
 * o ticket a confere (`expira_em`, no banco), e só a repetição de uma ativação já feita ignora o prazo. Qualquer
 * defeito responde o mesmo código: ticket forjado, adulterado ou ilegível não distingue motivo.
 */
export const lerTicketAssinado = (ticket: string, segredo: string): CargaDoTicket => {
  const partes = ticket.split('.');

  if (partes.length !== 2 || segredo.length < TAMANHO_MINIMO_DO_SEGREDO) {
    throw ticketInvalido();
  }

  const [parteUm = '', assinatura = ''] = partes;
  const recebida = Buffer.from(assinatura, 'base64url');
  const esperada = assinar(parteUm, segredo);

  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    throw ticketInvalido();
  }

  let json: unknown;

  try {
    json = JSON.parse(Buffer.from(parteUm, 'base64url').toString('utf8'));
  } catch {
    throw ticketInvalido();
  }

  const carga = cargaSchema.safeParse(json);

  if (!carga.success) {
    throw ticketInvalido();
  }

  return carga.data;
};
