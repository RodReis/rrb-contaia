import {
  estadoDaProcuracao,
  type EstadoDaProcuracao,
  type PoderRfb,
} from '@contaia/domain';
import type { PoolClient } from 'pg';

export type EstadoPersistidoDaProcuracao = 'DRAFT' | 'CONFIRMED' | 'REVOKED';
export type EmpresaParaProcuracao = Readonly<{
  id: string;
  nome: string;
  cnpj: string;
  cnpjEscritorio: string;
  ativa: boolean;
}>;

export type DocumentoDaProcuracao = Readonly<{
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  sha256: string;
  chaveStorage: string;
}>;

export type ProcuracaoPersistida = Readonly<{
  id: string;
  tenantId: string;
  empresaId: string;
  empresaNome: string;
  empresaCnpj: string;
  outorganteCnpj: string;
  outorgadoCnpj: string;
  validFrom: string;
  validUntil: string;
  statusPersistido: EstadoPersistidoDaProcuracao;
  status: EstadoDaProcuracao;
  versionNumber: number;
  catalogVersion: number;
  powers: readonly PoderRfb[];
  evidence: Omit<DocumentoDaProcuracao, 'chaveStorage'> | null;
  declarationBy: string | null;
  declarationAt: string | null;
  localTestPower: PoderRfb | null;
  localTestResult: 'SUCCESS' | 'FAILURE' | null;
  localTestCorrelationId: string | null;
  localTestedAt: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  archivedAt: string | null;
  revision: number;
}>;

export type EventoDaProcuracao = Readonly<{
  id: string;
  acao: string;
  estadoAnterior: string | null;
  estadoNovo: string | null;
  poder: PoderRfb | null;
  resultado: string | null;
  motivo: string | null;
  correlationId: string;
  atorId: string | null;
  criadoEm: string;
}>;

type LinhaDaProcuracao = {
  id: string;
  tenant_id: string;
  empresa_id: string;
  empresa_nome: string;
  empresa_cnpj: string;
  outorgante_cnpj: string;
  outorgado_cnpj: string;
  valid_from: string;
  valid_until: string;
  status: EstadoPersistidoDaProcuracao;
  version_number: number;
  catalog_version: number;
  powers: PoderRfb[];
  evidence_id: string | null;
  evidence_name: string | null;
  evidence_type: string | null;
  evidence_size: string | null;
  evidence_sha256: string | null;
  evidence_storage_key: string | null;
  declaration_by: string | null;
  declaration_at: Date | null;
  local_test_power: PoderRfb | null;
  local_test_result: 'SUCCESS' | 'FAILURE' | null;
  local_test_correlation_id: string | null;
  local_tested_at: Date | null;
  revoked_by: string | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  archived_at: Date | null;
  revision: number;
};

const COLUNAS = `p.id,p.tenant_id,p.empresa_id,ei.empresa_nome,ei.empresa_cnpj,
  p.outorgante_cnpj,p.outorgado_cnpj,to_char(p.valid_from,'YYYY-MM-DD') valid_from,
  to_char(p.valid_until,'YYYY-MM-DD') valid_until,p.status,p.version_number,p.catalog_version,p.powers,
  d.documento_id evidence_id,d.nome evidence_name,d.tipo evidence_type,d.tamanho::text evidence_size,
  d.sha256 evidence_sha256,d.chave_storage evidence_storage_key,p.declaration_by,p.declaration_at,
  p.local_test_power,p.local_test_result,p.local_test_correlation_id,p.local_tested_at,
  p.revoked_by,p.revoked_at,p.revoked_reason,p.archived_at,p.revision`;

const FROM_EVIDENCE = `
  from app.rfb_procuracao p
  join lateral app.rfb_procuracao_empresa_info(p.empresa_id) ei on true
  left join lateral app.rfb_procuracao_evidencia_info(p.evidence_document_id,p.empresa_id) d on true`;

