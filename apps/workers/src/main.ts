import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';

import { criarPoolDaAplicacao, criarPoolDoAgendadorDashboard, criarPoolDoAgendadorDfe } from '@contaia/db';
import { conexaoDoRedis, criarClienteDoSigner } from '@contaia/signer-client';

import { lerConfig, type ConfigDoArmazenamento, type ConfigDoSigner } from './config.js';
import { iniciarConsumidores } from './consumidores.js';
import { verificarSaude } from './monitor.js';
import { iniciarConsumidorDeEmpregados } from './empregados/consumidor.js';
import { iniciarConsumidorDfeCapture } from './dfe-capture.js';
import { iniciarConsumidorDeDocumentosFiscais } from './fiscal-documents.js';
import { iniciarConsumidorNfce } from './nfce.js';
import { iniciarConsumidorDeRiscoFiscal } from './fiscal-risk.js';
import { iniciarConsumidorDeExportacoesDeAuditoria } from './audit-export.js';
import { iniciarConsumidorDeManifestacoesConclusivas } from './fiscal-manifestation.js';
import { iniciarAgendadorDeObrigacoes } from './obligations.js';
import { iniciarReconciliadorDeSaude } from './dashboard-health.js';
import { iniciarAgendadorDeAlertasDeProcuracao } from './rfb-procuracao-scheduler.js';
import { criarLeitorDoArmazenamento } from './importacao/leitura-s3.js';
import { iniciarConsumidorDoPlanoDeContas } from './plano-contas/consumidor.js';
import { criarServidorDeSaude, encerrarComGraca, escutar } from './server.js';

type Fechar = () => Promise<void>;

const config = lerConfig(process.env);
const conexao = conexaoDoRedis(config.redisUrl);
const pool = criarPoolDaAplicacao();
const schedulerPool = criarPoolDoAgendadorDfe();
const dashboardSchedulerPool = criarPoolDoAgendadorDashboard();
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

// Os consumidores das importações (plano de contas e empregados) leem o original do mesmo storage e
// sobem juntos: o mesmo grupo S3_* liga os dois.
const iniciarImportacoes = async (armazenamento: ConfigDoArmazenamento): Promise<Fechar> => {
  const leitor = criarLeitorDoArmazenamento(armazenamento);
  const opcoes = { conexao, pool, ler: leitor.ler, agora };
  const plano = await iniciarConsumidorDoPlanoDeContas(opcoes);
  const empregados = await iniciarConsumidorDeEmpregados(opcoes);

  return async () => {
    await Promise.all([plano.fechar(), empregados.fechar()]);
    leitor.fechar();
  };
};

const fechamentos: Fechar[] = [];
const ativos: string[] = [];
const obligations = iniciarAgendadorDeObrigacoes({pool,schedulerPool,conexao,agora});
fechamentos.push(obligations.fechar);
ativos.push('agenda de obrigações F22');
const dashboardHealth = iniciarReconciliadorDeSaude({ pool, schedulerPool: dashboardSchedulerPool, agora });
fechamentos.push(dashboardHealth.fechar);
ativos.push('reconciliação do dashboard F23');
const alertasProcuracao = iniciarAgendadorDeAlertasDeProcuracao({ schedulerPool: dashboardSchedulerPool });
fechamentos.push(alertasProcuracao.fechar);
ativos.push('alertas de procuração RFB F25');

