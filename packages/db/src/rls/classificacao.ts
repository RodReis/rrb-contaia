/**
 * Classificação obrigatória das tabelas (SPEC-010 §3.5).
 *
 * Toda tabela do banco pertence a exatamente uma classe. Tabela nova sem entrada
 * aqui reprova o anti-drift: convenção de nome ou de schema não concede exceção.
 *
 * Classes com `empresa_id` (transacionais, com RLS de dois níveis):
 *   - `empresa`: tenant + empresa autorizada pela carteira (`app.empresa_autorizada`);
 *   - `vinculo`: a própria carteira — o usuário lê os seus, a gestão de acesso lê todos.
 *
 * Classes sem `empresa_id` — allowlist explícita, cada uma com origem e
 * justificativa verificáveis no domínio:
 *   - `raiz_tenant`: a própria linha é o escritório;
 *   - `raiz_empresa`: a própria linha é a empresa (isolamento pela PK, sem `empresa_id`);
 *   - `tenant`: gestão do escritório (usuários, papéis, carteira, onboarding), por tenant;
 *   - `global`: sem dado de tenant; o papel da aplicação não tem nenhum privilégio nela.
 *
 * Acrescentar entrada sem origem no domínio é decisão do PI (SPEC-010 §11, "Perguntar antes").
 */

export type ClasseDeTabela = 'raiz_tenant' | 'raiz_empresa' | 'empresa' | 'vinculo' | 'tenant' | 'global';

export type EntradaDeClassificacao = Readonly<{
  /** `schema.tabela`. */
  tabela: string;
  classe: ClasseDeTabela;
  /** Fatia e requisito de onde vem a tabela. */
  origem: string;
  exigeIndiceEmpresa?: boolean;
  exigirContextoTecnicoNasEscritas?: boolean;
  exigirHelperRfbNasEscritas?: boolean;
  /** Tabela temporal que exige índice independente por empresa, além do composto tenant/empresa. */
  /** Obrigatória nas classes sem `empresa_id`: por que a tabela não é por empresa. */
  justificativa?: string;
  /** I-6: o papel da aplicação nunca tem UPDATE nem DELETE. */
  appendOnly?: boolean;
  /**
   * Só na classe `tenant`. Quem LÊ além do tenant: `comum` (qualquer contexto humano, padrão),
   * `admin` (só a gestão de acesso) ou `proprio_usuario` (o dono da linha, ou a gestão de acesso).
   */
  leitura?: 'comum' | 'admin' | 'proprio_usuario';
  /**
   * Só na classe `tenant`. Quem ESCREVE: `comum` (padrão), `admin` (só a gestão de acesso) ou
   * `dono_ou_admin` (INSERT na gestão de acesso; o dono altera a própria linha).
   */
  escrita?: 'comum' | 'admin' | 'dono_ou_admin';
}>;

export const CLASSES_COM_EMPRESA: readonly ClasseDeTabela[] = ['empresa', 'vinculo'];
export const CLASSES_SEM_EMPRESA: readonly ClasseDeTabela[] = [
  'raiz_tenant',
  'raiz_empresa',
  'tenant',
  'global',
];

const GESTAO = 'gestão do escritório, sem recorte de empresa';

