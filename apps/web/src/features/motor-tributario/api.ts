/** Chamadas ao catálogo e ao simulador tributário (SPEC-016 §6.2). Tipos e contratos vêm de `@contaia/shared`. */
import type { TaxRegime, TaxRuleStatus, TaxType } from '@contaia/domain';
import type {
  CreateTaxRule,
  ManualTaxSimulation,
  NfeComplement,
  NfeSimulationDto,
  TaxOperationType,
  TaxRuleCommand,
  TaxRulePageDto,
  TaxRuleVersionDto,
  TaxSimulationResultDto,
  UpdateTaxRule,
} from '@contaia/shared';

import { requisitar } from '@/lib/http';

export type FiltroDoCatalogo = Readonly<{
  taxType: TaxType | null;
  regime: TaxRegime | null;
  operationType: TaxOperationType | null;
  status: TaxRuleStatus | null;
  validOn: string | null;
  page: number;
  pageSize: number;
}>;

const comJson = (corpo: unknown, method: 'PUT' | 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

const consulta = (filtro: FiltroDoCatalogo): string => {
  const parametros = new URLSearchParams();

  for (const [chave, valor] of Object.entries(filtro)) {
    if (valor !== null) {
      parametros.set(chave, String(valor));
    }
  }

  return parametros.toString();
};

export const listarRegras = (filtro: FiltroDoCatalogo): Promise<TaxRulePageDto> =>
  requisitar(`/tax-rules?${consulta(filtro)}`);

export const obterRegra = (id: string): Promise<TaxRuleVersionDto> => requisitar(`/tax-rules/${id}`);

export const criarRegra =(corpo: CreateTaxRule): Promise<TaxRuleVersionDto> => requisitar('/tax-rules', comJson(corpo, 'POST'));

export const editarRegra = (id: string, corpo: UpdateTaxRule): Promise<TaxRuleVersionDto> =>
  requisitar(`/tax-rules/${id}`, comJson(corpo, 'PUT'));

export const publicarRegra = (id: string, comando: TaxRuleCommand): Promise<TaxRuleVersionDto> =>
  requisitar(`/tax-rules/${id}/publish`, comJson(comando, 'POST'));

export const arquivarRegra = (id: string, comando: TaxRuleCommand): Promise<TaxRuleVersionDto> =>
  requisitar(`/tax-rules/${id}/archive`, comJson(comando, 'POST'));

export const simularManual = (entrada: ManualTaxSimulation): Promise<TaxSimulationResultDto> =>
  requisitar('/tax-simulations/manual', comJson(entrada, 'POST'));

/**
 * NF-e de teste (SPEC-016 §3.6): o XML segue como `arquivo` do multipart e o complemento, quando
 * existe, como JSON no campo `complemento`. Nada é guardado no navegador entre as chamadas.
 */
export const simularNfe = (arquivo: File, complemento: NfeComplement | null): Promise<NfeSimulationDto> => {
  const formulario = new FormData();

  formulario.append('arquivo', arquivo);

  if (complemento !== null) {
    formulario.append('complemento', JSON.stringify(complemento));
  }

  return requisitar('/tax-simulations/nfe', { method: 'POST', body: formulario });
};
