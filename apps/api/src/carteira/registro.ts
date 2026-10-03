/**
 * Efeitos de carteira que nascem de outros casos de uso, dentro da transação
 * deles: autoatribuição na criação da empresa e encerramento de vínculos no
 * arquivamento de usuário ou empresa (SPEC-009 §3.1, §3.3, §3.4).
 *
 * Vínculo, evento e notificação são gravados juntos: o chamador já abriu a
 * transação, então qualquer falha aqui desfaz a operação inteira.
 */
import {
  autoatribuirEmpresa,
  criarNotificacoesDeCarteira,
  registrarEventoDeCarteira,
  resumoDaEmpresa,
} from '@contaia/db';
import type { AfetadoDoEvento, OrigemDoEventoDeCarteira } from '@contaia/db';

type Cliente = Parameters<typeof registrarEventoDeCarteira>[0];

/**
 * Grava o evento do encerramento. `notificar` liga o aviso ao colaborador: vale
 * para quem continua ativo (empresa arquivada), não para quem acabou de ser
 * arquivado e já não acessa o sistema.
 */
export const registrarEncerramento = async (
  cliente: Cliente,
  tenantId: string,
  autorId: string | null,
  origem: Extract<OrigemDoEventoDeCarteira, 'ARQUIVAMENTO_USUARIO' | 'ARQUIVAMENTO_EMPRESA'>,
  afetados: readonly AfetadoDoEvento[],
  notificar: boolean,
): Promise<void> => {
  if (afetados.length === 0) {
    return;
  }

  const eventoId = await registrarEventoDeCarteira(cliente, tenantId, { origem, autorId, afetados });

  if (notificar) {
    await criarNotificacoesDeCarteira(cliente, tenantId, eventoId, afetados);
  }
};

/**
 * O `admin_escritorio` que cria a empresa entra na própria carteira, na mesma
 * transação. Sem notificação: o autor é o próprio colaborador afetado.
 */
export const autoatribuirCriador = async (
  cliente: Cliente,
  tenantId: string,
  usuarioId: string,
  empresaId: string,
): Promise<void> => {
  const revisao = await autoatribuirEmpresa(cliente, tenantId, usuarioId, empresaId);
  const empresa = await resumoDaEmpresa(cliente, tenantId, empresaId);

  if (empresa === null) {
    throw new Error('Empresa recém-criada não encontrada para a autoatribuição.');
  }

  await registrarEventoDeCarteira(cliente, tenantId, {
    origem: 'AUTOATRIBUICAO',
    autorId: usuarioId,
    afetados: [
      {
        usuarioId,
        usuarioNome: revisao.usuarioNome,
        adicionadas: [empresa],
        removidas: [],
        revisaoAnterior: revisao.revisaoAnterior,
        revisaoNova: revisao.revisaoNova,
      },
    ],
  });
};