const mapear = (
  linha: LinhaDaProcuracao,
  hoje: string,
): ProcuracaoPersistida => ({
  id: linha.id,
  tenantId: linha.tenant_id,
  empresaId: linha.empresa_id,
  empresaNome: linha.empresa_nome,
  empresaCnpj: linha.empresa_cnpj,
  outorganteCnpj: linha.outorgante_cnpj,
  outorgadoCnpj: linha.outorgado_cnpj,
  validFrom: linha.valid_from,
  validUntil: linha.valid_until,
  statusPersistido: linha.status,
  status: estadoDaProcuracao(
    linha.status === 'CONFIRMED' ? 'ACTIVE' : linha.status,
    linha.valid_from,
    linha.valid_until,
    hoje,
  ),
  versionNumber: linha.version_number,
  catalogVersion: linha.catalog_version,
  powers: linha.powers,
  evidence:
    linha.evidence_id === null ||
    linha.evidence_name === null ||
    linha.evidence_type === null ||
    linha.evidence_size === null ||
    linha.evidence_sha256 === null
      ? null
      : {
          id: linha.evidence_id,
          nome: linha.evidence_name,
          tipo: linha.evidence_type,
          tamanho: Number(linha.evidence_size),
          sha256: linha.evidence_sha256,
        },
  declarationBy: linha.declaration_by,
  declarationAt: linha.declaration_at?.toISOString() ?? null,
  localTestPower: linha.local_test_power,
  localTestResult: linha.local_test_result,
  localTestCorrelationId: linha.local_test_correlation_id,
  localTestedAt: linha.local_tested_at?.toISOString() ?? null,
  revokedBy: linha.revoked_by,
  revokedAt: linha.revoked_at?.toISOString() ?? null,
  revokedReason: linha.revoked_reason,
  archivedAt: linha.archived_at?.toISOString() ?? null,
  revision: linha.revision,
});

export const carregarEmpresaParaProcuracao = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<EmpresaParaProcuracao | null> => {
  const { rows } = await cliente.query<{
    empresa_id: string;
    empresa_nome: string;
    empresa_cnpj: string;
    escritorio_cnpj: string;
    empresa_ativa: boolean;
  }>('select * from app.rfb_procuracao_empresa_info($1)', [empresaId]);
  const linha = rows[0];
  return linha === undefined
    ? null
    : {
        id: linha.empresa_id,
        nome: linha.empresa_nome,
        cnpj: linha.empresa_cnpj,
        cnpjEscritorio: linha.escritorio_cnpj,
        ativa: linha.empresa_ativa,
      };
};

export const listarProcuracoesRfb = async (
  cliente: PoolClient,
  tenantId: string,
  hoje: string,
  filtros: Readonly<{
    empresaId?: string;
    busca?: string;
    estado?: EstadoDaProcuracao;
    poder?: PoderRfb;
    vencimento?: '30_DIAS' | '7_DIAS' | 'VENCIDAS';
    ordem?: 'VENCIMENTO_ASC' | 'VENCIMENTO_DESC' | 'EMPRESA_ASC';
    limit: number;
    offset: number;
  }>,
): Promise<
  Readonly<{ itens: readonly ProcuracaoPersistida[]; total: number }>
> => {
  const { rows } = await cliente.query<LinhaDaProcuracao & { total: string }>(
    `select ${COLUNAS},count(*) over()::text as total ${FROM_EVIDENCE}
      where p.tenant_id=$1
        and ($2::uuid is null or p.empresa_id=$2)
        and ($3::text is null or (ei.empresa_nome ilike '%'||$3||'%' or p.outorgante_cnpj ilike '%'||$3||'%'))
        and ($4::text is null or (case when p.status='REVOKED' then 'REVOKED'
          when p.status='DRAFT' then 'DRAFT' when p.valid_from>$5::date then 'SCHEDULED'
          when p.valid_until<$5::date then 'EXPIRED' else 'ACTIVE' end)=$4)
        and ($6::text is null or $6=any(p.powers))
        and ($7::text is null or case $7 when 'VENCIDAS' then p.valid_until<$5::date
          when '7_DIAS' then p.valid_until between $5::date and $5::date+7
          when '30_DIAS' then p.valid_until between $5::date and $5::date+30 else false end)
      order by
        case when $8='VENCIMENTO_ASC' then p.valid_until end asc,
        case when $8='VENCIMENTO_DESC' then p.valid_until end desc,
        case when $8='EMPRESA_ASC' then ei.empresa_nome end asc,
        p.empresa_id,p.version_number desc
      limit $9 offset $10`,
    [
      tenantId,
      filtros.empresaId ?? null,
      filtros.busca?.trim() || null,
      filtros.estado ?? null,
      hoje,
      filtros.poder ?? null,
      filtros.vencimento ?? null,
      filtros.ordem ?? 'VENCIMENTO_ASC',
      filtros.limit,
      filtros.offset,
    ],
  );
  return {
    itens: rows.map((linha) => mapear(linha, hoje)),
    total: Number(rows[0]?.total ?? 0),
  };
};

