/**
 * Planilha (XLSX/ODS) na validação assíncrona (SPEC-015 §3.2–§3.7, §7). A configuração vem da
 * tentativa (formato, aba, linha de cabeçalho gravados no envio); o original vem do storage como no
 * CSV. Regras:
 *
 * 1. **Toda leitura roda no processo filho** (`lerPlanilhaIsolada`, teto de memória, tempo e saída).
 *    Pior caso de uma leitura: ~40 s (10 s para subir o filho + 30 s de trabalho); o lock do job no
 *    BullMQ é renovado por temporizador enquanto o job espera ou lê, então isso não o derruba.
 * 2. **No máximo `LEITURAS_SIMULTANEAS_DE_PLANILHA` por processo**, somando os dois importadores: o
 *    pai segura por instantes o JSON do filho (até ~330 MB de pico por leitura). O excedente ESPERA a
 *    vez (o job continua ativo); nunca falha por isso. A análise pura roda ainda na vaga, para a
 *    leitura grande sair de escopo antes de outra entrar.
 * 3. **Defeito do arquivo** (`ErroDePlanilha`: formato, cifra, corrompido, aba inexistente, limite,
 *    tempo esgotado no filho) → recusa do arquivo com o código estável (REJEITADA, sem staging).
 *    **Falha técnica do filho** (`ErroDeInfraestrutura`: não subiu, morreu, canal quebrou) → relança
 *    para o retry do BullMQ; esgotado, FALHA com o código técnico (`FALHA_NA_VALIDACAO`).
 * 4. Nada de conteúdo em log, erro ou argumento de processo: o leitor já recebe os bytes por stdin.
 */
import { diagnosticosDaTabela, type LeituraDaAba, type ResultadoTabular } from '@contaia/domain';
import { ErroDePlanilha, lerPlanilhaIsolada } from '@contaia/planilhas';
import type { DetalhesDePlanilha, DiagnosticoDeLeituraDaPlanilha } from '@contaia/shared';

import type { ArquivoRecusado } from './arquivo-recusado.js';

/** Lê uma aba do original (o real roda em processo filho; os testes o dublam). */
export type LeitorDeAba = (bytes: Uint8Array, abaPosicao: number) => Promise<LeituraDaAba>;

export const LEITOR_ISOLADO: LeitorDeAba = (bytes, abaPosicao) => lerPlanilhaIsolada(bytes, { tipo: 'ler-aba', abaPosicao });

/** Leituras de planilha simultâneas por processo de workers (os dois importadores somados). */
export const LEITURAS_SIMULTANEAS_DE_PLANILHA = 2;

/** Semáforo com fila: acima do máximo, a tarefa espera a vez (em ordem de chegada). */
export class LimitadorDeLeituras {
  private emUso = 0;
  private readonly fila: Array<() => void> = [];

  constructor(private readonly maximo: number) {}

  get ocupadas(): number {
    return this.emUso;
  }

  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    if (this.emUso < this.maximo) {
      this.emUso += 1;
    } else {
      // A vaga passa direto de quem sai para quem espera: `emUso` não cai nem sobe.
      await new Promise<void>((entrar) => this.fila.push(entrar));
    }

    try {
      return await tarefa();
    } finally {
      const proximo = this.fila.shift();
      if (proximo === undefined) {
        this.emUso -= 1;
      } else {
        proximo();
      }
    }
  }
}

export const LIMITADOR_DO_PROCESSO = new LimitadorDeLeituras(LEITURAS_SIMULTANEAS_DE_PLANILHA);

export type ConfiguracaoDaPlanilha = Readonly<{ abaPosicao: number; linhaCabecalho: number }>;

/** O que a tentativa gravou no envio. `null` = CSV (ou tentativa sem os campos): o caminho das F13/F14. */
export const configuracaoDaPlanilha = (
  tentativa: Partial<Pick<DetalhesDePlanilha, 'formato' | 'aba' | 'linhaCabecalho'>>,
): ConfiguracaoDaPlanilha | null =>
  (tentativa.formato === 'XLSX' || tentativa.formato === 'ODS') && tentativa.aba !== null && tentativa.aba !== undefined && tentativa.linhaCabecalho !== undefined
    ? { abaPosicao: tentativa.aba.posicao, linhaCabecalho: tentativa.linhaCabecalho }
    : null;

/** O que a leitura grava na tentativa (contagens e diagnósticos de texto fixo; nenhum valor de célula). */
export type LeituraRegistravel = Readonly<{
  linhasIgnoradasAntesDoCabecalho: number;
  linhasOcultas: number;
  diagnosticos: readonly DiagnosticoDeLeituraDaPlanilha[];
}>;

export const leituraRegistravel = (tabela: ResultadoTabular): LeituraRegistravel => ({
  linhasIgnoradasAntesDoCabecalho: tabela.ignoradasAntesDoCabecalho,
  linhasOcultas: tabela.ocultas,
  diagnosticos: diagnosticosDaTabela(tabela),
});

/**
 * Lê a aba da tentativa na vaga do limitador do processo e entrega a leitura à análise pura (ainda na
 * vaga). Defeito do arquivo → `ARQUIVO_RECUSADO`; falha técnica → relança.
 */
export const analisarPlanilha = <R>(
  deps: Readonly<{ lerPlanilha?: LeitorDeAba | undefined }>,
  bytes: Uint8Array,
  config: ConfiguracaoDaPlanilha,
  analisar: (leitura: LeituraDaAba) => R,
): Promise<R | ArquivoRecusado> =>
  LIMITADOR_DO_PROCESSO.executar(async () => {
    let leitura: LeituraDaAba;
    try {
      leitura = await (deps.lerPlanilha ?? LEITOR_ISOLADO)(bytes, config.abaPosicao);
    } catch (erro) {
      if (erro instanceof ErroDePlanilha) {
        // Todo código do leitor é recusa do arquivo (o tipo não compila se faltar um).
        const recusa: ArquivoRecusado = { tipo: 'ARQUIVO_RECUSADO', codigo: erro.codigo };
        return recusa;
      }
      throw erro;
    }

    return analisar(leitura);
  });
