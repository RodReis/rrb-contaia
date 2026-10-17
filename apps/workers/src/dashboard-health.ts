import { randomUUID } from 'node:crypto';

import { coletarSinaisDaSaude, comContexto, substituirProjecaoDaSaude } from '@contaia/db';
import { contextoTecnico } from '@contaia/domain';
import type { Pool } from 'pg';
import { FONTES_DA_SAUDE, type FonteDaSaude } from '@contaia/domain';

type Dependencias = Readonly<{ pool: Pool; schedulerPool: Pool; agora?: () => Date; intervaloMs?: number }>;

export const iniciarReconciliadorDeSaude = (deps: Dependencias): Readonly<{ fechar: () => Promise<void> }> => {
  const agora = deps.agora ?? (() => new Date());
  let rodando = false;
  let offset = 0;
  const executar = async (): Promise<void> => {
    if (rodando) return;
    rodando = true;
    try {
      const candidatas = await deps.schedulerPool.query<{ tenant_id: string; empresa_id: string }>(
        'select * from app.dashboard_health_companies_pending(1000)',
      );
      if (candidatas.rows.length === 0) {
        offset = 0;
        return;
      }
      const pagina = candidatas.rows.slice(offset, offset + 20);
      for (const empresa of pagina) {
        const correlationId = `dashboard-health-${randomUUID()}`;
        const contexto = contextoTecnico({ identidadeTecnica: 'workers-dfe-capture', finalidade: 'PROCESSAMENTO_DE_EMPRESA',
          tenantId: empresa.tenant_id, empresaId: empresa.empresa_id, correlationId });
        try {
          await comContexto(deps.pool, contexto, async (cliente) => {
            const instante = agora();
            const habilitadas = await cliente.query<{ fonte: FonteDaSaude; disponivel: boolean }>(`select fonte,
              case fonte when 'PENDENCIAS' then to_regclass('app.empresa_pendencia') is not null
                when 'CERTIFICADOS' then to_regclass('app.empresa_certificado') is not null
                when 'CAPTURA' then to_regclass('app.dfe_capture_state') is not null
                when 'MANIFESTACOES' then to_regclass('app.fiscal_manifestation') is not null
                when 'OBRIGACOES' then to_regclass('app.obligation_occurrence') is not null end disponivel
              from unnest($1::text[]) fonte`, [FONTES_DA_SAUDE]);
            const fontesAtivas = habilitadas.rows.filter((row) => row.disponivel).map((row) => row.fonte);
            const identidade = { tenantId: empresa.tenant_id, empresaId: empresa.empresa_id };
            const sinais = await coletarSinaisDaSaude(cliente, identidade, instante, fontesAtivas);
            await substituirProjecaoDaSaude(cliente, identidade, sinais.resultado, sinais.revisoes, instante, correlationId);
          });
        } catch (erro) {
          console.error(JSON.stringify({ event: 'dashboard-health-company-error', tenantId: empresa.tenant_id,
            empresaId: empresa.empresa_id, correlationId, name: erro instanceof Error ? erro.name : 'UnknownError' }));
          // Falha da leitura não pode deixar retrato verde silencioso. Uma transação nova marca
          // a projeção como amarela e a reconciliação seguinte repõe os dados de origem.
          await comContexto(deps.pool, contexto, async (cliente) => {
            const sinais = await coletarSinaisDaSaude(cliente,
              { tenantId: empresa.tenant_id, empresaId: empresa.empresa_id }, agora(), []);
            const fontesIndisponiveis = Object.fromEntries(FONTES_DA_SAUDE.map((fonte) => [fonte, 'ERRO_DE_LEITURA'])) as Record<FonteDaSaude, string>;
            await substituirProjecaoDaSaude(cliente, { tenantId: empresa.tenant_id, empresaId: empresa.empresa_id },
              sinais.resultado, fontesIndisponiveis, agora(), correlationId);
          }).catch((falha) => console.error(JSON.stringify({ event: 'dashboard-health-fallback-error', correlationId,
            name: falha instanceof Error ? falha.name : 'UnknownError' })));
        }
      }
      offset = offset + 20 >= candidatas.rows.length ? 0 : offset + 20;
    } catch (erro) {
      console.error(JSON.stringify({ event: 'dashboard-health-scheduler-error', name: erro instanceof Error ? erro.name : 'UnknownError' }));
    } finally { rodando = false; }
  };
  const timer = setInterval(() => void executar(), deps.intervaloMs ?? 60_000);
  void executar();
  return { fechar: async () => { clearInterval(timer); while (rodando) await new Promise((resolve) => setTimeout(resolve, 10)); } };
};