if (config.signer !== null) {
  fechamentos.push(await iniciarSigner(config.signer));
  ativos.push('Signer');
  const certificadoPem = readFileSync(config.signer.arquivoDoCertificado, 'utf8');
  const chavePem = readFileSync(config.signer.arquivoDaChave, 'utf8');
  const caPem = readFileSync(config.signer.arquivoDaCaInterna, 'utf8');
  const signer = criarClienteDoSigner({ host: config.signer.signer.host, porta: config.signer.signer.porta,
    servername: config.signer.signer.servername, certificadoPem, chavePem, caPem });
  const captura = await iniciarConsumidorDfeCapture({ pool, schedulerPool: schedulerPool!, conexao, signer, agora });
  fechamentos.push(async () => { await captura.fechar(); });
  ativos.push('captura DF-e');
}
if (config.armazenamento !== null) {
  const roots=config.raizesIcp?readdirSync(config.raizesIcp.diretorio).filter(name=>/\.(?:crt|pem)$/iu.test(name)).map(name=>new X509Certificate(readFileSync(path.join(config.raizesIcp!.diretorio,name)))):[];
  const fiscalDocuments = await iniciarConsumidorDeDocumentosFiscais({ pool, schedulerPool: schedulerPool!, conexao, storage: config.armazenamento, certificateRoots:roots,
    ...(config.signer ? { signer: criarClienteDoSigner({ host:config.signer.signer.host,porta:config.signer.signer.porta,servername:config.signer.signer.servername,
      certificadoPem:readFileSync(config.signer.arquivoDoCertificado,'utf8'),chavePem:readFileSync(config.signer.arquivoDaChave,'utf8'),caPem:readFileSync(config.signer.arquivoDaCaInterna,'utf8') }) } : {}) });
  fechamentos.push(async () => { await fiscalDocuments.fechar(); });
  ativos.push('documentos fiscais F18');
  fechamentos.push(await iniciarImportacoes(config.armazenamento));
  ativos.push('plano de contas', 'empregados');
  if(config.raizesIcp){
    if(roots.length===0)throw new Error('Pacote de raízes ICP-Brasil vazio; importação NFC-e permanece desativada.');
    const nfce=await iniciarConsumidorNfce({pool,conexao,storage:config.armazenamento,certificateRoots:roots});
    fechamentos.push(async()=>{await nfce.fechar();});ativos.push('importação NFC-e F30');
  } else {
    throw new Error('COFRE_RAIZES_ICP_DIR obrigatório para iniciar o worker com importação NFC-e F30.');
  }
}
const fiscalRisk = await iniciarConsumidorDeRiscoFiscal({pool,conexao});
fechamentos.push(async()=>{await fiscalRisk.fechar();});
ativos.push('análise fiscal F20 (abstenção segura até regra PI)');
if (config.armazenamento !== null) {
  const exportsAudit = await iniciarConsumidorDeExportacoesDeAuditoria({ pool, conexao, armazenamento: config.armazenamento });
  fechamentos.push(async () => { await exportsAudit.fechar(); });
  ativos.push('exportação temporária da auditoria F24');
}
if(config.signer){
 const conclusivas=await iniciarConsumidorDeManifestacoesConclusivas({pool,conexao,signer:criarClienteDoSigner({host:config.signer.signer.host,porta:config.signer.signer.porta,servername:config.signer.signer.servername,
  certificadoPem:readFileSync(config.signer.arquivoDoCertificado,'utf8'),chavePem:readFileSync(config.signer.arquivoDaChave,'utf8'),caPem:readFileSync(config.signer.arquivoDaCaInterna,'utf8')})});
 fechamentos.push(async()=>{await conclusivas.fechar();});ativos.push('manifestações conclusivas F21');
}
const server = criarServidorDeSaude('workers');

await escutar(server, config.portaDeSaude);
encerrarComGraca(server, async () => {
  await Promise.all(fechamentos.map((fechar) => fechar()));
  await schedulerPool.end();
  await dashboardSchedulerPool.end();
  await pool.end();
});

const desligados = [
  ...(config.signer === null ? ['Signer (sem os arquivos de mTLS)'] : []),
  ...(config.armazenamento === null ? ['plano de contas e empregados (sem S3_*)'] : []),
];

console.warn(
  `[workers] consumidores ativos: ${ativos.join(', ')}; desligados: ${desligados.join(', ') || 'nenhum'}; ` +
    `saúde em http://0.0.0.0:${config.portaDeSaude}/health`,
);
