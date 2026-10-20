import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { CODIGOS_DE_ERRO, ErroDeConflito } from '@contaia/domain';
import { transicionarCienciaDaEmissao } from './fiscal-acknowledgement.js';

export type RegistroFiscalPersistido = Readonly<{
  id: string; especie: 'NFE_55' | 'CTE'; chaveAcesso: string; hashSha256: string; tamanho: number;
  versaoLayout: string; modelo: string; protocolo: string | null; protocoloRecebidoEm: string | null; referencias: readonly Readonly<{ tipo: string; chave: string }>[];
  partes: readonly Readonly<{ papel: 'EMITENTE' | 'DESTINATARIO'; identificador: string | null; nome: string | null; inscricaoEstadual: string | null;
    logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; codigoMunicipio: string | null;
    municipio: string | null; uf: string | null; cep: string | null; codigoPais: string | null; pais: string | null }>[];
  emitidoEm: string | null; emitente: string | null;
  destinatario: string | null; total: string | null; ibsCbsPendente: boolean;
  baseIbsCbs: string | null; totalIbs: string | null; totalCbs: string | null;
  itens: readonly Readonly<{ tipo: 'ITEM' | 'COMPONENTE' | 'MEDIDA_CARGA'; codigo: string | null; descricao: string | null; quantidade: string | null; unidade: string | null; valor: string | null; ibs: string | null; cbs: string | null; ncm?: string | null; cfop?: string | null; cstCsosn?: string | null }>[];
  tributos: readonly Readonly<{ escopo: 'DOCUMENTO' | 'ITEM'; numeroItem: number | null; codigo: 'ICMS' | 'ICMS_ST' | 'IPI' | 'II' | 'PIS' | 'COFINS' | 'IBS' | 'CBS'; baseCalculo: string | null; aliquota: string | null; valor: string | null; situacao: string | null; classificacao: string | null }>[];
}>;

export type ItemParaResolucaoTributaria = Readonly<{
  numero: number;
  parser_version: string;
  descricao: string | null;
  valor: string | null;
  ncm: string | null;
  cfop: string | null;
  cst_csosn: string | null;
  modelo: string;
  estado: string;
  emitido_em: string | null;
  protocolo: string | null;
  origem_uf: string | null;
  destino_uf: string | null;
}>;

export const listarItensParaResolucaoTributaria = async (client: PoolClient, empresaId: string, documentId: string) => {
  const document = await client.query<{ parser_version: string; especie: string; modelo: string; estado: string; emitido_em: string | null }>(
    `select parser_version,especie,modelo,estado,emitido_em from app.fiscal_document where empresa_id=$1 and id=$2`,
    [empresaId,documentId],
  );
  if (!document.rows[0]) return null;
  const { rows: items } = await client.query<ItemParaResolucaoTributaria>(
    `select i.numero,i.parser_version,i.descricao,i.valor::text,i.ncm,i.cfop,i.cst_csosn,
            d.modelo,d.estado,d.emitido_em::text,d.protocolo,
            (select uf from app.fiscal_document_party p where p.document_id=d.id and p.parser_version=d.parser_version and p.papel='EMITENTE' limit 1) origem_uf,
            (select uf from app.fiscal_document_party p where p.document_id=d.id and p.parser_version=d.parser_version and p.papel='DESTINATARIO' limit 1) destino_uf
       from app.fiscal_document_item i join app.fiscal_document d on d.id=i.document_id and d.empresa_id=i.empresa_id
      where i.empresa_id=$1 and i.document_id=$2 and i.parser_version=$3 and i.tipo='ITEM' order by i.numero`,
    [empresaId,documentId,document.rows[0].parser_version],
  );
  const { rows: tributos } = await client.query<{
    escopo: 'ITEM'; numero_item: number; codigo: 'ICMS' | 'ICMS_ST' | 'IPI' | 'II' | 'PIS' | 'COFINS' | 'IBS' | 'CBS';
    base_calculo: string | null; aliquota: string | null; valor: string | null; situacao: string | null; classificacao: string | null;
  }>(
    `select escopo,numero_item,codigo,base_calculo::text,aliquota::text,valor::text,situacao,classificacao
       from app.fiscal_document_tax
      where empresa_id=$1 and document_id=$2 and parser_version=$3 and escopo='ITEM'
      order by numero_item,codigo`,
    [empresaId,documentId,document.rows[0].parser_version],
  );
  return { ...document.rows[0], origem_uf: items[0]?.origem_uf ?? null, destino_uf: items[0]?.destino_uf ?? null,
    protocolo: items[0]?.protocolo ?? null, itens: items, tributos };
};

