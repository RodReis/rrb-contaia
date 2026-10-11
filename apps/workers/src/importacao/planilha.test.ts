/**
 * Leitura de planilha no worker (SPEC-015 §3.2–§3.7, §7): configuração vinda da tentativa, vaga do
 * limitador do processo, erro do leitor → recusa do arquivo (código estável) ou falha técnica
 * (retentável), e o que a leitura grava na tentativa. O leitor é dublado.
 */
import type { LeituraDaAba } from '@contaia/domain';
import { ErroDeInfraestrutura, ErroDePlanilha } from '@contaia/planilhas';
import { describe, expect, it } from 'vitest';

import { motivoDaFalhaDaValidacao } from './falhas.js';
import {
  LEITURAS_SIMULTANEAS_DE_PLANILHA,
  LIMITADOR_DO_PROCESSO,
  LimitadorDeLeituras,
  analisarPlanilha,
  configuracaoDaPlanilha,
  leituraRegistravel,
} from './planilha.js';

const LEITURA: LeituraDaAba = {
  formato: 'XLSX',
  aba: { nome: 'Dados', posicao: 2, utilizavel: true },
  linhas: [],
  mesclas: [],
  totalDeLinhasOcultas: 0,
};

const adiado = <T>() => {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promessa = new Promise<T>((ok, falha) => {
    resolver = ok;
    rejeitar = falha;
  });
  return { promessa, resolver, rejeitar };
};

/** Esvazia a fila de microtarefas (as promessas já resolvidas encadeiam em poucas voltas), sem relógio. */
const umInstante = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('configuracaoDaPlanilha', () => {
  it('CSV (ou tentativa sem os campos de planilha) → null: o caminho do CSV não muda', () => {
    expect(configuracaoDaPlanilha({ formato: 'CSV', aba: null, linhaCabecalho: 1 })).toBeNull();
    expect(configuracaoDaPlanilha({})).toBeNull();
  });

  it('XLSX/ODS → posição da aba e linha do cabeçalho gravadas no envio', () => {
    expect(configuracaoDaPlanilha({ formato: 'XLSX', aba: { nome: 'Dados', posicao: 2 }, linhaCabecalho: 3 })).toEqual({ abaPosicao: 2, linhaCabecalho: 3 });
    expect(configuracaoDaPlanilha({ formato: 'ODS', aba: { nome: 'P', posicao: 1 }, linhaCabecalho: 1 })).toEqual({ abaPosicao: 1, linhaCabecalho: 1 });
  });
});

describe('LimitadorDeLeituras: teto do processo, o excedente ESPERA a vez', () => {
  it(`no máximo ${LEITURAS_SIMULTANEAS_DE_PLANILHA} ao mesmo tempo; os demais esperam (nenhum falha) e entram em ordem`, async () => {
    const limitador = new LimitadorDeLeituras(2);
    const tarefas = Array.from({ length: 5 }, () => adiado<number>());
    let emCurso = 0;
    let pico = 0;
    const ordem: number[] = [];

    const execucoes = tarefas.map((tarefa, i) =>
      limitador.executar(async () => {
        emCurso += 1;
        pico = Math.max(pico, emCurso);
        ordem.push(i);
        try {
          return await tarefa.promessa;
        } finally {
          emCurso -= 1;
        }
      }),
    );

    await umInstante();
    expect(ordem).toEqual([0, 1]);

    tarefas[1]!.resolver(1);
    await umInstante();
    expect(ordem).toEqual([0, 1, 2]);

    tarefas.forEach((tarefa, i) => tarefa.resolver(i));
    expect(await Promise.all(execucoes)).toEqual([0, 1, 2, 3, 4]);
    expect(pico).toBe(2);
    expect(ordem).toEqual([0, 1, 2, 3, 4]);
  });

  it('a vaga volta quando a tarefa falha (e o erro chega a quem chamou)', async () => {
    const limitador = new LimitadorDeLeituras(1);

    await expect(limitador.executar(() => Promise.reject(new Error('quebrou')))).rejects.toThrow('quebrou');
    await expect(limitador.executar(async () => 'depois')).resolves.toBe('depois');
  });

  it('o processo inteiro usa UM limitador de 2 vagas (plano e empregados somados)', () => {
    expect(LEITURAS_SIMULTANEAS_DE_PLANILHA).toBe(2);
  });
});

