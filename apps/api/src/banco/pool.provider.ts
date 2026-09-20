/** Pool único do processo, fechado no shutdown do Nest. */
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';

import { criarPool } from '@contaia/db';

@Injectable()
export class PoolDoBanco implements OnApplicationShutdown {
  readonly instancia: Pool = criarPool();

  async onApplicationShutdown(): Promise<void> {
    await this.instancia.end();
  }
}
