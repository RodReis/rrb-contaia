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
  const cienciasPorChave = new Map();
  const respostaDaCienciaPorIdentidade = new Map();
  let efeitosRegistrados = 0;
  let recusasDeTls = 0;

  const tratar = async (requisicao, resposta) => {
    if (requisicao.method === 'POST' && requisicao.url === '/v1/manifestacao') {
      const chave = requisicao.headers['idempotency-key'];
      const cnpj = cnpjDoCertificado(requisicao.socket);
      const cnpjDeclarado = requisicao.headers['x-cnpj-declarado'];
      const xml = await lerCorpo(requisicao);
      const accessKey = /<chNFe>(\d{44})<\/chNFe>/u.exec(xml)?.[1] ?? null;
      const eventType = /<tpEvento>(\d{6})<\/tpEvento>/u.exec(xml)?.[1] ?? null;
      const sequence = /<nSeqEvento>(\d+)<\/nSeqEvento>/u.exec(xml)?.[1] ?? null;
      const eventCnpj = /<CNPJ>(\d{14})<\/CNPJ>/u.exec(xml)?.[1] ?? null;
      if (typeof chave !== 'string' || cnpj === null || cnpjDeclarado !== cnpj || eventCnpj !== cnpj ||
          accessKey === null || eventType !== '210210' || sequence !== '1' ||
          !xml.includes('<Signature') || !xml.includes('</Signature>')) {
        responder(resposta, 422, { tipo: 'REJEITADO', codigo: 'IDENTIDADE_OU_EVENTO_INVALIDO' });
        return;
      }
      const identidade = JSON.stringify({ cnpj, accessKey, eventType, sequence });
      const existente = respostasPorChave.get(`ciencia:${chave}`);
      if (existente !== undefined) {
        if (existente.identidade !== identidade) { responder(resposta, 409, { codigo: 'IDEMPOTENCIA_CONFLITO' }); return; }
        responder(resposta, existente.status, existente.corpo, { 'x-idempotent-replay': 'true' });
        return;
      }
      const anteriorDaIdentidade = respostaDaCienciaPorIdentidade.get(identidade);
      if (anteriorDaIdentidade !== undefined) {
        const duplicidade = { ...anteriorDaIdentidade.corpo, tipo: 'DUPLICIDADE', codigo: '573' };
        respostasPorChave.set(`ciencia:${chave}`, { status: 200, corpo: duplicidade, identidade });
        responder(resposta, 200, duplicidade);
        return;
      }
      const protocolo = createHash('sha256').update(`${nome}:${chave}`).digest('hex').slice(0, 16);
      const resultado = { tipo: 'ACEITO', codigo: '135', protocolo, chaveAcesso: accessKey, cnpj, tipoEvento: '210210',
        sequencia: 1, ambiente: 'HOMOLOGACAO', recebidoEm: new Date().toISOString() };
      respostasPorChave.set(`ciencia:${chave}`, { status: 200, corpo: resultado, identidade });
      respostaDaCienciaPorIdentidade.set(identidade, { status: 200, corpo: resultado, identidade });
      cienciasPorChave.set(accessKey, cnpj);
      efeitosRegistrados += 1;
      registrarEfeito({ duble: nome, cnpj, tipo: 'CIENCIA_210210', protocolo });
      responder(resposta, 200, resultado);
      return;
    }

    if (requisicao.method === 'POST' && requisicao.url === '/v1/distribuicao-chave') {
      const chave = requisicao.headers['idempotency-key'];
      const cnpj = cnpjDoCertificado(requisicao.socket);
      if (typeof chave !== 'string' || cnpj === null || requisicao.headers['x-cnpj-declarado'] !== cnpj) {
        responder(resposta, 403, { codigo: 'IDENTIDADE_INCOMPATIVEL' });
        return;
      }
      const corpo = JSON.parse(await lerCorpo(requisicao));
      const accessKey = corpo.chaveAcesso;
      if (corpo.cnpj !== cnpj || typeof accessKey !== 'string' || !/^\d{44}$/u.test(accessKey)) {
        responder(resposta, 400, { codigo: 'REQUISICAO_INVALIDA' });
        return;
      }
      if (cienciasPorChave.get(accessKey) !== cnpj) {
        responder(resposta, 200, { tipo: 'PENDENTE', xmlCompleto: null, chaveAcesso: accessKey, cnpj, codigo: 'XML_AINDA_NAO_DISPONIVEL' });
        return;
      }
      const id = `NFe${accessKey}`;
      const xmlCompleto = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe versao="4.00" Id="${id}"><ide><mod>55</mod><dhEmi>2026-01-15T10:00:00-03:00</dhEmi></ide><emit><CNPJ>00000000000000</CNPJ></emit><dest><CNPJ>${cnpj}</CNPJ></dest><det nItem="1"><prod><xProd>Documento sintetico de teste</xProd></prod></det><total><ICMSTot><vNF>0.00</vNF></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${accessKey}</chNFe><dhRecbto>2026-01-15T10:01:00-03:00</dhRecbto><nProt>135${accessKey.slice(-12)}</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
      responder(resposta, 200, { tipo: 'OBTIDO', xmlCompleto, chaveAcesso: accessKey, cnpj, codigo: null });
      return;
    }

    if (requisicao.method === 'POST' && requisicao.url === '/v1/distribuicao') {
      const chave = requisicao.headers['idempotency-key'];
      const cnpj = cnpjDoCertificado(requisicao.socket);
      if (typeof chave !== 'string' || cnpj === null || requisicao.headers['x-cnpj-declarado'] !== cnpj) {
        responder(resposta, 403, { codigo: 'IDENTIDADE_INCOMPATIVEL' });
        return;
      }
      const corpo = JSON.parse(await lerCorpo(requisicao));
      if (corpo.cnpj !== cnpj || !/^\d{1,15}$/u.test(corpo.ultNSU) || !Number.isInteger(corpo.limite) || corpo.limite < 1 || corpo.limite > 50) {
        responder(resposta, 400, { codigo: 'REQUISICAO_INVALIDA' });
        return;
      }
      const existente = respostasPorChave.get(`dfe:${chave}`);
      if (existente !== undefined) {
        if (existente.fingerprint !== JSON.stringify(corpo)) {
          responder(resposta, 409, { codigo: 'IDEMPOTENCIA_CONFLITO' });
          return;
        }
        responder(resposta, existente.status, existente.corpo, { 'x-idempotent-replay': 'true' });
        return;
      }
      const cursor = BigInt(corpo.ultNSU);
      const temNovo = cursor === 0n;
      const proximo = temNovo ? '000000000000001' : corpo.ultNSU;
      const respostaLote = {
        tipo: temNovo ? 'LOTE' : 'SEM_NOVOS', codigoResposta: temNovo ? '137' : '139',
        ultNSU: proximo, maxNSU: proximo, tempoMedioMs: 60_000, disponivelNovamenteEm: null,
        itens: temNovo ? [{ nsu: proximo, chaveAcesso: null, especie: 'NFE_55', conteudoBruto: '<NFe>opaco-fixture</NFe>', disponibilizadoEm: null }] : [],
      };
      respostasPorChave.set(`dfe:${chave}`, { status: 200, corpo: respostaLote, fingerprint: JSON.stringify(corpo) });
      efeitosRegistrados += 1;
      registrarEfeito({ duble: nome, cnpj, tipo: 'DISTRIBUICAO_DFE' });
      responder(resposta, 200, respostaLote);
      return;
    }

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
    efeitosRegistrados += 1;
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
    efeitos: () => efeitosRegistrados,
    recusasDeTls: () => recusasDeTls,
  };
};