export const obterRegimeTributarioHistorico = async (client: PoolClient, empresaId: string, factDate: string | null) => {
  if (factDate === null) return null;
  const { rows } = await client.query<{ regime: string | null; vigente_desde: string | null }>(
    `select valor_novo as regime, to_char(vigencia,'YYYY-MM-DD') as vigente_desde
       from app.empresa_evento_de_historico
      where empresa_id=$1 and aba='DADOS_FISCAIS' and campo='regimeTributario'
        and vigencia <= $2::date
      order by vigencia desc, ocorrido_em desc, sequencia desc
      limit 1`,
    [empresaId,factDate],
  );
  return rows[0] ?? null;
};

export const persistirSnapshotsResolucaoTributaria = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; documentId: string; actorId: string; correlationId: string;
  idempotencyKey: string; expectedParserVersion: string; reprocessingReason: string | null;
  packageId: string | null; packageSha256: string | null;
  items: readonly Readonly<{ itemNumber: number; parserVersion: string; inputSha256: string; facts: unknown; decisions: unknown }>[];
}>) => {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[input.documentId]);
  const document = await client.query<{ parser_version: string; estado: string }>(
    `select parser_version,estado from app.fiscal_document where tenant_id=$1 and empresa_id=$2 and id=$3 for share`,
    [input.tenantId,input.empresaId,input.documentId],
  );
  const current = document.rows[0];
  if (!current || current.parser_version !== input.expectedParserVersion || current.estado !== 'PROCESSADO') {
    throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_TREATMENT_DOCUMENT_CONFLICT, 'A NF-e mudou ou deixou de estar processada durante a resolução.');
  }
  const prior = await client.query(
    `select * from app.tax_entry_resolution_snapshot where tenant_id=$1 and empresa_id=$2 and document_id=$3 and idempotency_key=$4 order by item_number`,
    [input.tenantId,input.empresaId,input.documentId,input.idempotencyKey],
  );
  if (prior.rows.length > 0) {
    const hashes = new Map(prior.rows.map((row) => [Number(row.item_number),String(row.input_sha256)]));
    const requestedItems = new Set(input.items.map((item) => item.itemNumber));
    const priorPackageId = prior.rows[0]?.package_id ?? null;
    const priorPackageSha256 = prior.rows[0]?.package_sha256 ?? null;
    if (input.items.length !== prior.rows.length || requestedItems.size !== input.items.length || requestedItems.size !== hashes.size ||
        [...requestedItems].some((itemNumber) => !hashes.has(itemNumber)) ||
        input.items.some((item) => hashes.get(item.itemNumber) !== item.inputSha256) ||
        prior.rows.some((row) => (row.package_id ?? null) !== priorPackageId || (row.package_sha256 ?? null) !== priorPackageSha256) ||
        priorPackageId !== input.packageId || priorPackageSha256 !== input.packageSha256) {
      throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_TREATMENT_IDEMPOTENCY_CONFLICT, 'A chave idempotente já foi usada com conteúdo diferente.');
    }
    return { revision: Number(prior.rows[0].revision), reused: true, snapshots: prior.rows };
  }
  if (input.items.length === 0) throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_TREATMENT_DOCUMENT_CONFLICT, 'A NF-e não possui itens elegíveis para registrar resolução.');
  const { rows: latestRows } = await client.query<{ revision: number }>(
    `select coalesce(max(revision),0) as revision from app.tax_entry_resolution_snapshot where tenant_id=$1 and empresa_id=$2 and document_id=$3`,
    [input.tenantId,input.empresaId,input.documentId],
  );
  if (Number(latestRows[0]?.revision ?? 0) > 0 && input.reprocessingReason === null) {
    throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_TREATMENT_REPROCESS_REASON_REQUIRED, 'Informe o motivo antes de criar outra revisão da resolução.');
  }
  const { rows: revisionRows } = await client.query<{ revision: number }>(
    `select coalesce(max(revision),0)+1 as revision from app.tax_entry_resolution_snapshot where tenant_id=$1 and empresa_id=$2 and document_id=$3`,
    [input.tenantId,input.empresaId,input.documentId],
  );
  const revision = Number(revisionRows[0]?.revision ?? 1);
  const snapshots = [];
  for (const item of input.items) {
    const { rows } = await client.query(
      `insert into app.tax_entry_resolution_snapshot
         (tenant_id,empresa_id,document_id,item_number,parser_version,revision,idempotency_key,input_sha256,package_id,package_sha256,facts,decisions,reprocessing_reason,actor_id,correlation_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15) returning *`,
      [input.tenantId,input.empresaId,input.documentId,item.itemNumber,item.parserVersion,revision,input.idempotencyKey,item.inputSha256,input.packageId,input.packageSha256,JSON.stringify(item.facts),JSON.stringify(item.decisions),input.reprocessingReason,input.actorId,input.correlationId],
    );
    snapshots.push(rows[0]);
  }
  return { revision, reused: false, snapshots };
};

