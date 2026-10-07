import { createServer, type Server } from 'node:http';
import { health, type ServiceName } from '@contaia/shared';

export const criarServidorDeSaude = (service: ServiceName): Server =>
  createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(health(service)));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'not_found' }));
  });

export const escutar = (server: Server, port: number): Promise<Server> =>
  new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve(server));
  });

/** Fecha o servidor e, antes de sair, o que o processo ainda mantém aberto (filas, pool). */
export const encerrarComGraca = (server: Server, aoEncerrar: () => Promise<void> = async () => {}): void => {
  const fechar = (): void => {
    server.close(() => {
      void aoEncerrar().finally(() => process.exit(0));
    });
  };

  process.on('SIGTERM', fechar);
  process.on('SIGINT', fechar);
};
