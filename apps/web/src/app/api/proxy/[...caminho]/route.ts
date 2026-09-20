/**
 * Ponte entre o navegador e a API.
 *
 * O token vive em cookie `httpOnly`: o cliente nunca o lê. O proxy acrescenta
 * o `Authorization` no servidor e devolve a resposta como veio — inclusive o
 * `application/problem+json`, que a tela precisa para mapear `code` e
 * `correlationId` (FRONTEND.md §14).
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { COOKIE_DE_SESSAO } from '@/lib/oidc';

const urlDaApi = (): string => process.env['API_ORIGIN'] ?? 'http://127.0.0.1:15101';

const semSessao = (): NextResponse =>
  NextResponse.json(
    {
      type: 'https://contaia.local/erros/http-401',
      title: 'Sessão inválida ou expirada.',
      status: 401,
      code: 'HTTP_401',
      correlationId: 'sem-sessao',
    },
    { status: 401, headers: { 'content-type': 'application/problem+json' } },
  );

const encaminhar = async (
  requisicao: NextRequest,
  caminho: readonly string[],
): Promise<NextResponse> => {
  const token = (await cookies()).get(COOKIE_DE_SESSAO)?.value;

  if (token === undefined) {
    return semSessao();
  }

  const destino = `${urlDaApi()}/${caminho.join('/')}${requisicao.nextUrl.search}`;
  const cabecalhos = new Headers();

  cabecalhos.set('authorization', `Bearer ${token}`);
  cabecalhos.set('accept', requisicao.headers.get('accept') ?? 'application/json');

  const tipoDoConteudo = requisicao.headers.get('content-type');

  if (tipoDoConteudo !== null) {
    cabecalhos.set('content-type', tipoDoConteudo);
  }

  const temCorpo = requisicao.method !== 'GET' && requisicao.method !== 'HEAD';

  let resposta: Response;

  try {
    resposta = await fetch(destino, {
      method: requisicao.method,
      headers: cabecalhos,
      ...(temCorpo ? { body: await requisicao.arrayBuffer() } : {}),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      {
        type: 'https://contaia.local/erros/rede',
        title: 'Não foi possível falar com o servidor.',
        status: 502,
        code: 'FALHA_DE_REDE',
        correlationId: 'sem-correlacao',
      },
      { status: 502, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const corpo = await resposta.arrayBuffer();

  return new NextResponse(corpo, {
    status: resposta.status,
    headers: {
      'content-type': resposta.headers.get('content-type') ?? 'application/json',
    },
  });
};

type Contexto = { params: Promise<{ caminho: string[] }> };

export const GET = async (requisicao: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  encaminhar(requisicao, (await params).caminho);

export const POST = async (requisicao: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  encaminhar(requisicao, (await params).caminho);

export const PUT = async (requisicao: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  encaminhar(requisicao, (await params).caminho);

export const DELETE = async (
  requisicao: NextRequest,
  { params }: Contexto,
): Promise<NextResponse> => encaminhar(requisicao, (await params).caminho);