export const listarSnapshotsResolucaoTributaria = async (client: PoolClient, empresaId: string, documentId: string, revision?: number) => {
  const { rows } = await client.query(
    `select * from app.tax_entry_resolution_snapshot where empresa_id=$1 and document_id=$2 and ($3::integer is null or revision=$3) order by revision desc,item_number`,
    [empresaId,documentId,revision ?? null],
  );
  return rows;
};

export const registrarEventoResolucaoTributaria = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; documentId: string; actorId: string; correlationId: string;
  action: 'PROCESSED' | 'REPROCESSED' | 'ABSTAINED'; revision: number; packageId: string | null;
  itemCount: number; indeterminateCount: number; idempotencyKey: string;
}>) => {
  await client.query(
    `insert into app.tax_entry_resolution_event
      (tenant_id,empresa_id,document_id,actor_id,correlation_id,action,revision,package_id,item_count,indeterminate_count,idempotency_key)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict(tenant_id,idempotency_key) do nothing`,
    [input.tenantId,input.empresaId,input.documentId,input.actorId,input.correlationId,input.action,input.revision,
      input.packageId,input.itemCount,input.indeterminateCount,input.idempotencyKey],
  );
};

export const listarFilaResolucaoTributaria = async (client: PoolClient, empresaId:string, page:number, filters:Readonly<{
  from:string|null; to:string|null; regime:'SIMPLES_NACIONAL'|'LUCRO_PRESUMIDO'|null;
  state:'SEM_PROCESSAMENTO'|'INDETERMINADO'|'RESOLVIDO'|null; hasIndeterminate:boolean|null;
}>, pageSize=20) => {
  const { rows } = await client.query(
    `with elegiveis as (
       select d.id,d.chave_acesso,d.emitido_em,coalesce(issuer.nome,d.emitente) emitente,d.destinatario,d.modelo,d.protocolo,
              (select count(*)::int from app.fiscal_document_item fi where fi.document_id=d.id and fi.parser_version=d.parser_version and fi.tipo='ITEM') item_count,
              regime.regime,
              latest.revision,latest.package_id,latest.has_indeterminate,
              case when latest.revision is null then 'SEM_PROCESSAMENTO'
                   when latest.has_indeterminate then 'INDETERMINADO' else 'RESOLVIDO' end resolution_state
         from app.fiscal_document d
         join app.empresa company on company.id=d.empresa_id and company.id=$1
         join app.fiscal_document_party issuer on issuer.document_id=d.id and issuer.parser_version=d.parser_version and issuer.papel='EMITENTE'
         join app.fiscal_document_party recipient on recipient.document_id=d.id and recipient.parser_version=d.parser_version and recipient.papel='DESTINATARIO'
         left join lateral (
           select valor_novo as regime from app.empresa_evento_de_historico h
            where h.empresa_id=d.empresa_id and h.aba='DADOS_FISCAIS' and h.campo='regimeTributario'
              and h.vigencia<=d.emitido_em order by h.vigencia desc,h.ocorrido_em desc,h.sequencia desc limit 1
         ) regime on true
         left join lateral (
           select s.revision,(array_agg(s.package_id ORDER BY s.item_number) FILTER (WHERE s.package_id IS NOT NULL))[1] package_id,
                  bool_or(exists(select 1 from jsonb_array_elements(s.decisions) decision where decision->>'status'='INDETERMINATE')) has_indeterminate
             from app.tax_entry_resolution_snapshot s where s.tenant_id=d.tenant_id and s.empresa_id=d.empresa_id and s.document_id=d.id
            group by s.revision order by s.revision desc limit 1
         ) latest on true
        where d.tenant_id=(select tenant_id from app.empresa where id=$1)
          and d.especie='NFE_55' and d.modelo='55' and d.estado='PROCESSADO' and d.protocolo is not null and d.emitido_em is not null
          and recipient.identificador is not null and regexp_replace(recipient.identificador,'\\D','','g')=regexp_replace(company.cnpj,'\\D','','g')
          and issuer.identificador is not null and regexp_replace(issuer.identificador,'\\D','','g')<>regexp_replace(recipient.identificador,'\\D','','g')
     )
     select *,count(*) over()::int total from elegiveis
      where ($2::date is null or emitido_em >= $2::date) and ($3::date is null or emitido_em <= $3::date)
        and ($4::text is null or regime=$4) and ($5::text is null or resolution_state=$5)
        and ($6::boolean is null or coalesce(has_indeterminate,false)=$6)
      order by emitido_em desc,id limit $7 offset $8`,
    [empresaId,filters.from,filters.to,filters.regime,filters.state,filters.hasIndeterminate,pageSize+1,(page-1)*pageSize],
  );
  return { total:rows[0]?.total ?? 0,temProximaPagina:rows.length>pageSize,items:rows.slice(0,pageSize) };
};

