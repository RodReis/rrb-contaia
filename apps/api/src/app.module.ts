import { Module } from '@nestjs/common';

import { PoolDoBanco } from './banco/pool.provider';
import { SessaoService } from './auth/sessao.service';
import { GuardDeCadastro, GuardDeSessao } from './auth/sessao.guard';
import { ConsultaDeCnpjNaCnpja } from './empresa/cnpja.adapter';
import { DocumentosDaEmpresaController } from './empresa/documentos.controller';
import { DocumentosDaEmpresaService } from './empresa/documentos.service';
import { EmpresaController } from './empresa/empresa.controller';
import { EmpresaService } from './empresa/empresa.service';
import {
  HistoricoController,
  ManutencaoDaEmpresaController,
} from './empresa/manutencao.controller';
import { ManutencaoDaEmpresaService } from './empresa/manutencao.service';
import { EscritorioController } from './escritorio/escritorio.controller';
import { EscritorioService } from './escritorio/escritorio.service';
import { PainelController } from './escritorio/painel.controller';
import { StorageService } from './comum/storage.service';
import { HealthController } from './health/health.controller';

@Module({
  // `ManutencaoDaEmpresaController` vem antes de `EmpresaController`: o Nest
  // casa rotas na ordem de registro, e `empresas/:empresaId` capturaria
  // `empresas/<id>/manutencao/...` se viesse primeiro.
  controllers: [
    HealthController,
    EscritorioController,
    PainelController,
    HistoricoController,
    ManutencaoDaEmpresaController,
    DocumentosDaEmpresaController,
    EmpresaController,
  ],
  providers: [
    PoolDoBanco,
    SessaoService,
    StorageService,
    EscritorioService,
    EmpresaService,
    ManutencaoDaEmpresaService,
    DocumentosDaEmpresaService,
    ConsultaDeCnpjNaCnpja,
    GuardDeSessao,
    GuardDeCadastro,
  ],
})
export class AppModule {}
