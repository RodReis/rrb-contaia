import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { criarPki, raizConfiavelEmPem } from '../../../scripts/gerar-pki-de-teste.mjs';
import { carregarRaizes, lerConfig, resolverCaminho } from './config.js';

const ENV_VALIDO: NodeJS.ProcessEnv = {
  COFRE_PORT: '15104',
  VAULT_ADDR: 'http://127.0.0.1:18200/',
  COFRE_VAULT_TOKEN_FILE: '/tokens/cofre',
  COFRE_RAIZES_ICP_DIR: '/raizes',
  COFRE_API_URL: 'http://127.0.0.1:15101/',
  COFRE_TICKET_SECRET: 'a'.repeat(32),
  COFRE_SERVICE_TOKEN: 'b'.repeat(32),
  COFRE_ADMIN_TOKEN: 'c'.repeat(32),
  COFRE_ORIGENS_PERMITIDAS: 'http://127.0.0.1:15100/, http://localhost:15100',
};

describe('lerConfig', () => {
  it('lê tudo do ambiente e normaliza barras finais e origens', () => {
    const config = lerConfig(ENV_VALIDO);

    expect(config).toMatchObject({
      porta: 15104,
      vaultAddr: 'http://127.0.0.1:18200',
      apiUrl: 'http://127.0.0.1:15101',
      origensPermitidas: ['http://127.0.0.1:15100', 'http://localhost:15100'],
    });
  });

  it.each(['VAULT_ADDR', 'COFRE_TICKET_SECRET', 'COFRE_SERVICE_TOKEN', 'COFRE_ADMIN_TOKEN', 'COFRE_ORIGENS_PERMITIDAS', 'COFRE_API_URL'])(
    'falha fechado sem %s',
    (nome) => {
      expect(() => lerConfig({ ...ENV_VALIDO, [nome]: '' })).toThrow(nome);
    },
  );

  it('recusa segredo com menos de 32 bytes', () => {
    expect(() => lerConfig({ ...ENV_VALIDO, COFRE_TICKET_SECRET: 'curto' })).toThrow(/32 bytes/);
    expect(() => lerConfig({ ...ENV_VALIDO, COFRE_SERVICE_TOKEN: 'd'.repeat(31) })).toThrow(/32 bytes/);
    expect(() => lerConfig({ ...ENV_VALIDO, COFRE_ADMIN_TOKEN: 'd'.repeat(31) })).toThrow(/32 bytes/);
  });

  it('as duas credenciais de serviço (cofre→API e API→cofre) precisam ser diferentes', () => {
    expect(() => lerConfig({ ...ENV_VALIDO, COFRE_ADMIN_TOKEN: ENV_VALIDO['COFRE_SERVICE_TOKEN'] })).toThrow(
      /diferentes/,
    );
    const config = lerConfig(ENV_VALIDO);
    expect(config.serviceToken).not.toBe(config.adminToken);
  });

  it('escuta em 127.0.0.1 por padrão; COFRE_HOST é opt-in explícito', () => {
    expect(lerConfig(ENV_VALIDO).host).toBe('127.0.0.1');
    expect(lerConfig({ ...ENV_VALIDO, COFRE_HOST: '' }).host).toBe('127.0.0.1');
    expect(lerConfig({ ...ENV_VALIDO, COFRE_HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
  });

  it('caminho absoluto fica como está; relativo sobe até a raiz do workspace', () => {
    expect(resolverCaminho('/abs/x')).toBe('/abs/x');
    expect(resolverCaminho('infra/docker/.vault-local/token', process.cwd())).toMatch(/infra[\\/]docker[\\/]\.vault-local[\\/]token$/);
  });
});

describe('carregarRaizes', () => {
  let pasta: string | undefined;
  afterAll(async () => {
    if (pasta) await rm(pasta, { recursive: true, force: true });
  });

  it('carrega todo .pem do diretório e ignora o resto', async () => {
    pasta = await mkdtemp(join(tmpdir(), 'raizes-'));
    await writeFile(join(pasta, 'a.pem'), raizConfiavelEmPem(criarPki()));
    await writeFile(join(pasta, 'b.PEM'), raizConfiavelEmPem(criarPki()));
    await writeFile(join(pasta, 'leia-me.txt'), 'não é certificado');

    expect(await carregarRaizes(pasta)).toHaveLength(2);
  });
});