const estadoFiscalApresentado = (alias: string) => `case
  when exists(select 1 from app.fiscal_document_event e where e.document_id=${alias}.id and e.tipo='CONFLITO') then 'CONFLITO'
  else coalesce((
    select case when e.tipo in ('REUTILIZADO','REPROCESSADO') then e.codigo else e.tipo end
      from app.fiscal_document_event e
     where e.document_id=${alias}.id
       and (e.tipo in ('PROCESSADO','PENDENTE_IBS_CBS','PENDENTE_LAYOUT','XML_INVALIDO','FALHA')
         or (e.tipo in ('REUTILIZADO','REPROCESSADO') and e.codigo in ('PROCESSADO','PENDENTE_IBS_CBS','PENDENTE_LAYOUT','XML_INVALIDO','FALHA')))
     order by e.ocorrido_em desc,e.id desc limit 1
  ),${alias}.estado)
end`;

export const listarDocumentosFiscais = async (client: PoolClient, empresaId: string, page: number, estado: string | null = null, pageSize = 20) => {
  const { rows } = await client.query(
    `with documentos as (
       select d.id,d.especie,d.chave_acesso,d.hash_sha256,d.emitido_em,d.emitente,d.destinatario,d.total,
              ${estadoFiscalApresentado('d')} estado,
              d.versao_layout,d.criado_em,o.nsu,o.capturado_em,
              coalesce((select max(e.ocorrido_em) from app.fiscal_document_event e where e.document_id=d.id),o.capturado_em) atividade_em,
              (select count(*)::int from app.fiscal_document_origin oo where oo.document_id=d.id) origens
         from app.fiscal_document d left join lateral (
           select nsu,capturado_em from app.fiscal_document_origin x where x.document_id=d.id order by capturado_em desc limit 1
         ) o on true
        where d.empresa_id=$1
       union all
       select s.id,s.especie,s.chave_acesso,null::text,null::date,null::text,null::text,null::numeric,
              case when o.estado='PENDENTE' then 'PENDENTE' else 'PROCESSANDO' end,
              null::text,s.capturado_em,s.nsu,s.capturado_em,coalesce(o.publicado_em,s.capturado_em),1::int
         from app.fiscal_document_outbox o join app.dfe_capture_staging s on s.id=o.staging_id and s.empresa_id=o.empresa_id
        where s.empresa_id=$1 and o.estado in ('PENDENTE','PUBLICADO')
          and not exists(select 1 from app.fiscal_document_origin x where x.staging_id=s.id)
     )
     select * from documentos
      where $2::text is null or estado=$2
      order by emitido_em desc nulls last,capturado_em desc,id
      limit $3 offset $4`, [empresaId,estado,pageSize + 1,(page-1)*pageSize],
  );
  return rows;
};

