import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as processosFilhos from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ErroDeInfraestrutura } from './erros.ts';
import { executarNoFilho, lerPlanilhaIsolada } from './isolado.ts';
import { lerAba } from './ler-aba.ts';
import { LIMITES } from './limites.ts';
import { abaXml, celulaOds as sc, conteudoOds, entradaBomba, ods, sstXml, tabelaOds, xlsx, xlsxCru } from './testes/construtores.ts';
import { PRAZO_DO_TESTE_MS, TETO_DE_RELOGIO_MS, esperarErroAssincrono } from './testes/esperar.ts';

/** Filhos falsos para cada forma de término (scripts gerados em diretório temporário próprio). */
const RESPOSTA_OK = JSON.stringify({ ok: true, resultado: { formato: 'XLSX', abas: [] }, maxRssKb: 1 });
const FILHOS_FALSOS = {
  semPronto: 'setInterval(() => {}, 1000);',
  prontoAtrasado: `setTimeout(() => process.send('pronto'), 2800); process.on('message', () => process.stdout.write(${JSON.stringify(RESPOSTA_OK)}, () => process.exit(0)));`,
  excecao: `process.send('pronto'); process.on('message', () => setTimeout(() => { throw new Error('bug'); }, 10));`,
  saiCom1: `process.send('pronto'); process.on('message', () => process.exit(1));`,
  oom: `process.send('pronto'); process.on('message', () => process.stderr.write('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', () => process.exit(134)));`,
} as const;
let diretorioDosFalsos = '';
const falso = (nome: keyof typeof FILHOS_FALSOS): string => join(diretorioDosFalsos, `${nome}.mjs`);
beforeAll(() => {
  diretorioDosFalsos = mkdtempSync(join(tmpdir(), 'planilhas-filhos-'));
  for (const [nome, codigo] of Object.entries(FILHOS_FALSOS)) writeFileSync(join(diretorioDosFalsos, `${nome}.mjs`), codigo);
});
afterAll(() => {
  rmSync(diretorioDosFalsos, { recursive: true, force: true });
});

vi.mock('node:child_process', async (original) => {
  const real = await original<typeof processosFilhos>();
  return { ...real, fork: vi.fn(real.fork) };
});