export const resumirProcuracoesRfb = async (
  cliente: PoolClient,
  tenantId: string,
  hoje: string,
) => {
  const { rows } = await cliente.query<{ estado: string; total: string }>(
    `select case when p.status='REVOKED' then 'REVOKED' when p.status='DRAFT' then 'DRAFT'
      when p.valid_from>$2::date then 'SCHEDULED' when p.valid_until<$2::date then 'EXPIRED' else 'ACTIVE' end estado,
      count(*)::text total from app.rfb_procuracao p where p.tenant_id=$1 and p.archived_at is null
      and (app.usuario_admin_atual() or app.empresa_autorizada(p.empresa_id)) group by 1`,
    [tenantId, hoje],
  );
  return Object.fromEntries(
    ['DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'REVOKED'].map((estado) => [
      estado,
      Number(rows.find((r) => r.estado === estado)?.total ?? 0),
    ]),
  );
};

export const carregarUsuarioAdminDaProcuracao = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
): Promise<boolean> => {
  const { rows } = await cliente.query<{ permitido: boolean }>(
    `select app.usuario_admin_atual() permitido
      where app.tenant_atual()=$1 and app.usuario_atual()=$2 and app.contexto_humano()`,
    [tenantId, usuarioId],
  );
  return rows[0]?.permitido === true;
};

export const exigirCarteiraOuAdminDaProcuracao = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  empresaId: string,
): Promise<boolean> => {
  const { rows } = await cliente.query<{ permitido: boolean }>(
    `select app.tenant_atual()=$1 and app.usuario_atual()=$2 and app.usuario_ativo_atual()
    and (app.usuario_admin_atual() or app.empresa_na_carteira($3)) permitido`,
    [tenantId, usuarioId, empresaId],
  );
  return rows[0]?.permitido === true;
};

export const exigirCarteiraDaProcuracao = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  empresaId: string,
): Promise<boolean> => {
  const { rows } = await cliente.query<{ permitido: boolean }>(
    `select app.tenant_atual()=$1 and app.usuario_atual()=$2 and app.usuario_ativo_atual()
    and app.empresa_na_carteira($3) permitido`,
    [tenantId, usuarioId, empresaId],
  );
  return rows[0]?.permitido === true;
};

export const carregarProcuracaoRfb = async (
  cliente: PoolClient,
  tenantId: string,
  procuracaoId: string,
  hoje: string,
  travar = false,
): Promise<ProcuracaoPersistida | null> => {
  const { rows } = await cliente.query<LinhaDaProcuracao>(
    `select ${COLUNAS} ${FROM_EVIDENCE} where p.tenant_id=$1 and p.id=$2 ${travar ? 'for update of p' : ''}`,
    [tenantId, procuracaoId],
  );
  return rows[0] === undefined ? null : mapear(rows[0], hoje);
};

export const criarRascunhoDeProcuracao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    empresaId: string;
    usuarioId: string;
    validFrom: string;
    validUntil: string;
    powers: readonly PoderRfb[];
    hoje: string;
  }>,
): Promise<string | null> => {
  await cliente.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${entrada.tenantId}:${entrada.empresaId}`,
  ]);
  const empresa = await carregarEmpresaParaProcuracao(
    cliente,
    entrada.empresaId,
  );
  if (empresa === null || !empresa.ativa || empresa.cnpjEscritorio === '')
    return null;
  const versao = await cliente.query<{ numero: number }>(
    'select coalesce(max(version_number),0)+1 numero from app.rfb_procuracao where tenant_id=$1 and empresa_id=$2',
    [entrada.tenantId, entrada.empresaId],
  );
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.rfb_procuracao(tenant_id,empresa_id,outorgante_cnpj,outorgado_cnpj,valid_from,valid_until,
      version_number,powers,created_by)
     values($1,$2,$3,$4,$5::date,$6::date,$7,$8::jsonb,$9) returning id`,
    [
      entrada.tenantId,
      entrada.empresaId,
      empresa.cnpj,
      empresa.cnpjEscritorio,
      entrada.validFrom,
      entrada.validUntil,
      versao.rows[0]?.numero ?? 1,
      JSON.stringify(entrada.powers),
      entrada.usuarioId,
    ],
  );
  return rows[0]?.id ?? null;
};

