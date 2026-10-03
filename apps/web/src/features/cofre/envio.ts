/**
 * Envio do certificado A1 ao cofre (SPEC-011 §6.2).
 *
 * O arquivo e a senha seguem do navegador DIRETO para o endpoint isolado do
 * cofre, com o ticket de uso único que a API emitiu. Por isso este módulo não
 * usa o cliente HTTP do produto (que passa pelo proxy do Next): o proxy nunca
 * pode ver o corpo. A requisição não leva cookies nem credenciais.
 *
 * Nada aqui é registrado: nem em log, nem em armazenamento do navegador, nem em
 * mensagem de erro. A senha existe só dentro do `FormData` desta chamada.
 */
import {
  EXTENSOES_DO_CERTIFICADO,
  LIMITE_DO_CERTIFICADO_BYTES,
  MENSAGEM_DA_RECUSA,
} from '@contaia/shared';
import type { RespostaDaIngestao } from '@contaia/shared';

import { ErroDaApi, ehProblema, type Problema } from '@/lib/http';

/** Cobre o upload de 10 MB em rede ruim sem deixar a tela esperando para sempre. */
const TEMPO_MAXIMO_MS = 120_000;
const SEM_CORRELACAO = 'sem-correlacao';

/**
 * Mesma regra do cofre, aplicada antes de gastar a rede (e o ticket): o erro
 * aparece na tela onde a pessoa escolheu o arquivo. A validação do cofre é a que vale.
 */
export const validarArquivoDoCertificado = (
  arquivo: Readonly<{ name: string; size: number }>,
): string | null => {
  const nome = arquivo.name.toLowerCase();

  if (!EXTENSOES_DO_CERTIFICADO.some((extensao) => nome.endsWith(extensao))) {
    return MENSAGEM_DA_RECUSA.CERTIFICADO_EXTENSAO_INVALIDA;
  }

  if (arquivo.size === 0) {
    return MENSAGEM_DA_RECUSA.CERTIFICADO_ARQUIVO_VAZIO;
  }

  return arquivo.size > LIMITE_DO_CERTIFICADO_BYTES
    ? MENSAGEM_DA_RECUSA.CERTIFICADO_TAMANHO_EXCEDIDO
    : null;
};

/**
 * A URL do cofre vem da API junto com o ticket. Se a API (ou algo no caminho) fosse
 * comprometida, apontar o navegador para outro host levaria senha e arquivo embora.
 * Com `NEXT_PUBLIC_COFRE_URL` definida (build), só a mesma ORIGEM passa; sem ela (dev)
 * basta ser uma URL http(s) válida. O Next só embute a variável se o acesso for literal.
 */
const origemConfigurada = (): string | undefined =>
  // O acesso por ponto é obrigatório: o Next só substitui `process.env.NEXT_PUBLIC_*` literal
  // no bundle do navegador (por colchetes ficaria `undefined` e a trava sumiria em silêncio).
  // @ts-expect-error TS4111: o tsconfig exige colchetes em assinatura de índice.
  process.env.NEXT_PUBLIC_COFRE_URL;

export const origemDoCofreEhAceita = (
  cofreUrl: string,
  permitida: string | undefined = origemConfigurada(),
): boolean => {
  try {
    const recebida = new URL(cofreUrl);

    if (recebida.protocol !== 'http:' && recebida.protocol !== 'https:') {
      return false;
    }

    return permitida === undefined || permitida.trim() === ''
      ? true
      : recebida.origin === new URL(permitida).origin;
  } catch {
    return false;
  }
};

export type EntradaDoEnvio = Readonly<{
  /** Origem do cofre, devolvida pela API junto com o ticket. */
  cofreUrl: string;
  ticket: string;
  senha: string;
  arquivo: File;
  /** Fração enviada, de 0 a 1. */
  aoProgredir: (fracao: number) => void;
}>;

const indisponivel = (): ErroDaApi =>
  new ErroDaApi({
    type: 'https://contaia.local/erros/cofre-indisponivel',
    title: 'Cofre indisponível.',
    status: 0,
    code: 'COFRE_INDISPONIVEL',
    correlationId: SEM_CORRELACAO,
  });

const ehResposta = (valor: unknown): valor is RespostaDaIngestao =>
  typeof valor === 'object' &&
  valor !== null &&
  typeof (valor as { certificado?: unknown }).certificado === 'object' &&
  (valor as { certificado?: unknown }).certificado !== null;

const lerCorpo = (xhr: XMLHttpRequest): unknown => {
  try {
    const corpo: unknown = JSON.parse(xhr.responseText);

    return corpo;
  } catch {
    return null;
  }
};

const problemaDe = (xhr: XMLHttpRequest, corpo: unknown): Problema =>
  ehProblema(corpo)
    ? corpo
    : {
        type: 'https://contaia.local/erros/desconhecido',
        title: 'Não foi possível concluir a operação.',
        status: xhr.status,
        code: 'ERRO_DESCONHECIDO',
        correlationId: xhr.getResponseHeader('x-correlation-id') ?? SEM_CORRELACAO,
      };

export const enviarAoCofre = (entrada: EntradaDoEnvio): Promise<RespostaDaIngestao> =>
  new Promise((resolver, rejeitar) => {
    if (!origemDoCofreEhAceita(entrada.cofreUrl)) {
      rejeitar(indisponivel());

      return;
    }

    // O ticket vai primeiro: o cofre o confere antes de ler o arquivo.
    const corpo = new FormData();

    corpo.append('ticket', entrada.ticket);
    corpo.append('senha', entrada.senha);
    corpo.append('arquivo', entrada.arquivo, entrada.arquivo.name);

    const requisicao = new XMLHttpRequest();

    requisicao.open('POST', `${entrada.cofreUrl.replace(/\/+$/u, '')}/ingestao`);
    // Sem cookies nem credenciais: a autorização é só o ticket (SPEC-011 §6.2).
    requisicao.withCredentials = false;
    requisicao.timeout = TEMPO_MAXIMO_MS;
    requisicao.setRequestHeader('accept', 'application/json');

    requisicao.upload.onprogress = (evento) => {
      if (evento.lengthComputable && evento.total > 0) {
        entrada.aoProgredir(Math.min(1, evento.loaded / evento.total));
      }
    };

    requisicao.onload = () => {
      const resposta = lerCorpo(requisicao);

      if (requisicao.status >= 200 && requisicao.status < 300 && ehResposta(resposta)) {
        resolver(resposta);

        return;
      }

      rejeitar(new ErroDaApi(problemaDe(requisicao, resposta)));
    };

    requisicao.onerror = () => rejeitar(indisponivel());
    requisicao.ontimeout = () => rejeitar(indisponivel());

    requisicao.send(corpo);
  });
