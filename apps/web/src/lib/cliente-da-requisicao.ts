/**
 * Quem está do outro lado: a web fica na frente da API, então o IP que a API
 * enxerga é sempre o do servidor da web. Repassar o cliente real faz o limite de
 * tentativas das rotas públicas valer por pessoa, não pelo servidor inteiro.
 */
import type { NextRequest } from 'next/server';

export const clienteDaRequisicao = (requisicao: NextRequest): string | null => {
  // A última entrada é a que o salto mais próximo (o proxy da frente) acrescentou; o início
  // da lista vem do cliente e ele pode inventá-lo a cada requisição.
  const entradas = requisicao.headers.get('x-forwarded-for')?.split(',') ?? [];
  const encaminhado = entradas[entradas.length - 1]?.trim();

  if (encaminhado !== undefined && encaminhado !== '') {
    return encaminhado;
  }

  const real = requisicao.headers.get('x-real-ip')?.trim();

  return real !== undefined && real !== '' ? real : null;
};