export const atualizarRascunhoDeProcuracao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    procuracaoId: string;
    expectedRevision: number;
    validFrom: string;
    validUntil: string;
    powers: readonly PoderRfb[];
  }>,
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `update app.rfb_procuracao set valid_from=$4::date,valid_until=$5::date,powers=$6::jsonb,
       revision=revision+1,updated_at=now()
     where tenant_id=$1 and id=$2 and status='DRAFT' and revision=$3`,
    [
      entrada.tenantId,
      entrada.procuracaoId,
      entrada.expectedRevision,
      entrada.validFrom,
      entrada.validUntil,
      JSON.stringify(entrada.powers),
    ],
  );
  return rowCount === 1;
};

export const anexarEvidenciaDeProcuracao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    empresaId: string;
    procuracaoId: string;
    usuarioId: string;
    expectedRevision: number;
    storageKey: string;
    nome: string;
    tamanho: number;
    sha256: string;
  }>,
): Promise<Readonly<{ documentoId: string; revision: number }> | null> => {
  const { rows } = await cliente.query<{
    documento_id: string;
    revisao: number;
  }>(
    `select * from app.rfb_procuracao_anexar_evidencia($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entrada.tenantId,
      entrada.empresaId,
      entrada.procuracaoId,
      entrada.usuarioId,
      entrada.expectedRevision,
      entrada.storageKey,
      entrada.nome,
      entrada.tamanho,
      entrada.sha256,
    ],
  );
  const linha = rows[0];
  return linha === undefined
    ? null
    : { documentoId: linha.documento_id, revision: linha.revisao };
};

export const gravarTesteLocalDaProcuracao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    procuracaoId: string;
    usuarioId: string;
    expectedRevision: number;
    power: PoderRfb;
    sucesso: boolean;
    correlationId: string;
  }>,
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `update app.rfb_procuracao set local_test_power=$4,local_test_result=$5,local_test_correlation_id=$6,
       local_tested_at=now(),revision=revision+1,updated_at=now()
     where tenant_id=$1 and id=$2 and status='DRAFT' and revision=$3 and evidence_document_id is not null`,
    [
      entrada.tenantId,
      entrada.procuracaoId,
      entrada.expectedRevision,
      entrada.power,
      entrada.sucesso ? 'SUCCESS' : 'FAILURE',
      entrada.correlationId,
    ],
  );
  if (rowCount !== 1) return false;
  await registrarEventoDeProcuracao(cliente, {
    tenantId: entrada.tenantId,
    procuracaoId: entrada.procuracaoId,
    acao: 'TESTE_LOCAL',
    estadoNovo: entrada.sucesso
      ? 'CONFIGURACAO_TESTADA_LOCALMENTE'
      : 'TESTE_LOCAL_FALHOU',
    poder: entrada.power,
    resultado: entrada.sucesso ? 'SUCCESS' : 'FAILURE',
    correlationId: entrada.correlationId,
    atorId: entrada.usuarioId,
    idempotencyKey: `teste:${entrada.procuracaoId}:${entrada.expectedRevision}`,
  });
  return true;
};

export const confirmarProcuracaoRfb = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    procuracaoId: string;
    expectedRevision: number;
    usuarioId: string;
    hoje: string;
    correlationId: string;
  }>,
): Promise<'CONFIRMED' | 'REVISION_CONFLICT' | 'INVALID_STATE' | 'OVERLAP'> => {
  const atual = await carregarProcuracaoRfb(
    cliente,
    entrada.tenantId,
    entrada.procuracaoId,
    entrada.hoje,
    true,
  );
  if (atual === null) return 'INVALID_STATE';
  if (atual.revision !== entrada.expectedRevision) return 'REVISION_CONFLICT';
  if (
    atual.statusPersistido !== 'DRAFT' ||
    atual.evidence === null ||
    atual.localTestResult !== 'SUCCESS'
  )
    return 'INVALID_STATE';
  await cliente.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${entrada.tenantId}:${atual.empresaId}`,
  ]);
  const cardinalidade = await cliente.query<{
    ativa: number;
    futura: number;
    sobreposta: boolean;
  }>(
    `select count(*) filter(where valid_from <= $3::date and valid_until >= $3::date)::int ativa,
            count(*) filter(where valid_from > $3::date)::int futura,
            coalesce(bool_or(daterange(valid_from,valid_until,'[]') && daterange($4::date,$5::date,'[]')),false) sobreposta
       from app.rfb_procuracao where tenant_id=$1 and empresa_id=$2 and status='CONFIRMED'
         and revoked_at is null and archived_at is null and id<>$6`,
    [
      entrada.tenantId,
      atual.empresaId,
      entrada.hoje,
      atual.validFrom,
      atual.validUntil,
      atual.id,
    ],
  );
  const conta = cardinalidade.rows[0];
  if (
    conta === undefined ||
    conta.sobreposta ||
    (atual.validFrom <= entrada.hoje ? conta.ativa > 0 : conta.futura > 0)
  )
    return 'OVERLAP';

  const { rowCount } = await cliente.query(
    `update app.rfb_procuracao set status='CONFIRMED',declaration_by=$4,declaration_at=now(),
       confirmed_by=$4,confirmed_at=now(),revision=revision+1,updated_at=now()
     where tenant_id=$1 and id=$2 and status='DRAFT' and revision=$3`,
    [
      entrada.tenantId,
      entrada.procuracaoId,
      entrada.expectedRevision,
      entrada.usuarioId,
    ],
  );
  if (rowCount !== 1) return 'REVISION_CONFLICT';
  const renovacao = atual.versionNumber > 1;
  await registrarEventoDeProcuracao(cliente, {
    tenantId: entrada.tenantId,
    procuracaoId: entrada.procuracaoId,
    acao: 'DECLARACAO_REGISTRADA',
    estadoNovo: 'CONFERENCIA_DECLARADA',
    resultado: 'DECLARACAO_DO_ADMINISTRADOR',
    correlationId: entrada.correlationId,
    atorId: entrada.usuarioId,
    idempotencyKey: `declaracao:${entrada.procuracaoId}`,
  });
  await registrarEventoDeProcuracao(cliente, {
    tenantId: entrada.tenantId,
    procuracaoId: entrada.procuracaoId,
    acao: renovacao ? 'RENOVADA' : 'CONFIRMADA',
    estadoAnterior: 'DRAFT',
    estadoNovo: atual.validFrom > entrada.hoje ? 'SCHEDULED' : 'ACTIVE',
    correlationId: entrada.correlationId,
    atorId: entrada.usuarioId,
    idempotencyKey: `confirmacao:${entrada.procuracaoId}`,
  });
  return 'CONFIRMED';
};

