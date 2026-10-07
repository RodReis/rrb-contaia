/**
 * Monitor de saúde do Signer (SPEC-012 §3.10): uma verificação por minuto.
 *
 * Resposta válida = o Signer respondeu o contrato de saúde (OPERACIONAL ou DEGRADADO — degradado é
 * uma resposta: o serviço está de pé). Qualquer outra coisa (rede, TLS, tempo, 5xx, corpo fora do
 * contrato) é falha. A máquina de incidente é do domínio e pura; aqui só se lê o estado, aplica a
 * transição e executa os efeitos, tudo na MESMA transação, sob o contexto de serviço (sem tenant).
 *
 * Indisponibilidade do Signer notifica administradores pelo sino e NUNCA cria item na Central de
 * Pendências: o serviço é global, a pendência é de uma empresa.
 */
import { randomUUID } from 'node:crypto';

import {
  abrirIncidente,
  comContexto,
  encerrarIncidente,
  estadoDoMonitor,
  notificarIncidente,
  registrarVerificacao,
} from '@contaia/db';
import { avancarIncidente, contextoDeServico } from '@contaia/domain';
import { VERSAO_DO_CONTRATO_DO_SIGNER } from '@contaia/shared';
import type { ClienteDoSigner } from '@contaia/signer-client';
import type { Pool } from 'pg';

export type DependenciasDoMonitor = Readonly<{
  pool: Pool;
  cliente: Pick<ClienteDoSigner, 'saude'>;
  agora: () => Date;
}>;

export type ResultadoDaVerificacao = Readonly<{
  resultado: 'OK' | 'FALHA';
  /** Nomes dos efeitos de incidente aplicados nesta verificação. */
  efeitos: readonly string[];
}>;

const respostaDeSaudeValida = (resposta: unknown): boolean => {
  const candidata = resposta as { versaoDoContrato?: unknown; estado?: unknown } | null;

  return (
    typeof candidata === 'object' &&
    candidata !== null &&
    candidata.versaoDoContrato === VERSAO_DO_CONTRATO_DO_SIGNER &&
    (candidata.estado === 'OPERACIONAL' || candidata.estado === 'DEGRADADO')
  );
};

export const verificarSaude = async ({ pool, cliente, agora }: DependenciasDoMonitor): Promise<ResultadoDaVerificacao> => {
  const correlationId = `monitor-${randomUUID()}`;
  const inicio = agora().getTime();
  let resultado: 'OK' | 'FALHA' = 'FALHA';
  let latenciaMs: number | null = null;
  let degradado = false;

  try {
    const resposta = await cliente.saude(correlationId);

    if (respostaDeSaudeValida(resposta)) {
      resultado = 'OK';
      latenciaMs = agora().getTime() - inicio;
      // De pé, mas o próprio Signer diz que não está pleno (ex.: Vault selado): não é falha, mas o cartão não afirma "operacional".
      degradado = resposta.estado === 'DEGRADADO';
    }
  } catch {
    // Falha de chamada de qualquer tipo é falha de verificação: o motivo não muda a decisão.
  }

  const contexto = contextoDeServico({
    identidadeTecnica: 'workers-monitor-signer',
    finalidade: 'MONITORAMENTO_DO_SIGNER',
    correlationId,
  });

  return comContexto(pool, contexto, async (transacao) => {
    const antes = await estadoDoMonitor(transacao);
    const transicao = avancarIncidente(
      { falhasConsecutivas: antes.falhasConsecutivas, incidenteAbertoEm: antes.incidenteAbertoEm },
      resultado,
      agora(),
    );

    await registrarVerificacao(transacao, { resultado, latenciaMs, correlationId, degradado });

    let incidenteId = antes.incidenteId;

    for (const efeito of transicao.efeitos) {
      switch (efeito.tipo) {
        case 'ABRIR_INCIDENTE':
          incidenteId = await abrirIncidente(transacao);
          break;
        case 'NOTIFICAR_INDISPONIBILIDADE':
          if (incidenteId !== null) {
            await notificarIncidente(transacao, incidenteId, 'INDISPONIBILIDADE', null);
          }
          break;
        case 'ENCERRAR_INCIDENTE':
          if (incidenteId !== null) {
            await encerrarIncidente(transacao, incidenteId, efeito.duracaoMs);
          }
          break;
        case 'NOTIFICAR_RECUPERACAO':
          if (incidenteId !== null) {
            await notificarIncidente(transacao, incidenteId, 'RECUPERACAO', efeito.duracaoMs);
          }
          break;
      }
    }

    return { resultado, efeitos: transicao.efeitos.map((efeito) => efeito.tipo) };
  });
};
