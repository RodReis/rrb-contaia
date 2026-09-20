import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import {
  COOKIE_DE_RETORNO,
  COOKIE_DE_VERIFICADOR,
  gerarVerificador,
  urlDeAutorizacao,
} from '@/lib/oidc';

const SEGUNDOS_DO_FLUXO = 600;

export const GET = async (requisicao: NextRequest): Promise<NextResponse> => {
  const verificador = gerarVerificador();
  const estado = randomBytes(16).toString('hex');
  const destino = requisicao.nextUrl.searchParams.get('destino') ?? '/escritorio';

  const armazenamento = await cookies();
  const comum = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SEGUNDOS_DO_FLUXO,
  };

  // O verificador PKCE e o destino ficam do lado do servidor: o cliente não
  // precisa vê-los e não deve poder trocá-los.
  armazenamento.set(COOKIE_DE_VERIFICADOR, `${verificador}:${estado}`, comum);
  armazenamento.set(COOKIE_DE_RETORNO, destino, comum);

  return NextResponse.redirect(urlDeAutorizacao(verificador, estado));
};
