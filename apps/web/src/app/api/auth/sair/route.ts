import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { COOKIE_DE_ID_TOKEN, COOKIE_DE_SESSAO, urlDeSaida } from '@/lib/oidc';

export const GET = async (): Promise<NextResponse> => {
  const armazenamento = await cookies();
  const idToken = armazenamento.get(COOKIE_DE_ID_TOKEN)?.value ?? null;

  armazenamento.delete(COOKIE_DE_SESSAO);
  armazenamento.delete(COOKIE_DE_ID_TOKEN);

  // Com o `id_token_hint` o provedor encerra a sessão direto, sem a tela de
  // confirmação que deixaria o usuário logado no Keycloak.
  return NextResponse.redirect(urlDeSaida(idToken));
};
