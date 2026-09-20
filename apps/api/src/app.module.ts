import { Module } from '@nestjs/common';

import { PoolDoBanco } from './banco/pool.provider';
import { SessaoService } from './auth/sessao.service';
import { GuardDeCadastro, GuardDeSessao } from './auth/sessao.guard';
import { EscritorioController } from './escritorio/escritorio.controller';
import { EscritorioService } from './escritorio/escritorio.service';
import { PainelController } from './escritorio/painel.controller';
import { StorageService } from './escritorio/storage.service';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController, EscritorioController, PainelController],
  providers: [
    PoolDoBanco,
    SessaoService,
    StorageService,
    EscritorioService,
    GuardDeSessao,
    GuardDeCadastro,
  ],
})
export class AppModule {}
