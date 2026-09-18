import { criarServidorDeSaude, encerrarComGraca, escutar } from './server.js';

const port = Number(process.env['WORKERS_PORT'] ?? 15102);
const server = criarServidorDeSaude('workers');

await escutar(server, port);
encerrarComGraca(server);

console.warn(`[workers] saúde em http://0.0.0.0:${port}/health`);
