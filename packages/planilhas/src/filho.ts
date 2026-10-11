/**
 * Processo filho da leitura de planilhas (`lerPlanilhaIsolada`). Recebe os bytes pelo stdin e a
 * operação por IPC, escreve uma única resposta JSON no stdout e sai. Nada de argumento, ambiente ou
 * log com conteúdo: o arquivo é dado não confiável e pode conter PII.
 */
import { ErroDePlanilha } from './erros.ts';
import { inspecionarPlanilha } from './inspecionar.ts';
import { lerAba } from './ler-aba.ts';
import { LIMITES } from './limites.ts';
import { PRONTO, ehOperacao, type Resposta } from './protocolo.ts';

const SAIDA_DO_CANAL_FECHADO = 70;

const pedacos: Buffer[] = [];
let recebidos = 0;
let fimDosBytes = false;
let operacao: unknown;
let respondido = false;

const maxRssKb = (): number => process.resourceUsage().maxRSS;

const responder = (resposta: Resposta): void => {
  if (respondido) return;
  respondido = true;
  let json = JSON.stringify(resposta);
  if (json.length > LIMITES.bytesDaSaida) {
    json = JSON.stringify({ ok: false, codigo: 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', detalhe: 'SAIDA', maxRssKb: maxRssKb() } satisfies Resposta);
  }
  process.stdout.write(json, () => process.exit(0));
};

const executar = (): void => {
  if (!fimDosBytes || operacao === undefined || respondido) return;
  if (!ehOperacao(operacao)) {
    responder({ ok: false, infraestrutura: true, maxRssKb: maxRssKb() });
    return;
  }
  try {
    const bytes = new Uint8Array(Buffer.concat(pedacos));
    pedacos.length = 0;
    const resultado = operacao.tipo === 'inspecionar' ? inspecionarPlanilha(bytes) : lerAba(bytes, operacao.abaPosicao);
    responder({ ok: true, resultado, maxRssKb: maxRssKb() });
  } catch (erro) {
    if (erro instanceof ErroDePlanilha) {
      responder({ ok: false, codigo: erro.codigo, ...(erro.detalhe === undefined ? {} : { detalhe: erro.detalhe }), maxRssKb: maxRssKb() });
    } else if (erro instanceof RangeError) {
      // Alocação recusada (string/array grande demais): o arquivo passou do que o processo comporta.
      responder({ ok: false, codigo: 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', detalhe: 'MEMORIA', maxRssKb: maxRssKb() });
    } else {
      responder({ ok: false, infraestrutura: true, maxRssKb: maxRssKb() });
    }
  }
};

process.on('disconnect', () => {
  if (!respondido) process.exit(SAIDA_DO_CANAL_FECHADO);
});
process.on('message', (mensagem: unknown) => {
  operacao = mensagem;
  executar();
});
process.stdin.on('data', (pedaco: Buffer) => {
  recebidos += pedaco.length;
  if (recebidos > LIMITES.bytesDoArquivo) {
    responder({ ok: false, codigo: 'ARQUIVO_ACIMA_DO_LIMITE', detalhe: 'TAMANHO', maxRssKb: maxRssKb() });
    return;
  }
  pedacos.push(pedaco);
});
process.stdin.on('end', () => {
  fimDosBytes = true;
  executar();
});
process.send?.(PRONTO);
