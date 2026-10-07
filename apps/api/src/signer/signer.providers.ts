/**
 * Cliente mTLS do Signer e fila de diagnóstico, montados do ambiente (SPEC-012 §3.1).
 *
 * A API SOBE sem eles: o modo local no host (sem Signer na rede privada) segue servindo as demais
 * fatias. Sem configuração, toda chamada ao Signer falha como "indisponível" — o cartão e o painel
 * mostram isso com clareza — e nada tenta rede. Com configuração, a API apresenta a SUA identidade
 * de serviço (certificado `api`, que a alçada do Signer limita a consultar e diagnosticar).
 */
import { readFileSync } from 'node:fs';

import { Logger, type Provider } from '@nestjs/common';
import {
  ErroDoClienteDoSigner,
  FILA_DE_DIAGNOSTICO,
  conexaoDoRedis,
  criarClienteDoSigner as criarClienteMtls,
  type ClienteDoSigner,
  type FilaQueEnfileira,
} from '@contaia/signer-client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { SignerService } from './signer.service';
import { CLIENTE_DO_SIGNER, FILA_DE_DIAGNOSTICO_DA_API } from './signer.tokens';

export type ConfigDoSignerNaApi = Readonly<{
  host: string;
  porta: number;
  servername: string;
  arquivoDoCertificado: string;
  arquivoDaChave: string;
  arquivoDaCaInterna: string;
}>;

const PORTA_INTERNA_PADRAO = 8_443;

/** `null` = Signer não configurado neste ambiente (a API sobe do mesmo jeito). */
export const lerConfigDoSigner = (env: NodeJS.ProcessEnv): ConfigDoSignerNaApi | null => {
  const certificado = env['API_CERT_FILE']?.trim();
  const chave = env['API_KEY_FILE']?.trim();
  const ca = env['SIGNER_CA_INTERNA_FILE']?.trim();

  if (!certificado || !chave || !ca) {
    return null;
  }

  const bruta = env['SIGNER_PORT']?.trim();
  const porta = bruta === undefined || bruta === '' ? PORTA_INTERNA_PADRAO : Number(bruta);

  if (!Number.isInteger(porta) || porta < 1 || porta > 65_535) {
    throw new Error('SIGNER_PORT deve ser uma porta TCP válida');
  }

  return {
    host: env['SIGNER_HOST']?.trim() || 'signer',
    porta,
    servername: env['SIGNER_SERVERNAME']?.trim() || 'signer',
    arquivoDoCertificado: certificado,
    arquivoDaChave: chave,
    arquivoDaCaInterna: ca,
  };
};

const indisponivel = (): Promise<never> =>
  Promise.reject(new ErroDoClienteDoSigner('SIGNER_INDISPONIVEL', null, null, true));

const clienteDesligado = (): ClienteDoSigner => ({
  saude: indisponivel,
  assinar: indisponivel,
  executarMtls: indisponivel,
  diagnosticar: indisponivel,
  estados: indisponivel,
  historico: indisponivel,
});

export const criarClienteDoSigner = (env: NodeJS.ProcessEnv): ClienteDoSigner => {
  const config = lerConfigDoSigner(env);

  if (config === null) {
    new Logger('Signer').warn('Signer não configurado (API_CERT_FILE/API_KEY_FILE/SIGNER_CA_INTERNA_FILE): consultas retornam indisponível.');

    return clienteDesligado();
  }

  return criarClienteMtls({
    host: config.host,
    porta: config.porta,
    servername: config.servername,
    certificadoPem: readFileSync(config.arquivoDoCertificado, 'utf8'),
    chavePem: readFileSync(config.arquivoDaChave, 'utf8'),
    caPem: readFileSync(config.arquivoDaCaInterna, 'utf8'),
  });
};

export const criarFilaDeDiagnostico = (env: NodeJS.ProcessEnv): FilaQueEnfileira => {
  const url = env['REDIS_URL']?.trim();

  if (!url) {
    return { add: () => Promise.reject(new Error('REDIS_URL ausente: diagnóstico pós-cadastro não enfileirado')) };
  }

  // Em ESM nativo o BullMQ pede a instância; o produtor não usa `maxRetriesPerRequest: null`.
  return new Queue(FILA_DE_DIAGNOSTICO, { connection: new Redis({ ...conexaoDoRedis(url), maxRetriesPerRequest: 3 }) });
};

export const PROVEDORES_DO_SIGNER: Provider[] = [
  SignerService,
  { provide: CLIENTE_DO_SIGNER, useFactory: () => criarClienteDoSigner(process.env) },
  { provide: FILA_DE_DIAGNOSTICO_DA_API, useFactory: () => criarFilaDeDiagnostico(process.env) },
];
