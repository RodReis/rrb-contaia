import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import {
  COOKIE_DE_ID_TOKEN,
  COOKIE_DE_RETORNO,
  COOKIE_DE_SESSAO,
  COOKIE_DE_VERIFICADOR,
  opcoesDeCookie,
  origemDaAplicacao,
  trocarCodigoPorToken,
} from '@/lib/oidc';

export const GET = async (requisicao: NextRequest): Promise<NextResponse> => {
  const origem = origemDaAplicacao();
  const codigo = requisicao.nextUrl.searchParams.get('code');
  const estadoRecebido = requisicao.nextUrl.searchParams.get('state');

  const armazenamento = await cookies();
  const guardado = armazenamento.get(COOKIE_DE_VERIFICADOR)?.value ?? '';
  const [verificador, estadoEsperado] = guardado.split(':');

  armazenamento.delete(COOKIE_DE_VERIFICADOR);

  // Estado ausente ou divergente derruba o fluxo: é a proteção contra código
  // injetado por terceiro.
  if (
    codigo === null ||
    verificador === undefined ||
    estadoEsperado === undefined ||
    estadoRecebido !== estadoEsperado
  ) {
    return NextResponse.redirect(`${origem}/acesso?erro=fluxo`);
  }

  try {
    const tokens = await trocarCodigoPorToken(codigo, verificador);
    const destino = armazenamento.get(COOKIE_DE_RETORNO)?.value ?? '/escritorio';

    armazenamento.delete(COOKIE_DE_RETORNO);
    armazenamento.set(COOKIE_DE_SESSAO, tokens.accessToken, opcoesDeCookie(tokens.expiraEm));

    if (tokens.idToken !== null) {
      armazenamento.set(COOKIE_DE_ID_TOKEN, tokens.idToken, opcoesDeCookie(tokens.expiraEm));
    }

    return NextResponse.redirect(`${origem}${destino}`);
  } catch {
    return NextResponse.redirect(`${origem}/acesso?erro=autenticacao`);
  }
};
