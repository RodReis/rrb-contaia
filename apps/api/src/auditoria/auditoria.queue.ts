import { Logger, type Provider } from '@nestjs/common';
import { AUDIT_EXPORT_QUEUE } from '@contaia/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const AUDIT_EXPORT_API_QUEUE = Symbol('AUDIT_EXPORT_API_QUEUE');

const abrir = () => {
  const url = process.env['REDIS_URL']?.trim();
  if (!url) return { queue: null as Queue | null, fechar: async () => undefined };
  const connection = new Redis(url, { maxRetriesPerRequest: 3 });
  const queue = new Queue(AUDIT_EXPORT_QUEUE, { connection });
  queue.on('error', (error: Error) => new Logger('FilaAuditoria').warn(`Fila de exportação indisponível: ${error.name}`));
  return { queue, fechar: async () => { await queue.close(); await connection.quit().catch(() => connection.disconnect()); } };
};

let compartilhada: ReturnType<typeof abrir> | null = null;
const obter = () => compartilhada ??= abrir();

export const PROVEDOR_DA_FILA_DE_AUDITORIA: Provider[] = [
  { provide: AUDIT_EXPORT_API_QUEUE, useFactory: () => obter().queue },
  { provide: 'AUDIT_EXPORT_API_QUEUE_LIFECYCLE', useFactory: () => ({ onModuleDestroy: async () => { await compartilhada?.fechar(); compartilhada = null; } }) },
];
