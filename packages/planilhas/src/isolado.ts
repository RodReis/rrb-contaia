import { fork, type ChildProcess } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LeituraDaAba } from '@contaia/domain';
import { AbaDaPlanilhaSchema, LeituraDaAbaSchema } from '@contaia/shared';
import { z } from 'zod';

import { CODIGOS_DO_LEITOR, DETALHES_DO_ERRO, ErroDeInfraestrutura, ErroDePlanilha, excedido } from './erros.ts';
import type { Inspecao } from './inspecionar.ts';
import { LIMITES } from './limites.ts';
import { PRONTO, ehOperacao, type OperacaoDePlanilha } from './protocolo.ts';

export interface OpcoesDoIsolamento {
  /**
   * Tempo máximo do trabalho (padrão 30 s), contado do momento em que o filho fica pronto; estouro →
   * `LIMITE_DE_PROCESSAMENTO_EXCEDIDO`. A partida tem prazo próprio (10 s), que não é limite do arquivo.
   */
  readonly timeoutMs?: number;
  /** Heap máximo do filho em MB (padrão 512); estouro → `LIMITE_DE_PROCESSAMENTO_EXCEDIDO`. */
  readonly memoriaMb?: number;
}

/** Opções só para teste do próprio isolamento. */
interface OpcoesInternas extends OpcoesDoIsolamento {
  readonly caminhoDoFilho?: string;
  readonly execPath?: string;
  readonly bytesDaSaida?: number;
  readonly prazoDePartidaMs?: number;
}

/** Folga para subir o Node do filho mesmo com a máquina carregada; estourar é falha técnica. */
const PRAZO_DE_PARTIDA_MS = 10_000;
/** Só o começo do stderr é guardado, e só para reconhecer o abort do V8 (nunca vai para log). */
const TETO_DO_STDERR = 8 * 1024;
const MENSAGEM_DE_HEAP = /heap out of memory|Reached heap limit|Allocation failed/u;
const CODIGO_DO_ABORT = 134;

/**
 * Morte sem resposta depois do `pronto`: só o abort do V8 por heap esgotado (SIGABRT no Linux,
 * código 134 no Windows, mensagem de OOM no stderr) é limite do arquivo. Qualquer outro término
 * (exceção não tratada, SIGKILL/SIGTERM de fora, canal fechado) é falha técnica, retentável.
 */
const morreuPorHeap = (codigo: number | null, sinal: NodeJS.Signals | null, stderr: string): boolean =>
  sinal === 'SIGABRT' || codigo === CODIGO_DO_ABORT || MENSAGEM_DE_HEAP.test(stderr);

// Nos testes o fonte `.ts` roda direto (o Node 24 remove os tipos); no dist, o `.js` compilado.
const aqui = fileURLToPath(import.meta.url);
const CAMINHO_DO_FILHO = fileURLToPath(new URL(`./filho${extname(aqui)}`, import.meta.url));

const InspecaoSchema = z.strictObject({ formato: z.enum(['XLSX', 'ODS']), abas: z.array(AbaDaPlanilhaSchema) });
const RespostaSchema = z.union([
  z.strictObject({ ok: z.literal(true), resultado: z.unknown(), maxRssKb: z.number() }),
  z.strictObject({ ok: z.literal(false), codigo: z.enum(CODIGOS_DO_LEITOR), detalhe: z.enum(DETALHES_DO_ERRO).optional(), maxRssKb: z.number() }),
  z.strictObject({ ok: z.literal(false), infraestrutura: z.literal(true), maxRssKb: z.number() }),
]);

/**
 * Executa a leitura num processo filho (`child_process.fork`) com heap limitado, tempo máximo com
 * `SIGKILL` e saída com teto de bytes. Os bytes vão pelo stdin e a operação por IPC — nunca por
 * argumento ou ambiente (o filho recebe ambiente vazio). A saída é revalidada pelo schema estrito.
 */
