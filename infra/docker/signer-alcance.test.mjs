/**
 * Alcance do Signer na composição Docker (SPEC-012 §3.1, critério de aceite "sem porta nem domínio
 * público"). Roda contra a composição JÁ no ar (`pnpm docker:up`); sem ela cada teste é PULADO com a
 * razão explícita — `not_run`, nunca PASS.
 *
 *   node --test infra/docker/signer-alcance.test.mjs
 *
 * Provas: (1) o Signer não publica porta no host e a rede dele é interna; (2) da API, a identidade
 * `api` fala com o Signer; (3) sem certificado de serviço o handshake é recusado; (4) estar na rede
 * não basta: a alçada da `api` não inclui assinar.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

const PROJETO = process.env.COMPOSE_PROJECT_NAME ?? 'contaia';
const SIGNER = `${PROJETO}-signer`;
const API = `${PROJETO}-api`;
const REDE_PRIVADA = `${PROJETO}_privada`;

const docker = (...argumentos) =>
  execFileSync('docker', argumentos, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const emExecucao = (nome) => {
  try {
    return docker('inspect', '--format', '{{.State.Running}}', nome) === 'true';
  } catch {
    return false;
  }
};

const composicaoNoAr = emExecucao(SIGNER) && emExecucao(API);
const pular = composicaoNoAr ? false : `composição não está no ar (${SIGNER}/${API}): not_run`;

/** Corre `node -e` dentro da API, que tem o certificado `api` e a CA interna montados. */
const daApi = (programa) => docker('exec', API, 'node', '-e', programa);

const PEDIDO_COM_IDENTIDADE = (caminho, metodo = 'GET') => `
  const fs = require('node:fs');
  const https = require('node:https');
  const requisicao = https.request({
    host: 'signer', port: 8443, path: '${caminho}', method: '${metodo}', servername: 'signer',
    cert: fs.readFileSync(process.env.API_CERT_FILE), key: fs.readFileSync(process.env.API_KEY_FILE),
    ca: fs.readFileSync(process.env.SIGNER_CA_INTERNA_FILE),
    headers: { 'content-type': 'application/json' }, timeout: 5000,
  }, (resposta) => { resposta.resume(); console.log(resposta.statusCode); });
  requisicao.on('error', (erro) => console.log('ERRO ' + (erro.code ?? erro.message)));
  requisicao.end('${metodo}' === 'POST' ? '{}' : undefined);
`;

describe('alcance do Signer na rede privada', { skip: pular }, () => {
  it('não publica porta no host', () => {
    const publicadas = docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', SIGNER);
    const ligacoes = docker('inspect', '--format', '{{json .HostConfig.PortBindings}}', SIGNER);

    // Portas só EXPOSTAS (sem destino no host) aparecem como `null`; publicada teria HostPort.
    assert.ok(!publicadas.includes('HostPort'), `porta publicada: ${publicadas}`);
    assert.ok(ligacoes === 'null' || ligacoes === '{}', `PortBindings: ${ligacoes}`);
  });

  it('a rede privada é interna e o Signer só está nela', () => {
    assert.equal(docker('network', 'inspect', '--format', '{{.Internal}}', REDE_PRIVADA), 'true');

    const redes = docker('inspect', '--format', '{{json .NetworkSettings.Networks}}', SIGNER);

    assert.deepEqual(Object.keys(JSON.parse(redes)), [REDE_PRIVADA]);
  });

  it('da API, a identidade `api` consulta a saúde do Signer', () => {
    assert.equal(daApi(PEDIDO_COM_IDENTIDADE('/v1/saude')), '200');
  });

  it('sem certificado de serviço o handshake é recusado, mesmo dentro da rede', () => {
    const saida = daApi(`
      const https = require('node:https');
      const fs = require('node:fs');
      const requisicao = https.request({
        host: 'signer', port: 8443, path: '/v1/saude', servername: 'signer',
        ca: fs.readFileSync(process.env.SIGNER_CA_INTERNA_FILE), timeout: 5000,
      }, (resposta) => { resposta.resume(); console.log('RESPONDEU ' + resposta.statusCode); });
      requisicao.on('error', (erro) => console.log('ERRO ' + (erro.code ?? erro.message)));
      requisicao.end();
    `);

    assert.ok(saida.startsWith('ERRO'), `esperava recusa no handshake, veio: ${saida}`);
  });

  it('estar na rede não basta: a alçada da `api` não inclui assinar', () => {
    assert.equal(daApi(PEDIDO_COM_IDENTIDADE('/v1/assinar', 'POST')), '403');
  });
});
