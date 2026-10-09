/**
 * Desempenho e equivalência da validação hierárquica (SPEC-013 §3.2, §3.4).
 *
 * O worker valida até 10.000 linhas no event loop: a resolução da hierarquia precisa ser linear.
 * A implementação anterior (ponto fixo com `aceitas.some` dentro do laço das pendentes) fica AQUI,
 * só como oráculo da propriedade de equivalência nos casos em que as regras não mudaram.
 */
import { describe, expect, it } from 'vitest';

import { validarLinhasDoPlano } from './validacao.js';
import type {
  ContaVigente,
  LinhaAceita,
  LinhaBrutaDeEntrada,
  LinhaDeEntrada,
  LinhaRejeitada,
  ResultadoDaValidacao,
} from './validacao.js';

const LIMITE_GENEROSO_EM_MS = 1000;
const LINHAS_NO_LIMITE = 10_000;

const medir = (executar: () => ResultadoDaValidacao): { resultado: ResultadoDaValidacao; ms: number } => {
  const inicio = performance.now();
  const resultado = executar();
  return { resultado, ms: performance.now() - inicio };
};

describe('validarLinhasDoPlano — desempenho no limite do arquivo (SPEC-013 §3.2)', () => {
  it('cadeia de 10.000 linhas em ordem invertida (filhas antes dos pais) termina em menos de 1 s', () => {
    const linhas: LinhaBrutaDeEntrada[] = [];
    for (let i = LINHAS_NO_LIMITE - 1; i >= 0; i -= 1) {
      linhas.push({
        numeroDaLinha: LINHAS_NO_LIMITE - i + 1,
        codigo: `C${i}`,
        nome: `Conta ${i}`,
        tipo: i === LINHAS_NO_LIMITE - 1 ? 'analitica' : 'sintetica',
        natureza: 'devedora',
        contaPai: i === 0 ? null : `C${i - 1}`,
      });
    }

    const { resultado, ms } = medir(() => validarLinhasDoPlano({ linhas, contasVigentes: [] }));

    expect(resultado.rejeitadas).toEqual([]);
    expect(resultado.aceitas).toHaveLength(LINHAS_NO_LIMITE);
    expect(ms).toBeLessThan(LIMITE_GENEROSO_EM_MS);
  });

  it('cadeia de 10.000 linhas pendurada numa cadeia vigente profunda termina em menos de 1 s', () => {
    const contasVigentes: ContaVigente[] = [];
    for (let i = 0; i < LINHAS_NO_LIMITE; i += 1) {
      contasVigentes.push({
        codigo: `V${i}`,
        tipo: 'sintetica',
        arquivada: false,
        temFilhas: i < LINHAS_NO_LIMITE - 1,
        contaPai: i === 0 ? null : `V${i - 1}`,
      });
    }
    const linhas: LinhaBrutaDeEntrada[] = [];
    for (let i = LINHAS_NO_LIMITE - 1; i >= 0; i -= 1) {
      linhas.push({
        numeroDaLinha: LINHAS_NO_LIMITE - i + 1,
        codigo: `N${i}`,
        nome: `Nova ${i}`,
        tipo: 'sintetica',
        natureza: 'credora',
        contaPai: i === 0 ? `V${LINHAS_NO_LIMITE - 1}` : `N${i - 1}`,
      });
    }

    const { resultado, ms } = medir(() => validarLinhasDoPlano({ linhas, contasVigentes }));

    expect(resultado.aceitas).toHaveLength(LINHAS_NO_LIMITE);
    expect(ms).toBeLessThan(LIMITE_GENEROSO_EM_MS);
  });

  it('ciclo de 10.000 linhas é rejeitado inteiro em menos de 1 s', () => {
    const linhas: LinhaBrutaDeEntrada[] = [];
    for (let i = 0; i < LINHAS_NO_LIMITE; i += 1) {
      linhas.push({
        numeroDaLinha: i + 2,
        codigo: `C${i}`,
        nome: `Conta ${i}`,
        tipo: 'sintetica',
        natureza: 'devedora',
        contaPai: `C${(i + 1) % LINHAS_NO_LIMITE}`,
      });
    }

    const { resultado, ms } = medir(() => validarLinhasDoPlano({ linhas, contasVigentes: [] }));

    expect(resultado.aceitas).toEqual([]);
    expect(resultado.rejeitadas.every((r) => r.codigoDeErro === 'CICLO_HIERARQUICO')).toBe(true);
    expect(resultado.rejeitadas).toHaveLength(LINHAS_NO_LIMITE);
    expect(ms).toBeLessThan(LIMITE_GENEROSO_EM_MS);
  });

  /**
   * Cascata adversária (válida): vigente `R ← C1 ← … ← Cm ← [T1 ← … ← Tt]` e o lote põe cada `Ci`
   * sob a folha. Cada rodada recusa UMA linha, que volta ao pai antigo e fecha um ciclo um pouco
   * maior; sem atalhos na busca de ciclos o custo era quadrático (9.999 linhas: 8,6 s; com 10.000
   * vigentes na cauda: 33,5 s, acima do lockDuration padrão do BullMQ).
   */
  const cascataAdversaria = (m: number, cauda: number) => {
    const contasVigentes: ContaVigente[] = [{ codigo: 'R', tipo: 'sintetica', arquivada: false, temFilhas: true, contaPai: null }];
    for (let i = 1; i <= m; i += 1) {
      contasVigentes.push({ codigo: `C${i}`, tipo: 'sintetica', arquivada: false, temFilhas: true, contaPai: i === 1 ? 'R' : `C${i - 1}` });
    }
    for (let j = 1; j <= cauda; j += 1) {
      contasVigentes.push({
        codigo: `T${j}`,
        tipo: 'sintetica',
        arquivada: false,
        temFilhas: j < cauda,
        contaPai: j === 1 ? `C${m}` : `T${j - 1}`,
      });
    }
    const folha = cauda === 0 ? `C${m + 1}` : `T${cauda}`;
    if (cauda === 0) {
      contasVigentes.push({ codigo: folha, tipo: 'sintetica', arquivada: false, temFilhas: false, contaPai: `C${m}` });
    }
    const linhas: LinhaBrutaDeEntrada[] = [];
    for (let i = 1; i <= m; i += 1) {
      linhas.push({ numeroDaLinha: i + 1, codigo: `C${i}`, nome: `Conta ${i}`, tipo: 'sintetica', natureza: 'devedora', contaPai: folha });
    }
    return { linhas, contasVigentes };
  };

  it('cascata 9.999: toda linha cai em ciclo e a validação termina em menos de 1 s', () => {
    const entrada = cascataAdversaria(9_999, 0);

    const { resultado, ms } = medir(() => validarLinhasDoPlano(entrada));

    expect(resultado.aceitas).toEqual([]);
    expect(resultado.rejeitadas).toHaveLength(9_999);
    expect(resultado.rejeitadas.every((r) => r.codigoDeErro === 'CICLO_HIERARQUICO')).toBe(true);
    expect(ms).toBeLessThan(LIMITE_GENEROSO_EM_MS);
  });

  it('cascata com cauda vigente (10.000 vigentes pendurados): menos de 1 s', () => {
    const entrada = cascataAdversaria(9_999, 10_000);

    const { resultado, ms } = medir(() => validarLinhasDoPlano(entrada));

    expect(resultado.aceitas).toEqual([]);
    expect(resultado.rejeitadas).toHaveLength(9_999);
    expect(resultado.rejeitadas.every((r) => r.codigoDeErro === 'CICLO_HIERARQUICO')).toBe(true);
    expect(ms).toBeLessThan(LIMITE_GENEROSO_EM_MS);
  });

  it('árvore larga (1 raiz e 9.999 filhas listadas antes dela) termina em menos de 1 s', () => {
    const linhas: LinhaBrutaDeEntrada[] = [];
    for (let i = 1; i < LINHAS_NO_LIMITE; i += 1) {
      linhas.push({
        numeroDaLinha: i + 1,
        codigo: `R.${i}`,
        nome: `Filha ${i}`,
        tipo: 'analitica',
        natureza: 'devedora',
        contaPai: 'R',
      });
    }
    linhas.push({ numeroDaLinha: LINHAS_NO_LIMITE + 1, codigo: 'R', nome: 'Raiz', tipo: 'sintetica', natureza: 'devedora', contaPai: null });

    const { resultado, ms } = medir(() => validarLinhasDoPlano({ linhas, contasVigentes: [] }));

    expect(resultado.rejeitadas).toEqual([]);
    expect(resultado.aceitas).toHaveLength(LINHAS_NO_LIMITE);
    expect(ms).toBeLessThan(LIMITE_GENEROSO_EM_MS);
  });
});

