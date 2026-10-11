/**
 * Estado de uma aba de importação na URL (FRONTEND.md §7): a tentativa aberta, as páginas do
 * histórico, das rejeições e da base vigente, e a busca. O link da notificação
 * (`/empresas/{id}?aba={aba}&tentativa={id}`) cai direto na tentativa, e qualquer leitura da tela
 * se compartilha por link.
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const paginaDe = (valor: string | null): number => {
  const numero = Number(valor ?? '1');

  return Number.isInteger(numero) && numero >= 1 ? numero : 1;
};

/**
 * @param aba valor de `?aba=` da aba que hospeda a importação (`plano-contas`, `empregados`)
 * @param parametroDaBase nome do parâmetro da página da base (`contas`, `empregados`)
 */
export const useEstadoNaUrl = (empresaId: string, aba: string, parametroDaBase: string) => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  /**
   * Abrir ou fechar uma tentativa é mudar de "tela": entra no histórico do navegador (`push`), e o
   * "voltar" retorna. Página e busca só refinam a mesma tela: trocam a entrada (`replace`).
   */
  const ir = (ajustar: (proximos: URLSearchParams) => void, modo: 'push' | 'replace' = 'replace'): void => {
    const proximos = new URLSearchParams(parametros.toString());

    proximos.set('aba', aba);
    ajustar(proximos);
    navegador[modo](`/empresas/${empresaId}?${proximos.toString()}`, { scroll: false });
  };

  const definirPagina = (nome: string, pagina: number) => (proximos: URLSearchParams) => {
    if (pagina <= 1) {
      proximos.delete(nome);
    } else {
      proximos.set(nome, String(pagina));
    }
  };

  const tentativa = parametros.get('tentativa');

  return {
    tentativaId: tentativa === null || tentativa === '' ? null : tentativa,
    paginaDoHistorico: paginaDe(parametros.get('historico')),
    paginaDasRejeicoes: paginaDe(parametros.get('rejeicoes')),
    paginaDaBase: paginaDe(parametros.get(parametroDaBase)),
    busca: parametros.get('busca') ?? '',
    abrirTentativa: (tentativaId: string): void =>
      ir((proximos) => {
        proximos.set('tentativa', tentativaId);
        proximos.delete('rejeicoes');
      }, 'push'),
    fecharTentativa: (): void =>
      ir((proximos) => {
        proximos.delete('tentativa');
        proximos.delete('rejeicoes');
      }, 'push'),
    irParaHistorico: (pagina: number): void => ir(definirPagina('historico', pagina)),
    irParaRejeicoes: (pagina: number): void => ir(definirPagina('rejeicoes', pagina)),
    irParaBase: (pagina: number): void => ir(definirPagina(parametroDaBase, pagina)),
    buscar: (texto: string): void =>
      ir((proximos) => {
        if (texto === '') {
          proximos.delete('busca');
        } else {
          proximos.set('busca', texto);
        }
        proximos.delete(parametroDaBase);
      }),
  };
};

export type EstadoNaUrl = ReturnType<typeof useEstadoNaUrl>;
