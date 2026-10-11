/**
 * Chamadas da importação por CSV (SPEC-013/014 §6.2), por domínio: `/empresas/{id}/{recurso}`.
 * Toda resposta passa pelo leitor do domínio (schema do `@contaia/shared`) antes de chegar à tela:
 * dado externo é `unknown` até ser validado.
 *
 * Cada ação do usuário leva um `x-correlation-id` próprio: é esse id que a API grava na tentativa,
 * no evento e no problem+json, e que o suporte procura do outro lado.
 */
import { HistoricoDeImportacoesSchema, type HistoricoDeImportacoes } from '@contaia/shared';

import { ErroDaApi, ehProblema, requisitar } from '@/lib/http';
import type { DominioDaImportacao, PaginaDeRejeicoesBase, PreviaBase } from './dominio';

/** Um id por ação; o formato (UUID) cabe no que a API aceita (`[A-Za-z0-9-]{8,64}`). */
export const novoCorrelationId = (): string => globalThis.crypto.randomUUID();

const CABECALHO_DE_CORRELACAO = 'x-correlation-id';

export const caminhoDoRecurso = (dominio: DominioDaImportacao, empresaId: string): string =>
  `/empresas/${empresaId}/${dominio.recurso}`;

export const ler = async (caminho: string, opcoes: RequestInit = {}): Promise<unknown> =>
  requisitar<unknown>(caminho, {
    ...opcoes,
    headers: { [CABECALHO_DE_CORRELACAO]: novoCorrelationId(), ...(opcoes.headers ?? {}) },
  });

const comPagina = (pagina: number): string => new URLSearchParams({ pagina: String(pagina) }).toString();

export const obterTentativa = async (
  dominio: DominioDaImportacao,
  empresaId: string,
  tentativaId: string,
): Promise<PreviaBase> => dominio.lerPrevia(await ler(`${caminhoDoRecurso(dominio, empresaId)}/importacoes/${tentativaId}`));

export const listarHistorico = async (
  dominio: DominioDaImportacao,
  empresaId: string,
  pagina: number,
): Promise<HistoricoDeImportacoes> =>
  HistoricoDeImportacoesSchema.parse(await ler(`${caminhoDoRecurso(dominio, empresaId)}/importacoes?${comPagina(pagina)}`));

export const listarRejeicoes = async (
  dominio: DominioDaImportacao,
  empresaId: string,
  tentativaId: string,
  pagina: number,
): Promise<PaginaDeRejeicoesBase> =>
  dominio.lerRejeicoes(
    await ler(`${caminhoDoRecurso(dominio, empresaId)}/importacoes/${tentativaId}/rejeicoes?${comPagina(pagina)}`),
  );

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
  dominio: DominioDaImportacao,
  empresaId: string,
  entrada: Readonly<{ arquivo: File; mapeamento: Readonly<Record<string, string>> }>,
): Promise<PreviaBase> => {
  const corpo = new FormData();
  corpo.append('arquivo', comoCsv(entrada.arquivo));
  corpo.append('mapeamento', JSON.stringify(entrada.mapeamento));

  return dominio.lerPrevia(await ler(`${caminhoDoRecurso(dominio, empresaId)}/importacoes`, { method: 'POST', body: corpo }));
};

export const confirmarImportacao = async (
  dominio: DominioDaImportacao,
  empresaId: string,
  tentativaId: string,
  versaoDaPrevia: number,
): Promise<PreviaBase> =>
  dominio.lerPrevia(
    await ler(`${caminhoDoRecurso(dominio, empresaId)}/importacoes/${tentativaId}/confirmar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ versaoDaPrevia }),
    }),
  );

export const cancelarImportacao = async (
  dominio: DominioDaImportacao,
  empresaId: string,
  tentativaId: string,
): Promise<PreviaBase> =>
  dominio.lerPrevia(
    await ler(`${caminhoDoRecurso(dominio, empresaId)}/importacoes/${tentativaId}/cancelar`, { method: 'POST' }),
  );

export const caminhoDoModelo = (dominio: DominioDaImportacao, empresaId: string): string =>
  `${caminhoDoRecurso(dominio, empresaId)}/modelo`;

export const caminhoDoRelatorio = (dominio: DominioDaImportacao, empresaId: string, tentativaId: string): string =>
  `${caminhoDoRecurso(dominio, empresaId)}/importacoes/${tentativaId}/relatorio`;

export const caminhoDoOriginal = (dominio: DominioDaImportacao, empresaId: string, tentativaId: string): string =>
  `${caminhoDoRecurso(dominio, empresaId)}/importacoes/${tentativaId}/arquivo`;

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