// ---------------------------------------------------------------------------------------------
// Oráculo: a implementação anterior, preservada só aqui, com duas correções de regra que a
// reescrita também faz (ambas pela letra da SPEC; a hierarquia em si fica como era):
// 1. a detecção de ciclo marcava também a linha que só APONTA para um ciclo (o teste
//    `visitados.has(inicial)` é sempre verdadeiro); a SPEC §7 rejeita por ciclo "as linhas que
//    formam o ciclo", e a que pende dele recebe CONTA_PAI_REJEITADA (`atual === inicial`);
// 2. a repetição de código contava só as linhas com campos válidos; com uma ocorrência inválida e
//    outra válida, a válida era aceita e a filha dela dependia da ordem física do arquivo.
// ---------------------------------------------------------------------------------------------

const TIPOS = ['analitica', 'sintetica'];
const NATUREZAS = ['devedora', 'credora'];
const CAMPO_DO_ERRO_ANTIGO: Readonly<Record<LinhaRejeitada['codigoDeErro'], string | null>> = {
  CAMPO_OBRIGATORIO_AUSENTE: null,
  VALOR_FORA_DO_DOMINIO: null,
  CODIGO_DUPLICADO_NO_ARQUIVO: 'codigo',
  CONTA_PAI_INEXISTENTE: 'conta_pai',
  CONTA_PAI_REJEITADA: 'conta_pai',
  CICLO_HIERARQUICO: 'conta_pai',
  SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA: 'tipo',
  CONTA_ARQUIVADA: 'codigo',
};

