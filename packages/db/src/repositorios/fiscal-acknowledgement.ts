import type { PoolClient } from 'pg';
import { proximoEstadoDaCiencia, type EstadoDaCiencia } from '@contaia/shared/fiscal-acknowledgement';

export type CienciaDaEmissao = Readonly<{
  id: string; tenant_id: string; empresa_id: string; staging_id: string; chave_acesso: string;
  estado: EstadoDaCiencia; tentativas: number; tentativas_ciencia: number; tentativas_xml: number;
  tentativas_ciencia_ciclo: number; tentativas_xml_ciclo: number;
  protocolo: string | null; ambiente: string | null; solicitada_em: Date;
  codigo: string | null; motivo_sanitizado: string | null; proxima_tentativa_em: Date | null;
  xml_staging_id: string | null; correlation_id: string; criado_em: Date; atualizado_em: Date;
}>;

export const iniciarCienciaDaEmissao = async (
  client: PoolClient,
  input: Readonly<{ tenantId: string; empresaId: string; stagingId: string; chaveAcesso: string; correlationId: string }>,
): Promise<CienciaDaEmissao> => {
  const inserted = await client.query<CienciaDaEmissao>(
  `insert into app.fiscal_acknowledgement(tenant_id,empresa_id,staging_id,chave_acesso,estado,correlation_id)
     values($1,$2,$3,$4,'RESUMO_CAPTURADO',$5) on conflict do nothing returning *`,
    [input.tenantId,input.empresaId,input.stagingId,input.chaveAcesso,input.correlationId]);
  let row = inserted.rows[0];
  if (!row) {
    const current = await client.query<CienciaDaEmissao>(
      `select * from app.fiscal_acknowledgement where tenant_id=$1 and empresa_id=$2 and chave_acesso=$3 and tipo_evento='210210' and sequencia=1 for update`,
      [input.tenantId,input.empresaId,input.chaveAcesso]);
    row = current.rows[0];
  }
  if (!row) throw new Error('FISCAL_ACK_IDENTITY_INVALID');
  if (row.staging_id !== input.stagingId) throw new Error('FISCAL_ACK_IDENTITY_INVALID');
  if (row.estado !== 'RESUMO_CAPTURADO') return row;
  await client.query(`insert into app.fiscal_acknowledgement_event(tenant_id,empresa_id,acknowledgement_id,estado,tentativa,correlation_id)
    values($1,$2,$3,'RESUMO_CAPTURADO',0,$4)`, [input.tenantId,input.empresaId,row.id,input.correlationId]);
  const next = 'CIENCIA_PENDENTE';
  if (!proximoEstadoDaCiencia(row.estado,next)) throw new Error('FISCAL_ACK_TRANSITION_INVALID');
  const updated = await client.query<CienciaDaEmissao>(
    `update app.fiscal_acknowledgement set estado=$1,atualizado_em=now() where id=$2 returning *`, [next,row.id]);
  await client.query(`insert into app.fiscal_acknowledgement_event(tenant_id,empresa_id,acknowledgement_id,estado,tentativa,correlation_id)
    values($1,$2,$3,$4,0,$5)`, [input.tenantId,input.empresaId,row.id,next,input.correlationId]);
  await client.query(`insert into app.fiscal_acknowledgement_outbox(tenant_id,empresa_id,acknowledgement_id)
    values($1,$2,$3) on conflict(acknowledgement_id) do nothing`, [input.tenantId,input.empresaId,row.id]);
  const result = updated.rows[0];
  if (!result) throw new Error('FISCAL_ACK_STATE_MISSING');
  return result;
};

export const registrarResumoImpedido = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; stagingId: string; chaveAcesso: string | null; codigo: string;
  motivoSanitizado: string; correlationId: string;
}>): Promise<CienciaDaEmissao> => {
  const inserted = await client.query<CienciaDaEmissao>(
    `insert into app.fiscal_acknowledgement(tenant_id,empresa_id,staging_id,chave_acesso,estado,codigo,motivo_sanitizado,correlation_id)
     values($1,$2,$3,$4,'IMPEDIDO',$5,$6,$7) on conflict(staging_id) do nothing returning *`,
    [input.tenantId,input.empresaId,input.stagingId,input.chaveAcesso,input.codigo,input.motivoSanitizado.slice(0,256),input.correlationId]);
  const row = inserted.rows[0] ?? (await client.query<CienciaDaEmissao>(
    `select * from app.fiscal_acknowledgement where staging_id=$1 and empresa_id=$2`,[input.stagingId,input.empresaId])).rows[0];
  if (!row || row.tenant_id !== input.tenantId) throw new Error('FISCAL_ACK_IDENTITY_INVALID');
  if (inserted.rowCount === 1) await client.query(`insert into app.fiscal_acknowledgement_event(tenant_id,empresa_id,acknowledgement_id,estado,codigo,detalhe_sanitizado,tentativa,correlation_id)
    values($1,$2,$3,'IMPEDIDO',$4,$5,0,$6)`, [input.tenantId,input.empresaId,row.id,input.codigo,input.motivoSanitizado.slice(0,256),input.correlationId]);
  return row;
};

