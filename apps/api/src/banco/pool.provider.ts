/**
 * Pool único do processo, fechado no shutdown do Nest.
 *
 * Conecta SEMPRE como o papel da aplicação (`contaia_app`, sem SUPERUSER nem
 * BYPASSRLS): com o superusuário das migrations a RLS de dois níveis não vale
 * (SPEC-010). O processo não sobe se o papel conectado ignorar a RLS.
 */
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';

import { criarPoolDaAplicacao } from '@contaia/db';

@Injectable()
export class PoolDoBanco implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PoolDoBanco.name);
  readonly instancia: Pool = criarPoolDaAplicacao();

  async onModuleInit(): Promise<void> {
    const { rows } = await this.instancia.query<{
      papel: string;
      superusuario: boolean;
      ignora_rls: boolean;
    }>(
      `select current_user::text as papel, r.rolsuper as superusuario, r.rolbypassrls as ignora_rls
         from pg_roles r where r.rolname = current_user`,
    );
    const conexao = rows[0];

    if (conexao === undefined || conexao.superusuario || conexao.ignora_rls) {
      throw new Error(
        `A API conectou como "${conexao?.papel ?? 'desconhecido'}", que ignora a RLS. ` +
          'Use o papel da aplicação (DATABASE_APP_URL ou contaia_app); superusuário só para migrations e seed.',
      );
    }

    this.logger.log(`Banco conectado como ${conexao.papel} (sem BYPASSRLS).`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.instancia.end();
  }
}