const PEQUENA = xlsx({ textos: ['codigo', '00123'], abas: [{ nome: 'Dados', xml: abaXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row>') }] });

const LINHAS = 10_000;
const COLUNAS_DE_TEXTO = 11;
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const aleatorio = (n: number): string => {
  const bytes = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALFABETO[(bytes[i] ?? 0) % ALFABETO.length];
  return s;
};
const letra = (i: number): string => String.fromCharCode(65 + i);

/** ~10 MB, 10.000 linhas × 15 colunas (como o big.xlsx/big.ods da avaliação). */
const xlsxGrande = (): Uint8Array => {
  const textos: string[] = [];
  const linhas: string[] = [];
  for (let r = 1; r <= LINHAS + 1; r++) {
    let celulas = '';
    if (r === 1) {
      for (let c = 0; c < 4 + COLUNAS_DE_TEXTO; c++) {
        textos.push(`h${c}`);
        celulas += `<c r="${letra(c)}1" t="s"><v>${textos.length - 1}</v></c>`;
      }
    } else {
      textos.push(String(r).padStart(7, '0'));
      celulas += `<c r="A${r}" t="s"><v>${textos.length - 1}</v></c><c r="B${r}" s="2"><v>${52998224725 + r}</v></c><c r="C${r}" s="1"><v>${44000 + (r % 3000)}</v></c><c r="D${r}"><v>${(r * 1.25).toFixed(2)}</v></c>`;
      for (let c = 0; c < COLUNAS_DE_TEXTO; c++) {
        textos.push(aleatorio(110));
        celulas += `<c r="${letra(4 + c)}${r}" t="s"><v>${textos.length - 1}</v></c>`;
      }
    }
    linhas.push(`<row r="${r}">${celulas}</row>`);
  }
  return xlsx({ sstXml: sstXml(textos), abas: [{ nome: 'Dados', xml: abaXml(linhas.join('')) }] });
};

const odsGrande = (): Uint8Array => {
  const linhas: string[] = [];
  for (let r = 1; r <= LINHAS + 1; r++) {
    let celulas = '';
    if (r === 1) for (let c = 0; c < 4 + COLUNAS_DE_TEXTO; c++) celulas += sc(`h${c}`);
    else {
      celulas += sc(String(r).padStart(7, '0'));
      celulas += `<table:table-cell office:value-type="float" office:value="${52998224725 + r}"><text:p>${String(52998224725 + r).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/u, '$1.$2.$3-$4')}</text:p></table:table-cell>`;
      celulas += `<table:table-cell office:value-type="date" office:date-value="2020-06-01"><text:p>01/06/2020</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="${(r * 1.25).toFixed(2)}"><text:p>${(r * 1.25).toFixed(2)}</text:p></table:table-cell>`;
      for (let c = 0; c < COLUNAS_DE_TEXTO; c++) celulas += sc(aleatorio(110));
    }
    linhas.push(`<table:table-row>${celulas}</table:table-row>`);
  }
  return ods(conteudoOds(tabelaOds('Dados', linhas.join(''))));
};

describe('lerPlanilhaIsolada — processo filho', () => {
  it('inspeção e leitura devolvem o mesmo que a leitura direta', async () => {
    expect(await lerPlanilhaIsolada(PEQUENA, { tipo: 'inspecionar' })).toEqual({
      formato: 'XLSX',
      abas: [{ nome: 'Dados', posicao: 1, utilizavel: true }],
    });
    expect(await lerPlanilhaIsolada(PEQUENA, { tipo: 'ler-aba', abaPosicao: 1 })).toEqual(lerAba(PEQUENA, 1));
  });

  it('erro do arquivo volta como ErroDePlanilha com o código estável', async () => {
    await esperarErroAssincrono(lerPlanilhaIsolada(PEQUENA, { tipo: 'ler-aba', abaPosicao: 9 }), 'ABA_INEXISTENTE');
    await esperarErroAssincrono(lerPlanilhaIsolada(xlsxCru([entradaBomba('xl/sharedStrings.xml', 200, 4096)]), { tipo: 'ler-aba', abaPosicao: 1 }), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO');
    await esperarErroAssincrono(lerPlanilhaIsolada(new TextEncoder().encode('a;b\n1;2'), { tipo: 'inspecionar' }), 'EXTENSAO_DIFERENTE_DO_CONTEUDO');
  });

  it('arquivo acima de 10 MB é recusado antes de subir o processo', async () => {
    const chamadas = vi.mocked(processosFilhos.fork).mock.calls.length;
    await esperarErroAssincrono(lerPlanilhaIsolada(new Uint8Array(LIMITES.bytesDoArquivo + 1), { tipo: 'inspecionar' }), 'ARQUIVO_ACIMA_DO_LIMITE');
    expect(vi.mocked(processosFilhos.fork).mock.calls.length).toBe(chamadas);
  });

  it('posição de aba inválida é recusada antes de subir o processo', async () => {
    await esperarErroAssincrono(lerPlanilhaIsolada(PEQUENA, { tipo: 'ler-aba', abaPosicao: 0 }), 'ABA_INEXISTENTE');
  });

  it('nenhum byte do arquivo nem PII vai em argumento ou ambiente do filho', async () => {
    const marcador = '52998224725-MARIA';
    const bytes = xlsx({ textos: [marcador], abas: [{ nome: 'Dados', xml: abaXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }] });
    vi.mocked(processosFilhos.fork).mockClear();
    await lerPlanilhaIsolada(bytes, { tipo: 'ler-aba', abaPosicao: 1 });
    const [caminho, argumentos, opcoes] = vi.mocked(processosFilhos.fork).mock.calls[0] ?? [];
    const tudo = JSON.stringify([caminho, argumentos, opcoes]);
    expect(tudo).not.toContain(marcador);
    expect(tudo).not.toContain(Buffer.from(bytes).toString('base64').slice(0, 40));
    expect(argumentos).toEqual([]);
    expect(opcoes).toMatchObject({ env: {} });
    expect((opcoes as { execArgv: string[] }).execArgv).toContain('--max-old-space-size=512');
  });

  it('falha ao subir o processo → ErroDeInfraestrutura', async () => {
    await expect(executarNoFilho(PEQUENA, { tipo: 'inspecionar' }, { execPath: 'C:/nao/existe/node.exe' })).rejects.toBeInstanceOf(ErroDeInfraestrutura);
    await expect(executarNoFilho(PEQUENA, { tipo: 'inspecionar' }, { caminhoDoFilho: 'C:/nao/existe/filho.js' })).rejects.toBeInstanceOf(ErroDeInfraestrutura);
  });

  it('saída acima do teto: o filho é morto → LIMITE', async () => {
    await esperarErroAssincrono(executarNoFilho(PEQUENA, { tipo: 'ler-aba', abaPosicao: 1 }, { bytesDaSaida: 64 }), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'SAIDA');
  });

  describe('término do filho: limite (não retentável) × infraestrutura (retentável)', () => {
    it('não ficou pronto dentro do prazo de partida → ErroDeInfraestrutura (não é limite do arquivo)', async () => {
      const inicio = performance.now();
      await expect(executarNoFilho(PEQUENA, { tipo: 'inspecionar' }, { caminhoDoFilho: falso('semPronto'), prazoDePartidaMs: 300 })).rejects.toBeInstanceOf(ErroDeInfraestrutura);
      expect(performance.now() - inicio).toBeLessThan(TETO_DE_RELOGIO_MS); // sem o prazo de partida, esperaria os 30 s do trabalho
    }, PRAZO_DO_TESTE_MS);

    it('o prazo do trabalho só conta depois do pronto (partida lenta não estoura o tempo do arquivo)', async () => {
      const { resultado } = await executarNoFilho(PEQUENA, { tipo: 'inspecionar' }, { caminhoDoFilho: falso('prontoAtrasado'), timeoutMs: 2_500 });
      expect(resultado).toEqual({ formato: 'XLSX', abas: [] });
    }, 15_000); // partida (2,8 s) > prazo do trabalho (2,5 s): só passa se o prazo conta a partir do pronto

    it('exceção não tratada no filho → ErroDeInfraestrutura', async () => {
      await expect(executarNoFilho(PEQUENA, { tipo: 'inspecionar' }, { caminhoDoFilho: falso('excecao') })).rejects.toBeInstanceOf(ErroDeInfraestrutura);
    });

    it('saída inesperada com código 1 → ErroDeInfraestrutura', async () => {
      await expect(executarNoFilho(PEQUENA, { tipo: 'inspecionar' }, { caminhoDoFilho: falso('saiCom1') })).rejects.toBeInstanceOf(ErroDeInfraestrutura);
    });

    it('abort do V8 por heap (código 134 / mensagem de OOM) → LIMITE (MEMORIA)', async () => {
      await esperarErroAssincrono(executarNoFilho(PEQUENA, { tipo: 'inspecionar' }, { caminhoDoFilho: falso('oom') }), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'MEMORIA');
    });
  });

  describe('carga de ~10 MB e 10.000 linhas', () => {
    let grandeXlsx: Uint8Array;
    let grandeOds: Uint8Array;
    beforeAll(() => {
      grandeXlsx = xlsxGrande();
      grandeOds = odsGrande();
    }, 60_000);

    it.each(['XLSX', 'ODS'] as const)('%s: lê com pico de memória do filho < 400 MB (tempo só no log)', async (formato) => {
      const bytes = formato === 'XLSX' ? grandeXlsx : grandeOds;
      expect(bytes.length).toBeGreaterThan(8 * 1024 * 1024);
      expect(bytes.length).toBeLessThanOrEqual(LIMITES.bytesDoArquivo);
      const inicio = performance.now();
      const { resultado, maxRssKb } = await executarNoFilho(bytes, { tipo: 'ler-aba', abaPosicao: 1 });
      const ms = performance.now() - inicio;
      expect('linhas' in resultado && resultado.linhas.length).toBe(LINHAS + 1);
      expect(maxRssKb / 1024).toBeLessThan(400);
      console.warn(`[desempenho] ${formato} ${(bytes.length / 1048576).toFixed(2)} MB: ${ms.toFixed(0)} ms, RSS do filho ${(maxRssKb / 1024).toFixed(0)} MB`);
    }, PRAZO_DO_TESTE_MS);

    it('estouro de tempo: o filho é morto, o teste segue vivo → LIMITE', async () => {
      await esperarErroAssincrono(lerPlanilhaIsolada(grandeXlsx, { tipo: 'ler-aba', abaPosicao: 1 }, { timeoutMs: 150 }), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'TEMPO');
      expect(process.memoryUsage().rss).toBeGreaterThan(0);
    });

    it('término externo (SIGTERM de desligamento) no meio do trabalho → ErroDeInfraestrutura', async () => {
      const leitura = lerPlanilhaIsolada(grandeXlsx, { tipo: 'ler-aba', abaPosicao: 1 });
      const filho = vi.mocked(processosFilhos.fork).mock.results.at(-1)?.value as processosFilhos.ChildProcess;
      filho.once('message', () => setTimeout(() => filho.kill('SIGTERM'), 50));
      await expect(leitura).rejects.toBeInstanceOf(ErroDeInfraestrutura);
    });

    it('estouro de memória: o filho morre por falta de heap, o teste segue vivo → LIMITE', async () => {
      await esperarErroAssincrono(lerPlanilhaIsolada(grandeXlsx, { tipo: 'ler-aba', abaPosicao: 1 }, { memoriaMb: 32 }), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'MEMORIA');
      expect(await lerPlanilhaIsolada(PEQUENA, { tipo: 'inspecionar' })).toMatchObject({ formato: 'XLSX' });
    }, 20_000);
  });
});