export const obterDocumentoFiscal = async (client: PoolClient, empresaId: string, documentId: string) => {
  const document = await client.query(
    `select d.*,( ${estadoFiscalApresentado('d')} ) estado_apresentado
       from app.fiscal_document d where d.empresa_id=$1 and d.id=$2`, [empresaId,documentId],
  );
  if (!document.rows[0]) return null;
  const { estado_apresentado, ...documentData } = document.rows[0];
  const [items,origins,events,references,parties,taxes] = await Promise.all([
    client.query(`select numero,tipo,codigo,descricao,ncm,cfop,cst_csosn,quantidade,unidade,valor,ibs,cbs from app.fiscal_document_item where document_id=$1 and parser_version=$2 order by numero`, [documentId,documentData.parser_version]),
    client.query(`select staging_id,cnpj,nsu,correlation_id,capturado_em from app.fiscal_document_origin where document_id=$1 order by capturado_em`, [documentId]),
    client.query(`select tipo,codigo,detalhe_sanitizado,parser_version,hash_sha256,ocorrido_em from app.fiscal_document_event where document_id=$1 order by ocorrido_em desc limit 30`, [documentId]),
    client.query(`select tipo,chave from app.fiscal_document_reference where document_id=$1 and parser_version=$2 order by tipo,chave`, [documentId,documentData.parser_version]),
    client.query(`select papel,identificador,nome,inscricao_estadual,logradouro,numero,complemento,bairro,codigo_municipio,municipio,uf,cep,codigo_pais,pais from app.fiscal_document_party where document_id=$1 and parser_version=$2 order by papel`, [documentId,documentData.parser_version]),
    client.query(`select escopo,numero_item,codigo,base_calculo,aliquota,valor,situacao,classificacao from app.fiscal_document_tax where document_id=$1 and parser_version=$2 order by escopo,numero_item nulls first,codigo`, [documentId,documentData.parser_version]),
  ]);
  return { ...documentData, estado: estado_apresentado, itens: items.rows, origens: origins.rows, eventos: events.rows, referencias: references.rows, partes: parties.rows, tributos: taxes.rows };
};

