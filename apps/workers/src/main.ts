import { readFileSync } from 'node:fs';

import { criarPoolDaAplicacao } from '@contaia/db';
import { conexaoDoRedis, criarClienteDoSigner } from '@contaia/signer-client';

import { lerConfig, type ConfigDoArmazenamento, type ConfigDoSigner } from './config.js';
import { iniciarConsumidores } from './consumidores.js';
import { verificarSaude } from './monitor.js';
import { iniciarConsumidorDoPlanoDeContas } from './plano-contas/consumidor.js';
import { criarLeitorDoArmazenamento } from './plano-contas/leitura-s3.js';
import { criarServidorDeSaude, encerrarComGraca, escutar } from './server.js';

type Fechar = () => Promise<void>;

const config = lerConfig(process.env);
const conexao = conexaoDoRedis(config.redisUrl);
const pool = criarPoolDaAplicacao();
const agora = (): Date => new Date();

const iniciarSigner = async (signer: ConfigDoSigner): Promise<Fechar> => {
  // Identidade de serviço do worker (certificado da CA interna) e CA em que confia ao falar com o Signer.
  const cliente = criarClienteDoSigner({
    host: signer.signer.host,
    porta: signer.signer.porta,
    servername: signer.signer.servername,
    certificadoPem: readFileSync(signer.arquivoDoCertificado, 'utf8'),
    chavePem: readFileSync(signer.arquivoDaChave, 'utf8'),
    caPem: readFileSync(signer.arquivoDaCaInterna, 'utf8'),
  });
  const consumidores = await iniciarConsumidores({
    conexao,
    cliente,
    intervaloDoMonitorMs: signer.intervaloDoMonitorMs,
    verificar: () => verificarSaude({ pool, cliente, agora }),
  });

  return consumidores.fechar;
};

const iniciarPlanoDeContas = async (armazenamento: ConfigDoArmazenamento): Promise<Fechar> => {
  const leitor = criarLeitorDoArmazenamento(armazenamento);
  const consumidor = await iniciarConsumidorDoPlanoDeContas({ conexao, pool, ler: leitor.ler, agora });

  return async () => {
    await consumidor.fechar();
    leitor.fechar();
  };
};

const fechamentos: Fechar[] = [];
const ativos: string[] = [];

if (config.signer !== null) {
  fechamentos.push(await iniciarSigner(config.signer));
  ativos.push('Signer');
}
if (config.armazenamento !== null) {
  fechamentos.push(await iniciarPlanoDeContas(config.armazenamento));
  ativos.push('plano de contas');
}

const server = criarServidorDeSaude('workers');

await escutar(server, config.portaDeSaude);
encerrarComGraca(server, async () => {
  await Promise.all(fechamentos.map((fechar) => fechar()));
  await pool.end();
});

const desligados = [
  ...(config.signer === null ? ['Signer (sem os arquivos de mTLS)'] : []),
  ...(config.armazenamento === null ? ['plano de contas (sem S3_*)'] : []),
];

console.warn(
  `[workers] consumidores ativos: ${ativos.join(', ')}; desligados: ${desligados.join(', ') || 'nenhum'}; ` +
    `saúde em http://0.0.0.0:${config.portaDeSaude}/health`,
);