const rejeicaoAntiga = (
  linha: LinhaBrutaDeEntrada,
  codigoDeErro: LinhaRejeitada['codigoDeErro'],
  campo: string | null = CAMPO_DO_ERRO_ANTIGO[codigoDeErro],
): LinhaRejeitada => ({ numeroDaLinha: linha.numeroDaLinha, codigo: linha.codigo || null, campo, codigoDeErro });

const camposAntigos = (linha: LinhaBrutaDeEntrada): LinhaRejeitada | LinhaDeEntrada => {
  if (!linha.codigo) return rejeicaoAntiga(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'codigo');
  if (!linha.nome) return rejeicaoAntiga(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'nome');
  if (!linha.tipo) return rejeicaoAntiga(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'tipo');
  if (!TIPOS.includes(linha.tipo)) return rejeicaoAntiga(linha, 'VALOR_FORA_DO_DOMINIO', 'tipo');
  if (!linha.natureza) return rejeicaoAntiga(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'natureza');
  if (!NATUREZAS.includes(linha.natureza)) return rejeicaoAntiga(linha, 'VALOR_FORA_DO_DOMINIO', 'natureza');
  return linha as LinhaDeEntrada;
};

const validarComOAlgoritmoAntigo = (entrada: {
  readonly linhas: readonly LinhaBrutaDeEntrada[];
  readonly contasVigentes: readonly ContaVigente[];
}): ResultadoDaValidacao => {
  const rejeitadas: LinhaRejeitada[] = [];
  const vigentePorCodigo = new Map(entrada.contasVigentes.map((c) => [c.codigo, c]));

  const comCamposValidos: LinhaDeEntrada[] = [];
  for (const linha of entrada.linhas) {
    const resultado = camposAntigos(linha);
    if ('codigoDeErro' in resultado) rejeitadas.push(resultado);
    else comCamposValidos.push(resultado);
  }

  // Correção 2: a repetição conta TODAS as linhas com o código (SPEC §3.4 "aparece mais de uma vez
  // no arquivo"), não só as que passaram nos campos.
  const repeticoes = new Map<string, number>();
  for (const linha of entrada.linhas) {
    if (linha.codigo) repeticoes.set(linha.codigo, (repeticoes.get(linha.codigo) ?? 0) + 1);
  }
  const ocorrencias = new Map<string, LinhaDeEntrada[]>();
  for (const linha of comCamposValidos) {
    ocorrencias.set(linha.codigo, [...(ocorrencias.get(linha.codigo) ?? []), linha]);
  }
  const semDuplicidade: LinhaDeEntrada[] = [];
  for (const [codigo, lista] of ocorrencias) {
    if ((repeticoes.get(codigo) ?? 0) > 1) for (const linha of lista) rejeitadas.push(rejeicaoAntiga(linha, 'CODIGO_DUPLICADO_NO_ARQUIVO'));
    else semDuplicidade.push(lista[0]!);
  }

  const semConflitoVigente: LinhaDeEntrada[] = [];
  for (const linha of semDuplicidade) {
    const vig = vigentePorCodigo.get(linha.codigo);
    if (vig?.arquivada) {
      rejeitadas.push(rejeicaoAntiga(linha, 'CONTA_ARQUIVADA'));
      continue;
    }
    if (vig?.temFilhas && vig.tipo === 'sintetica' && linha.tipo === 'analitica') {
      rejeitadas.push(rejeicaoAntiga(linha, 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA'));
      continue;
    }
    semConflitoVigente.push(linha);
  }

  const codigosCandidatos = new Set(semConflitoVigente.map((l) => l.codigo));
  const paraCiclo = semConflitoVigente.filter((l) => l.contaPai === null || codigosCandidatos.has(l.contaPai));
  const paiPorCodigo = new Map<string, string | null>(paraCiclo.map((l) => [l.codigo, l.contaPai]));
  const emCiclo = new Set<string>();
  for (const inicial of paraCiclo) {
    const visitados = new Set<string>();
    let atual: string | null = inicial.codigo;
    while (atual !== null) {
      if (visitados.has(atual)) {
        if (atual === inicial.codigo) emCiclo.add(inicial.codigo);
        break;
      }
      visitados.add(atual);
      const proximo = paiPorCodigo.get(atual);
      atual = proximo === undefined ? null : proximo;
    }
  }
  const semCiclo: LinhaDeEntrada[] = [];
  for (const linha of semConflitoVigente) {
    if (emCiclo.has(linha.codigo)) rejeitadas.push(rejeicaoAntiga(linha, 'CICLO_HIERARQUICO'));
    else semCiclo.push(linha);
  }

  const validosNoLote = new Set(semCiclo.map((l) => l.codigo));
  const rejeitados = new Set(rejeitadas.map((r) => r.codigo).filter((c): c is string => c !== null));
  const pendentes = new Map(semCiclo.map((l) => [l.codigo, l]));
  const aceitas: LinhaAceita[] = [];
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [codigo, linha] of pendentes) {
      if (linha.contaPai === null) {
        aceitas.push(linha);
        pendentes.delete(codigo);
        mudou = true;
        continue;
      }
      if (vigentePorCodigo.has(linha.contaPai) && !vigentePorCodigo.get(linha.contaPai)?.arquivada) {
        aceitas.push(linha);
        pendentes.delete(codigo);
        mudou = true;
        continue;
      }
      if (aceitas.some((a) => a.codigo === linha.contaPai)) {
        aceitas.push(linha);
        pendentes.delete(codigo);
        mudou = true;
        continue;
      }
      if ((rejeitados.has(linha.contaPai) || !validosNoLote.has(linha.contaPai)) && !vigentePorCodigo.has(linha.contaPai)) {
        rejeitadas.push(rejeicaoAntiga(linha, rejeitados.has(linha.contaPai) ? 'CONTA_PAI_REJEITADA' : 'CONTA_PAI_INEXISTENTE'));
        rejeitados.add(linha.codigo);
        pendentes.delete(codigo);
        mudou = true;
      }
    }
  }
  for (const [, linha] of pendentes) rejeitadas.push(rejeicaoAntiga(linha, 'CONTA_PAI_INEXISTENTE'));

  aceitas.sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);
  rejeitadas.sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);
  return { aceitas, rejeitadas };
};

