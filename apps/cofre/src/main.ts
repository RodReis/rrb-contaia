import { criarClienteDaApi } from './api.js';
import { carregarRaizes, lerConfig } from './config.js';
import { criarServidorDoCofre, encerrarComGraca, escutar } from './server.js';
import { criarClienteDoVault } from './vault.js';

const config = lerConfig(process.env);
const raizes = await carregarRaizes(config.diretorioDasRaizes);

if (raizes.length === 0) {
  // Sem âncora de confiança todo PFX seria recusado: melhor avisar alto que falhar calado.
  console.error(`[cofre] nenhuma raiz .pem em ${config.diretorioDasRaizes}; toda ingestão será recusada`);
}

const server = criarServidorDoCofre({
  vault: criarClienteDoVault({ endereco: config.vaultAddr, arquivoDoToken: config.arquivoDoTokenDoVault }),
  api: criarClienteDaApi({ apiUrl: config.apiUrl, serviceToken: config.serviceToken }),
  raizes,
  ticketSecret: config.ticketSecret,
  adminToken: config.adminToken,
  origensPermitidas: config.origensPermitidas,
});

await escutar(server, config.porta, config.host);
encerrarComGraca(server);

console.warn(`[cofre] escutando em http://${config.host}:${config.porta} (saúde em /health)`);
