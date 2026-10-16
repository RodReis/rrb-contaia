import { Logger, type Provider } from '@nestjs/common';
import { FISCAL_RISK_API_QUEUE, FISCAL_RISK_QUEUE } from '@contaia/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const abrir = () => {
  const url = process.env['REDIS_URL']?.trim();
  if (!url) return { queue: null as Queue | null, fechar: async () => undefined };
  const connection = new Redis(url, { maxRetriesPerRequest: 3 });
  const queue = new Queue(FISCAL_RISK_QUEUE, { connection });
  queue.on('error', (error: Error) => new Logger('FilaFiscalRisk').warn(`Fila de análise indisponível: ${error.name}`));
  return { queue, fechar: async () => { await queue.close(); await connection.quit().catch(() => connection.disconnect()); } };
};
let shared: ReturnType<typeof abrir> | null = null;
const obter = () => shared ??= abrir();

export const PROVEDOR_DA_FILA_FISCAL_RISK: Provider[] = [
  { provide: FISCAL_RISK_API_QUEUE, useFactory: () => obter().queue },
  { provide: 'FISCAL_RISK_API_QUEUE_LIFECYCLE', useFactory: () => ({ onModuleDestroy: async () => { await shared?.fechar(); shared = null; } }) },
];
