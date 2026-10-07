/**
 * Healthcheck do contêiner do Signer. O servidor é mTLS e não tem porta publicada: a verificação
 * entra pela própria identidade `signer` (certificado de serviço da CA interna, alçada `saude`) e
 * sai com 0 só se o `/v1/saude` responder 200. Nunca desliga a validação do certificado.
 */
import { readFileSync } from 'node:fs';
import https from 'node:https';

const PORTA_PADRAO = 8443;
const TEMPO_LIMITE_MS = 3_000;

const arquivo = (nome: string): string => {
  const caminho = process.env[nome];

  if (caminho === undefined || caminho.trim() === '') {
    throw new Error(`Variável obrigatória ausente: ${nome}`);
  }

  return readFileSync(caminho.trim(), 'utf8');
};

const requisicao = https.request(
  {
    host: '127.0.0.1',
    port: Number(process.env['SIGNER_PORT'] ?? PORTA_PADRAO),
    path: '/v1/saude',
    method: 'GET',
    // O certificado do Signer apresenta o nome `signer` (SAN DNS), nunca o IP de loopback.
    servername: 'signer',
    cert: arquivo('SIGNER_CERT_FILE'),
    key: arquivo('SIGNER_KEY_FILE'),
    ca: arquivo('SIGNER_CA_INTERNA_FILE'),
    timeout: TEMPO_LIMITE_MS,
  },
  (resposta) => {
    resposta.resume();
    process.exit(resposta.statusCode === 200 ? 0 : 1);
  },
);

requisicao.on('timeout', () => requisicao.destroy());
requisicao.on('error', () => process.exit(1));
requisicao.end();
