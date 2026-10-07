import { Module } from '@nestjs/common';

import { PoolDoBanco } from './banco/pool.provider';
import { SessaoService } from './auth/sessao.service';
import { GuardDeCadastro, GuardDeSessao } from './auth/sessao.guard';
import { GuardDeAcao } from './auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from './auth/escopo';
import { CarteirasController, HistoricoDeCarteirasController } from './carteira/carteira.controller';
import { CarteiraService } from './carteira/carteira.service';
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
import { GuardDeLimiteDeTentativas, LimitadorDeTentativas } from './auth/limite-de-tentativas';
import { ConviteMailer } from './usuarios/convite.mailer';
import { ConvitesController } from './usuarios/convites.controller';
import { ConvitesService } from './usuarios/convites.service';
import { HistoricoDeUsuariosController } from './usuarios/historico-de-usuarios.controller';
import { KeycloakAdminClient } from './usuarios/keycloak-admin.client';
import { UsuariosController } from './usuarios/usuarios.controller';
import { UsuariosService } from './usuarios/usuarios.service';
import { HealthController } from './health/health.controller';
import { PapeisController } from './papeis/papeis.controller';
import { PapeisService } from './papeis/papeis.service';
import {
  CertificadosController,
  CertificadosDaEmpresaController,
  CofreInternoController,
  HistoricoDeCertificadosController,
} from './certificados/certificados.controller';
import { CertificadosService } from './certificados/certificados.service';
import { CofreClient } from './certificados/cofre.client';
import { GuardDeServicoInterno } from './certificados/servico-interno.guard';
import { SignerController, SignerDaEmpresaController } from './signer/signer.controller';
import { PROVEDORES_DO_SIGNER } from './signer/signer.providers';
import { NotificacoesController } from './notificacoes/notificacoes.controller';
import { NotificacoesService } from './notificacoes/notificacoes.service';
import {
  PendenciasController,
  PendenciasDaEmpresaController,
} from './pendencias/pendencias.controller';
import { PendenciasService } from './pendencias/pendencias.service';

@Module({
  // `ManutencaoDaEmpresaController` vem antes de `EmpresaController`: o Nest
  // casa rotas na ordem de registro, e `empresas/:empresaId` capturaria
  // `empresas/<id>/manutencao/...` se viesse primeiro. Mesma prudência para
  // `PendenciasDaEmpresaController` (`empresas/:empresaId/pendencias`), que
  // por isso também vem antes de `DocumentosDaEmpresaController`.
  controllers: [
    HealthController,
    EscritorioController,
    PainelController,
    HistoricoDeUsuariosController,
    HistoricoDeCarteirasController,
    HistoricoDeCertificadosController,
    HistoricoController,
    ManutencaoDaEmpresaController,
    PendenciasDaEmpresaController,
    CertificadosDaEmpresaController,
    SignerDaEmpresaController,
    DocumentosDaEmpresaController,
    EmpresaController,
    PendenciasController,
    CertificadosController,
    SignerController,
    CofreInternoController,
    NotificacoesController,
    UsuariosController,
    CarteirasController,
    PapeisController,
    ConvitesController,
  ],
  providers: [
    PoolDoBanco,
    SessaoService,
    StorageService,
    EscritorioService,
    EmpresaService,
    ManutencaoDaEmpresaService,
    DocumentosDaEmpresaService,
    PendenciasService,
    CertificadosService,
    CofreClient,
    ...PROVEDORES_DO_SIGNER,
    GuardDeServicoInterno,
    NotificacoesService,
    UsuariosService,
    PapeisService,
    CarteiraService,
    ConvitesService,
    KeycloakAdminClient,
    ConviteMailer,
    // 10 tentativas por minuto por cliente e rota nas rotas públicas do convite.
    { provide: LimitadorDeTentativas, useValue: new LimitadorDeTentativas(10, 60_000) },
    GuardDeLimiteDeTentativas,
    ConsultaDeCnpjNaCnpja,
    GuardDeSessao,
    GuardDeCadastro,
    GuardDeAcao,
    GuardDeEscopoDeEmpresa,
  ],
})
export class AppModule {}
