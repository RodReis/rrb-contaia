/**
 * Ponte pública entre o navegador e a API — só para o convite.
 *
 * Quem aceita um convite ainda não tem sessão, então esta rota não exige o
 * cookie e **nunca** envia `Authorization`. Por isso é estreita de propósito:
 * uma lista fechada de caminhos e métodos. Qualquer outra coisa é 404 sem
 * chegar à API — esta rota não pode virar um atalho para o resto dela.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { clienteDaRequisicao } from '@/lib/cliente-da-requisicao';

const urlDaApi = (): string => process.env['API_ORIGIN'] ?? 'http://127.0.0.1:15101';

/** Forma de um token emitido (43) com folga, e nenhuma barra ou ponto. */
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const TETO_DO_CORPO_EM_BYTES = 8 * 1024;

const problema = (status: number, codigo: string, titulo: string): NextResponse =>
  NextResponse.json(
    {
      type: `https://contaia.local/erros/${codigo.toLowerCase().replace(/_/g, '-')}`,
      title: titulo,
      status,
      code: codigo,
      correlationId: 'sem-correlacao',
    },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

const permitido = (metodo: string, caminho: readonly string[]): boolean => {
  const [recurso, alvo, resto] = caminho;

  if (recurso !== 'convites' || alvo === undefined || resto !== undefined) {
    return false;
  }

  return metodo === 'POST' ? alvo === 'aceitar' : metodo === 'GET' && TOKEN.test(alvo);
};

const encaminhar = async (
  requisicao: NextRequest,
  caminho: readonly string[],
): Promise<NextResponse> => {
  if (!permitido(requisicao.method, caminho)) {
    return problema(404, 'HTTP_404', 'Recurso não encontrado.');
  }

  const cabecalhos = new Headers({ accept: 'application/json' });
  const tipoDoConteudo = requisicao.headers.get('content-type');
  const cliente = clienteDaRequisicao(requisicao);

  if (tipoDoConteudo !== null) {
    cabecalhos.set('content-type', tipoDoConteudo);
  }

  if (cliente !== null) {
    cabecalhos.set('x-forwarded-for', cliente);
  }

  // Rota pública: o corpo é lido inteiro na memória, então tem teto próprio (um aceite real
  // tem poucas centenas de bytes).
  const corpoDaRequisicao = requisicao.method === 'GET' ? null : await requisicao.arrayBuffer();

  if (corpoDaRequisicao !== null && corpoDaRequisicao.byteLength > TETO_DO_CORPO_EM_BYTES) {
    return problema(413, 'HTTP_413', 'O corpo da requisição é grande demais.');
  }

  let resposta: Response;

  try {
    resposta = await fetch(`${urlDaApi()}/${caminho.join('/')}`, {
      method: requisicao.method,
      headers: cabecalhos,
      ...(corpoDaRequisicao === null ? {} : { body: corpoDaRequisicao }),
      cache: 'no-store',
    });
  } catch {
    return problema(502, 'FALHA_DE_REDE', 'Não foi possível falar com o servidor.');
  }

  // 204 não admite corpo no `Response`: repassar o vazio como `null`.
  const corpo = resposta.status === 204 ? null : await resposta.arrayBuffer();

  return new NextResponse(corpo, {
    status: resposta.status,
    headers: { 'content-type': resposta.headers.get('content-type') ?? 'application/json' },
  });
};

type Contexto = { params: Promise<{ caminho: string[] }> };

export const GET = async (requisicao: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  encaminhar(requisicao, (await params).caminho);

export const POST = async (requisicao: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  encaminhar(requisicao, (await params).caminho);
