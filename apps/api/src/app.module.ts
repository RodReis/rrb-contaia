import { Module } from '@nestjs/common';

import { PoolDoBanco } from './banco/pool.provider';
import { SessaoService } from './auth/sessao.service';
import { GuardDeCadastro, GuardDeSessao } from './auth/sessao.guard';
import { GuardDeAcao } from './auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from './auth/escopo';
import { CarteirasController, HistoricoDeCarteirasController } from './carteira/carteira.controller';
import { CarteiraService } from './carteira/carteira.service';
import { ConsultaDeCnpjNaCnpja } from './empresa/cnpja.adapter';
import { EmpregadosDaEmpresaController } from './empregados/empregados.controller';
import { PROVEDORES_DA_FILA_DOS_EMPREGADOS } from './empregados/empregados.fila';
import { EmpregadosService } from './empregados/empregados.service';
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
import { PlanoContasDaEmpresaController } from './plano-contas/plano-contas.controller';
import { PROVEDORES_DA_FILA_DO_PLANO } from './plano-contas/plano-contas.fila';
import { PlanoContasService } from './plano-contas/plano-contas.service';
import { GuardDoCatalogoTributario } from './auth/catalogo-tributario.guard';
import { TaxRulesController } from './tax-rules/tax-rules.controller';
import { TaxRulesService } from './tax-rules/tax-rules.service';
import { TaxSimulationsController } from './tax-simulations/tax-simulations.controller';
import { TaxSimulationsService } from './tax-simulations/tax-simulations.service';
import { DfeCaptureController } from './dfe-capture/dfe-capture.controller';
import { DfeCaptureService } from './dfe-capture/dfe-capture.service';
import { PROVEDOR_DA_FILA_DFE_CAPTURE } from './dfe-capture/dfe-capture.queue';
import { FiscalDocumentsController } from './fiscal-documents/fiscal-documents.controller';
import { FiscalDocumentsService } from './fiscal-documents/fiscal-documents.service';
import { PROVEDOR_DA_FILA_FISCAL } from './fiscal-documents/fiscal-documents.queue';
import { FiscalRiskController } from './fiscal-risk/fiscal-risk.controller';
import { FiscalRiskService } from './fiscal-risk/fiscal-risk.service';
import { PROVEDOR_DA_FILA_FISCAL_RISK } from './fiscal-risk/fiscal-risk.queue';
import { PROVEDOR_DA_FILA_DE_MANIFESTACAO } from './fiscal-risk/fiscal-manifestation.queue';
import { ObligationsController } from './obligations/obligations.controller';
import { ObligationsCatalogController } from './obligations/obligations-catalog.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { AuditoriaController } from './auditoria/auditoria.controller';
import { AuditoriaService } from './auditoria/auditoria.service';
import { PROVEDOR_DA_FILA_DE_AUDITORIA } from './auditoria/auditoria.queue';
import { ObligationsService } from './obligations/obligations.service';
import { ProcuracoesController } from './procuracoes/procuracoes.controller';
import { ProcuracoesService } from './procuracoes/procuracoes.service';
import { RfbDubleClient } from './procuracoes/rfb-duble.client';

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
    PlanoContasDaEmpresaController,
    EmpregadosDaEmpresaController,
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
    TaxRulesController,
    TaxSimulationsController,
    DfeCaptureController,
    FiscalDocumentsController,
    FiscalRiskController,
      ObligationsController,
    ObligationsCatalogController,
    DashboardController,
    AuditoriaController,
    ProcuracoesController,
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
    PlanoContasService,
    ...PROVEDORES_DA_FILA_DO_PLANO,
    EmpregadosService,
    ...PROVEDORES_DA_FILA_DOS_EMPREGADOS,
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
    TaxRulesService,
    TaxSimulationsService,
    DfeCaptureService,
    ...PROVEDOR_DA_FILA_DFE_CAPTURE,
    FiscalDocumentsService,
    ...PROVEDOR_DA_FILA_FISCAL,
    FiscalRiskService,
    ObligationsService,
    DashboardService,
    AuditoriaService,
    ProcuracoesService,
    RfbDubleClient,
    ...PROVEDOR_DA_FILA_DE_AUDITORIA,
    ...PROVEDOR_DA_FILA_FISCAL_RISK,
    ...PROVEDOR_DA_FILA_DE_MANIFESTACAO,
    GuardDoCatalogoTributario,
    GuardDeSessao,
    GuardDeCadastro,
    GuardDeAcao,
    GuardDeEscopoDeEmpresa,
  ],
})
export class AppModule {}
