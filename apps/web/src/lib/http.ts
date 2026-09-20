/**
 * Cliente HTTP do produto. Normaliza toda falha em `application/problem+json`,
 * inclusive falha de rede, que recebe código próprio (FRONTEND.md §14).
 */
import type { CodigoDeErro } from '@contaia/domain';

export type CampoComProblema = Readonly<{ campo: string; codigo: CodigoDeErro }>;

export type Problema = Readonly<{
  type: string;
  title: string;
  status: number;
  code: string;
  correlationId: string;
  campos?: readonly CampoComProblema[];
}>;

export class ErroDaApi extends Error {
  readonly problema: Problema;

  constructor(problema: Problema) {
    super(problema.title);
    this.name = 'ErroDaApi';
    this.problema = problema;
  }
}

const PROBLEMA_DE_REDE: Omit<Problema, 'correlationId'> = {
  type: 'https://contaia.local/erros/rede',
  title: 'Não foi possível falar com o servidor.',
  status: 0,
  code: 'FALHA_DE_REDE',
};

const ehProblema = (valor: unknown): valor is Problema =>
  typeof valor === 'object' &&
  valor !== null &&
  typeof (valor as { code?: unknown }).code === 'string';

export const requisitar = async <T>(
  caminho: string,
  opcoes: RequestInit = {},
): Promise<T> => {
  let resposta: Response;

  try {
    resposta = await fetch(`/api/proxy${caminho}`, {
      ...opcoes,
      headers: { accept: 'application/json', ...(opcoes.headers ?? {}) },
    });
  } catch {
    throw new ErroDaApi({ ...PROBLEMA_DE_REDE, correlationId: 'sem-correlacao' });
  }

  if (resposta.status === 204) {
    return undefined as T;
  }

  const corpo: unknown = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    throw new ErroDaApi(
      ehProblema(corpo)
        ? corpo
        : {
            type: 'https://contaia.local/erros/desconhecido',
            title: 'Não foi possível concluir a operação.',
            status: resposta.status,
            code: 'ERRO_DESCONHECIDO',
            correlationId: resposta.headers.get('x-correlation-id') ?? 'sem-correlacao',
          },
    );
  }

  return corpo as T;
};
