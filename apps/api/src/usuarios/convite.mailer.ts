/**
 * Envio do convite por e-mail (SPEC-007 §3.2).
 *
 * Localmente o destino é o Mailpit, que captura a mensagem para a prova
 * determinística; entrega externa real é `not_run` até o gate de produção.
 *
 * O link carrega o token de uso único: nunca entra em log, nem na falha. Quem
 * chama recebe um erro sanitizado e preserva o cadastro (SPEC-007 §3.2).
 */
import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

import { VALIDADE_DO_CONVITE_HORAS } from '@contaia/domain';

export type EntradaDoConvite = Readonly<{
  para: string;
  nome: string;
  link: string;
  expiraEm: Date;
}>;

const ASSUNTO = 'Convite para acessar o ContaIA';
const PRAZO_DO_SMTP_MS = 10_000;

const escaparHtml = (texto: string): string =>
  texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const vencimentoEmSaoPaulo = (expiraEm: Date): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(expiraEm);

@Injectable()
export class ConviteMailer {
  private readonly logger = new Logger(ConviteMailer.name);

  async enviar(entrada: EntradaDoConvite): Promise<void> {
    const vencimento = vencimentoEmSaoPaulo(entrada.expiraEm);
    const validade = `${VALIDADE_DO_CONVITE_HORAS} horas`;

    const texto = [
      `Olá, ${entrada.nome}.`,
      '',
      'Você foi convidado(a) para acessar o ContaIA. Para definir sua senha e entrar, abra o link abaixo:',
      '',
      entrada.link,
      '',
      `O link é de uso único e vale por ${validade}, até ${vencimento} (horário de São Paulo).`,
      'Se você não esperava este convite, ignore esta mensagem.',
    ].join('\n');

    const html = [
      `<p>Olá, ${escaparHtml(entrada.nome)}.</p>`,
      '<p>Você foi convidado(a) para acessar o ContaIA. Para definir sua senha e entrar, use o link abaixo:</p>',
      `<p><a href="${escaparHtml(entrada.link)}">${escaparHtml(entrada.link)}</a></p>`,
      `<p>O link é de uso único e vale por ${validade}, até ${vencimento} (horário de São Paulo).</p>`,
      '<p>Se você não esperava este convite, ignore esta mensagem.</p>',
    ].join('\n');

    try {
      const transporte = nodemailer.createTransport({
        host: process.env['SMTP_HOST'] ?? '127.0.0.1',
        port: Number(process.env['SMTP_PORT'] ?? 11025),
        secure: false,
        // Sem isto um SMTP que não responde segura a requisição do admin indefinidamente.
        connectionTimeout: PRAZO_DO_SMTP_MS,
        greetingTimeout: PRAZO_DO_SMTP_MS,
        socketTimeout: PRAZO_DO_SMTP_MS,
      });

      await transporte.sendMail({
        from: process.env['SMTP_FROM'] ?? 'no-reply@contaia.local',
        to: entrada.para,
        subject: ASSUNTO,
        text: texto,
        html,
      });
    } catch {
      // O erro original pode repetir o link; o log guarda só o fato da falha.
      this.logger.warn('falha ao enviar e-mail de convite');

      throw new Error('Falha no envio do e-mail de convite.');
    }
  }
}
