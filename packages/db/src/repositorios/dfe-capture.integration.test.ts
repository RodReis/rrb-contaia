import { randomUUID } from 'node:crypto';
import { contextoHumano, contextoTecnico } from '@contaia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { criarPool, criarPoolDaAplicacao, criarPoolDoAgendadorDfe } from '../client.js';
import { comContexto } from '../contexto.js';
import { limparCenario, montarCenario, type Cenario } from '../testes/cenario-rls.js';
import { commitDfeBatch, createOrReuseDfeCaptureRun, ensureDfeCaptureState, getDfeCaptureCompany, marcarDfeCaptureEmExecucao, prepararReprocessamentoDfeCapture, registrarFalhaDfeCapture, reservarJanelaDfeTenant } from './dfe-capture.js';
import { listarDocumentosFiscais, obterDocumentoFiscal, persistirDocumentoFiscal, persistirFalhaDocumentoFiscal, registrarEventoDocumentoFiscal } from './fiscal-documents.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();
const scheduler = criarPoolDoAgendadorDfe();
let c: Cenario;
let n = 0;
const now = new Date('2026-10-14T16:00:00.000Z');

const empresa = async () => {
  n += 1;
  const cnpj = `${String(n).padStart(6, '0')}${c.sufixo}`.slice(0, 14);
  const { rows } = await admin.query<{ id: string }>(`insert into app.empresa (tenant_id,cnpj,razao_social,status,situacao) values ($1,$2,'Teste DF-e','ATIVA','ativo') returning id`, [c.tenantA, cnpj]);
  const id = rows[0]!.id;
  await admin.query(`insert into app.carteira_vinculo (tenant_id,usuario_id,empresa_id) values ($1,$2,$3)`, [c.tenantA,c.usuarios.naCarteira,id]);
  return { id, cnpj };
};
const tech = <T>(companyId: string, correlationId: string, run: (client: PoolClient) => Promise<T>): Promise<T> => comContexto(app, contextoTecnico({ identidadeTecnica: 'workers-dfe-capture', finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId: c.tenantA, empresaId: companyId, correlationId }), run);

beforeAll(async () => { c = await montarCenario(admin); }, 60_000);
afterAll(async () => { await limparCenario(admin, c); await Promise.all([admin.end(), app.end(), scheduler.end()]); });

