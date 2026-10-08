/**
 * Trilha da importação, a mesma leitura do pipeline do protótipo (arquivo → mapeamento →
 * validação → revisão → resultado), com o `Stepper` do produto: a etapa é dita por texto, não só
 * pela cor ou pelo número.
 */
import type { EstadoDaImportacao } from '@contaia/shared';

import { Stepper, type EtapaDoStepper } from '@/components/ui/stepper';

export type EtapaDaImportacao = 'arquivo' | 'mapeamento' | 'validacao' | 'revisao' | 'resultado';

const ETAPAS: readonly Readonly<{ id: EtapaDaImportacao; rotulo: string }>[] = [
  { id: 'arquivo', rotulo: 'Arquivo' },
  { id: 'mapeamento', rotulo: 'Mapeamento' },
  { id: 'validacao', rotulo: 'Validação' },
  { id: 'revisao', rotulo: 'Revisão' },
  { id: 'resultado', rotulo: 'Resultado' },
];

export const etapaDoEstado = (estado: EstadoDaImportacao): EtapaDaImportacao => {
  switch (estado) {
    case 'RECEBIDA':
    case 'VALIDANDO':
      return 'validacao';
    case 'AGUARDANDO_CONFIRMACAO':
    case 'APLICANDO':
      return 'revisao';
    default:
      return 'resultado';
  }
};

export const EtapasDaImportacao = ({ atual }: { atual: EtapaDaImportacao }) => {
  const posicao = ETAPAS.findIndex((etapa) => etapa.id === atual);
  const etapas: EtapaDoStepper[] = ETAPAS.map((etapa, indice) => ({
    id: etapa.id,
    rotulo: etapa.rotulo,
    situacao: indice < posicao ? 'concluida' : indice === posicao ? 'atual' : 'pendente',
  }));

  return <Stepper etapas={etapas} rotulo="Etapas da importação" />;
};