export const revogarProcuracaoRfb = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    procuracaoId: string;
    expectedRevision: number;
    usuarioId: string;
    motivo: string;
    correlationId: string;
  }>,
): Promise<boolean> => {
  const { rows } = await cliente.query<{ empresa_id: string }>(
    `update app.rfb_procuracao set status='REVOKED',revoked_by=$4,revoked_at=now(),revoked_reason=$5,
       revision=revision+1,updated_at=now()
     where tenant_id=$1 and id=$2 and status='CONFIRMED' and revision=$3 returning empresa_id`,
    [
      entrada.tenantId,
      entrada.procuracaoId,
      entrada.expectedRevision,
      entrada.usuarioId,
      entrada.motivo,
    ],
  );
  if (rows[0] === undefined) return false;
  await registrarEventoDeProcuracao(cliente, {
    tenantId: entrada.tenantId,
    procuracaoId: entrada.procuracaoId,
    acao: 'REVOGADA',
    estadoAnterior: 'ACTIVE_OR_SCHEDULED',
    estadoNovo: 'REVOKED',
    motivo: entrada.motivo,
    correlationId: entrada.correlationId,
    atorId: entrada.usuarioId,
    idempotencyKey: `revogacao:${entrada.procuracaoId}`,
  });
  return true;
};

