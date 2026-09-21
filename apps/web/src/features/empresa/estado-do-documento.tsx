/**
 * Tradução do estado documental para o semáforo do design system
 * (COMPONENTS.md §3.4).
 *
 * O mapa mora num arquivo só para que aba, histórico e resumo digam a mesma
 * coisa: dois mapas divergentes é como um documento vira "Aprovado" numa tela
 * e "Conforme" em outra.
 */
import type { EstadoDoDocumento } from '@contaia/domain';

import type { TomDoStatus } from '@/components/ui/status-badge';

type Aparencia = Readonly<{ tom: TomDoStatus; rotulo: string }>;

export const APARENCIA_DO_ESTADO: Readonly<Record<EstadoDoDocumento, Aparencia>> = {
  // Pendente é ausência de entrega, não risco: `neutro`, não `atencao`.
  PENDENTE: { tom: 'neutro', rotulo: 'Pendente' },
  // Enviado aguarda decisão humana — é trabalho em curso do escritório.
  ENVIADO: { tom: 'processando', rotulo: 'Enviado' },
  APROVADO: { tom: 'conforme', rotulo: 'Aprovado' },
  // Rejeitado e vencido exigem ação: o documento que existia não vale.
  REJEITADO: { tom: 'critico', rotulo: 'Rejeitado' },
  VENCIDO: { tom: 'atencao', rotulo: 'Vencido' },
  DISPENSADO: { tom: 'neutro', rotulo: 'Dispensado' },
};

/** Estados em que a exigência ainda cobra alguma coisa do escritório. */
export const ESTADO_PEDE_ACAO: Readonly<Record<EstadoDoDocumento, boolean>> = {
  PENDENTE: true,
  ENVIADO: true,
  APROVADO: false,
  REJEITADO: true,
  VENCIDO: true,
  DISPENSADO: false,
};