export const CLASSIFICACAO: readonly EntradaDeClassificacao[] = [
  {
    tabela: 'app.tenant',
    classe: 'raiz_tenant',
    origem: 'F1 / SPEC-001',
    justificativa: 'A própria linha é o escritório: o isolamento vem da PK, não de tenant_id.',
  },
  {
    tabela: 'app.empresa',
    classe: 'raiz_empresa',
    origem: 'F2 / SPEC-002',
    justificativa:
      'A própria linha é a empresa: o isolamento por empresa vem da PK e da carteira, não de empresa_id.',
  },
  {
    tabela: 'app.empresa_cnae_secundario',
    classe: 'empresa',
    origem: 'F2 / SPEC-002',
  },
  { tabela: 'app.empresa_endereco', classe: 'empresa', origem: 'F2 / SPEC-002' },
  {
    tabela: 'app.empresa_evento_de_historico',
    classe: 'empresa',
    origem: 'F3 / SPEC-003',
    appendOnly: true,
  },
  { tabela: 'app.empresa_exigencia_documental', classe: 'empresa', origem: 'F4 / SPEC-004' },
  { tabela: 'app.empresa_documento_versao', classe: 'empresa', origem: 'F4 / SPEC-004' },
  {
    tabela: 'app.empresa_evento_documental',
    classe: 'empresa',
    origem: 'F4 / SPEC-004',
    appendOnly: true,
  },
  { tabela: 'app.empresa_pendencia', classe: 'empresa', origem: 'F5 / SPEC-005' },
  {
    tabela: 'app.empresa_evento_de_pendencia',
    classe: 'empresa',
    origem: 'F5 / SPEC-005',
    appendOnly: true,
  },
  { tabela: 'app.empresa_notificacao', classe: 'empresa', origem: 'F6 / SPEC-006' },
  {
    tabela: 'app.empresa_evento_de_notificacao',
    classe: 'empresa',
    origem: 'F6 / SPEC-006',
    appendOnly: true,
  },
  { tabela: 'app.empresa_certificado', classe: 'empresa', origem: 'F11 / SPEC-011' },
  {
    tabela: 'app.empresa_certificado_evento',
    classe: 'empresa',
    origem: 'F11 / SPEC-011',
    appendOnly: true,
  },
  { tabela: 'app.empresa_certificado_ingestao', classe: 'empresa', origem: 'F11 / SPEC-011' },
  { tabela: 'app.empresa_certificado_notificacao', classe: 'empresa', origem: 'F11 / SPEC-011' },
  { tabela: 'app.signer_operacao', classe: 'empresa', origem: 'F12 / SPEC-012' },
  {
    tabela: 'app.signer_evento',
    classe: 'empresa',
    origem: 'F12 / SPEC-012',
    appendOnly: true,
  },
  { tabela: 'app.dfe_capture_state', classe: 'empresa', origem: 'F17 / SPEC-017' },
  { tabela: 'app.dfe_capture_run', classe: 'empresa', origem: 'F17 / SPEC-017' },
  {
    tabela: 'app.dfe_capture_staging',
    classe: 'empresa',
    origem: 'F17 / SPEC-017',
    appendOnly: true,
  },
  {
    tabela: 'app.dfe_capture_event',
    classe: 'empresa',
    origem: 'F17 / SPEC-017',
    appendOnly: true,
  },
  {
    tabela: 'app.dfe_capture_alert_event',
    classe: 'empresa',
    origem: 'F17 / SPEC-017',
    appendOnly: true,
  },
  { tabela: 'app.fiscal_document', classe: 'empresa', origem: 'F18 / SPEC-018' },
  { tabela: 'app.fiscal_document_party', classe: 'empresa', origem: 'F18 / SPEC-018', appendOnly: true },
  { tabela: 'app.fiscal_document_origin', classe: 'empresa', origem: 'F18 / SPEC-018', appendOnly: true },
  { tabela: 'app.fiscal_document_item', classe: 'empresa', origem: 'F18 / SPEC-018', appendOnly: true },
  { tabela: 'app.fiscal_document_tax', classe: 'empresa', origem: 'F18 / SPEC-018', appendOnly: true },
  { tabela: 'app.fiscal_document_reference', classe: 'empresa', origem: 'F18 / SPEC-018', appendOnly: true },
  { tabela: 'app.fiscal_document_event', classe: 'empresa', origem: 'F18 / SPEC-018', appendOnly: true },
  { tabela: 'app.fiscal_document_outbox', classe: 'empresa', origem: 'F18 / SPEC-018' },
  { tabela: 'app.fiscal_acknowledgement', classe: 'empresa', origem: 'F19 / SPEC-019' },
  { tabela: 'app.fiscal_acknowledgement_event', classe: 'empresa', origem: 'F19 / SPEC-019', appendOnly: true },
  { tabela: 'app.fiscal_acknowledgement_attempt', classe: 'empresa', origem: 'F19 / SPEC-019', appendOnly: true },
  { tabela: 'app.fiscal_acknowledgement_outbox', classe: 'empresa', origem: 'F19 / SPEC-019' },
  { tabela: 'app.fiscal_risk_configuration', classe: 'empresa', origem: 'F20 / SPEC-020', appendOnly: true },
  { tabela: 'app.fiscal_risk_supplier', classe: 'empresa', origem: 'F20 / SPEC-020', appendOnly: true },
  { tabela: 'app.fiscal_risk_execution', classe: 'empresa', origem: 'F20 / SPEC-020' },
  { tabela: 'app.fiscal_risk_analysis', classe: 'empresa', origem: 'F20 / SPEC-020', appendOnly: true },
  { tabela: 'app.fiscal_manifestation', classe: 'empresa', origem: 'F21 / SPEC-021' },
  { tabela: 'app.fiscal_manifestation_outbox', classe: 'empresa', origem: 'F21 / SPEC-021' },
  { tabela: 'app.fiscal_manifestation_event', classe: 'empresa', origem: 'F21 / SPEC-021', appendOnly: true },
  {
    tabela: 'app.obligation_rule', classe: 'global', origem: 'F22 / SPEC-022',
    justificativa: 'Catálogo versionado administrado pelo super_admin local; a aplicação acessa as versões e seus comandos apenas por funções SECURITY DEFINER sob o contexto CATALOGO_TRIBUTARIO, seguindo a F16.',
  },
  {
    tabela: 'app.obligation_catalog_audit', classe: 'global', origem: 'F22 / SPEC-022', appendOnly: true,
    justificativa: 'Auditoria append-only do catálogo global de obrigações; só as funções SECURITY DEFINER do contexto CATALOGO_TRIBUTARIO escrevem ou consultam a trilha.',
  },
  {
    tabela: 'app.obligation_holiday', classe: 'global', origem: 'F22 / SPEC-022',
    justificativa: 'Calendário versionado global; a aplicação acessa os dados apenas por funções controladas e o super_admin local registra novas versões.',
  },
  {
    tabela: 'app.obligation_calendar_coverage', classe: 'global', origem: 'F22 / SPEC-022',
    justificativa: 'Declaração versionada de cobertura temporal do calendário global; só funções SECURITY DEFINER permitem consulta e gravação administrativa.',
  },
  { tabela: 'app.obligation_occurrence', classe: 'empresa', origem: 'F22 / SPEC-022' },
  { tabela: 'app.dashboard_health_projection', classe: 'empresa', origem: 'F23 / SPEC-023' },
  { tabela: 'app.dashboard_health_reason', classe: 'empresa', origem: 'F23 / SPEC-023' },
  { tabela: 'app.dashboard_health_source_checkpoint', classe: 'empresa', origem: 'F23 / SPEC-023' },
  { tabela: 'app.audit_event', classe: 'empresa', origem: 'F24 / SPEC-024', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.audit_payload', classe: 'empresa', origem: 'F24 / SPEC-024', exigeIndiceEmpresa: true },
  { tabela: 'app.audit_export_job', classe: 'empresa', origem: 'F24 / SPEC-024', exigeIndiceEmpresa: true },
  { tabela: 'app.audit_export_manifest', classe: 'empresa', origem: 'F24 / SPEC-024', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.audit_payload_revelation', classe: 'empresa', origem: 'F24 / SPEC-024', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.audit_export_download', classe: 'empresa', origem: 'F24 / SPEC-024', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.obligation_event', classe: 'empresa', origem: 'F22 / SPEC-022', appendOnly: true },
  { tabela: 'app.obligation_alert', classe: 'empresa', origem: 'F22 / SPEC-022' },
  { tabela: 'app.obligation_alert_recipient', classe: 'empresa', origem: 'F22 / SPEC-022' },
  { tabela: 'app.obligation_in_app_notification', classe: 'empresa', origem: 'F22 / SPEC-022' },
  { tabela: 'app.obligation_channel_outbox', classe: 'empresa', origem: 'F22 / SPEC-022' },
  { tabela: 'app.fiscal_risk_attempt', classe: 'empresa', origem: 'F20 / SPEC-020', appendOnly: true },
  { tabela: 'app.fiscal_risk_event', classe: 'empresa', origem: 'F20 / SPEC-020', appendOnly: true },
  { tabela: 'app.conta_contabil', classe: 'empresa', origem: 'F13 / SPEC-013' },
  { tabela: 'app.empresa_plano_versao', classe: 'empresa', origem: 'F13 / SPEC-013' },
  { tabela: 'app.importacao_plano_contas', classe: 'empresa', origem: 'F13 / SPEC-013' },
  { tabela: 'app.importacao_plano_contas_linha', classe: 'empresa', origem: 'F13 / SPEC-013' },
  {
    tabela: 'app.importacao_plano_contas_evento',
    classe: 'empresa',
    origem: 'F13 / SPEC-013',
    appendOnly: true,
  },
  { tabela: 'app.importacao_plano_contas_notificacao', classe: 'empresa', origem: 'F13 / SPEC-013' },
  { tabela: 'app.empregado', classe: 'empresa', origem: 'F14 / SPEC-014' },
  { tabela: 'app.empresa_empregados_versao', classe: 'empresa', origem: 'F14 / SPEC-014' },
  { tabela: 'app.importacao_empregados', classe: 'empresa', origem: 'F14 / SPEC-014' },
  { tabela: 'app.importacao_empregados_linha', classe: 'empresa', origem: 'F14 / SPEC-014' },
  {
    tabela: 'app.importacao_empregados_evento',
    classe: 'empresa',
    origem: 'F14 / SPEC-014',
    appendOnly: true,
  },
  { tabela: 'app.importacao_empregados_notificacao', classe: 'empresa', origem: 'F14 / SPEC-014' },
  { tabela: 'app.carteira_vinculo', classe: 'vinculo', origem: 'F9 / SPEC-009' },
  {
    tabela: 'app.usuario',
    classe: 'tenant',
    origem: 'F1 / SPEC-001, F7 / SPEC-007',
    justificativa: `Cadastro de colaborador: ${GESTAO}.`,
  },
  {
    tabela: 'app.usuario_papel',
    classe: 'tenant',
    origem: 'F7 / SPEC-007',
    justificativa: `Papel padrão do colaborador: ${GESTAO}.`,
    escrita: 'admin',
  },
  {
    tabela: 'app.usuario_convite',
    classe: 'tenant',
    origem: 'F7 / SPEC-007',
    justificativa: `Convite de colaborador: ${GESTAO}.`,
  },
  {
    tabela: 'app.usuario_evento',
    classe: 'tenant',
    origem: 'F7 / SPEC-007',
    justificativa: `Histórico de usuários e papéis: ${GESTAO}.`,
    appendOnly: true,
  },
  {
    tabela: 'app.papel_personalizado',
    classe: 'tenant',
    origem: 'F8 / SPEC-008',
    justificativa: `Papel personalizado do escritório: ${GESTAO}.`,
    escrita: 'admin',
  },
  {
    tabela: 'app.papel_personalizado_revisao',
    classe: 'tenant',
    origem: 'F8 / SPEC-008',
    justificativa: `Revisão imutável de papel personalizado: ${GESTAO}.`,
    appendOnly: true,
    escrita: 'admin',
  },
  {
    tabela: 'app.usuario_papel_personalizado',
    classe: 'tenant',
    origem: 'F8 / SPEC-008',
    justificativa: `Vínculo colaborador–papel personalizado: ${GESTAO}.`,
    escrita: 'admin',
  },
  {
    tabela: 'app.escritorio_endereco',
    classe: 'tenant',
    origem: 'F1 / SPEC-001',
    justificativa: 'Endereço do próprio escritório: pertence ao tenant, não a uma empresa cliente.',
  },
  {
    tabela: 'app.escritorio_arquivo',
    classe: 'tenant',
    origem: 'F1 / SPEC-001',
    justificativa: 'Logo e documentos do próprio escritório: pertencem ao tenant, não a uma empresa cliente.',
  },
  {
    tabela: 'app.carteira_evento',
    classe: 'tenant',
    origem: 'F9 / SPEC-009',
    justificativa:
      'Histórico global da carteira (SPEC-009 §3): um evento cobre vários colaboradores e empresas, lido na Central de Carteiras.',
    appendOnly: true,
    leitura: 'admin',
    escrita: 'admin',
  },
  {
    tabela: 'app.carteira_notificacao',
    classe: 'tenant',
    origem: 'F9 / SPEC-009',
    justificativa:
      'Notificação do colaborador sobre a própria carteira: o destinatário é um usuário, não uma empresa.',
    leitura: 'proprio_usuario',
    escrita: 'dono_ou_admin',
  },
  {
    tabela: 'app.signer_notificacao',
    classe: 'tenant',
    origem: 'F12 / SPEC-012',
    justificativa:
      'Alerta de indisponibilidade/recuperação do Signer ao administrador: o destinatário é um usuário e o incidente é global, não de uma empresa.',
    leitura: 'proprio_usuario',
    escrita: 'dono_ou_admin',
  },
  {
    tabela: 'app.signer_verificacao',
    classe: 'global',
    origem: 'F12 / SPEC-012',
    justificativa:
      'Verificação de saúde do Signer, um serviço único para todos os escritórios: sem dado de tenant. A aplicação só a alcança pelas funções SECURITY DEFINER do contexto de serviço.',
    appendOnly: true,
  },
  {
    tabela: 'app.signer_incidente_evento',
    classe: 'global',
    origem: 'F12 / SPEC-012',
    justificativa:
      'Incidente de indisponibilidade do Signer, global: sem dado de tenant. A aplicação só o alcança pelas funções SECURITY DEFINER do contexto de serviço.',
    appendOnly: true,
  },
  {
    tabela: 'app.tax_rule',
    classe: 'global',
    origem: 'F16 / SPEC-016',
    justificativa:
      'Identidade da regra do catálogo tributário (SPEC-016 §3.7): o catálogo é da plataforma, sem tenant nem empresa. A aplicação só o alcança pelas funções SECURITY DEFINER app.tax_rule_*, sob o contexto de serviço CATALOGO_TRIBUTARIO.',
  },
  {
    tabela: 'app.tax_rule_version',
    classe: 'global',
    origem: 'F16 / SPEC-016',
    justificativa:
      'Versões publicadas do catálogo tributário global (SPEC-016 §3.1–3.3): sem dado de tenant, imutáveis depois de publicadas. A aplicação só as alcança pelas funções SECURITY DEFINER app.tax_rule_*, sob o contexto de serviço CATALOGO_TRIBUTARIO.',
  },
  {
    tabela: 'app.tax_rule_audit_event',
    classe: 'global',
    origem: 'F16 / SPEC-016',
    justificativa:
      'Auditoria append-only do catálogo tributário global (SPEC-016 §3.8, I-6): sem dado de tenant. A aplicação só a alcança pelas funções SECURITY DEFINER app.tax_rule_*, sob o contexto de serviço CATALOGO_TRIBUTARIO.',
    appendOnly: true,
  },
  {
    tabela: 'app.tax_resolution_package',
    classe: 'global',
    origem: 'F26 / SPEC-026',
    justificativa: 'Pacote normativo global curado; acesso restrito ao contexto de serviço CATALOGO_TRIBUTARIO.',
  },
  {
    tabela: 'app.tax_resolution_package_event',
    classe: 'global',
    origem: 'F26 / SPEC-026',
    justificativa: 'Auditoria append-only do ciclo de pacotes globais F26.',
    appendOnly: true,
  },
  {
    tabela: 'app.tax_entry_resolution_snapshot',
    classe: 'empresa',
    origem: 'F26 / SPEC-026',
    appendOnly: true,
  },
  { tabela: 'app.tax_entry_resolution_event', classe: 'empresa', origem: 'F26 / SPEC-026', appendOnly: true },
  { tabela: 'app.tax_entry_resolution_human_review', classe: 'empresa', origem: 'F28 / SPEC-028', exigeIndiceEmpresa: true },
  { tabela: 'app.tax_entry_resolution_human_review_event', classe: 'empresa', origem: 'F28 / SPEC-028', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_settlement_snapshot', classe: 'empresa', origem: 'F29 / SPEC-029', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_settlement_line', classe: 'empresa', origem: 'F29 / SPEC-029; leitura da linha aprovada para F32 / SPEC-032', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_settlement_event', classe: 'empresa', origem: 'F29 / SPEC-029', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_settlement_review_event', classe: 'empresa', origem: 'F29 / SPEC-029', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_return_event', classe: 'empresa', origem: 'F32 / SPEC-032', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_return_reversal', classe: 'empresa', origem: 'F32 / SPEC-032', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_return_review_event', classe: 'empresa', origem: 'F32 / SPEC-032', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_authorized_cancellation', classe: 'empresa', origem: 'F32 / SPEC-032', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_history_package', classe: 'empresa', origem: 'F33 / SPEC-033', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_history_package_line', classe: 'empresa', origem: 'F33 / SPEC-033', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_history_package_event', classe: 'empresa', origem: 'F33 / SPEC-033', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_legal_rule_package', classe: 'empresa', origem: 'F34 / SPEC-034', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_legal_rule_package_event', classe: 'empresa', origem: 'F34 / SPEC-034', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_legal_formal_act', classe: 'empresa', origem: 'F34 / SPEC-034', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_legal_formal_act_event', classe: 'empresa', origem: 'F34 / SPEC-034', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_legal_accrual_result', classe: 'empresa', origem: 'F34 / SPEC-034', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_legal_accrual_event', classe: 'empresa', origem: 'F34 / SPEC-034', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_destination_rule_package', classe: 'empresa', origem: 'F35 / SPEC-035', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_destination_rule_event', classe: 'empresa', origem: 'F35 / SPEC-035', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_internal_decision_dossier', classe: 'empresa', origem: 'F35 / SPEC-035', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_internal_decision_evidence', classe: 'empresa', origem: 'F35 / SPEC-035', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_st_internal_decision_event', classe: 'empresa', origem: 'F35 / SPEC-035', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.fiscal_document_verified_event', classe: 'empresa', origem: 'F32 / SPEC-032', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.rfb_procuracao', classe: 'empresa', origem: 'F25 / SPEC-025', exigirHelperRfbNasEscritas: true },
  { tabela: 'app.rfb_procuracao_evento', classe: 'empresa', origem: 'F25 / SPEC-025', appendOnly: true },
  { tabela: 'app.rfb_procuracao_operacao', classe: 'empresa', origem: 'F25 / SPEC-025', appendOnly: true },
  { tabela: 'app.rfb_procuracao_notificacao', classe: 'empresa', origem: 'F25 / SPEC-025' },
  { tabela: 'app.fiscal_document_payment', classe: 'empresa', origem: 'F30 / SPEC-030', appendOnly: true },
  { tabela: 'app.nfce_import_batch', classe: 'empresa', origem: 'F30 / SPEC-030' },
  { tabela: 'app.nfce_import_item', classe: 'empresa', origem: 'F30 / SPEC-030' },
  { tabela: 'app.nfce_import_source', classe: 'empresa', origem: 'F30 / SPEC-030' },
  { tabela: 'app.nfce_import_event', classe: 'empresa', origem: 'F30 / SPEC-030', appendOnly: true },
  { tabela: 'app.tax_monthly_rule_package', classe: 'empresa', origem: 'F36 / SPEC-036; F37 / SPEC-037', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_monthly_rule_package_event', classe: 'empresa', origem: 'F36 / SPEC-036; F37 / SPEC-037', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_monthly_declaration', classe: 'empresa', origem: 'F36 / SPEC-036; F37 / SPEC-037', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_monthly_declaration_event', classe: 'empresa', origem: 'F36 / SPEC-036; F37 / SPEC-037', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_monthly_evidence', classe: 'empresa', origem: 'F36 / SPEC-036; F37 / SPEC-037', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_monthly_assessment', classe: 'empresa', origem: 'F36 / SPEC-036; F37 / SPEC-037', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.tax_monthly_assessment_event', classe: 'empresa', origem: 'F36 / SPEC-036; F37 / SPEC-037', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.corporate_tax_rule_package', classe: 'empresa', origem: 'F38 / SPEC-038', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.corporate_tax_rule_package_event', classe: 'empresa', origem: 'F38 / SPEC-038', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.corporate_tax_declaration', classe: 'empresa', origem: 'F38 / SPEC-038', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.corporate_tax_declaration_event', classe: 'empresa', origem: 'F38 / SPEC-038', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.corporate_tax_evidence', classe: 'empresa', origem: 'F38 / SPEC-038', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.corporate_tax_assessment', classe: 'empresa', origem: 'F38 / SPEC-038', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.corporate_tax_assessment_event', classe: 'empresa', origem: 'F38 / SPEC-038', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.corporate_tax_artifact', classe: 'empresa', origem: 'F38 / SPEC-038', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.centro_custo', classe: 'empresa', origem: 'F39 / SPEC-039' },
  { tabela: 'app.catalogo_contabil_evento', classe: 'empresa', origem: 'F39 / SPEC-039', appendOnly: true, exigeIndiceEmpresa: true },
  { tabela: 'app.lancamento_contabil', classe: 'empresa', origem: 'F40 / SPEC-040', exigeIndiceEmpresa: true },
  { tabela: 'app.lancamento_contabil_partida', classe: 'empresa', origem: 'F40 / SPEC-040', exigeIndiceEmpresa: true },
  { tabela: 'app.lancamento_contabil_sequencia', classe: 'empresa', origem: 'F40 / SPEC-040', exigeIndiceEmpresa: true },
  { tabela: 'app.lancamento_contabil_evento', classe: 'empresa', origem: 'F40 / SPEC-040', appendOnly: true, exigeIndiceEmpresa: true },
  {
    tabela: 'public.__migrations',
    classe: 'global',
    origem: 'INFRA / #8',
    justificativa:
      'Controle técnico das migrations: sem dado de tenant, e o papel da aplicação não tem privilégio nela.',
  },
];