describe('analisarPlanilha: lê a aba na vaga e entrega à análise pura', () => {
  const config = { abaPosicao: 2, linhaCabecalho: 1 };
  const bytes = new Uint8Array([1, 2, 3]);

  it('lê a aba gravada na tentativa e devolve o que a análise produziu', async () => {
    const pedidas: number[] = [];
    const resultado = await analisarPlanilha(
      {
        lerPlanilha: async (recebidos, aba) => {
          expect(recebidos).toBe(bytes);
          pedidas.push(aba);
          return LEITURA;
        },
      },
      bytes,
      config,
      (leitura) => ({ tipo: 'LINHAS' as const, aba: leitura.aba.nome }),
    );

    expect(pedidas).toEqual([2]);
    expect(resultado).toEqual({ tipo: 'LINHAS', aba: 'Dados' });
  });

  it.each([
    'ARQUIVO_CORROMPIDO',
    'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO',
    'FORMATO_XLS_NAO_SUPORTADO',
    'FORMATO_XLSM_NAO_SUPORTADO',
    'EXTENSAO_DIFERENTE_DO_CONTEUDO',
    'ABA_INEXISTENTE',
    'LIMITE_DE_PROCESSAMENTO_EXCEDIDO',
    'ARQUIVO_ACIMA_DO_LIMITE',
    'ARQUIVO_VAZIO',
  ] as const)('defeito do arquivo no leitor (%s) → recusa do arquivo com o código estável, sem análise', async (codigo) => {
    let analisou = false;
    const resultado = await analisarPlanilha(
      { lerPlanilha: () => Promise.reject(new ErroDePlanilha(codigo, 'TEMPO')) },
      bytes,
      config,
      () => {
        analisou = true;
        return { tipo: 'LINHAS' as const };
      },
    );

    expect(resultado).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo });
    expect(analisou).toBe(false);
  });

  it('falha técnica do processo filho (ErroDeInfraestrutura) NÃO vira recusa: relança para o retry, com o código técnico genérico', async () => {
    const erro = new ErroDeInfraestrutura('o processo filho não subiu');
    const promessa = analisarPlanilha({ lerPlanilha: () => Promise.reject(erro) }, bytes, config, () => ({ tipo: 'LINHAS' as const }));

    await expect(promessa).rejects.toBe(erro);
    expect(motivoDaFalhaDaValidacao(erro)).toBe('FALHA_NA_VALIDACAO');
  });

  it('leitura presa ocupa a vaga; a falha libera a vaga para a próxima (limitador do processo)', async () => {
    const presa = adiado<LeituraDaAba>();
    let emCurso = 0;
    let pico = 0;
    const lerPlanilha = async (): Promise<LeituraDaAba> => {
      emCurso += 1;
      pico = Math.max(pico, emCurso);
      try {
        return await presa.promessa;
      } finally {
        emCurso -= 1;
      }
    };
    const analisar = () => ({ tipo: 'LINHAS' as const });

    const tres = [1, 2, 3].map(() => analisarPlanilha({ lerPlanilha }, bytes, config, analisar).catch((erro: unknown) => erro));
    await umInstante();
    expect(emCurso).toBe(2);

    presa.rejeitar(new ErroDeInfraestrutura('morreu'));
    const resultados = await Promise.all(tres);

    expect(pico).toBe(2);
    expect(resultados.every((r) => r instanceof ErroDeInfraestrutura)).toBe(true);
    await expect(analisarPlanilha({ lerPlanilha: async () => LEITURA }, bytes, config, analisar)).resolves.toEqual({ tipo: 'LINHAS' });
  });

  it('a análise pura roda DENTRO da vaga (a leitura grande não sobrevive fora dela)', async () => {
    let ocupadasNaAnalise = -1;
    await analisarPlanilha({ lerPlanilha: async () => LEITURA }, bytes, config, () => {
      ocupadasNaAnalise = LIMITADOR_DO_PROCESSO.ocupadas;
      return null;
    });

    expect(ocupadasNaAnalise).toBe(1);
    expect(LIMITADOR_DO_PROCESSO.ocupadas).toBe(0);
  });
});

describe('leituraRegistravel: o que vai para a tentativa (sem valor de célula)', () => {
  it('contagens e diagnósticos com texto fixo por código', () => {
    const registravel = leituraRegistravel({
      cabecalho: ['A', 'B'],
      registros: [],
      ignoradasAntesDoCabecalho: 2,
      ocultas: 1,
      cabecalhoMesclado: false,
      rejeicoesEstruturaisPorLinha: new Map([
        [5, { codigo: 'CELULA_COM_FORMULA', letra: 'B' }],
        [6, { codigo: 'CELULA_MESCLADA', letra: 'A' }],
        [7, { codigo: 'CELULA_MESCLADA', letra: 'A' }],
      ]),
    });

    expect(registravel).toEqual({
      linhasIgnoradasAntesDoCabecalho: 2,
      linhasOcultas: 1,
      diagnosticos: [
        { codigo: 'LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS', mensagem: expect.any(String), quantidade: 2 },
        { codigo: 'LINHAS_OCULTAS_PROCESSADAS', mensagem: expect.any(String), quantidade: 1 },
        { codigo: 'LINHAS_COM_FORMULA_REJEITADAS', mensagem: expect.any(String), quantidade: 1 },
        { codigo: 'LINHAS_COM_CELULA_MESCLADA_REJEITADAS', mensagem: expect.any(String), quantidade: 2 },
      ],
    });
  });
});