export const listarCienciasPendentes = async (client: PoolClient, empresaId: string, limite = 100) => {
  const { rows } = await client.query<CienciaDaEmissao & { etapa: 'CIENCIA'|'RECUPERACAO_XML' }>(
    `select a.*,o.etapa,s.cnpj from app.fiscal_acknowledgement_outbox o join app.fiscal_acknowledgement a on a.id=o.acknowledgement_id
      join app.dfe_capture_staging s on s.id=a.staging_id
      where o.empresa_id=$1 and o.estado='PENDENTE' and o.disponivel_em<=now()
      order by o.disponivel_em,o.criado_em limit $2`, [empresaId,Math.min(Math.max(limite,1),100)]);
  return rows;
};

export const registrarTentativaDaCiencia = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; acknowledgementId: string; etapa: 'CIENCIA'|'RECUPERACAO_XML';
  tentativa: number; resultado: string; codigo?: string | null; protocolo?: string | null; ambiente?: string | null;
  correlationId: string; iniciadaEm: Date; finalizadaEm: Date;
}>): Promise<void> => {
  const result = await client.query(`insert into app.fiscal_acknowledgement_attempt(tenant_id,empresa_id,acknowledgement_id,etapa,tentativa,resultado,codigo,protocolo,ambiente,correlation_id,iniciada_em,finalizada_em)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(acknowledgement_id,etapa,tentativa) do nothing`,
  [input.tenantId,input.empresaId,input.acknowledgementId,input.etapa,input.tentativa,input.resultado,input.codigo ?? null,
    input.protocolo ?? null,input.ambiente ?? null,input.correlationId,input.iniciadaEm,input.finalizadaEm]);
  if (result.rowCount === 1) await client.query(`update app.fiscal_acknowledgement set tentativas=tentativas+1,
    tentativas_ciencia=tentativas_ciencia+case when $1='CIENCIA' then 1 else 0 end,
    tentativas_xml=tentativas_xml+case when $1='RECUPERACAO_XML' then 1 else 0 end,
    tentativas_ciencia_ciclo=tentativas_ciencia_ciclo+case when $1='CIENCIA' then 1 else 0 end,
    tentativas_xml_ciclo=tentativas_xml_ciclo+case when $1='RECUPERACAO_XML' then 1 else 0 end,
    atualizado_em=now() where id=$2`,
    [input.etapa,input.acknowledgementId]);
};

