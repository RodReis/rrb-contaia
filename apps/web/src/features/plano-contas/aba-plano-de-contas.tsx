/**
 * Aba "Plano de contas" da empresa (SPEC-013 §3.1, §5.2): importação por CSV, histórico e plano
 * vigente num lugar só. A composição é a comum às importações (`AbaDeImportacao`); aqui ficam o
 * domínio do plano, os textos da aba e o plano vigente. O título trata só do plano de contas (sem
 * centro de custo do protótipo, SPEC §5.1).
 */
'use client';

import { AbaDeImportacao } from '../importacao/aba-de-importacao';
import { DOMINIO_DO_PLANO } from './dominio';
import { PlanoVigente } from './plano-vigente';

const CABECALHO = {
  titulo: 'Plano de contas',
  introducao:
    'Importe e reimporte o plano de contas desta empresa por CSV, no modelo do ContaIA ou mapeando as colunas de um arquivo legado. Nenhuma conta muda antes da sua confirmação.',
} as const;

export const AbaPlanoDeContas = ({
  empresaId,
  somenteLeitura,
  comCabecalho = true,
}: {
  empresaId: string;
  somenteLeitura: boolean;
  /** Falso quando quem hospeda a aba (a etapa do cadastro) já tem o próprio título e introdução. */
  comCabecalho?: boolean;
}) => (
  <AbaDeImportacao
    dominio={DOMINIO_DO_PLANO}
    empresaId={empresaId}
    somenteLeitura={somenteLeitura}
    parametroDaBase="contas"
    cabecalho={comCabecalho ? CABECALHO : null}
    avisoDeSomenteLeitura="Empresa arquivada: o plano e o histórico ficam para consulta, sem novas importações."
    base={(url) => <PlanoVigente empresaId={empresaId} url={url} />}
  />
);
