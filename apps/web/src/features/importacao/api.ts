/**
 * Chamadas da importação por CSV (SPEC-013/014 §6.2), por domínio: `/empresas/{id}/{recurso}`.
 * Toda resposta passa pelo leitor do domínio (schema do `@contaia/shared`) antes de chegar à tela:
 * dado externo é `unknown` até ser validado.
 *
 * Cada ação do usuário leva um `x-correlation-id` próprio: é esse id que a API grava na tentativa,
 * no evento e no problem+json, e que o suporte procura do outro lado.
 */
import {
  HistoricoDeImportacoesSchema,
  InspecaoDePlanilhaSchema,
  formatoPelaExtensao,
  tipoDeConteudoDoFormato,
  type HistoricoDeImportacoes,
  type InspecaoDePlanilha,
} from '@contaia/shared';

import { ErroDaApi, ehProblema, requisitar } from '@/lib/http';
import type { FormatoDoModelo } from './apresentacao-da-planilha';
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
 * O tipo declarado pelo navegador não é confiável: o Windows com Excel manda `.csv` como
 * `application/vnd.ms-excel`, e planilhas às vezes chegam sem tipo. O arquivo já passou pela
 * checagem de extensão; segue com o tipo canônico do formato (`text/csv`, XLSX ou ODS).
 */
const comTipoDoFormato = (arquivo: File): File => {
  const tipo = tipoDeConteudoDoFormato(formatoPelaExtensao(arquivo.name) ?? 'CSV');

  return arquivo.type === tipo ? arquivo : new File([arquivo], arquivo.name, { type: tipo });
};

/** Aba (posição, base 1) e linha do cabeçalho escolhidas para uma planilha (SPEC-015 §3.3–3.4). */
export type ConfiguracaoDoEnvio = Readonly<{ aba: number; linhaCabecalho: number }>;

/**
 * Envio do arquivo com o mapeamento. `FormData` sem `content-type` explícito: o navegador define o
 * boundary do multipart. Responde 202 com a tentativa (nova ou reaproveitada por idempotência).
 * Planilha leva a aba e a linha do cabeçalho, e o mapeamento por letra de coluna; o CSV, nenhum dos
 * dois (a identidade do CSV continua a das F13/F14).
 */
export const enviarImportacao = async (
  dominio: DominioDaImportacao,
  empresaId: string,
  entrada: Readonly<{
    arquivo: File;
    mapeamento: Readonly<Record<string, string>>;
    planilha?: ConfiguracaoDoEnvio | undefined;
  }>,
): Promise<PreviaBase> => {
  const corpo = new FormData();
  corpo.append('arquivo', comTipoDoFormato(entrada.arquivo));
  corpo.append('mapeamento', JSON.stringify(entrada.mapeamento));

  if (entrada.planilha !== undefined) {
    corpo.append('aba', String(entrada.planilha.aba));
    corpo.append('linhaCabecalho', String(entrada.planilha.linhaCabecalho));
  }

  return dominio.lerPrevia(await ler(`${caminhoDoRecurso(dominio, empresaId)}/importacoes`, { method: 'POST', body: corpo }));
};

/**
 * Inspeção sem estado da planilha (SPEC-015 §6.2): abas, cabeçalho sugerido ou o pedido, colunas
 * com rótulo inequívoco e amostra. Nada fica guardado no servidor; o arquivo vai de novo no envio.
 */
export const inspecionarPlanilha = async (
  dominio: DominioDaImportacao,
  empresaId: string,
  entrada: Readonly<{ arquivo: File; aba: number | null; linhaCabecalho: number | null }>,
): Promise<InspecaoDePlanilha> => {
  const corpo = new FormData();
  corpo.append('arquivo', comTipoDoFormato(entrada.arquivo));

  if (entrada.aba !== null) {
    corpo.append('aba', String(entrada.aba));
  }
  if (entrada.linhaCabecalho !== null) {
    corpo.append('linhaCabecalho', String(entrada.linhaCabecalho));
  }

  return InspecaoDePlanilhaSchema.parse(
    await ler(`${caminhoDoRecurso(dominio, empresaId)}/planilhas/inspecao`, { method: 'POST', body: corpo }),
  );
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

/** O modelo CSV mantém a rota das F13/F14; XLSX e ODS pedem o formato (SPEC-015 §3.1). */
export const caminhoDoModelo = (dominio: DominioDaImportacao, empresaId: string, formato: FormatoDoModelo = 'csv'): string =>
  formato === 'csv'
    ? `${caminhoDoRecurso(dominio, empresaId)}/modelo`
    : `${caminhoDoRecurso(dominio, empresaId)}/modelo?formato=${formato}`;

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
      headers: { accept: '*/*', [CABECALHO_DE_CORRELACAO]: correlationId },
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
