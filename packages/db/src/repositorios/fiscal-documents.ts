import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

export type RegistroFiscalPersistido = Readonly<{
  id: string; especie: 'NFE_55' | 'CTE'; chaveAcesso: string; hashSha256: string; tamanho: number;
  versaoLayout: string; modelo: string; protocolo: string | null; referencias: readonly Readonly<{ tipo: string; chave: string }>[];
  partes: readonly Readonly<{ papel: 'EMITENTE' | 'DESTINATARIO'; identificador: string | null; nome: string | null; inscricaoEstadual: string | null;
    logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; codigoMunicipio: string | null;
    municipio: string | null; uf: string | null; cep: string | null; codigoPais: string | null; pais: string | null }>[];
  emitidoEm: string | null; emitente: string | null;
  destinatario: string | null; total: string | null; ibsCbsPendente: boolean;
  baseIbsCbs: string | null; totalIbs: string | null; totalCbs: string | null;
  itens: readonly Readonly<{ codigo: string | null; descricao: string | null; quantidade: string | null; unidade: string | null; valor: string | null; ibs: string | null; cbs: string | null }>[];
}>;

const estadoFiscalApresentado = (alias: string) => `case
  when exists(select 1 from app.fiscal_document_event e where e.document_id=${alias}.id and e.tipo='CONFLITO') then 'CONFLITO'
  else coalesce((
    select case when e.tipo='REUTILIZADO' then e.codigo else e.tipo end
      from app.fiscal_document_event e
     where e.document_id=${alias}.id
       and (e.tipo in ('PROCESSADO','PENDENTE_IBS_CBS','PENDENTE_LAYOUT','XML_INVALIDO','FALHA')
         or (e.tipo='REUTILIZADO' and e.codigo in ('PROCESSADO','PENDENTE_IBS_CBS','PENDENTE_LAYOUT','XML_INVALIDO','FALHA')))
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
  const [items,origins,events,references,parties] = await Promise.all([
    client.query(`select numero,codigo,descricao,quantidade,unidade,valor,ibs,cbs from app.fiscal_document_item where document_id=$1 order by numero`, [documentId]),
    client.query(`select staging_id,cnpj,nsu,correlation_id,capturado_em from app.fiscal_document_origin where document_id=$1 order by capturado_em`, [documentId]),
    client.query(`select tipo,codigo,detalhe_sanitizado,parser_version,hash_sha256,ocorrido_em from app.fiscal_document_event where document_id=$1 order by ocorrido_em desc limit 30`, [documentId]),
    client.query(`select tipo,chave from app.fiscal_document_reference where document_id=$1 order by tipo,chave`, [documentId]),
    client.query(`select papel,identificador,nome,inscricao_estadual,logradouro,numero,complemento,bairro,codigo_municipio,municipio,uf,cep,codigo_pais,pais from app.fiscal_document_party where document_id=$1 order by papel`, [documentId]),
  ]);
  return { ...documentData, estado: estado_apresentado, itens: items.rows, origens: origins.rows, eventos: events.rows, referencias: references.rows, partes: parties.rows };
};

export const persistirDocumentoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; stagingId: string; cnpj: string; nsu: string; correlationId: string;
  originalKey: string; parserVersion: string; atorId?: string; parsed: RegistroFiscalPersistido;
}>): Promise<Readonly<{ id: string; reused: boolean; conflict: boolean; state: string }>> => {
  const stagedDocument = await client.query<{ id: string; hash_sha256: string; estado: string }>(
    `select id,hash_sha256,estado from app.fiscal_document where primary_staging_id=$1`, [input.stagingId],
  );
  const current = stagedDocument.rows[0] ? stagedDocument : await client.query<{ id: string; hash_sha256: string; estado: string }>(
    `select id,hash_sha256,estado from app.fiscal_document where tenant_id=$1 and empresa_id=$2 and especie=$3 and chave_acesso=$4 order by criado_em limit 1`,
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
  const precisaNormalizar = !existing || ['FALHA','XML_INVALIDO','PENDENTE_LAYOUT'].includes(existing.estado);
  if (!existing) {
    await client.query(
      `insert into app.fiscal_document(id,tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,original_key,tamanho_bytes,modelo,versao_layout,protocolo,emitido_em,emitente,destinatario,total,base_ibs_cbs,total_ibs,total_cbs,estado,parser_version)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14,$15,$16::numeric,$17::numeric,$18::numeric,$19::numeric,$20,$21)`,
      [id,input.tenantId,input.empresaId,input.stagingId,input.parsed.especie,input.parsed.chaveAcesso,input.parsed.hashSha256,input.originalKey,input.parsed.tamanho,input.parsed.modelo,input.parsed.versaoLayout,input.parsed.protocolo,input.parsed.emitidoEm?.slice(0,10) ?? null,input.parsed.emitente,input.parsed.destinatario,input.parsed.total,input.parsed.baseIbsCbs,input.parsed.totalIbs,input.parsed.totalCbs,state,input.parserVersion],
    );
  } else if (precisaNormalizar) {
    await client.query(
      `update app.fiscal_document set estado=$1,modelo=$2,versao_layout=$3,protocolo=$4,emitido_em=$5::date,emitente=$6,destinatario=$7,total=$8::numeric,base_ibs_cbs=$9::numeric,total_ibs=$10::numeric,total_cbs=$11::numeric,atualizado_em=now() where id=$12`,
      [state,input.parsed.modelo,input.parsed.versaoLayout,input.parsed.protocolo,input.parsed.emitidoEm?.slice(0,10) ?? null,input.parsed.emitente,input.parsed.destinatario,input.parsed.total,input.parsed.baseIbsCbs,input.parsed.totalIbs,input.parsed.totalCbs,id],
    );
  }
  if (precisaNormalizar) {
    for (const [index,item] of input.parsed.itens.entries()) {
      await client.query(
        `insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,numero,codigo,descricao,quantidade,unidade,valor,ibs,cbs)
         values($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9::numeric,$10::numeric,$11::numeric)`,
        [input.tenantId,input.empresaId,id,index+1,item.codigo,item.descricao,item.quantidade,item.unidade,item.valor,item.ibs,item.cbs],
      );
    }
    for (const reference of input.parsed.referencias) {
      await client.query(
        `insert into app.fiscal_document_reference(tenant_id,empresa_id,document_id,tipo,chave) values($1,$2,$3,$4,$5) on conflict(document_id,tipo,chave) do nothing`,
        [input.tenantId,input.empresaId,id,reference.tipo,reference.chave],
      );
    }
    for (const party of input.parsed.partes) {
      await client.query(
        `insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,papel,identificador,nome,inscricao_estadual,logradouro,numero,complemento,bairro,codigo_municipio,municipio,uf,cep,codigo_pais,pais)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict(document_id,papel) do nothing`,
        [input.tenantId,input.empresaId,id,party.papel,party.identificador,party.nome,party.inscricaoEstadual,party.logradouro,party.numero,party.complemento,party.bairro,party.codigoMunicipio,party.municipio,party.uf,party.cep,party.codigoPais,party.pais],
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
    [input.tenantId,input.empresaId,id,input.stagingId,existing?'REUTILIZADO':'PROCESSADO',state,input.parserVersion,input.parsed.hashSha256,input.atorId ?? null,input.correlationId],
  );
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
