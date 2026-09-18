import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { criarServidorDeSaude, escutar } from './server.js';

const servidores: ReturnType<typeof criarServidorDeSaude>[] = [];

const subir = async (): Promise<string> => {
  const server = criarServidorDeSaude('workers');
  servidores.push(server);
  await escutar(server, 0);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

afterEach(async () => {
  await Promise.all(
    servidores.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('servidor de saúde dos workers', () => {
  it('responde 200 com o contrato de saúde em /health', async () => {
    const base = await subir();

    const resposta = await fetch(`${base}/health`);

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ service: 'workers', status: 'ok' });
  });

  it('responde 404 em rota desconhecida', async () => {
    const base = await subir();

    const resposta = await fetch(`${base}/desconhecida`);

    expect(resposta.status).toBe(404);
  });
});
