import type { ConexaoDoRedis } from '@contaia/signer-client';
import { Redis } from 'ioredis';

/**
 * Cliente do Redis para o BullMQ. Em ESM nativo o BullMQ não carrega o `ioredis` sozinho: a
 * instância é construída aqui. `maxRetriesPerRequest: null` é exigência dos Workers (esperam o
 * Redis voltar em vez de falhar o comando bloqueante).
 */
export const criarConexaoRedis = (conexao: ConexaoDoRedis): Redis =>
  new Redis({ ...conexao, maxRetriesPerRequest: null });
