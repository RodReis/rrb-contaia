import { Logger, type Provider } from '@nestjs/common';
import { FISCAL_DOCUMENTS_QUEUE } from '@contaia/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const FISCAL_DOCUMENTS_API_QUEUE = Symbol('FISCAL_DOCUMENTS_API_QUEUE');
const abrir = () => {
  const url = process.env['REDIS_URL']?.trim();
  if (!url) return { queue: null as Queue | null, fechar: async () => undefined };
  const connection = new Redis(url, { maxRetriesPerRequest: 3 });
  const queue = new Queue(FISCAL_DOCUMENTS_QUEUE, { connection });
  queue.on('error', (error: Error) => new Logger('FilaFiscalDocuments').warn(`Fila fiscal indisponível: ${error.name}`));
  return { queue, fechar: async () => { await queue.close(); await connection.quit().catch(() => connection.disconnect()); } };
};
let shared: ReturnType<typeof abrir> | null = null;
const obter = () => shared ??= abrir();
export const PROVEDOR_DA_FILA_FISCAL = [
  { provide: FISCAL_DOCUMENTS_API_QUEUE, useFactory: () => obter().queue },
  { provide: 'FISCAL_DOCUMENTS_API_QUEUE_LIFECYCLE', useFactory: () => ({ onModuleDestroy: async () => { await shared?.fechar(); shared = null; } }) },
] satisfies Provider[];