export const persistirDocumentoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; stagingId: string; cnpj: string; nsu: string; correlationId: string;
  originalKey: string; parserVersion: string; atorId?: string; parsed: RegistroFiscalPersistido;
}>): Promise<Readonly<{ id: string; reused: boolean; conflict: boolean; state: string }>> => {
  const stagedDocument = await client.query<{ id: string; hash_sha256: string; estado: string; parser_version: string }>(
    `select id,hash_sha256,estado,parser_version from app.fiscal_document where primary_staging_id=$1`, [input.stagingId],
  );
  const current = stagedDocument.rows[0] ? stagedDocument : await client.query<{ id: string; hash_sha256: string; estado: string; parser_version: string }>(
    `select id,hash_sha256,estado,parser_version from app.fiscal_document where tenant_id=$1 and empresa_id=$2 and especie=$3 and chave_acesso=$4 order by criado_em limit 1`,
    [input.tenantId,input.empresaId,input.parsed.especie,input.parsed.chaveAcesso],
  );
  const existing = current.rows[0];
  if (existing && existing.hash_sha256 !== input.parsed.hashSha256) {
    await client.query(
      `insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,tipo,codigo,detalhe_sanitizado,parser_version,hash_sha256,ator_id,correlation_id)
       values($1,$2,$3,$4,'CONFLITO','FISCAL_DOCUMENT_CONFLICT','Chave de acesso já vinculada a conteúdo diferente.',$5,$6,$7,$8)`,
      [input.tenantId,input.empresaId,existing.id,input.stagingId,input.parserVersion,input.parsed.hashSha256,input.atorId ?? null,input.correlationId],
    );
    await client.query(
      `insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,staging_id,cnpj,nsu,correlation_id,capturado_em)
       select $1,$2,$3,s.id,s.cnpj,s.nsu,s.correlation_id,s.capturado_em from app.dfe_capture_staging s where s.id=$4 on conflict(staging_id) do nothing`,
      [input.tenantId,input.empresaId,existing.id,input.stagingId],
    );
    return { id: existing.id, reused: true, conflict: true, state: 'CONFLITO' };
  }
  const id = existing?.id ?? input.parsed.id;
  const state = input.parsed.ibsCbsPendente ? 'PENDENTE_IBS_CBS' : 'PROCESSADO';
  const precisaNormalizar = !existing || existing.parser_version !== input.parserVersion || ['FALHA','XML_INVALIDO','PENDENTE_LAYOUT'].includes(existing.estado);
  if (!existing) {
    await client.query(
      `insert into app.fiscal_document(id,tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,original_key,tamanho_bytes,modelo,versao_layout,protocolo,protocolo_recebido_em,emitido_em,emitente,destinatario,total,base_ibs_cbs,total_ibs,total_cbs,estado,parser_version)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::date,$15,$16,$17::numeric,$18::numeric,$19::numeric,$20::numeric,$21,$22)`,
      [id,input.tenantId,input.empresaId,input.stagingId,input.parsed.especie,input.parsed.chaveAcesso,input.parsed.hashSha256,input.originalKey,input.parsed.tamanho,input.parsed.modelo,input.parsed.versaoLayout,input.parsed.protocolo,input.parsed.protocoloRecebidoEm,input.parsed.emitidoEm?.slice(0,10) ?? null,input.parsed.emitente,input.parsed.destinatario,input.parsed.total,input.parsed.baseIbsCbs,input.parsed.totalIbs,input.parsed.totalCbs,state,input.parserVersion],
    );
  } else if (precisaNormalizar) {
    await client.query(
      `update app.fiscal_document set estado=$1,modelo=$2,versao_layout=$3,protocolo=$4,protocolo_recebido_em=$5::timestamptz,emitido_em=$6::date,emitente=$7,destinatario=$8,total=$9::numeric,base_ibs_cbs=$10::numeric,total_ibs=$11::numeric,total_cbs=$12::numeric,parser_version=$13,atualizado_em=now() where id=$14`,
      [state,input.parsed.modelo,input.parsed.versaoLayout,input.parsed.protocolo,input.parsed.protocoloRecebidoEm,input.parsed.emitidoEm?.slice(0,10) ?? null,input.parsed.emitente,input.parsed.destinatario,input.parsed.total,input.parsed.baseIbsCbs,input.parsed.totalIbs,input.parsed.totalCbs,input.parserVersion,id],
    );
  }
  if (precisaNormalizar) {
    for (const [index,item] of input.parsed.itens.entries()) {
      await client.query(
        `insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,codigo,descricao,quantidade,unidade,valor,ibs,cbs,ncm,cfop,cst_csosn)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11::numeric,$12::numeric,$13::numeric,$14,$15,$16)`,
        [input.tenantId,input.empresaId,id,input.parserVersion,index+1,item.tipo,item.codigo,item.descricao,item.quantidade,item.unidade,item.valor,item.ibs,item.cbs,item.ncm ?? null,item.cfop ?? null,item.cstCsosn ?? null],
      );
    }
    for (const tax of input.parsed.tributos) {
      await client.query(
        `insert into app.fiscal_document_tax(tenant_id,empresa_id,document_id,parser_version,escopo,numero_item,codigo,base_calculo,aliquota,valor,situacao,classificacao)
         values($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10::numeric,$11,$12) on conflict do nothing`,
        [input.tenantId,input.empresaId,id,input.parserVersion,tax.escopo,tax.numeroItem,tax.codigo,tax.baseCalculo,tax.aliquota,tax.valor,tax.situacao,tax.classificacao],
      );
    }
    for (const reference of input.parsed.referencias) {
      await client.query(
        `insert into app.fiscal_document_reference(tenant_id,empresa_id,document_id,parser_version,tipo,chave) values($1,$2,$3,$4,$5,$6) on conflict(document_id,parser_version,tipo,chave) do nothing`,
        [input.tenantId,input.empresaId,id,input.parserVersion,reference.tipo,reference.chave],
      );
    }
    for (const party of input.parsed.partes) {
      await client.query(
        `insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome,inscricao_estadual,logradouro,numero,complemento,bairro,codigo_municipio,municipio,uf,cep,codigo_pais,pais)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) on conflict(document_id,parser_version,papel) do nothing`,
        [input.tenantId,input.empresaId,id,input.parserVersion,party.papel,party.identificador,party.nome,party.inscricaoEstadual,party.logradouro,party.numero,party.complemento,party.bairro,party.codigoMunicipio,party.municipio,party.uf,party.cep,party.codigoPais,party.pais],
      );
    }
  }
  await client.query(
    `insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,staging_id,cnpj,nsu,correlation_id,capturado_em)
     select $1,$2,$3,s.id,s.cnpj,s.nsu,s.correlation_id,s.capturado_em from app.dfe_capture_staging s where s.id=$4
     on conflict(staging_id) do nothing`,
    [input.tenantId,input.empresaId,id,input.stagingId],
  );
  await client.query(
    `insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,tipo,codigo,parser_version,hash_sha256,ator_id,correlation_id)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [input.tenantId,input.empresaId,id,input.stagingId,!existing?'PROCESSADO':precisaNormalizar?'REPROCESSADO':'REUTILIZADO',state,input.parserVersion,input.parsed.hashSha256,input.atorId ?? null,input.correlationId],
  );
  const acknowledgement = await client.query<{ id: string; tenant_id: string; empresa_id: string; estado: string }>(
    `select id,tenant_id,empresa_id,estado from app.fiscal_acknowledgement where xml_staging_id=$1 and estado='XML_COMPLETO_OBTIDO'`,
    [input.stagingId],
  );
  for (const row of acknowledgement.rows) {
    await transicionarCienciaDaEmissao(client, { tenantId: row.tenant_id, empresaId: row.empresa_id,
      acknowledgementId: row.id, estado: 'PARSEADO', codigo: 'FISCAL_DOCUMENT_PARSED', correlationId: input.correlationId });
  }
  return { id, reused: Boolean(existing), conflict: false, state };
};

export const persistirFalhaDocumentoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; stagingId: string; especie: 'NFE_55' | 'CTE'; chaveAcesso: string | null;
  hashSha256: string; tamanho: number; originalKey: string; parserVersion: string; correlationId: string; codigo: string;
  estado: 'PENDENTE_LAYOUT' | 'XML_INVALIDO' | 'FALHA';
}>): Promise<string> => {
  const existing = await client.query<{ id: string; hash_sha256: string }>(
    `select id,hash_sha256 from app.fiscal_document where primary_staging_id=$1`, [input.stagingId],
  );
  if (existing.rows[0]) {
    await registrarEventoDocumentoFiscal(client, { tenantId: input.tenantId, empresaId: input.empresaId,
      documentId: existing.rows[0].id, stagingId: input.stagingId, tipo: input.estado, codigo: input.codigo,
      detalhe: input.codigo, parserVersion: input.parserVersion, hashSha256: input.hashSha256, correlationId: input.correlationId });
    return existing.rows[0].id;
  }
  if (input.chaveAcesso) {
    const byKey = await client.query<{ id: string; hash_sha256: string }>(
      `select id,hash_sha256 from app.fiscal_document where tenant_id=$1 and empresa_id=$2 and especie=$3 and chave_acesso=$4 order by criado_em limit 1`,
      [input.tenantId,input.empresaId,input.especie,input.chaveAcesso],
    );
    if (byKey.rows[0]) {
      const canonical = byKey.rows[0];
      await client.query(
        `insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,staging_id,cnpj,nsu,correlation_id,capturado_em)
         select $1,$2,$3,s.id,s.cnpj,s.nsu,s.correlation_id,s.capturado_em from app.dfe_capture_staging s where s.id=$4 on conflict(staging_id) do nothing`,
        [input.tenantId,input.empresaId,canonical.id,input.stagingId],
      );
      await registrarEventoDocumentoFiscal(client, { tenantId: input.tenantId, empresaId: input.empresaId,
        documentId: canonical.id, stagingId: input.stagingId, tipo: canonical.hash_sha256 === input.hashSha256 ? input.estado : 'CONFLITO',
        codigo: canonical.hash_sha256 === input.hashSha256 ? input.codigo : 'FISCAL_DOCUMENT_CONFLICT',
        detalhe: canonical.hash_sha256 === input.hashSha256 ? input.codigo : 'Chave de acesso já vinculada a conteúdo diferente.',
        parserVersion: input.parserVersion, hashSha256: input.hashSha256, correlationId: input.correlationId });
      return canonical.id;
    }
  }
  const id = randomUUID();
  await client.query(
    `insert into app.fiscal_document(id,tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,original_key,tamanho_bytes,modelo,versao_layout,estado,parser_version)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,'desconhecido','desconhecido',$10,$11)`,
    [id,input.tenantId,input.empresaId,input.stagingId,input.especie,input.chaveAcesso,input.hashSha256,input.originalKey,input.tamanho,input.estado,input.parserVersion],
  );
  await client.query(
    `insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,staging_id,cnpj,nsu,correlation_id,capturado_em)
     select $1,$2,$3,s.id,s.cnpj,s.nsu,s.correlation_id,s.capturado_em from app.dfe_capture_staging s where s.id=$4
     on conflict(staging_id) do nothing`, [input.tenantId,input.empresaId,id,input.stagingId],
  );
  await registrarEventoDocumentoFiscal(client, { tenantId: input.tenantId, empresaId: input.empresaId,
    documentId: id, stagingId: input.stagingId, tipo: input.estado, codigo: input.codigo,
    detalhe: input.codigo, parserVersion: input.parserVersion, hashSha256: input.hashSha256, correlationId: input.correlationId });
  return id;
};

export const registrarEventoDocumentoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; documentId: string | null; stagingId: string; tipo: string; codigo?: string;
  detalhe?: string; parserVersion: string; hashSha256?: string; atorId?: string; correlationId: string;
}>) => client.query(
  `insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,tipo,codigo,detalhe_sanitizado,parser_version,hash_sha256,ator_id,correlation_id)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [input.tenantId,input.empresaId,input.documentId,input.stagingId,input.tipo,input.codigo ?? null,input.detalhe ?? null,input.parserVersion,input.hashSha256 ?? null,input.atorId ?? null,input.correlationId],
);