export const arquivarProcuracaoRfb = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    procuracaoId: string;
    expectedRevision: number;
    hoje: string;
    correlationId: string;
    usuarioId: string;
  }>,
): Promise<boolean> => {
  const atual = await carregarProcuracaoRfb(
    cliente,
    entrada.tenantId,
    entrada.procuracaoId,
    entrada.hoje,
    true,
  );
  if (
    atual === null ||
    atual.archivedAt !== null ||
    (atual.status !== 'EXPIRED' && atual.status !== 'REVOKED')
  )
    return false;
  if (atual.revision !== entrada.expectedRevision) return false;
  const { rowCount } = await cliente.query(
    `update app.rfb_procuracao set archived_at=now(),revision=revision+1,updated_at=now()
     where tenant_id=$1 and id=$2 and revision=$3 and archived_at is null`,
    [entrada.tenantId, entrada.procuracaoId, entrada.expectedRevision],
  );
  if (rowCount !== 1) return false;
  await registrarEventoDeProcuracao(cliente, {
    tenantId: entrada.tenantId,
    procuracaoId: entrada.procuracaoId,
    acao: 'ARQUIVADA',
    estadoAnterior: atual.status,
    estadoNovo: 'ARQUIVADA',
    correlationId: entrada.correlationId,
    atorId: entrada.usuarioId,
    idempotencyKey: `arquivamento:${entrada.procuracaoId}`,
  });
  return true;
};

export const registrarEventoDeProcuracao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    procuracaoId: string;
    acao: string;
    estadoAnterior?: string;
    estadoNovo?: string;
    poder?: PoderRfb;
    resultado?: string;
    motivo?: string;
    correlationId: string;
    atorId?: string;
    idempotencyKey: string;
  }>,
): Promise<void> => {
  await cliente.query(
    `insert into app.rfb_procuracao_evento(tenant_id,empresa_id,procuracao_id,acao,estado_anterior,estado_novo,
      poder,resultado,motivo,correlation_id,ator_id,idempotency_key,revisao)
      select p.tenant_id,p.empresa_id,p.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,p.revision
       from app.rfb_procuracao p where p.tenant_id=$1 and p.id=$2
     on conflict(tenant_id,idempotency_key) do nothing`,
    [
      entrada.tenantId,
      entrada.procuracaoId,
      entrada.acao,
      entrada.estadoAnterior ?? null,
      entrada.estadoNovo ?? null,
      entrada.poder ?? null,
      entrada.resultado ?? null,
      entrada.motivo ?? null,
      entrada.correlationId,
      entrada.atorId ?? null,
      entrada.idempotencyKey,
    ],
  );
};

export const registrarTentativaRecusadaDeProcuracao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    procuracaoId: string;
    usuarioId: string;
    poder: PoderRfb;
    resultado: string;
    motivo: string;
    correlationId: string;
    idempotencyKey: string;
  }>,
): Promise<void> => {
  await cliente.query(
    `insert into app.rfb_procuracao_evento(tenant_id,empresa_id,procuracao_id,acao,poder,resultado,motivo,correlation_id,ator_id,idempotency_key,revisao)
     select p.tenant_id,p.empresa_id,p.id,'OPERACAO_RFB',$4,'RECUSADA',$5,$6,$3,$7,p.revision
       from app.rfb_procuracao p
      where p.tenant_id=$1 and p.id=$2 and app.empresa_autorizada(p.empresa_id)
     on conflict(tenant_id,idempotency_key) do nothing`,
    [
      entrada.tenantId,
      entrada.procuracaoId,
      entrada.usuarioId,
      entrada.poder,
      entrada.motivo,
      entrada.correlationId,
      entrada.idempotencyKey,
    ],
  );
};