export const executarNoFilho = (
  bytes: Uint8Array,
  operacao: OperacaoDePlanilha,
  opcoes: OpcoesInternas = {},
): Promise<{ resultado: Inspecao | LeituraDaAba; maxRssKb: number }> =>
  new Promise((resolver, rejeitar) => {
    const tetoDaSaida = opcoes.bytesDaSaida ?? LIMITES.bytesDaSaida;
    let filho: ChildProcess;
    try {
      filho = fork(opcoes.caminhoDoFilho ?? CAMINHO_DO_FILHO, [], {
        execArgv: [`--max-old-space-size=${opcoes.memoriaMb ?? LIMITES.memoriaMb}`, '--disallow-code-generation-from-strings', '--disable-proto=delete'],
        env: {},
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        serialization: 'json',
        windowsHide: true,
        ...(opcoes.execPath === undefined ? {} : { execPath: opcoes.execPath }),
      });
    } catch (erro) {
      rejeitar(new ErroDeInfraestrutura('Não foi possível iniciar o processo de leitura da planilha.', { cause: erro, motivo: 'PARTIDA' }));
      return;
    }

    let encerrado = false;
    let pronto = false;
    let motivo: 'PARTIDA' | 'TEMPO' | 'SAIDA' | null = null;
    const pedacos: Buffer[] = [];
    let recebidos = 0;
    let stderr = '';

    const matar = (porque: 'PARTIDA' | 'TEMPO' | 'SAIDA'): void => {
      motivo ??= porque;
      filho.kill('SIGKILL');
    };
    const partida = setTimeout(() => matar('PARTIDA'), opcoes.prazoDePartidaMs ?? PRAZO_DE_PARTIDA_MS);
    let relogio: NodeJS.Timeout | undefined;
    const terminar = (acao: () => void): void => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(partida);
      clearTimeout(relogio);
      if (filho.exitCode === null && filho.signalCode === null) filho.kill('SIGKILL');
      acao();
    };

    filho.on('error', (erro) => {
      terminar(() => rejeitar(new ErroDeInfraestrutura('Falha no processo de leitura da planilha.', { cause: erro, motivo: 'PROCESSO' })));
    });
    filho.on('message', (mensagem) => {
      if (mensagem !== PRONTO || pronto) return;
      pronto = true;
      clearTimeout(partida);
      relogio = setTimeout(() => matar('TEMPO'), opcoes.timeoutMs ?? LIMITES.tempoMs);
      filho.send(operacao, (erro) => {
        if (erro !== null) terminar(() => rejeitar(new ErroDeInfraestrutura('Canal com o processo de leitura quebrado.', { cause: erro, motivo: 'CANAL' })));
      });
    });
    filho.stdout?.on('data', (pedaco: Buffer) => {
      recebidos += pedaco.length;
      if (recebidos > tetoDaSaida) matar('SAIDA');
      else pedacos.push(pedaco);
    });
    filho.stderr?.on('data', (pedaco: Buffer) => {
      if (stderr.length < TETO_DO_STDERR) stderr += pedaco.toString('utf8', 0, TETO_DO_STDERR - stderr.length);
    });
    filho.stdin?.on('error', () => {
      // O filho pode morrer antes de ler tudo (memória, tempo); o desfecho vem do `close`.
    });
    filho.stdin?.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));

    filho.on('close', (codigo: number | null, sinal: NodeJS.Signals | null) => {
      terminar(() => {
        if (motivo === 'TEMPO' || motivo === 'SAIDA') {
          rejeitar(excedido(motivo));
          return;
        }
        if (!pronto) {
          rejeitar(new ErroDeInfraestrutura('O processo de leitura da planilha não iniciou a tempo.', { motivo: 'PARTIDA_ATRASADA' }));
          return;
        }
        let bruto: unknown;
        try {
          bruto = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
        } catch {
          // Morreu no meio do trabalho sem responder.
          rejeitar(
            morreuPorHeap(codigo, sinal, stderr)
              ? excedido('MEMORIA')
              : new ErroDeInfraestrutura('O processo de leitura da planilha terminou sem responder.', { motivo: 'SEM_RESPOSTA' }),
          );
          return;
        }
        try {
          resolver(interpretar(bruto, operacao));
        } catch (erro) {
          rejeitar(erro);
        }
      });
    });
  });

const interpretar = (bruto: unknown, operacao: OperacaoDePlanilha): { resultado: Inspecao | LeituraDaAba; maxRssKb: number } => {
  const resposta = RespostaSchema.safeParse(bruto);
  if (!resposta.success) throw new ErroDeInfraestrutura('Resposta inválida do processo de leitura.', { motivo: 'RESPOSTA_INVALIDA' });
  const r = resposta.data;
  if (r.ok) {
    const schema = operacao.tipo === 'inspecionar' ? InspecaoSchema : LeituraDaAbaSchema;
    const resultado = schema.safeParse(r.resultado);
    if (!resultado.success) throw new ErroDeInfraestrutura('Resultado inválido do processo de leitura.', { motivo: 'RESULTADO_INVALIDO' });
    return { resultado: resultado.data as Inspecao | LeituraDaAba, maxRssKb: r.maxRssKb };
  }
  if ('infraestrutura' in r) throw new ErroDeInfraestrutura('Falha interna do processo de leitura.', { motivo: 'FALHA_INTERNA' });
  throw new ErroDePlanilha(r.codigo, r.detalhe);
};

/**
 * Leitura de XLSX/ODS isolada em processo filho. Rejeita com `ErroDePlanilha` (código estável:
 * arquivo inválido, limite excedido, aba inexistente) ou `ErroDeInfraestrutura` (falha técnica,
 * pode repetir).
 */
export async function lerPlanilhaIsolada(bytes: Uint8Array, op: { tipo: 'inspecionar' }, opcoes?: OpcoesDoIsolamento): Promise<Inspecao>;
export async function lerPlanilhaIsolada(bytes: Uint8Array, op: { tipo: 'ler-aba'; abaPosicao: number }, opcoes?: OpcoesDoIsolamento): Promise<LeituraDaAba>;
export async function lerPlanilhaIsolada(bytes: Uint8Array, op: OperacaoDePlanilha, opcoes?: OpcoesDoIsolamento): Promise<Inspecao | LeituraDaAba>;
export async function lerPlanilhaIsolada(bytes: Uint8Array, op: OperacaoDePlanilha, opcoes: OpcoesDoIsolamento = {}): Promise<Inspecao | LeituraDaAba> {
  if (bytes.length > LIMITES.bytesDoArquivo) throw new ErroDePlanilha('ARQUIVO_ACIMA_DO_LIMITE', 'TAMANHO');
  if (!ehOperacao(op)) throw new ErroDePlanilha('ABA_INEXISTENTE', 'ABA');
  const { timeoutMs, memoriaMb } = opcoes;
  const { resultado } = await executarNoFilho(bytes, op, {
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(memoriaMb === undefined ? {} : { memoriaMb }),
  });
  return resultado;
}
