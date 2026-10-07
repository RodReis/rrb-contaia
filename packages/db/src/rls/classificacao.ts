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
    tabela: 'public.__migrations',
    classe: 'global',
    origem: 'INFRA / #8',
    justificativa:
      'Controle técnico das migrations: sem dado de tenant, e o papel da aplicação não tem privilégio nela.',
  },
];
