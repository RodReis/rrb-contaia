/**
 * Busca da base vigente de uma aba de importação (plano de contas, empregados), publicada na URL.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

import type { EstadoNaUrl } from './use-estado-na-url';

const ATRASO_DA_BUSCA_MS = 300;

/**
 * Busca com atraso de 300 ms (PATTERNS.md §11), publicada na URL com `replace`. Se a busca da URL
 * muda por fora (voltar do navegador, outro link), o que estava digitado e ainda não publicado
 * deixa de valer — senão o atraso republicaria o rascunho velho por cima. A navegação é
 * assíncrona: quando a URL enfim reflete o que ESTE campo publicou, é eco, não mudança por fora, e
 * o que foi digitado nesse meio-tempo continua no campo.
 */
export const useBuscaComAtraso = (url: EstadoNaUrl) => {
  const [rascunho, definirRascunho] = useState<string | null>(null);
  const [buscaVista, definirBuscaVista] = useState(url.busca);
  // Valores que este campo publicou e a URL ainda não refletiu, em ordem (estado, não ref: são
  // lidos durante a renderização).
  const [publicadas, definirPublicadas] = useState<readonly string[]>([]);
  const buscar = useRef(url.buscar);

  if (url.busca !== buscaVista) {
    definirBuscaVista(url.busca);

    const posicao = publicadas.indexOf(url.busca);

    if (posicao >= 0) {
      // Eco de uma publicação deste campo: as anteriores a ela já passaram.
      definirPublicadas(publicadas.slice(posicao + 1));
    } else {
      definirPublicadas([]);

      if (rascunho !== null && rascunho.trim() !== url.busca) {
        definirRascunho(null);
      }
    }
  }

  useEffect(() => {
    buscar.current = url.buscar;
  });

  useEffect(() => {
    if (rascunho === null || rascunho.trim() === url.busca) {
      return undefined;
    }

    const relogio = setTimeout(() => {
      definirPublicadas((anteriores) => [...anteriores, rascunho.trim()]);
      buscar.current(rascunho.trim());
    }, ATRASO_DA_BUSCA_MS);

    return () => clearTimeout(relogio);
  }, [rascunho, url.busca]);

  return { texto: rascunho ?? url.busca, definir: definirRascunho, limpar: () => definirRascunho('') };
};
