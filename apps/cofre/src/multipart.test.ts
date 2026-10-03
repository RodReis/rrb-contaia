import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { lerFormulario } from './multipart.js';

const LIMITE = 'XXBOUNDARYXX';

const parte = (nome: string, valor: string, arquivo?: string): string =>
  `--${LIMITE}\r\nContent-Disposition: form-data; name="${nome}"${arquivo ? `; filename="${arquivo}"` : ''}\r\n` +
  `${arquivo ? 'Content-Type: application/octet-stream\r\n' : ''}\r\n${valor}\r\n`;
const FIM = `--${LIMITE}--\r\n`;

const novaRequisicao = (): { req: IncomingMessage; escrever: (texto: string) => void; terminar: () => void } => {
  const fluxo = new PassThrough();
  const req = Object.assign(fluxo, {
    headers: { 'content-type': `multipart/form-data; boundary=${LIMITE}` },
  }) as unknown as IncomingMessage;
  return { req, escrever: (t) => void fluxo.write(t), terminar: () => void fluxo.end() };
};

const esperarUmPouco = (): Promise<void> => new Promise((resolver) => setTimeout(resolver, 20));

describe('lerFormulario — o ticket é conferido antes do arquivo', () => {
  it('ticket aceito: lê senha e arquivo', async () => {
    const { req, escrever, terminar } = novaRequisicao();
    const aoVerTicket = vi.fn(() => true);

    const promessa = lerFormulario(req, aoVerTicket);
    escrever(parte('ticket', 'T') + parte('senha', 'S') + parte('arquivo', 'CONTEUDO', 'c.pfx') + FIM);
    terminar();
    const formulario = await promessa;

    expect(aoVerTicket).toHaveBeenCalledOnce();
    expect(aoVerTicket).toHaveBeenCalledWith('T');
    expect(formulario).toMatchObject({ ticket: 'T', senha: 'S', excedeuLimite: false });
    expect(formulario.arquivo?.bytes.toString()).toBe('CONTEUDO');
  });

  it('ticket recusado é conferido assim que chega, ANTES de o arquivo existir, e o arquivo nunca é acumulado', async () => {
    const { req, escrever, terminar } = novaRequisicao();
    const aoVerTicket = vi.fn(() => false);

    const promessa = lerFormulario(req, aoVerTicket);
    escrever(
      parte('ticket', 'RUIM') +
        `--${LIMITE}\r\nContent-Disposition: form-data; name="arquivo"; filename="c.pfx"\r\n\r\nINICIO`,
    );
    await esperarUmPouco();
    expect(aoVerTicket).toHaveBeenCalledOnce(); // antes mesmo de o corpo terminar

    escrever('-DO-ARQUIVO-QUE-NAO-DEVE-SER-GUARDADO');
    escrever(`\r\n${FIM}`);
    terminar();
    const formulario = await promessa;

    expect(formulario).toEqual({ ticket: 'RUIM', senha: null, arquivo: null, excedeuLimite: false });
    expect(aoVerTicket).toHaveBeenCalledOnce();
  });

  it('arquivo como primeira parte: o ticket nunca é consultado e a ingestão é interrompida', async () => {
    const { req, escrever, terminar } = novaRequisicao();
    const aoVerTicket = vi.fn(() => true);

    const promessa = lerFormulario(req, aoVerTicket);
    escrever(parte('arquivo', 'CONTEUDO', 'c.pfx') + parte('ticket', 'T') + FIM);
    terminar();
    const formulario = await promessa;

    expect(aoVerTicket).not.toHaveBeenCalled();
    expect(formulario).toMatchObject({ ticket: null, senha: null, arquivo: null });
  });

  it('senha como primeira parte também interrompe', async () => {
    const { req, escrever, terminar } = novaRequisicao();
    const aoVerTicket = vi.fn(() => true);

    const promessa = lerFormulario(req, aoVerTicket);
    escrever(parte('senha', 'S') + parte('ticket', 'T') + FIM);
    terminar();

    expect(await promessa).toMatchObject({ ticket: null, arquivo: null });
    expect(aoVerTicket).not.toHaveBeenCalled();
  });

  it('corpo declarado maior que o limite nem chega ao ticket', async () => {
    const fluxo = new PassThrough();
    const req = Object.assign(fluxo, {
      headers: {
        'content-type': `multipart/form-data; boundary=${LIMITE}`,
        'content-length': String(50 * 1024 * 1024),
      },
    }) as unknown as IncomingMessage;
    const aoVerTicket = vi.fn(() => true);

    const promessa = lerFormulario(req, aoVerTicket);
    fluxo.end('x');

    expect(await promessa).toEqual({ ticket: null, senha: null, arquivo: null, excedeuLimite: true });
    expect(aoVerTicket).not.toHaveBeenCalled();
  });
});
