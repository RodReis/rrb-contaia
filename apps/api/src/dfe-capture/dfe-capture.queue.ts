import { Logger, type Provider } from '@nestjs/common';
import { DFE_CAPTURE_QUEUE } from '@contaia/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const DFE_CAPTURE_API_QUEUE = Symbol('DFE_CAPTURE_API_QUEUE');

export const criarFilaDfeCapture = (): Readonly<{ queue: Queue | null; fechar: () => Promise<void> }> => {
  const url = process.env['REDIS_URL']?.trim();
  if (!url) return { queue: null, fechar: async () => undefined };
  const connection = new Redis(url, { maxRetriesPerRequest: 3 });
  const queue = new Queue(DFE_CAPTURE_QUEUE, { connection });
  queue.on('error', (error: Error) => new Logger('FilaDfeCapture').warn(`Fila de captura indisponível: ${error.name}`));
  return { queue, fechar: async () => { await queue.close(); await connection.quit().catch(() => connection.disconnect()); } };
};

let fila: ReturnType<typeof criarFilaDfeCapture> | null = null;
const obterFila = () => (fila ??= criarFilaDfeCapture());

export const PROVEDOR_DA_FILA_DFE_CAPTURE: Provider[] = [
  { provide: DFE_CAPTURE_API_QUEUE, useFactory: () => obterFila().queue },
  { provide: 'DFE_CAPTURE_API_QUEUE_LIFECYCLE', useFactory: () => ({ onModuleDestroy: async () => { await fila?.fechar(); fila = null; } }), inject: [], },
];
