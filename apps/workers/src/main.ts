import { readFileSync } from 'node:fs';

import { criarPoolDaAplicacao } from '@contaia/db';
import { conexaoDoRedis, criarClienteDoSigner } from '@contaia/signer-client';

import { lerConfig } from './config.js';
import { iniciarConsumidores } from './consumidores.js';
import { verificarSaude } from './monitor.js';
import { criarServidorDeSaude, encerrarComGraca, escutar } from './server.js';

const config = lerConfig(process.env);

// Identidade de serviço do worker (certificado da CA interna) e CA em que confia ao falar com o Signer.
const cliente = criarClienteDoSigner({
  host: config.signer.host,
  porta: config.signer.porta,
  servername: config.signer.servername,
  certificadoPem: readFileSync(config.arquivoDoCertificado, 'utf8'),
  chavePem: readFileSync(config.arquivoDaChave, 'utf8'),
  caPem: readFileSync(config.arquivoDaCaInterna, 'utf8'),
});

const pool = criarPoolDaAplicacao();

const consumidores = await iniciarConsumidores({
  conexao: conexaoDoRedis(config.redisUrl),
  cliente,
  intervaloDoMonitorMs: config.intervaloDoMonitorMs,
  verificar: () => verificarSaude({ pool, cliente, agora: () => new Date() }),
});

const server = criarServidorDeSaude('workers');

await escutar(server, config.portaDeSaude);
encerrarComGraca(server, async () => {
  await consumidores.fechar();
  await pool.end();
});

console.warn(`[workers] consumidores do Signer ativos; saúde em http://0.0.0.0:${config.portaDeSaude}/health`);
