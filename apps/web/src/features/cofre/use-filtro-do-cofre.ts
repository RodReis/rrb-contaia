/**
 * Estado da lista do cofre na URL (FRONTEND.md §7, SPEC-011 §5.2): busca, estado,
 * ordem, página e a empresa aberta no detalhe. Auditoria se compartilha por link,
 * e o estado precisa sobreviver ao recarregamento. O filtro, a ordenação e a
 * paginação são executados no servidor.
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { FiltroDoCofre } from './api';
import { ORDENACAO_PADRAO, TODOS, ehEstadoDoFiltro, ehOrdenacao } from './apresentacao';

export const CAMINHO_DO_COFRE = '/configuracoes/cofre';
export const POR_PAGINA = 25;
const ATRASO_DA_BUSCA_MS = 300;

export const useFiltroDoCofre = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const buscaNaUrl = parametros.get('busca') ?? '';
  const estadoNaUrl = parametros.get('estado');
  const ordemNaUrl = parametros.get('ordem');
  const empresaNaUrl = parametros.get('empresa');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  const [rascunho, definirRascunho] = useState<string | null>(null);
  const [buscaPublicada, definirBuscaPublicada] = useState(buscaNaUrl);
  const [buscaVistaNaUrl, definirBuscaVistaNaUrl] = useState(buscaNaUrl);
  const buscaDigitada = rascunho ?? buscaNaUrl;

  // A URL mudou por fora (menu, "voltar"): o que estava digitado deixa de valer.
  if (buscaNaUrl !== buscaVistaNaUrl) {
    definirBuscaVistaNaUrl(buscaNaUrl);

    if (buscaNaUrl !== buscaPublicada) {
      definirRascunho(null);
    }
  }

  const parametrosDeAgora = useRef(parametros);

  useEffect(() => {
    parametrosDeAgora.current = parametros;
  });

  const ir = (proximos: URLSearchParams): void => {
    const consulta = proximos.toString();

    navegador.replace(consulta === '' ? CAMINHO_DO_COFRE : `${CAMINHO_DO_COFRE}?${consulta}`, {
      scroll: false,
    });
  };

  const publicar = (ajustar: (proximos: URLSearchParams) => void, voltarAPrimeira = true): void => {
    const proximos = new URLSearchParams(parametrosDeAgora.current.toString());

    ajustar(proximos);

    // Qualquer mudança de filtro volta à primeira página: manter a página 4 num resultado
    // que encolheu mostraria vazio por engano.
    if (voltarAPrimeira) {
      proximos.delete('pagina');
    }

    ir(proximos);
  };

  useEffect(() => {
    if (rascunho === null || rascunho === buscaNaUrl) {
      return;
    }

    const temporizador = setTimeout(() => {
      definirBuscaPublicada(rascunho);
      publicar((proximos) => {
        if (rascunho.length > 0) {
          proximos.set('busca', rascunho);
        } else {
          proximos.delete('busca');
        }
      });
    }, ATRASO_DA_BUSCA_MS);

    return () => clearTimeout(temporizador);
    // `publicar` é recriada a cada render e só lê a ref: depender dela reiniciaria o debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho, buscaNaUrl]);

  const filtro: FiltroDoCofre = useMemo(
    () => ({
      busca: buscaNaUrl.length > 0 ? buscaNaUrl : null,
      estado: ehEstadoDoFiltro(estadoNaUrl) ? estadoNaUrl : null,
      ordem: ehOrdenacao(ordemNaUrl) ? ordemNaUrl : ORDENACAO_PADRAO,
      pagina: paginaNaUrl,
      limite: POR_PAGINA,
    }),
    [buscaNaUrl, estadoNaUrl, ordemNaUrl, paginaNaUrl],
  );

  const definir = (chave: 'estado' | 'ordem', valor: string, padrao: string = TODOS): void =>
    publicar((proximos) => {
      if (valor === padrao) {
        proximos.delete(chave);
      } else {
        proximos.set(chave, valor);
      }
    });

  /** Atalho dos cartões-resumo: aplica estado e/ou ordem de uma vez. */
  const aplicar = (estado: string | null, ordem: string | null): void =>
    publicar((proximos) => {
      if (estado === null) {
        proximos.delete('estado');
      } else {
        proximos.set('estado', estado);
      }

      if (ordem === null || ordem === ORDENACAO_PADRAO) {
        proximos.delete('ordem');
      } else {
        proximos.set('ordem', ordem);
      }
    });

  const irParaPagina = (pagina: number): void =>
    publicar((proximos) => {
      if (pagina <= 1) {
        proximos.delete('pagina');
      } else {
        proximos.set('pagina', String(pagina));
      }
    }, false);

  const abrirEmpresa = (empresaId: string | null): void =>
    publicar((proximos) => {
      if (empresaId === null) {
        proximos.delete('empresa');
      } else {
        proximos.set('empresa', empresaId);
      }
    }, false);

  const limpar = (): void => {
    definirRascunho(null);
    ir(new URLSearchParams());
  };

  const temFiltro = filtro.busca !== null || filtro.estado !== null;
  // Ordenar também é ajuste que "Limpar" desfaz, mas não esvazia a lista como o filtro faz.
  const temAjuste = temFiltro || filtro.ordem !== ORDENACAO_PADRAO;

  return {
    filtro,
    buscaDigitada,
    definirBusca: definirRascunho,
    definir,
    aplicar,
    irParaPagina,
    abrirEmpresa,
    limpar,
    temFiltro,
    temAjuste,
    empresaAberta: empresaNaUrl,
  };
};
