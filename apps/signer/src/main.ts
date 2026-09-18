import { criarServidorDeSaude, encerrarComGraca, escutar } from './server.js';

const port = Number(process.env['SIGNER_PORT'] ?? 15103);
const server = criarServidorDeSaude('signer');

await escutar(server, port);
encerrarComGraca(server);

console.warn(`[signer] saúde em http://0.0.0.0:${port}/health`);
