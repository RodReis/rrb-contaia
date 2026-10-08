/**
 * Chamadas da importação do plano de contas (SPEC-013 §6.2). Toda resposta passa pelo schema do
 * `@contaia/shared` antes de chegar à tela: dado externo é `unknown` até ser validado.
 *
 * Cada ação do usuário leva um `x-correlation-id` próprio (SPEC-013 §10): é esse id que a API grava
 * na tentativa, no evento e no problem+json, e que o suporte procura do outro lado.
 */
import type { Mapeamento } from '@contaia/domain';
import {
  HistoricoDeImportacoesSchema,
  PaginaDeRejeicoesDaImportacaoSchema,
  PaginaDoPlanoDeContasSchema,
  PreviaDaImportacaoSchema,
  type HistoricoDeImportacoes,
  type PaginaDeRejeicoesDaImportacao,
  type PaginaDoPlanoDeContas,
  type PreviaDaImportacao,
} from '@contaia/shared';

import { ErroDaApi, ehProblema, requisitar } from '@/lib/http';

/** Um id por ação; o formato (UUID) cabe no que a API aceita (`[A-Za-z0-9-]{8,64}`). */
export const novoCorrelationId = (): string => globalThis.crypto.randomUUID();

const CABECALHO_DE_CORRELACAO = 'x-correlation-id';

const base = (empresaId: string): string => `/empresas/${empresaId}/plano-contas`;

const ler = async (caminho: string, opcoes: RequestInit = {}): Promise<unknown> =>
  requisitar<unknown>(caminho, {
    ...opcoes,
    headers: { [CABECALHO_DE_CORRELACAO]: novoCorrelationId(), ...(opcoes.headers ?? {}) },
  });

const comPagina = (pagina: number): string => new URLSearchParams({ pagina: String(pagina) }).toString();

export const obterTentativa = async (
  empresaId: string,
  tentativaId: string,
): Promise<PreviaDaImportacao> =>
  PreviaDaImportacaoSchema.parse(await ler(`${base(empresaId)}/importacoes/${tentativaId}`));

export const listarHistorico = async (
  empresaId: string,
  pagina: number,
): Promise<HistoricoDeImportacoes> =>
  HistoricoDeImportacoesSchema.parse(await ler(`${base(empresaId)}/importacoes?${comPagina(pagina)}`));

export const listarRejeicoes = async (
  empresaId: string,
  tentativaId: string,
  pagina: number,
): Promise<PaginaDeRejeicoesDaImportacao> =>
  PaginaDeRejeicoesDaImportacaoSchema.parse(
    await ler(`${base(empresaId)}/importacoes/${tentativaId}/rejeicoes?${comPagina(pagina)}`),
  );

export const listarContas = async (
  empresaId: string,
  filtro: Readonly<{ pagina: number; busca: string }>,
): Promise<PaginaDoPlanoDeContas> => {
  const consulta = new URLSearchParams({ pagina: String(filtro.pagina) });

  if (filtro.busca !== '') {
    consulta.set('busca', filtro.busca);
  }

  return PaginaDoPlanoDeContasSchema.parse(await ler(`${base(empresaId)}/contas?${consulta.toString()}`));
};

/**
 * O navegador pode mandar `.csv` como `application/vnd.ms-excel` (Excel no Windows) ou sem tipo
 * nenhum; o arquivo já passou pela checagem de extensão e de conteúdo, então segue como `text/csv`.
 */
const comoCsv = (arquivo: File): File =>
  arquivo.type === 'text/csv' ? arquivo : new File([arquivo], arquivo.name, { type: 'text/csv' });

/**
 * Envio do arquivo com o mapeamento. `FormData` sem `content-type` explícito: o navegador define o
 * boundary do multipart. Responde 202 com a tentativa (nova ou reaproveitada por idempotência).
 */
export const enviarImportacao = async (
  empresaId: string,
  entrada: Readonly<{ arquivo: File; mapeamento: Mapeamento }>,
): Promise<PreviaDaImportacao> => {
  const corpo = new FormData();
  corpo.append('arquivo', comoCsv(entrada.arquivo));
  corpo.append('mapeamento', JSON.stringify(entrada.mapeamento));

  return PreviaDaImportacaoSchema.parse(
    await ler(`${base(empresaId)}/importacoes`, { method: 'POST', body: corpo }),
  );
};

export const confirmarImportacao = async (
  empresaId: string,
  tentativaId: string,
  versaoDaPrevia: number,
): Promise<PreviaDaImportacao> =>
  PreviaDaImportacaoSchema.parse(
    await ler(`${base(empresaId)}/importacoes/${tentativaId}/confirmar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ versaoDaPrevia }),
    }),
  );

export const cancelarImportacao = async (
  empresaId: string,
  tentativaId: string,
): Promise<PreviaDaImportacao> =>
  PreviaDaImportacaoSchema.parse(
    await ler(`${base(empresaId)}/importacoes/${tentativaId}/cancelar`, { method: 'POST' }),
  );

export const caminhoDoModelo = (empresaId: string): string => `${base(empresaId)}/modelo`;

export const caminhoDoRelatorio = (empresaId: string, tentativaId: string): string =>
  `${base(empresaId)}/importacoes/${tentativaId}/relatorio`;

export const caminhoDoOriginal = (empresaId: string, tentativaId: string): string =>
  `${base(empresaId)}/importacoes/${tentativaId}/arquivo`;

/** `attachment; filename="relatorio-plano.csv"` → `relatorio-plano.csv`, sem separador de caminho. */
const nomeDoAnexo = (disposicao: string | null): string | null => {
  const nome = disposicao?.match(/filename="([^"]+)"/u)?.[1]?.replace(/[\\/]/gu, '_').trim();

  return nome === undefined || nome === '' ? null : nome;
};

const salvarNoNavegador = (conteudo: Blob, nome: string): void => {
  const endereco = URL.createObjectURL(conteudo);
  const ancora = document.createElement('a');

  ancora.href = endereco;
  ancora.download = nome;
  ancora.rel = 'noopener';
  document.body.append(ancora);
  ancora.click();
  ancora.remove();
  // O clique já entregou o arquivo ao navegador; o endereço temporário sai no próximo ciclo.
  setTimeout(() => URL.revokeObjectURL(endereco), 0);
};

/**
 * Download por `fetch`, não por `<a href>`: um relatório indisponível (409, 500) vira erro na tela,
 * com código de suporte e nova tentativa, em vez de um "arquivo" com o JSON do erro.
 */
export const baixarArquivo = async (caminho: string, nomePadrao: string): Promise<void> => {
  const correlationId = novoCorrelationId();
  let resposta: Response;

  try {
    resposta = await fetch(`/api/proxy${caminho}`, {
      headers: { accept: 'text/csv, application/problem+json', [CABECALHO_DE_CORRELACAO]: correlationId },
    });
  } catch {
    throw new ErroDaApi({
      type: 'https://contaia.local/erros/rede',
      title: 'Não foi possível falar com o servidor.',
      status: 0,
      code: 'FALHA_DE_REDE',
      correlationId,
    });
  }

  if (!resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);

    throw new ErroDaApi(
      ehProblema(corpo)
        ? corpo
        : {
            type: 'https://contaia.local/erros/desconhecido',
            title: 'Não foi possível concluir a operação.',
            status: resposta.status,
            code: 'ERRO_DESCONHECIDO',
            correlationId,
          },
    );
  }

  salvarNoNavegador(await resposta.blob(), nomeDoAnexo(resposta.headers.get('content-disposition')) ?? nomePadrao);
};
