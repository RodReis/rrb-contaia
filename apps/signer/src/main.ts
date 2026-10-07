import { readFileSync } from 'node:fs';

import { lerConfig } from './config.js';
import { criarServicosDeSaude } from './servicos.js';
import { criarServidorDoSigner, encerrarComGraca, escutar } from './server.js';
import { criarLeitorDoVault } from './vault.js';

const config = lerConfig(process.env);

const vault = criarLeitorDoVault({
  endereco: config.vaultAddr,
  arquivoDoToken: config.arquivoDoTokenDoVault,
});

const servidor = criarServidorDoSigner({
  certificadoPem: readFileSync(config.arquivoDoCertificado, 'utf8'),
  chavePem: readFileSync(config.arquivoDaChave, 'utf8'),
  caInternaPem: readFileSync(config.arquivoDaCaInterna, 'utf8'),
  servicos: criarServicosDeSaude({ vault, agora: () => new Date() }),
});

await escutar(servidor, config.porta);
encerrarComGraca(servidor);

console.warn(`[signer] mTLS interno ouvindo na porta ${config.porta}`);