export const carregarEvidenciaDeProcuracao = async (
  cliente: PoolClient,
  tenantId: string,
  procuracaoId: string,
): Promise<Readonly<{ chaveStorage: string; nome: string }> | null> => {
  const { rows } = await cliente.query<{ chave_storage: string; nome: string }>(
    `select d.chave_storage,d.nome_original nome
       from app.rfb_procuracao p
       join app.empresa_documento_versao d
         on d.id=p.evidence_document_id and d.tenant_id=p.tenant_id and d.empresa_id=p.empresa_id
      where p.tenant_id=$1 and p.id=$2`,
    [tenantId, procuracaoId],
  );
  const linha = rows[0];
  return linha === undefined
    ? null
    : { chaveStorage: linha.chave_storage, nome: linha.nome };
};

export const carregarOperacaoIdempotenteDeProcuracao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    empresaId: string;
    idempotencyKey: string;
  }>,
): Promise<Readonly<{
  poder: PoderRfb;
  codigo: string;
  resumo: Readonly<Record<string, unknown>>;
}> | null> => {
  const { rows } = await cliente.query<{
    poder: PoderRfb;
    resultado_codigo: string;
    resultado_resumo: Record<string, unknown>;
  }>(
    `select poder,resultado_codigo,resultado_resumo from app.rfb_procuracao_operacao
      where tenant_id=$1 and empresa_id=$2 and idempotency_key=$3`,
    [entrada.tenantId, entrada.empresaId, entrada.idempotencyKey],
  );
  const linha = rows[0];
  return linha === undefined
    ? null
    : {
        poder: linha.poder,
        codigo: linha.resultado_codigo,
        resumo: linha.resultado_resumo,
      };
};

export const gravarOperacaoDeProcuracao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    empresaId: string;
    procuracaoId: string;
    usuarioId: string;
    poder: PoderRfb;
    idempotencyKey: string;
    codigo: string;
    resumo: Readonly<Record<string, unknown>>;
    correlationId: string;
  }>,
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `insert into app.rfb_procuracao_operacao(tenant_id,empresa_id,procuracao_id,ator_id,poder,idempotency_key,resultado_codigo,resultado_resumo,correlation_id)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) on conflict(tenant_id,empresa_id,idempotency_key) do nothing`,
    [
      entrada.tenantId,
      entrada.empresaId,
      entrada.procuracaoId,
      entrada.usuarioId,
      entrada.poder,
      entrada.idempotencyKey,
      entrada.codigo,
      JSON.stringify(entrada.resumo),
      entrada.correlationId,
    ],
  );
  if (rowCount === 1)
    await registrarEventoDeProcuracao(cliente, {
      tenantId: entrada.tenantId,
      procuracaoId: entrada.procuracaoId,
      acao: 'OPERACAO_RFB',
      poder: entrada.poder,
      resultado: entrada.codigo,
      correlationId: entrada.correlationId,
      atorId: entrada.usuarioId,
      idempotencyKey:
        'operacao:' +
        entrada.tenantId +
        ':' +
        entrada.empresaId +
        ':' +
        entrada.idempotencyKey,
    });
  return rowCount === 1;
};

export const listarEventosDeProcuracao = async (
  cliente: PoolClient,
  tenantId: string,
  procuracaoId: string,
  limit: number,
  offset: number,
): Promise<readonly EventoDaProcuracao[]> => {
  const { rows } = await cliente.query<{
    id: string;
    acao: string;
    estado_anterior: string | null;
    estado_novo: string | null;
    poder: PoderRfb | null;
    resultado: string | null;
    motivo: string | null;
    correlation_id: string;
    ator_id: string | null;
    criado_em: Date;
  }>(
    `select id,acao,estado_anterior,estado_novo,poder,resultado,motivo,correlation_id,ator_id,criado_em
       from app.rfb_procuracao_evento where tenant_id=$1 and procuracao_id=$2
      order by criado_em desc,sequencia desc limit $3 offset $4`,
    [tenantId, procuracaoId, limit, offset],
  );
  return rows.map((linha) => ({
    id: linha.id,
    acao: linha.acao,
    estadoAnterior: linha.estado_anterior,
    estadoNovo: linha.estado_novo,
    poder: linha.poder,
    resultado: linha.resultado,
    motivo: linha.motivo,
    correlationId: linha.correlation_id,
    atorId: linha.ator_id,
    criadoEm: linha.criado_em.toISOString(),
  }));
};
