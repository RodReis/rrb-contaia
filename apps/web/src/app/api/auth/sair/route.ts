import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { COOKIE_DE_SESSAO, urlDeSaida } from '@/lib/oidc';

export const GET = async (): Promise<NextResponse> => {
  const armazenamento = await cookies();

  armazenamento.delete(COOKIE_DE_SESSAO);

  return NextResponse.redirect(urlDeSaida());
};
