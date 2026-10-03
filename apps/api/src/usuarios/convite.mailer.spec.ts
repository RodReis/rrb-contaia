import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMail = vi.fn();

  return { sendMailMock: sendMail, createTransportMock: vi.fn(() => ({ sendMail })) };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

import { ConviteMailer } from './convite.mailer';

const LINK = 'http://127.0.0.1:15100/convite/token-super-secreto-123';
const ENTRADA = {
  para: 'ana@escritorio.com',
  nome: 'Ana Souza',
  link: LINK,
  // 2026-10-04T15:30:00Z = 04/10/2026 12:30 em America/Sao_Paulo (I-11)
  expiraEm: new Date('2026-10-04T15:30:00Z'),
};

describe('ConviteMailer', () => {
  let logs: string[];

  beforeEach(() => {
    sendMailMock.mockReset();
    createTransportMock.mockClear();
    logs = [];
    process.env['SMTP_HOST'] = '127.0.0.1';
    process.env['SMTP_PORT'] = '21025';
    process.env['SMTP_FROM'] = 'no-reply@contaia.local';

    for (const nivel of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, nivel).mockImplementation((...argumentos: unknown[]) => {
        logs.push(argumentos.map(String).join(' '));
      });
    }
  });

  afterEach(() => vi.restoreAllMocks());

  it('envia ao convidado, do remetente configurado, em PT-BR', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'x' });

    await new ConviteMailer().enviar(ENTRADA);

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 21025, secure: false }),
    );

    const mensagem = sendMailMock.mock.calls[0]?.[0] as {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    };

    expect(mensagem.from).toBe('no-reply@contaia.local');
    expect(mensagem.to).toBe('ana@escritorio.com');
    expect(mensagem.subject).toBe('Convite para acessar o ContaIA');
    expect(mensagem.text).toContain('Ana Souza');
    expect(mensagem.text).toContain(LINK);
    expect(mensagem.html).toContain(LINK);
  });

  it('informa a validade de 48 horas e o vencimento em horário de São Paulo', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'x' });

    await new ConviteMailer().enviar(ENTRADA);

    const mensagem = sendMailMock.mock.calls[0]?.[0] as { text: string };

    expect(mensagem.text).toContain('48 horas');
    expect(mensagem.text).toContain('04/10/2026');
    expect(mensagem.text).toContain('12:30');
  });

  it('escapa o nome no HTML para que nome malicioso não injete marcação', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'x' });

    await new ConviteMailer().enviar({ ...ENTRADA, nome: '<script>alert(1)</script>' });

    const mensagem = sendMailMock.mock.calls[0]?.[0] as { html: string };

    expect(mensagem.html).not.toContain('<script>');
    expect(mensagem.html).toContain('&lt;script&gt;');
  });

  it('propaga a falha de envio para o chamador decidir (cadastro é preservado lá)', async () => {
    sendMailMock.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:21025'));

    await expect(new ConviteMailer().enviar(ENTRADA)).rejects.toThrow();
  });

  it('nunca registra o link nem o token em log, nem na falha', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'x' });
    await new ConviteMailer().enviar(ENTRADA);

    sendMailMock.mockRejectedValueOnce(new Error(`falha ao enviar ${LINK}`));
    await new ConviteMailer().enviar(ENTRADA).catch(() => undefined);

    const tudo = logs.join('\n');

    expect(tudo).not.toContain('token-super-secreto-123');
    expect(tudo).not.toContain('/convite/');
  });
});
