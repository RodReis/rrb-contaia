/**
 * Dublê local de DF-e / eSocial com mTLS (SPEC-012 §3.7). Nada aqui é órgão oficial.
 *
 * Exige certificado cliente (o A1 de teste), valida a cadeia contra a raiz de teste configurada e
 * recusa conexão sem certificado ou de raiz desconhecida ainda no handshake. Depois confere que o
 * CNPJ declarado pela chamada é o do certificado e que o XML veio assinado. Deduplica o efeito
 * pela `Idempotency-Key`: a repetição devolve a resposta original e não conta efeito novo.
 *
 * Só `node:` embutido: roda em contêiner sem dependência alguma. Sem `rejectUnauthorized: false`.
 */
import { X509Certificate, createHash } from 'node:crypto';
import https from 'node:https';

const LIMITE_DO_CORPO_BYTES = 1_048_576;
const CNPJ_NO_CN = /:(\d{14})$/u;

const responder = (resposta, status, corpo, cabecalhos = {}) => {
  const texto = JSON.stringify(corpo);
  resposta.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    ...cabecalhos,
  });
  resposta.end(texto);
};

const lerCorpo = (requisicao) =>
  new Promise((resolver, rejeitar) => {
    const partes = [];
    let total = 0;

    requisicao.on('data', (parte) => {
      total += parte.length;
      if (total > LIMITE_DO_CORPO_BYTES) {
        requisicao.destroy();
        rejeitar(new Error('corpo acima do limite'));
        return;
      }
      partes.push(parte);
    });
    requisicao.on('end', () => resolver(Buffer.concat(partes).toString('utf8')));
    requisicao.on('error', rejeitar);
  });

/** CNPJ do titular, lido do CN do certificado cliente (`RAZAO SOCIAL:<14 dígitos>`, padrão ICP-Brasil). */
const cnpjDoCertificado = (socket) => {
  const par = socket.getPeerCertificate(true);

  if (par === null || par.raw === undefined) {
    return null;
  }
  const cn = /^CN=(.+)$/mu.exec(new X509Certificate(par.raw).subject)?.[1] ?? '';

  return CNPJ_NO_CN.exec(cn)?.[1] ?? null;
};

/**
 * @param {object} opcoes
 * @param {string} opcoes.nome                 Rótulo do dublê (`duble-dfe`, `duble-esocial`).
 * @param {string} opcoes.certificadoPem       Certificado de servidor (CA dos dublês).
 * @param {string} opcoes.chavePem
 * @param {string|string[]} opcoes.caDosClientesPem  Raiz(es) em que o dublê confia para o A1 cliente.
 * @param {(efeito: object) => void} [opcoes.registrarEfeito]  Chamado uma vez por efeito novo.
 */
export const criarDuble = ({ nome, certificadoPem, chavePem, caDosClientesPem, registrarEfeito = () => {} }) => {
  const respostasPorChave = new Map();
  let recusasDeTls = 0;

  const tratar = async (requisicao, resposta) => {
    if (requisicao.method !== 'POST' || requisicao.url !== '/v1/recepcao') {
      responder(resposta, 404, { codigo: 'NAO_ENCONTRADO' });
      return;
    }

    const chave = requisicao.headers['idempotency-key'];

    if (typeof chave !== 'string' || chave.length === 0) {
      responder(resposta, 400, { codigo: 'IDEMPOTENCY_KEY_OBRIGATORIA' });
      return;
    }

    const cnpj = cnpjDoCertificado(requisicao.socket);

    if (cnpj === null || requisicao.headers['x-cnpj-declarado'] !== cnpj) {
      responder(resposta, 403, { codigo: 'IDENTIDADE_INCOMPATIVEL' });
      return;
    }

    const corpo = await lerCorpo(requisicao);

    if (!corpo.includes('<Signature') || !corpo.includes('</Signature>')) {
      responder(resposta, 422, { codigo: 'ASSINATURA_AUSENTE' });
      return;
    }

    const existente = respostasPorChave.get(chave);

    if (existente !== undefined) {
      responder(resposta, existente.status, existente.corpo, { 'x-idempotent-replay': 'true' });
      return;
    }

    const protocolo = createHash('sha256').update(`${nome}:${chave}`).digest('hex').slice(0, 16);
    const aceito = { status: 200, corpo: { aceito: true, protocolo } };

    respostasPorChave.set(chave, aceito);
    registrarEfeito({ duble: nome, cnpj, protocolo });
    responder(resposta, aceito.status, aceito.corpo);
  };

  const servidor = https.createServer(
    {
      cert: certificadoPem,
      key: chavePem,
      ca: caDosClientesPem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    (requisicao, resposta) => {
      tratar(requisicao, resposta).catch(() => responder(resposta, 400, { codigo: 'REQUISICAO_INVALIDA' }));
    },
  );

  servidor.on('tlsClientError', () => {
    recusasDeTls += 1;
  });

  return {
    ouvir: (porta, host) =>
      new Promise((resolver, rejeitar) => {
        servidor.once('error', rejeitar);
        servidor.listen(porta, host, () => resolver(servidor.address().port));
      }),
    fechar: () =>
      new Promise((resolver) => {
        servidor.closeAllConnections();
        servidor.close(() => resolver());
      }),
    efeitos: () => respostasPorChave.size,
    recusasDeTls: () => recusasDeTls,
  };
};