describe('repositório de captura DF-e (SPEC-017 §3.5–§3.6)', () => {
  it('agendador vê só candidato com A1 vigente e não pode ler tabelas diretamente', async () => {
    const co = await empresa();
    const antes = await scheduler.query<{ empresa_id: string }>('select empresa_id from app.dfe_capture_empresas_elegiveis(100)');
    expect(antes.rows.some((row) => row.empresa_id === co.id)).toBe(false);
    await admin.query(
      `insert into app.empresa_certificado
       (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora,
        cadeia, numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id,
        referencia_segredo, cadastrado_por)
       values ($1,$2,1,'VIGENTE','Teste DF-e',$3,'AC Teste',array['AC Teste'],'serie-f17',$4,
               '2020-01-01','2099-12-31',$5,$6,$5)`,
      [c.tenantA, co.id, co.cnpj, 'a'.repeat(64), c.usuarios.naCarteira, randomUUID()],
    );
    const depois = await scheduler.query<{ empresa_id: string }>('select empresa_id from app.dfe_capture_empresas_elegiveis(100)');
    expect(depois.rows.some((row) => row.empresa_id === co.id)).toBe(true);
    await expect(scheduler.query('select id from app.empresa limit 1')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('select empresa_id from app.dfe_capture_empresas_elegiveis(1)')).rejects.toMatchObject({ code: '42501' });
  });
  it('admin consulta empresa do tenant fora da carteira só pela captura DF-e', async () => {
    const outside = await empresa();
    const result = await comContexto(app, contextoHumano({ tenantId: c.tenantA, usuarioId: c.usuarios.admin, correlationId: 'capture-admin-scope' }), async (client) => {
      const company = await getDfeCaptureCompany(client, outside.id);
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: outside.id, cnpj: outside.cnpj });
      const broadRead = await client.query('select id from app.empresa where id=$1', [outside.id]);
      return { company, state, broadRead: broadRead.rowCount };
    });
    expect(result.company).toMatchObject({ id: outside.id, active: true });
    expect(result.state.companyId).toBe(outside.id);
    expect(result.broadRead).toBe(0);
  });
  it('reserva uma única execução e reaproveita idempotência pendente', async () => {
    const co = await empresa();
    const result = await tech(co.id, 'capture-reserve-test', async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      const input = { state, origin: 'MANUAL' as const, originatingUserId: c.usuarios.naCarteira, idempotencyKey: `idemp-${randomUUID()}`, correlationId: 'capture-reserve-test', occurredAt: now };
      const first = await createOrReuseDfeCaptureRun(client, input);
      const second = await createOrReuseDfeCaptureRun(client, input);
      const third = await createOrReuseDfeCaptureRun(client, { ...input, idempotencyKey: `idemp-${randomUUID()}` });
      return { first, second, third };
    });
    expect(result.first.id).toBe(result.second.id);
    expect(result.second.reused).toBe(true);
    expect(result.third).toMatchObject({ id: result.first.id, idempotencyKey: result.first.idempotencyKey, reused: true });
  });

  it('serializa chamadas entre empresas do mesmo tenant usando reserva durável', async () => {
    const primeira = await empresa();
    const segunda = await empresa();
    const ids = await Promise.all([primeira, segunda].map((co, index) => tech(co.id, `rate-limit-${index}`, async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      const run = await createOrReuseDfeCaptureRun(client, { state, origin: 'MANUAL', originatingUserId: c.usuarios.naCarteira,
        idempotencyKey: `rate-${randomUUID()}`, correlationId: `rate-limit-${index}`, occurredAt: now });
      expect(await marcarDfeCaptureEmExecucao(client, run.id, state, now)).toBe(true);
      return run.id;
    })));
    const resultados = await Promise.all([primeira, segunda].map((co, index) => tech(co.id, `rate-reserve-${index}`,
      (client) => reservarJanelaDfeTenant(client, ids[index]!))));
    expect(resultados.filter((item) => item.reserved)).toHaveLength(1);
    expect(resultados.every((item) => item.nextWindow.getTime() > now.getTime())).toBe(true);
    const { rows } = await admin.query<{ quantidade: string }>(
      `select count(*)::text quantidade from app.dfe_capture_event where tenant_id=$1 and tipo='STARTED' and run_id=any($2::uuid[])`,
      [c.tenantA, ids]);
    expect(rows[0]?.quantidade).toBe('1');
  });

  it('grava lote opaco e avança cursor/intervalo na mesma transação', async () => {
    const co = await empresa();
    const idempotencyKey = `idemp-${randomUUID()}`;
    const committed = await tech(co.id, 'capture-batch-test', async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      const run = await createOrReuseDfeCaptureRun(client, { state, origin: 'MANUAL', originatingUserId: c.usuarios.naCarteira, idempotencyKey, correlationId: 'capture-batch-test', occurredAt: now });
      expect(await marcarDfeCaptureEmExecucao(client, run.id, state, now)).toBe(true);
      return commitDfeBatch(client, { state: { ...state, state: 'CAPTURING', version: state.version + 1 }, runId: run.id,
        returnedLastNsu: '1', maxNsu: '4', averageTimeMs: 60_000, nextAllowedAt: new Date(now.getTime() + 60_000), capturedAt: now,
        attempt: 1, correlationId: 'capture-batch-test', items: [{ nsu: '1', accessKey: null, kind: 'NFE_55', rawContent: '<opaque>not parsed</opaque>' }] });
    });
    expect(committed).toEqual({ created: 1, deduplicated: 0 });
    const { rows } = await admin.query<{ ult_nsu: string; estado: string; conteudo: string }>(`select s.ult_nsu,r.estado,convert_from(d.conteudo_bruto,'UTF8') conteudo from app.dfe_capture_state s join app.dfe_capture_run r on r.estado_id=s.id join app.dfe_capture_staging d on d.run_id=r.id where s.empresa_id=$1`, [co.id]);
    expect(rows[0]).toEqual({ ult_nsu: '1', estado: 'SUCCEEDED', conteudo: '<opaque>not parsed</opaque>' });
    const outbox = await admin.query<{ estado: string; tentativas: number }>(
      `select o.estado,o.tentativas from app.fiscal_document_outbox o join app.dfe_capture_staging s on s.id=o.staging_id where s.empresa_id=$1`, [co.id]);
    expect(outbox.rows).toEqual([{ estado: 'PENDENTE', tentativas: 0 }]);
    const replay = await tech(co.id, 'capture-batch-replay', async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      return createOrReuseDfeCaptureRun(client, { state, origin: 'MANUAL', originatingUserId: c.usuarios.naCarteira, idempotencyKey, correlationId: 'capture-batch-replay', occurredAt: new Date(now.getTime() + 1) });
    });
    expect(replay).toMatchObject({ reused: true, terminal: true });
  });

  it('projeta o último resultado fiscal e mantém conflito bloqueante após reprocessamento', async () => {
    const co = await empresa();
    const correlationId = 'fiscal-status-projection';
    await tech(co.id, correlationId, async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      const run = await createOrReuseDfeCaptureRun(client, { state, origin: 'MANUAL', originatingUserId: c.usuarios.naCarteira,
        idempotencyKey: `fiscal-state-${randomUUID()}`, correlationId, occurredAt: now });
      await commitDfeBatch(client, { state: { ...state, state: 'CAPTURING', version: state.version + 1 }, runId: run.id,
        returnedLastNsu: '1', maxNsu: '1', averageTimeMs: 60_000, nextAllowedAt: new Date(now.getTime() + 60_000), capturedAt: now,
        attempt: 1, correlationId, items: [{ nsu: '1', accessKey: null, kind: 'NFE_55', rawContent: '<opaque>fiscal</opaque>' }] });
    });
    const { rows: stagingRows } = await admin.query<{ id: string }>(
      `select id from app.dfe_capture_staging where empresa_id=$1 order by capturado_em desc limit 1`, [co.id]);
    const stagingId = stagingRows[0]!.id;
    const document = await tech(co.id, correlationId, (client) => persistirDocumentoFiscal(client, {
      tenantId: c.tenantA, empresaId: co.id, stagingId, cnpj: co.cnpj, nsu: '1', correlationId,
      originalKey: `${c.tenantA}/${co.id}/fiscal-original/${'a'.repeat(64)}.xml`, parserVersion: 'f18-test',
      parsed: { id: randomUUID(), especie: 'NFE_55', chaveAcesso: '00000000000000000000550010000000010000000010',
        hashSha256: 'a'.repeat(64), tamanho: 20, versaoLayout: '4.00', modelo: '55', emitidoEm: '2026-06-15',
        emitente: co.cnpj, destinatario: null, total: '1.00', ibsCbsPendente: false,
        itens: [{ codigo: '1', descricao: 'Item de teste', quantidade: '1.0000', unidade: 'UN', valor: '1.00', ibs: null, cbs: null }] },
    }));
    const registra = (tipo: string, codigo: string) => tech(co.id, `${correlationId}-${tipo}`, (client) => registrarEventoDocumentoFiscal(client, {
      tenantId: c.tenantA, empresaId: co.id, documentId: document.id, stagingId, tipo, codigo,
      parserVersion: 'f18-test', hashSha256: 'a'.repeat(64), correlationId: `${correlationId}-${tipo}`,
    }));
    await tech(co.id, `${correlationId}-failure`, (client) => persistirFalhaDocumentoFiscal(client, {
      tenantId: c.tenantA, empresaId: co.id, stagingId, especie: 'NFE_55', chaveAcesso: null,
      hashSha256: 'a'.repeat(64), tamanho: 20,
      originalKey: `${c.tenantA}/${co.id}/fiscal-original/${'a'.repeat(64)}.xml`, parserVersion: 'f18-test',
      correlationId: `${correlationId}-failure`, codigo: 'FISCAL_XML_INVALID', estado: 'XML_INVALIDO',
    }));
    const invalido = await tech(co.id, `${correlationId}-list-invalid`, (client) => listarDocumentosFiscais(client, co.id, 1, 'XML_INVALIDO'));
    expect(invalido[0]).toMatchObject({ id: document.id, estado: 'XML_INVALIDO' });

    await registra('REUTILIZADO', 'PROCESSADO');
    const processado = await tech(co.id, `${correlationId}-list-processed`, (client) => listarDocumentosFiscais(client, co.id, 1, 'PROCESSADO'));
    expect(processado[0]).toMatchObject({ id: document.id, estado: 'PROCESSADO' });

    await registra('CONFLITO', 'FISCAL_DOCUMENT_CONFLICT');
    await registra('REUTILIZADO', 'PROCESSADO');
    const conflito = await tech(co.id, `${correlationId}-list-conflict`, (client) => listarDocumentosFiscais(client, co.id, 1, 'CONFLITO'));
    expect(conflito[0]).toMatchObject({ id: document.id, estado: 'CONFLITO' });
  });

  it('reprocessa a mesma chave com nova versão do parser e preserva a normalização anterior', async () => {
    const co = await empresa();
    const correlationId = 'fiscal-parser-version';
    await tech(co.id, correlationId, async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      const run = await createOrReuseDfeCaptureRun(client, { state, origin: 'MANUAL', originatingUserId: c.usuarios.naCarteira,
        idempotencyKey: `fiscal-parser-${randomUUID()}`, correlationId, occurredAt: now });
      await commitDfeBatch(client, { state: { ...state, state: 'CAPTURING', version: state.version + 1 }, runId: run.id,
        returnedLastNsu: '1', maxNsu: '1', averageTimeMs: 60_000, nextAllowedAt: new Date(now.getTime() + 60_000), capturedAt: now,
        attempt: 1, correlationId, items: [{ nsu: '1', accessKey: null, kind: 'NFE_55', rawContent: '<opaque>versioned</opaque>' }] });
    });
    const { rows } = await admin.query<{ id: string }>(
      `select id from app.dfe_capture_staging where empresa_id=$1 order by capturado_em desc limit 1`, [co.id]);
    const stagingId = rows[0]!.id;
    const chaveAcesso = '00000000000000000000550010000000010000000010';
    const originalKey = `${c.tenantA}/${co.id}/fiscal-original/${'b'.repeat(64)}.xml`;
    const primeiro = { id: randomUUID(), especie: 'NFE_55' as const, chaveAcesso, hashSha256: 'b'.repeat(64), tamanho: 20,
      versaoLayout: '4.00', modelo: '55', protocolo: null, protocoloRecebidoEm: null, referencias: [{ tipo: 'NFE', chave: '1'.repeat(44) }],
      partes: [{ papel: 'EMITENTE' as const, identificador: co.cnpj, nome: 'Emitente v1', inscricaoEstadual: null,
        logradouro: null, numero: null, complemento: null, bairro: null, codigoMunicipio: null, municipio: null, uf: null,
        cep: null, codigoPais: null, pais: null }], emitidoEm: '2026-06-15', emitente: co.cnpj, destinatario: null, total: '1.00',
      ibsCbsPendente: false, baseIbsCbs: null, totalIbs: null, totalCbs: null,
      itens: [{ tipo: 'ITEM' as const, codigo: '1', descricao: 'Item v1', quantidade: '1.0000', unidade: 'UN', valor: '1.00', ibs: null, cbs: null }],
      tributos: [{ escopo: 'ITEM' as const, numeroItem: 1, codigo: 'ICMS' as const, baseCalculo: '1.00', aliquota: '0', valor: '0', situacao: '00', classificacao: null }] };
    const firstResult = await tech(co.id, `${correlationId}-v1`, (client) => persistirDocumentoFiscal(client, {
      tenantId: c.tenantA, empresaId: co.id, stagingId, cnpj: co.cnpj, nsu: '1', correlationId: `${correlationId}-v1`,
      originalKey, parserVersion: 'f18-v1', parsed: primeiro,
    }));
    const secondResult = await tech(co.id, `${correlationId}-v2`, (client) => persistirDocumentoFiscal(client, {
      tenantId: c.tenantA, empresaId: co.id, stagingId, cnpj: co.cnpj, nsu: '1', correlationId: `${correlationId}-v2`,
      originalKey, parserVersion: 'f18-v2', parsed: { ...primeiro, id: randomUUID(), partes: [{ ...primeiro.partes[0]!, nome: 'Emitente v2' }],
        itens: [{ ...primeiro.itens[0]!, descricao: 'Item v2' }], tributos: [{ ...primeiro.tributos[0]!, valor: '0.20' }] },
    }));
    expect(firstResult).toMatchObject({ reused: false, conflict: false, state: 'PROCESSADO' });
    expect(secondResult).toMatchObject({ id: firstResult.id, reused: true, conflict: false, state: 'PROCESSADO' });
    const detail = await tech(co.id, `${correlationId}-detail`, (client) => obterDocumentoFiscal(client, co.id, firstResult.id));
    expect(detail).toMatchObject({ parser_version: 'f18-v2', itens: [{ descricao: 'Item v2' }], partes: [{ nome: 'Emitente v2' }], tributos: [{ valor: '0.2000000000' }] });
    const history = await admin.query<{ parser_version: string; descricao: string }>(
      `select parser_version,descricao from app.fiscal_document_item where document_id=$1 order by parser_version`, [firstResult.id]);
    expect(history.rows).toEqual([{ parser_version: 'f18-v1', descricao: 'Item v1' }, { parser_version: 'f18-v2', descricao: 'Item v2' }]);
    const events = await admin.query<{ tipo: string; parser_version: string }>(
      `select tipo,parser_version from app.fiscal_document_event where document_id=$1 order by ocorrido_em,id`, [firstResult.id]);
    expect(events.rows).toEqual([{ tipo: 'PROCESSADO', parser_version: 'f18-v1' }, { tipo: 'REPROCESSADO', parser_version: 'f18-v2' }]);
  });

  it('abre alerta uma vez e registra recuperação append-only após lote bem-sucedido', async () => {
    const co = await empresa();
    const result = await tech(co.id, 'capture-alert-test', async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      const firstRun = await createOrReuseDfeCaptureRun(client, { state, origin: 'MANUAL', originatingUserId: c.usuarios.naCarteira, idempotencyKey: `alert-${randomUUID()}`, correlationId: 'capture-alert-test', occurredAt: now });
      await registrarFalhaDfeCapture(client, { state, runId: firstRun.id, code: 'DFE_PROVIDER_UNAVAILABLE', attempt: 3, failedAt: now });
      const secondRun = await createOrReuseDfeCaptureRun(client, { state: { ...state, version: state.version + 1, state: 'FAILED' }, origin: 'MANUAL', originatingUserId: c.usuarios.naCarteira, idempotencyKey: `alert-${randomUUID()}`, correlationId: 'capture-alert-recovery', occurredAt: new Date(now.getTime() + 1) });
      await marcarDfeCaptureEmExecucao(client, secondRun.id, { ...state, version: state.version + 1, state: 'FAILED' }, new Date(now.getTime() + 2));
      await commitDfeBatch(client, { state: { ...state, state: 'CAPTURING', version: state.version + 2 }, runId: secondRun.id,
        returnedLastNsu: '1', maxNsu: '1', averageTimeMs: 60_000, nextAllowedAt: new Date(now.getTime() + 60_000), capturedAt: new Date(now.getTime() + 3),
        attempt: 1, correlationId: 'capture-alert-recovery', items: [] });
    });
    const { rows } = await admin.query<{ tipo: string; quantidade: string }>(
      `select tipo,count(*)::text quantidade from app.dfe_capture_alert_event where empresa_id=$1 group by tipo order by tipo`, [co.id]);
    expect(rows).toEqual([{ tipo: 'OPENED', quantidade: '1' }, { tipo: 'RESOLVED', quantidade: '1' }]);
    expect(result).toBeUndefined();
  });

  it('reprocessa execução da DLQ sem substituir sua chave, origem ou tentativas', async () => {
    const co = await empresa();
    const failed = await tech(co.id, 'capture-dlq-test', async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      const run = await createOrReuseDfeCaptureRun(client, { state, origin: 'MANUAL', originatingUserId: c.usuarios.admin, idempotencyKey: `dlq-${randomUUID()}`, correlationId: 'capture-dlq-test', occurredAt: now });
      await marcarDfeCaptureEmExecucao(client, run.id, state, now);
      await registrarFalhaDfeCapture(client, { state: { ...state, state: 'CAPTURING', version: state.version + 1 }, runId: run.id, code: 'DFE_PROVIDER_UNAVAILABLE', attempt: 3, failedAt: now });
      return run;
    });
    const retried = await comContexto(app, contextoHumano({ tenantId: c.tenantA, usuarioId: c.usuarios.admin, correlationId: 'capture-dlq-reprocess' }), async (client) => {
      const state = await ensureDfeCaptureState(client, { tenantId: c.tenantA, companyId: co.id, cnpj: co.cnpj });
      return prepararReprocessamentoDfeCapture(client, { state, runId: failed.id, actorId: c.usuarios.admin, reprocessedAt: new Date(now.getTime() + 1) });
    });
    expect(retried).toMatchObject({ id: failed.id, idempotencyKey: failed.idempotencyKey, correlationId: failed.correlationId, origin: 'MANUAL' });
    const { rows } = await admin.query<{ estado: string; tentativa: number; finalizado_em: Date | null }>(
      `select estado,tentativa,finalizado_em from app.dfe_capture_run where id=$1`, [failed.id]);
    expect(rows[0]).toMatchObject({ estado: 'QUEUED', tentativa: 3, finalizado_em: null });
    const event = await admin.query<{ usuario_ator_id: string }>(`select usuario_ator_id from app.dfe_capture_event where run_id=$1 and tipo='QUEUED' order by sequencia desc limit 1`, [failed.id]);
    expect(event.rows[0]?.usuario_ator_id).toBe(c.usuarios.admin);
  });
});
