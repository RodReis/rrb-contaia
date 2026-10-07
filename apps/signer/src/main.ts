import { readFileSync } from 'node:fs';

import { criarPoolDaAplicacao } from '@contaia/db';

import { criarServicosDoSigner } from './caso-de-uso.js';
import { lerConfig, validarPepper } from './config.js';
import { chamarDestino } from './destino.js';
import { criarServidorDoSigner, encerrarComGraca, escutar } from './server.js';
import { criarLeitorDoVault } from './vault.js';

const config = lerConfig(process.env);

const vault = criarLeitorDoVault({
  endereco: config.vaultAddr,
  arquivoDoToken: config.arquivoDoTokenDoVault,
});

const pool = criarPoolDaAplicacao(config.urlDoBanco);

const servidor = criarServidorDoSigner({
  certificadoPem: readFileSync(config.arquivoDoCertificado, 'utf8'),
  chavePem: readFileSync(config.arquivoDaChave, 'utf8'),
  caInternaPem: readFileSync(config.arquivoDaCaInterna, 'utf8'),
  servicos: criarServicosDoSigner({
    pool,
    vault,
    chamarDestino,
    destinos: config.destinos,
    caDosDublesPem: readFileSync(config.arquivoDaCaDosDubles, 'utf8'),
    pepper: validarPepper(readFileSync(config.arquivoDoPepper, 'utf8')),
    agora: () => new Date(),
    tempoLimiteDoDestinoMs: config.tempoLimiteDoDestinoMs,
  }),
});

await escutar(servidor, config.porta);
encerrarComGraca(servidor, () => pool.end());

console.warn(`[signer] mTLS interno ouvindo na porta ${config.porta}`);
