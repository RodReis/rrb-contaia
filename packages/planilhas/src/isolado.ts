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
  /** Tempo máximo do processo filho (padrão 30 s); estouro → `LIMITE_DE_PROCESSAMENTO_EXCEDIDO`. */
  readonly timeoutMs?: number;
  /** Heap máximo do filho em MB (padrão 512); estouro → `LIMITE_DE_PROCESSAMENTO_EXCEDIDO`. */
  readonly memoriaMb?: number;
}

/** Opções só para teste do próprio isolamento. */
interface OpcoesInternas extends OpcoesDoIsolamento {
  readonly caminhoDoFilho?: string;
  readonly execPath?: string;
  readonly bytesDaSaida?: number;
}

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
        stdio: ['pipe', 'pipe', 'ignore', 'ipc'],
        serialization: 'json',
        windowsHide: true,
        ...(opcoes.execPath === undefined ? {} : { execPath: opcoes.execPath }),
      });
    } catch (erro) {
      rejeitar(new ErroDeInfraestrutura('Não foi possível iniciar o processo de leitura da planilha.', { cause: erro }));
      return;
    }

    let encerrado = false;
    let pronto = false;
    let motivo: 'TEMPO' | 'SAIDA' | null = null;
    const pedacos: Buffer[] = [];
    let recebidos = 0;

    const matar = (porque: 'TEMPO' | 'SAIDA'): void => {
      motivo ??= porque;
      filho.kill('SIGKILL');
    };
    const relogio = setTimeout(() => matar('TEMPO'), opcoes.timeoutMs ?? LIMITES.tempoMs);
    const terminar = (acao: () => void): void => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(relogio);
      if (filho.exitCode === null && filho.signalCode === null) filho.kill('SIGKILL');
      acao();
    };

    filho.on('error', (erro) => {
      terminar(() => rejeitar(new ErroDeInfraestrutura('Falha no processo de leitura da planilha.', { cause: erro })));
    });
    filho.on('message', (mensagem) => {
      if (mensagem !== PRONTO || pronto) return;
      pronto = true;
      filho.send(operacao, (erro) => {
        if (erro !== null) terminar(() => rejeitar(new ErroDeInfraestrutura('Canal com o processo de leitura quebrado.', { cause: erro })));
      });
    });
    filho.stdout?.on('data', (pedaco: Buffer) => {
      recebidos += pedaco.length;
      if (recebidos > tetoDaSaida) matar('SAIDA');
      else pedacos.push(pedaco);
    });
    filho.stdin?.on('error', () => {
      // O filho pode morrer antes de ler tudo (memória, tempo); o desfecho vem do `close`.
    });
    filho.stdin?.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));

    filho.on('close', () => {
      terminar(() => {
        if (motivo !== null) {
          rejeitar(excedido(motivo));
          return;
        }
        if (!pronto) {
          rejeitar(new ErroDeInfraestrutura('O processo de leitura da planilha não iniciou.'));
          return;
        }
        let bruto: unknown;
        try {
          bruto = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
        } catch {
          // Morreu no meio do trabalho sem responder: heap esgotado (o V8 aborta o processo).
          rejeitar(excedido('MEMORIA'));
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
  if (!resposta.success) throw new ErroDeInfraestrutura('Resposta inválida do processo de leitura.');
  const r = resposta.data;
  if (r.ok) {
    const schema = operacao.tipo === 'inspecionar' ? InspecaoSchema : LeituraDaAbaSchema;
    const resultado = schema.safeParse(r.resultado);
    if (!resultado.success) throw new ErroDeInfraestrutura('Resultado inválido do processo de leitura.');
    return { resultado: resultado.data as Inspecao | LeituraDaAba, maxRssKb: r.maxRssKb };
  }
  if ('infraestrutura' in r) throw new ErroDeInfraestrutura('Falha interna do processo de leitura.');
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