/** PRNG determinístico (mulberry32): a propriedade roda sempre os mesmos lotes. */
const criarSorteio = (semente: number): (() => number) => {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const CODIGOS_DO_LOTE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
// Plano vigente fora do alcance das regras novas: raízes sintéticas que o lote não reescreve
// (ciclo com o vigente, pai rejeitado que existe no vigente e analítica com filhas não se
// aplicam). Pai arquivado fica de fora: a neta de uma conta arquivada era CONTA_PAI_INEXISTENTE
// por um atalho da implementação antiga e agora é CONTA_PAI_REJEITADA (pai rejeitado no lote).
const VIGENTES_DO_ORACULO: readonly ContaVigente[] = [
  { codigo: 'V1', tipo: 'sintetica', arquivada: false, temFilhas: false, contaPai: null },
  { codigo: 'V2', tipo: 'sintetica', arquivada: false, temFilhas: true, contaPai: null },
];

const sortearLote = (sorteio: () => number): LinhaBrutaDeEntrada[] => {
  const escolher = <T,>(lista: readonly T[]): T => lista[Math.floor(sorteio() * lista.length)]!;
  const quantidade = 1 + Math.floor(sorteio() * 12);
  const linhas: LinhaBrutaDeEntrada[] = [];
  for (let i = 0; i < quantidade; i += 1) {
    const sorte = sorteio();
    const contaPai =
      sorte < 0.25 ? null : sorte < 0.8 ? escolher(CODIGOS_DO_LOTE) : sorte < 0.92 ? escolher(['V1', 'V2']) : 'Z';
    const defeito = sorteio();
    linhas.push({
      numeroDaLinha: i + 2,
      codigo: defeito < 0.03 ? '' : escolher(CODIGOS_DO_LOTE),
      nome: defeito >= 0.03 && defeito < 0.1 ? '' : `Conta ${i}`,
      // Só sintética entre as válidas: a regra nova "analítica não tem filhas" fica fora do oráculo.
      tipo: defeito >= 0.1 && defeito < 0.15 ? 'grupo' : 'sintetica',
      natureza: defeito >= 0.15 && defeito < 0.18 ? '' : escolher(NATUREZAS),
      contaPai,
    });
  }
  return linhas;
};

describe('validarLinhasDoPlano — equivalência com a implementação anterior (propriedade, semente fixa)', () => {
  it('500 lotes aleatórios pequenos dão o mesmo resultado que o oráculo', () => {
    const sorteio = criarSorteio(20261008);
    for (let rodada = 0; rodada < 500; rodada += 1) {
      const linhas = sortearLote(sorteio);
      const entrada = { linhas, contasVigentes: VIGENTES_DO_ORACULO };

      expect({ rodada, resultado: validarLinhasDoPlano(entrada) }).toEqual({ rodada, resultado: validarComOAlgoritmoAntigo(entrada) });
    }
  });

  it('o gerador exercita duplicidade, ciclo, pai inexistente e pai rejeitado', () => {
    const sorteio = criarSorteio(20261008);
    const vistos = new Set<string>();
    for (let rodada = 0; rodada < 500; rodada += 1) {
      const resultado = validarComOAlgoritmoAntigo({ linhas: sortearLote(sorteio), contasVigentes: VIGENTES_DO_ORACULO });
      for (const rejeicao of resultado.rejeitadas) vistos.add(rejeicao.codigoDeErro);
    }

    expect([...vistos].sort()).toEqual([
      'CAMPO_OBRIGATORIO_AUSENTE',
      'CICLO_HIERARQUICO',
      'CODIGO_DUPLICADO_NO_ARQUIVO',
      'CONTA_PAI_INEXISTENTE',
      'CONTA_PAI_REJEITADA',
      'VALOR_FORA_DO_DOMINIO',
    ]);
  });
});
