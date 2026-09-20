import { Module } from '@nestjs/common';

import { PoolDoBanco } from './banco/pool.provider';
import { SessaoService } from './auth/sessao.service';
import { GuardDeCadastro, GuardDeSessao } from './auth/sessao.guard';
import { ConsultaDeCnpjNaCnpja } from './empresa/cnpja.adapter';
import { EmpresaController } from './empresa/empresa.controller';
import { EmpresaService } from './empresa/empresa.service';
import { EscritorioController } from './escritorio/escritorio.controller';
import { EscritorioService } from './escritorio/escritorio.service';
import { PainelController } from './escritorio/painel.controller';
import { StorageService } from './escritorio/storage.service';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController, EscritorioController, PainelController, EmpresaController],
  providers: [
    PoolDoBanco,
    SessaoService,
    StorageService,
    EscritorioService,
    EmpresaService,
    ConsultaDeCnpjNaCnpja,
    GuardDeSessao,
    GuardDeCadastro,
  ],
})
export class AppModule {}
