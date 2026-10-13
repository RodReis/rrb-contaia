/**
 * Filtros, página e painel aberto do catálogo vivem na URL (FRONTEND.md §7): a lista é conferida e
 * auditada, então o estado precisa ser compartilhável e sobreviver ao recarregamento. Valor de URL
 * que não é do contrato é ignorado em vez de enviado ao servidor.
 */
'use client';

import { TAX_REGIMES, TAX_RULE_STATUSES, TAX_TYPES, lerDataCivil, type TaxRegime, type TaxRuleStatus, type TaxType } from '@contaia/domain';
import { TAX_OPERATION_TYPES, type TaxOperationType } from '@contaia/shared';
import { useRouter, useSearchParams } from 'next/navigation';

import type { FiltroDoCatalogo } from './api';

export const CAMINHO_DO_MOTOR = '/fiscal/motor-tributario';
export const POR_PAGINA = 25;
export const NOVA_REGRA = 'nova';

/** Valor "sem filtro" dos seletores; nunca vai à URL. */
export const TODOS = 'todos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const dentroDe = <T extends string>(lista: readonly T[], valor: string | null): T | null =>
  lista.find((candidato) => candidato === valor) ?? null;

type ChaveDaUrl = 'tributo' | 'regime' | 'operacao' | 'estado' | 'vigente' | 'pagina' | 'regra';

export const useFiltroDoCatalogo = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const vigente = parametros.get('vigente');
  const pagina = Number(parametros.get('pagina') ?? '1');
  const regra = parametros.get('regra');

  const filtro: FiltroDoCatalogo = {
    taxType: dentroDe<TaxType>(TAX_TYPES, parametros.get('tributo')),
    regime: dentroDe<TaxRegime>(TAX_REGIMES, parametros.get('regime')),
    operationType: dentroDe<TaxOperationType>(TAX_OPERATION_TYPES, parametros.get('operacao')),
    status: dentroDe<TaxRuleStatus>(TAX_RULE_STATUSES, parametros.get('estado')),
    validOn: vigente !== null && lerDataCivil(vigente) === vigente ? vigente : null,
    page: Number.isInteger(pagina) && pagina >= 1 ? pagina : 1,
    pageSize: POR_PAGINA,
  };

  const regraAberta = regra === NOVA_REGRA || (regra !== null && UUID.test(regra)) ? regra : null;

  const temFiltro =
    filtro.taxType !== null || filtro.regime !== null || filtro.operationType !== null || filtro.status !== null || filtro.validOn !== null;

  const publicar = (ajustar: (proximos: URLSearchParams) => void): void => {
    const proximos = new URLSearchParams(parametros.toString());

    ajustar(proximos);

    const texto = proximos.toString();

    navegador.replace(texto === '' ? CAMINHO_DO_MOTOR : `${CAMINHO_DO_MOTOR}?${texto}`, { scroll: false });
  };

  const colocar = (proximos: URLSearchParams, chave: ChaveDaUrl, valor: string | null): void => {
    if (valor === null || valor === '' || valor === TODOS) {
      proximos.delete(chave);
    } else {
      proximos.set(chave, valor);
    }
  };

  return {
    filtro,
    temFiltro,
    regraAberta,
    /** Qualquer mudança de filtro volta à primeira página: a página 4 de um resultado que encolheu seria vazio por engano. */
    definir: (chave: Exclude<ChaveDaUrl, 'pagina' | 'regra'>, valor: string): void =>
      publicar((proximos) => {
        colocar(proximos, chave, valor);
        proximos.delete('pagina');
      }),
    limpar: (): void => navegador.replace(CAMINHO_DO_MOTOR, { scroll: false }),
    irParaPagina: (numero: number): void =>
      publicar((proximos) => colocar(proximos, 'pagina', numero <= 1 ? null : String(numero))),
    abrir: (id: string | null): void => publicar((proximos) => colocar(proximos, 'regra', id)),
  };
};