export const transicionarCienciaDaEmissao = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; acknowledgementId: string; estado: EstadoDaCiencia;
  codigo?: string | null; motivoSanitizado?: string | null; protocolo?: string | null; ambiente?: string | null;
  proximaTentativaEm?: Date | null; xmlStagingId?: string | null; correlationId: string;
}>): Promise<CienciaDaEmissao> => {
  const found = await client.query<CienciaDaEmissao>(`select * from app.fiscal_acknowledgement where id=$1 and empresa_id=$2 for update`,
    [input.acknowledgementId,input.empresaId]);
  const current = found.rows[0];
  if (!current || current.tenant_id !== input.tenantId) throw new Error('FISCAL_ACK_ACCESS_DENIED');
  if (current.estado === input.estado) return current;
  if (!proximoEstadoDaCiencia(current.estado,input.estado)) throw new Error('FISCAL_ACK_TRANSITION_INVALID');
  if (input.motivoSanitizado && input.motivoSanitizado.length > 256) throw new Error('FISCAL_ACK_SANITIZED_REASON_INVALID');
  const updated = await client.query<CienciaDaEmissao>(
    `update app.fiscal_acknowledgement set estado=$1,codigo=$2,motivo_sanitizado=$3,protocolo=coalesce($4,protocolo),
       ambiente=coalesce($5,ambiente),proxima_tentativa_em=$6,xml_staging_id=coalesce($7,xml_staging_id),
       atualizado_em=now() where id=$8 returning *`,
    [input.estado,input.codigo ?? null,input.motivoSanitizado ?? null,input.protocolo ?? null,input.ambiente ?? null,
      input.proximaTentativaEm ?? null,input.xmlStagingId ?? null,input.acknowledgementId]);
  await client.query(`insert into app.fiscal_acknowledgement_event(tenant_id,empresa_id,acknowledgement_id,estado,codigo,detalhe_sanitizado,protocolo,ambiente,tentativa,correlation_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [input.tenantId,input.empresaId,input.acknowledgementId,input.estado,input.codigo ?? null,input.motivoSanitizado ?? null,
    input.protocolo ?? null,input.ambiente ?? null,current.tentativas,input.correlationId]);
  if (input.estado === 'CIENCIA_REGISTRADA') {
    await client.query(`update app.fiscal_acknowledgement_outbox set estado='PENDENTE',etapa='RECUPERACAO_XML',disponivel_em=now(),publicado_em=null
      where acknowledgement_id=$1`, [input.acknowledgementId]);
  } else if (['PARSEADO','JA_MANIFESTADO','XML_COMPLETO_JA_DISPONIVEL','REJEITADO','IMPEDIDO','DLQ'].includes(input.estado)) {
    await client.query(`update app.fiscal_acknowledgement_outbox set estado=case when $1='DLQ' then 'DLQ' else 'PUBLICADO' end,publicado_em=now()
      where acknowledgement_id=$2`, [input.estado,input.acknowledgementId]);
  } else if (input.estado === 'RETRY_AGENDADO') {
    await client.query(`update app.fiscal_acknowledgement_outbox set estado='PUBLICADO',disponivel_em=$1,publicado_em=now()
      where acknowledgement_id=$2`, [input.proximaTentativaEm ?? new Date(),input.acknowledgementId]);
  } else if (input.estado === 'CIENCIA_PENDENTE') {
    await client.query(`update app.fiscal_acknowledgement_outbox set estado='PENDENTE',etapa='CIENCIA',disponivel_em=coalesce($1,now()),publicado_em=null
      where acknowledgement_id=$2`,[input.proximaTentativaEm??null,input.acknowledgementId]);
  } else if (input.estado === 'XML_COMPLETO_PENDENTE') {
    await client.query(`update app.fiscal_acknowledgement_outbox set estado='PENDENTE',etapa='RECUPERACAO_XML',disponivel_em=coalesce($1,now()),publicado_em=null
      where acknowledgement_id=$2`,[input.proximaTentativaEm??null,input.acknowledgementId]);
  }
  const result = updated.rows[0];
  if (!result) throw new Error('FISCAL_ACK_STATE_MISSING');
  return result;
};

export const registrarXmlCompletoJaDisponivel = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; stagingId: string; chaveAcesso: string; correlationId: string;
}>): Promise<CienciaDaEmissao> => {
  const inserted = await client.query<CienciaDaEmissao>(
    `insert into app.fiscal_acknowledgement(tenant_id,empresa_id,staging_id,chave_acesso,estado,codigo,correlation_id)
     values($1,$2,$3,$4,'XML_COMPLETO_JA_DISPONIVEL','FISCAL_FULL_XML_ALREADY_AVAILABLE',$5)
     on conflict do nothing returning *`,
    [input.tenantId,input.empresaId,input.stagingId,input.chaveAcesso,input.correlationId],
  );
  if (inserted.rows[0]) {
    await client.query(`insert into app.fiscal_acknowledgement_event(tenant_id,empresa_id,acknowledgement_id,estado,codigo,tentativa,correlation_id)
      values($1,$2,$3,'XML_COMPLETO_JA_DISPONIVEL','FISCAL_FULL_XML_ALREADY_AVAILABLE',0,$4)`,
    [input.tenantId,input.empresaId,inserted.rows[0].id,input.correlationId]);
    return inserted.rows[0];
  }
  const existing = await client.query<CienciaDaEmissao>(
    `select * from app.fiscal_acknowledgement where tenant_id=$1 and empresa_id=$2 and
      (staging_id=$3 or (chave_acesso=$4 and tipo_evento='210210' and sequencia=1)) for update`,
    [input.tenantId,input.empresaId,input.stagingId,input.chaveAcesso],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('FISCAL_ACK_IDENTITY_INVALID');
  if (proximoEstadoDaCiencia(row.estado,'XML_COMPLETO_JA_DISPONIVEL')) {
    return transicionarCienciaDaEmissao(client,{tenantId:input.tenantId,empresaId:input.empresaId,acknowledgementId:row.id,
      estado:'XML_COMPLETO_JA_DISPONIVEL',codigo:'FISCAL_FULL_XML_ALREADY_AVAILABLE',correlationId:input.correlationId});
  }
  return row;
};

export const listarHistoricoDaCiencia = async (client: PoolClient, empresaId: string, acknowledgementId: string) => {
  const { rows } = await client.query(`select estado,codigo,detalhe_sanitizado as motivo_sanitizado,protocolo,ambiente,tentativa,correlation_id,ocorrido_em
    from app.fiscal_acknowledgement_event where acknowledgement_id=$1 and empresa_id=$2 order by ocorrido_em,id`, [acknowledgementId,empresaId]);
  return rows;
};

export const listarResumoCienciasDaEmissao = async (client: PoolClient, empresaId: string, limite=100) => {
  const {rows}=await client.query(`select a.id,a.staging_id,a.xml_staging_id,a.chave_acesso,a.estado,a.tentativas,a.tentativas_ciencia,a.tentativas_xml,
      a.protocolo,a.ambiente,a.codigo,a.motivo_sanitizado,a.proxima_tentativa_em,a.solicitada_em,a.atualizado_em,s.nsu as nsu_resumo,x.nsu as nsu_xml
    from app.fiscal_acknowledgement a join app.dfe_capture_staging s on s.id=a.staging_id
    left join app.dfe_capture_staging x on x.id=a.xml_staging_id where a.empresa_id=$1 order by a.criado_em desc,a.id limit $2`,
  [empresaId,Math.min(Math.max(limite,1),100)]);
  return rows;
};

export const obterCienciaDaEmissao = async(client:PoolClient,empresaId:string,id:string)=>{
  const {rows}=await client.query(`select a.id,a.staging_id,a.xml_staging_id,a.chave_acesso,a.estado,a.tentativas,a.tentativas_ciencia,a.tentativas_xml,
      a.protocolo,a.ambiente,a.codigo,a.motivo_sanitizado,a.proxima_tentativa_em,a.solicitada_em,a.atualizado_em,s.nsu as nsu_resumo,x.nsu as nsu_xml
    from app.fiscal_acknowledgement a join app.dfe_capture_staging s on s.id=a.staging_id
    left join app.dfe_capture_staging x on x.id=a.xml_staging_id where a.empresa_id=$1 and a.id=$2`,[empresaId,id]);
  return rows[0]??null;
};

export const retomarCienciaDaEmissao = async(client:PoolClient,input:Readonly<{tenantId:string;empresaId:string;id:string;correlationId:string}>):Promise<CienciaDaEmissao>=>{
  const found=await client.query<CienciaDaEmissao>(`select * from app.fiscal_acknowledgement where id=$1 and tenant_id=$2 and empresa_id=$3 for update`,[input.id,input.tenantId,input.empresaId]);
  const row=found.rows[0]; if(!row) throw new Error('FISCAL_ACK_ACCESS_DENIED');
  if(!['DLQ','RESULTADO_INCERTO','RETRY_AGENDADO'].includes(row.estado)) throw new Error('FISCAL_ACK_RESUME_NOT_ALLOWED');
  const outbox = await client.query<{etapa:'CIENCIA'|'RECUPERACAO_XML'}>(`select etapa from app.fiscal_acknowledgement_outbox where acknowledgement_id=$1 and empresa_id=$2 for update`,[row.id,input.empresaId]);
  const etapaXml = row.estado !== 'RESULTADO_INCERTO' && outbox.rows[0]?.etapa === 'RECUPERACAO_XML';
  if(row.estado==='RESULTADO_INCERTO'){
    await client.query(`update app.fiscal_acknowledgement_outbox set etapa='CIENCIA',estado='PENDENTE',disponivel_em=now(),publicado_em=null where acknowledgement_id=$1`,[row.id]);
  } else {
    if(row.estado==='DLQ') await client.query(`update app.fiscal_acknowledgement set
      tentativas_xml_ciclo=case when $2 then 0 else tentativas_xml_ciclo end,
      tentativas_ciencia_ciclo=case when $2 then tentativas_ciencia_ciclo else 0 end,atualizado_em=now() where id=$1`,[row.id,etapaXml]);
    await transicionarCienciaDaEmissao(client,{tenantId:input.tenantId,empresaId:input.empresaId,acknowledgementId:row.id,
      estado:etapaXml?'XML_COMPLETO_PENDENTE':'CIENCIA_PENDENTE',codigo:'FISCAL_ACK_RESUME_REQUESTED',correlationId:input.correlationId});
  }
  await client.query(`insert into app.fiscal_acknowledgement_event(tenant_id,empresa_id,acknowledgement_id,estado,codigo,detalhe_sanitizado,tentativa,correlation_id)
    values($1,$2,$3,$4,'FISCAL_ACK_RESUME_REQUESTED','Retomada técnica solicitada.',0,$5)`,[input.tenantId,input.empresaId,row.id,row.estado,input.correlationId]);
  return row;
};

export const listarTentativasDaCiencia = async (client: PoolClient, empresaId: string, acknowledgementId: string) => {
  const { rows } = await client.query(`select etapa,tentativa,resultado,codigo,protocolo,ambiente,correlation_id,iniciada_em,finalizada_em
    from app.fiscal_acknowledgement_attempt where acknowledgement_id=$1 and empresa_id=$2 order by iniciada_em,etapa,tentativa`,
  [acknowledgementId,empresaId]);
  return rows;
};

export const preservarXmlCompletoRecuperado = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; acknowledgementId: string; conteudo: Buffer; correlationId: string; capturadoEm: Date;
}>): Promise<string> => {
  const ack = await client.query<CienciaDaEmissao>(`select * from app.fiscal_acknowledgement where id=$1 and tenant_id=$2 and empresa_id=$3 for update`,
    [input.acknowledgementId,input.tenantId,input.empresaId]);
  const row = ack.rows[0];
  if (!row) throw new Error('FISCAL_ACK_ACCESS_DENIED');
  if(row.xml_staging_id){
    const prior=await client.query<{conteudo_bruto:Buffer}>(`select conteudo_bruto from app.dfe_capture_staging where id=$1`,[row.xml_staging_id]);
    if(!prior.rows[0]?.conteudo_bruto.equals(input.conteudo))throw new Error('FISCAL_FULL_XML_MISMATCH');
    return row.xml_staging_id;
  }
  const original = await client.query<{ run_id: string; cnpj: string; nsu: string }>(
    `select run_id,cnpj,nsu from app.dfe_capture_staging where id=$1 and tenant_id=$2 and empresa_id=$3 and origem='DISTRIBUICAO'`,
    [row.staging_id,input.tenantId,input.empresaId]);
  const source = original.rows[0];
  if (!source) throw new Error('FISCAL_ACK_IDENTITY_INVALID');
  const inserted = await client.query<{ id: string }>(
    `insert into app.dfe_capture_staging(tenant_id,empresa_id,run_id,cnpj,nsu,chave_acesso,especie,conteudo_bruto,disponibilizado_em,capturado_em,correlation_id,origem,origem_staging_id)
     values($1,$2,$3,$4,$5,$6,'NFE_55',$7,$8,$9,$10,'RECUPERACAO_CIENCIA',$11)
     on conflict(tenant_id,empresa_id,chave_acesso) where origem='RECUPERACAO_CIENCIA' do nothing returning id`,
    [input.tenantId,input.empresaId,source.run_id,source.cnpj,source.nsu,row.chave_acesso,input.conteudo,null,input.capturadoEm,input.correlationId,row.staging_id]);
  let stagingId = inserted.rows[0]?.id;
  if (!stagingId) {
    const existing = await client.query<{ id: string; conteudo_bruto: Buffer }>(
      `select id,conteudo_bruto from app.dfe_capture_staging where tenant_id=$1 and empresa_id=$2 and chave_acesso=$3 and origem='RECUPERACAO_CIENCIA'`,
      [input.tenantId,input.empresaId,row.chave_acesso]);
    const prior = existing.rows[0];
    if (!prior || !prior.conteudo_bruto.equals(input.conteudo)) throw new Error('FISCAL_FULL_XML_MISMATCH');
    stagingId = prior.id;
  }
  await client.query(`insert into app.fiscal_document_outbox(staging_id,tenant_id,empresa_id) values($1,$2,$3) on conflict(staging_id) do nothing`,
    [stagingId,input.tenantId,input.empresaId]);
  await client.query(`update app.fiscal_acknowledgement set xml_staging_id=$1,atualizado_em=now() where id=$2`, [stagingId,row.id]);
  return stagingId;
};
