/**
 * Hierarquia resultante: propriedades com plano vigente SOBREPOSTO ao lote (SPEC-013 §3.4, §7).
 *
 * 1. Equivalência com a resolução por rodadas anterior (busca de ciclos sem atalho), guardada AQUI
 *    só como oráculo: a busca com atalhos muda o custo, nunca o resultado — em cascatas (cada
 *    rodada recusa uma linha que volta ao pai antigo e fecha um ciclo maior) e em lotes aleatórios.
 * 2. Independência da ordem física das linhas.
 * 3. Validade do plano final: sem ciclo, sem pai arquivado, ausente ou analítico.
 */
import { describe, expect, it } from 'vitest';

import { resolverHierarquia } from './hierarquia.js';
import { validarLinhasDoPlano } from './validacao.js';
import type { ContaVigente, LinhaBrutaDeEntrada, LinhaDeEntrada } from './validacao.js';

// -- Oráculo: a resolução por rodadas anterior, sem atalhos (cópia fiel; só o nome mudou) ---------

type MotivoDeRejeicaoNaHierarquia =
  | 'CONTA_PAI_INEXISTENTE'
  | 'CONTA_PAI_REJEITADA'
  | 'CICLO_HIERARQUICO'
  /** A conta-pai é analítica no plano final (SPEC §3.4: analítica não tem filhas). */
  | 'PAI_ANALITICO';

interface RejeicaoNaHierarquia {
  readonly linha: LinhaDeEntrada;
  readonly motivo: MotivoDeRejeicaoNaHierarquia;
}

interface ResultadoDaHierarquia {
  readonly aceitas: readonly LinhaDeEntrada[];
  readonly rejeicoes: readonly RejeicaoNaHierarquia[];
}

type Situacao = 'pendente' | 'aceita' | 'rejeitada';

type Tarefa = readonly ['avaliar' | 'ancorar', string];

interface Estado {
  readonly linhaPorCodigo: ReadonlyMap<string, LinhaDeEntrada>;
  readonly vigentePorCodigo: ReadonlyMap<string, ContaVigente>;
  /** Códigos de qualquer linha rejeitada do lote (antes e durante a hierarquia). */
  readonly codigosRejeitados: Set<string>;
  readonly situacao: Map<string, Situacao>;
  readonly ancorados: Set<string>;
  readonly filhasNoLote: ReadonlyMap<string, readonly string[]>;
  readonly filhasVigentes: ReadonlyMap<string, readonly string[]>;
  readonly fila: Tarefa[];
  /** Linhas rejeitadas que são contas vigentes e voltaram ao pai antigo desde a última busca. */
  revertidas: string[];
  pendentes: number;
  readonly aceitas: LinhaDeEntrada[];
  readonly rejeicoes: RejeicaoNaHierarquia[];
}

const agrupar = (pares: Iterable<readonly [string | null, string]>): Map<string, string[]> => {
  const grupos = new Map<string, string[]>();
  for (const [pai, filha] of pares) {
    if (pai === null) continue;
    const lista = grupos.get(pai);
    if (lista) lista.push(filha);
    else grupos.set(pai, [filha]);
  }
  return grupos;
};

const existe = (estado: Estado, codigo: string): boolean =>
  estado.linhaPorCodigo.has(codigo) || estado.vigentePorCodigo.has(codigo);

/** A conta usa o pai do plano vigente: está fora do lote ou a sua linha foi rejeitada. */
const usaPaiVigente = (estado: Estado, codigo: string): boolean => {
  if (!estado.vigentePorCodigo.has(codigo)) return false;
  const situacao = estado.situacao.get(codigo);
  return situacao === undefined || situacao === 'rejeitada';
};

const paiNoPlanoFinal = (estado: Estado, codigo: string): string | null | undefined => {
  if (usaPaiVigente(estado, codigo)) return estado.vigentePorCodigo.get(codigo)!.contaPai;
  const situacao = estado.situacao.get(codigo);
  if (situacao === 'pendente' || situacao === 'aceita') return estado.linhaPorCodigo.get(codigo)!.contaPai;
  return undefined;
};

const naoResolvida = (estado: Estado, codigo: string): boolean =>
  estado.situacao.get(codigo) === 'pendente' || (usaPaiVigente(estado, codigo) && !estado.ancorados.has(codigo));

const tipoNoPlanoFinal = (estado: Estado, codigo: string): ContaVigente['tipo'] =>
  estado.situacao.get(codigo) === 'aceita'
    ? estado.linhaPorCodigo.get(codigo)!.tipo
    : estado.vigentePorCodigo.get(codigo)!.tipo;

const ancorar = (estado: Estado, codigo: string): void => {
  if (estado.ancorados.has(codigo)) return;
  estado.ancorados.add(codigo);
  for (const filha of estado.filhasNoLote.get(codigo) ?? []) {
    if (estado.situacao.get(filha) === 'pendente') estado.fila.push(['avaliar', filha]);
  }
  for (const filha of estado.filhasVigentes.get(codigo) ?? []) {
    if (usaPaiVigente(estado, filha) && !estado.ancorados.has(filha)) estado.fila.push(['ancorar', filha]);
  }
};

const aceitar = (estado: Estado, linha: LinhaDeEntrada): void => {
  estado.situacao.set(linha.codigo, 'aceita');
  estado.pendentes -= 1;
  estado.aceitas.push(linha);
  estado.fila.push(['ancorar', linha.codigo]);
};

const rejeitar = (estado: Estado, linha: LinhaDeEntrada, motivo: MotivoDeRejeicaoNaHierarquia): void => {
  estado.situacao.set(linha.codigo, 'rejeitada');
  estado.pendentes -= 1;
  estado.rejeicoes.push({ linha, motivo });
  estado.codigosRejeitados.add(linha.codigo);
  // As filhas do lote que esperavam por esta conta passam a ter pai rejeitado.
  for (const filha of estado.filhasNoLote.get(linha.codigo) ?? []) {
    if (estado.situacao.get(filha) === 'pendente') estado.fila.push(['avaliar', filha]);
  }
  const vigente = estado.vigentePorCodigo.get(linha.codigo);
  if (!vigente) return;
  // Conta vigente: no plano final ela fica com o pai antigo.
  estado.revertidas.push(linha.codigo);
  const pai = vigente.contaPai;
  if (pai === null || !existe(estado, pai) || estado.ancorados.has(pai)) estado.fila.push(['ancorar', linha.codigo]);
};

const avaliar = (estado: Estado, codigo: string): void => {
  if (estado.situacao.get(codigo) !== 'pendente') return;
  const linha = estado.linhaPorCodigo.get(codigo)!;
  const pai = linha.contaPai;
  if (pai === null) return aceitar(estado, linha);
  // Pai rejeitado vem antes do plano vigente: a filha segue o vínculo causal (SPEC §3.4).
  if (estado.codigosRejeitados.has(pai)) return rejeitar(estado, linha, 'CONTA_PAI_REJEITADA');
  const paiVigente = estado.vigentePorCodigo.get(pai);
  if (!estado.linhaPorCodigo.has(pai) && (!paiVigente || paiVigente.arquivada)) {
    return rejeitar(estado, linha, 'CONTA_PAI_INEXISTENTE');
  }
  if (!estado.ancorados.has(pai)) return; // espera o pai ancorar, ser rejeitado ou cair num ciclo
  if (tipoNoPlanoFinal(estado, pai) === 'analitica') return rejeitar(estado, linha, 'PAI_ANALITICO');
  aceitar(estado, linha);
};

const esvaziarFila = (estado: Estado): void => {
  for (let i = 0; i < estado.fila.length; i += 1) {
    const [tarefa, codigo] = estado.fila[i]!;
    if (tarefa === 'avaliar') avaliar(estado, codigo);
    else if (estado.situacao.get(codigo) !== 'pendente') ancorar(estado, codigo);
  }
  estado.fila.length = 0;
};

/**
 * Ciclos do grafo das contas não resolvidas, percorrendo os pais a partir de `inicios`. Cada conta
 * é visitada no máximo uma vez por chamada.
 */
const ciclosAPartirDe = (estado: Estado, inicios: Iterable<string>): string[][] => {
  const visitadas = new Set<string>();
  const ciclos: string[][] = [];
  for (const inicio of inicios) {
    const caminho: string[] = [];
    const posicao = new Map<string, number>();
    let atual: string | null | undefined = inicio;
    while (atual !== null && atual !== undefined && naoResolvida(estado, atual) && !visitadas.has(atual)) {
      visitadas.add(atual);
      posicao.set(atual, caminho.length);
      caminho.push(atual);
      atual = paiNoPlanoFinal(estado, atual);
    }
    const inicioDoCiclo = atual === null || atual === undefined ? undefined : posicao.get(atual);
    if (inicioDoCiclo !== undefined) ciclos.push(caminho.slice(inicioDoCiclo));
  }
  return ciclos;
};

const desfazerCiclos = (estado: Estado, ciclos: readonly (readonly string[])[]): void => {
  for (const ciclo of ciclos) {
    const linhas = ciclo.filter((codigo) => estado.situacao.get(codigo) === 'pendente');
    if (linhas.length === 0) {
      // Ciclo só de contas vigentes: dado anterior ao lote, não criado por ele. Não bloqueia.
      for (const codigo of ciclo) estado.fila.push(['ancorar', codigo]);
      continue;
    }
    for (const codigo of linhas) rejeitar(estado, estado.linhaPorCodigo.get(codigo)!, 'CICLO_HIERARQUICO');
  }
};

const listarPendentes = (estado: Estado): string[] =>
  [...estado.situacao].filter(([, situacao]) => situacao === 'pendente').map(([codigo]) => codigo);

const criarEstado = (
  candidatas: readonly LinhaDeEntrada[],
  vigentePorCodigo: ReadonlyMap<string, ContaVigente>,
  codigosRejeitados: ReadonlySet<string>,
): Estado => ({
  linhaPorCodigo: new Map(candidatas.map((linha) => [linha.codigo, linha])),
  vigentePorCodigo,
  codigosRejeitados: new Set(codigosRejeitados),
  situacao: new Map(candidatas.map((linha) => [linha.codigo, 'pendente' as Situacao])),
  ancorados: new Set(),
  filhasNoLote: agrupar(candidatas.map((linha) => [linha.contaPai, linha.codigo] as const)),
  filhasVigentes: agrupar([...vigentePorCodigo.values()].map((conta) => [conta.contaPai, conta.codigo] as const)),
  fila: [],
  revertidas: [],
  pendentes: candidatas.length,
  aceitas: [],
  rejeicoes: [],
});

/**
 * Decide, entre as `candidatas` (códigos únicos, já aprovadas nos campos, na duplicidade e no
 * conflito com o vigente), quais entram no plano final e por quê as demais ficam de fora.
 * `codigosRejeitados` são os códigos das linhas recusadas nas etapas anteriores.
 */
const resolverPorRodadasAnterior = (
  candidatas: readonly LinhaDeEntrada[],
  vigentePorCodigo: ReadonlyMap<string, ContaVigente>,
  codigosRejeitados: ReadonlySet<string>,
): ResultadoDaHierarquia => {
  const estado = criarEstado(candidatas, vigentePorCodigo, codigosRejeitados);

  for (const conta of vigentePorCodigo.values()) {
    const pai = conta.contaPai;
    if (usaPaiVigente(estado, conta.codigo) && (pai === null || !existe(estado, pai))) {
      estado.fila.push(['ancorar', conta.codigo]);
    }
  }
  for (const linha of candidatas) estado.fila.push(['avaliar', linha.codigo]);
  esvaziarFila(estado);

  let inicios: string[] = estado.pendentes > 0 ? listarPendentes(estado) : [];
  while (estado.pendentes > 0) {
    estado.revertidas = [];
    let ciclos = ciclosAPartirDe(estado, inicios);
    // Rede de segurança: se a busca incremental nada achar, varre todas as pendentes.
    if (ciclos.length === 0) ciclos = ciclosAPartirDe(estado, listarPendentes(estado));
    if (ciclos.length === 0) {
      // Inalcançável pelo invariante (toda pendente depende de um ciclo); garante o término.
      for (const codigo of listarPendentes(estado)) {
        rejeitar(estado, estado.linhaPorCodigo.get(codigo)!, 'CONTA_PAI_INEXISTENTE');
      }
    } else {
      desfazerCiclos(estado, ciclos);
    }
    esvaziarFila(estado);
    // Um ciclo novo só pode passar por uma conta que acabou de voltar ao pai antigo.
    inicios = estado.revertidas.filter((codigo) => naoResolvida(estado, codigo));
  }

  return { aceitas: estado.aceitas, rejeicoes: estado.rejeicoes };
};
// -- Fim do oráculo ------------------------------------------------------------------------------

type Desfecho = Readonly<{ aceitas: readonly string[]; rejeitadas: readonly (readonly [string, string])[] }>;

const normalizar = (resultado: Readonly<{ aceitas: readonly LinhaDeEntrada[]; rejeicoes: readonly RejeicaoNaHierarquia[] }>): Desfecho => ({
  aceitas: resultado.aceitas.map((linha) => linha.codigo).sort(),
  rejeitadas: resultado.rejeicoes
    .map((rejeicao) => [rejeicao.linha.codigo, rejeicao.motivo] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
});

const comparar = (
  candidatas: readonly LinhaDeEntrada[],
  vigentes: readonly ContaVigente[],
  rejeitados: ReadonlySet<string> = new Set(),
): void => {
  const porCodigo = new Map(vigentes.map((conta) => [conta.codigo, conta]));

  expect(normalizar(resolverHierarquia(candidatas, porCodigo, rejeitados))).toEqual(
    normalizar(resolverPorRodadasAnterior(candidatas, porCodigo, rejeitados)),
  );
};

const linhaDe = (numeroDaLinha: number, codigo: string, contaPai: string | null, tipo: LinhaDeEntrada['tipo'] = 'sintetica'): LinhaDeEntrada => ({
  numeroDaLinha,
  codigo,
  nome: `Conta ${codigo}`,
  tipo,
  natureza: 'devedora',
  contaPai,
});

const vigenteDe = (codigo: string, contaPai: string | null, extra: Partial<ContaVigente> = {}): ContaVigente => ({
  codigo,
  tipo: 'sintetica',
  arquivada: false,
  temFilhas: true,
  contaPai,
  ...extra,
});

/**
 * Cascata: vigente `R ← C1 ← … ← Cm ← T1 ← … ← Tt` (a folha é `Tt`, ou `Cm` sem cauda) e o lote
 * põe cada `Ci` sob a folha. Toda rodada recusa uma linha, que volta ao pai antigo e fecha um ciclo
 * um pouco maior.
 */
const cascata = (m: number, cauda: number): Readonly<{ linhas: LinhaDeEntrada[]; vigentes: ContaVigente[] }> => {
  const vigentes: ContaVigente[] = [vigenteDe('R', null)];
  for (let i = 1; i <= m; i += 1) vigentes.push(vigenteDe(`C${i}`, i === 1 ? 'R' : `C${i - 1}`));
  for (let j = 1; j <= cauda; j += 1) vigentes.push(vigenteDe(`T${j}`, j === 1 ? `C${m}` : `T${j - 1}`, { temFilhas: j < cauda }));
  const folha = cauda === 0 ? `C${m}` : `T${cauda}`;
  const linhas: LinhaDeEntrada[] = [];
  for (let i = 1; i <= m; i += 1) {
    if (`C${i}` !== folha) linhas.push(linhaDe(i + 1, `C${i}`, folha));
  }
  return { linhas, vigentes };
};

/** PRNG determinístico (mulberry32). */
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

const CODIGOS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

/**
 * Plano vigente válido (floresta, pais sintéticos e ativos, `temFilhas` coerente) que se SOBREPÕE
 * ao lote: os códigos do lote e do vigente vêm do mesmo conjunto.
 */
const sortearVigentes = (sorteio: () => number): ContaVigente[] => {
  const escolhidos = CODIGOS.filter(() => sorteio() < 0.6);
  const contas: { codigo: string; tipo: ContaVigente['tipo']; arquivada: boolean; contaPai: string | null }[] = [];
  for (const codigo of escolhidos) {
    const possiveis = contas.filter((conta) => conta.tipo === 'sintetica' && !conta.arquivada);
    const pai = possiveis.length > 0 && sorteio() < 0.7 ? possiveis[Math.floor(sorteio() * possiveis.length)]!.codigo : null;
    contas.push({ codigo, tipo: sorteio() < 0.3 ? 'analitica' : 'sintetica', arquivada: sorteio() < 0.1, contaPai: pai });
  }
  return contas.map((conta) => ({ ...conta, temFilhas: contas.some((outra) => outra.contaPai === conta.codigo) }));
};

const sortearLote = (sorteio: () => number): LinhaBrutaDeEntrada[] => {
  const quantidade = 1 + Math.floor(sorteio() * 10);
  const linhas: LinhaBrutaDeEntrada[] = [];
  for (let i = 0; i < quantidade; i += 1) {
    const sorte = sorteio();
    const contaPai = sorte < 0.2 ? null : sorte < 0.95 ? CODIGOS[Math.floor(sorteio() * CODIGOS.length)]! : 'Z';
    linhas.push({
      numeroDaLinha: i + 2,
      codigo: CODIGOS[Math.floor(sorteio() * CODIGOS.length)]!,
      nome: sorteio() < 0.05 ? '' : `Conta ${i}`,
      tipo: sorteio() < 0.35 ? 'analitica' : 'sintetica',
      natureza: 'devedora',
      contaPai,
    });
  }
  return linhas;
};

const embaralhar = <T,>(lista: readonly T[], sorteio: () => number): T[] => {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(sorteio() * (i + 1));
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  }
  return copia;
};

/** Plano final = vigente com as linhas aceitas por cima. Devolve a lista de defeitos (vazia = válido). */
const defeitosDoPlanoFinal = (vigentes: readonly ContaVigente[], aceitas: readonly LinhaDeEntrada[]): string[] => {
  const plano = new Map(vigentes.map((conta) => [conta.codigo, { tipo: conta.tipo, arquivada: conta.arquivada, contaPai: conta.contaPai }]));
  for (const linha of aceitas) {
    if (plano.get(linha.codigo)?.arquivada) return [`${linha.codigo}: arquivada aceita`];
    plano.set(linha.codigo, { tipo: linha.tipo, arquivada: false, contaPai: linha.contaPai });
  }
  const defeitos: string[] = [];
  for (const [codigo, conta] of plano) {
    if (conta.arquivada || conta.contaPai === null) continue;
    const pai = plano.get(conta.contaPai);
    if (pai === undefined) defeitos.push(`${codigo}: pai ausente`);
    else if (pai.arquivada) defeitos.push(`${codigo}: pai arquivado`);
    else if (pai.tipo === 'analitica') defeitos.push(`${codigo}: pai analítico`);
    const vistos = new Set<string>();
    let atual: string | null | undefined = codigo;
    while (atual !== null && atual !== undefined) {
      if (vistos.has(atual)) {
        defeitos.push(`${codigo}: ciclo`);
        break;
      }
      vistos.add(atual);
      atual = plano.get(atual)?.contaPai;
    }
  }
  return defeitos;
};

describe('busca de ciclos com atalhos: mesmo resultado da resolução por rodadas', () => {
  it('cascatas de 1 a 60 linhas, com e sem cauda vigente, dão o mesmo desfecho do oráculo', () => {
    for (let m = 1; m <= 60; m += 1) {
      for (const cauda of [0, 1, 7, 40]) {
        const { linhas, vigentes } = cascata(m, cauda);
        comparar(linhas, vigentes);
      }
    }
  });

  it('cascata com uma linha do meio já recusada antes da hierarquia (o pai volta antes)', () => {
    const { linhas, vigentes } = cascata(30, 5);
    const rejeitados = new Set(['C17']);
    comparar(
      linhas.filter((linha) => !rejeitados.has(linha.codigo)),
      vigentes,
      rejeitados,
    );
  });

  it('1.000 lotes aleatórios sobre planos vigentes sobrepostos dão o mesmo desfecho do oráculo', () => {
    const sorteio = criarSorteio(91);
    for (let rodada = 0; rodada < 1_000; rodada += 1) {
      const vigentes = sortearVigentes(sorteio);
      // As candidatas da hierarquia: códigos únicos e não arquivados (o que as etapas anteriores deixam).
      const arquivadas = new Set(vigentes.filter((conta) => conta.arquivada).map((conta) => conta.codigo));
      const vistas = new Set<string>();
      const candidatas: LinhaDeEntrada[] = [];
      for (const linha of sortearLote(sorteio)) {
        if (vistas.has(linha.codigo) || arquivadas.has(linha.codigo) || linha.nome === '') continue;
        vistas.add(linha.codigo);
        candidatas.push({ ...linha, tipo: linha.tipo === 'analitica' ? 'analitica' : 'sintetica', natureza: 'devedora' });
      }
      comparar(candidatas, vigentes);
    }
  });
});

describe('busca de ciclos com atalhos: planos maiores (fuzz com semente fixa)', () => {
  it('300 lotes de até 80 linhas sobre planos vigentes de até 60 contas dão o mesmo desfecho do oráculo', () => {
    const sorteio = criarSorteio(7);
    const codigos = Array.from({ length: 60 }, (_, i) => `K${i}`);
    for (let rodada = 0; rodada < 300; rodada += 1) {
      // Vigente: floresta profunda (o pai é sempre uma conta anterior), como as cascatas.
      const vigentes: ContaVigente[] = [];
      for (const codigo of codigos) {
        if (sorteio() < 0.2) continue;
        const pai = vigentes.length > 0 && sorteio() < 0.85 ? vigentes[Math.floor(sorteio() * vigentes.length)]!.codigo : null;
        vigentes.push({ codigo, tipo: 'sintetica', arquivada: false, temFilhas: false, contaPai: pai });
      }
      const comFilhas = new Set(vigentes.map((conta) => conta.contaPai));
      const vigentesCoerentes = vigentes.map((conta) => ({ ...conta, temFilhas: comFilhas.has(conta.codigo) }));
      const vistas = new Set<string>();
      const candidatas: LinhaDeEntrada[] = [];
      const quantidade = 1 + Math.floor(sorteio() * 80);
      for (let i = 0; i < quantidade; i += 1) {
        const codigo = codigos[Math.floor(sorteio() * codigos.length)]!;
        if (vistas.has(codigo)) continue;
        vistas.add(codigo);
        const pai = sorteio() < 0.1 ? null : codigos[Math.floor(sorteio() * codigos.length)]!;
        candidatas.push(linhaDe(i + 2, codigo, pai, sorteio() < 0.15 ? 'analitica' : 'sintetica'));
      }
      comparar(candidatas, vigentesCoerentes);
    }
  });
});

describe('validarLinhasDoPlano — propriedades com vigente sobreposto (semente fixa)', () => {
  it('1.000 lotes: a ordem física não muda o resultado e o plano final é válido', () => {
    const sorteio = criarSorteio(20261009);
    let comAceitas = 0;
    let comRejeitadas = 0;
    for (let rodada = 0; rodada < 1_000; rodada += 1) {
      const contasVigentes = sortearVigentes(sorteio);
      const linhas = sortearLote(sorteio);
      const resultado = validarLinhasDoPlano({ linhas, contasVigentes });

      expect({ rodada, resultado: validarLinhasDoPlano({ linhas: embaralhar(linhas, sorteio), contasVigentes }) }).toEqual({
        rodada,
        resultado,
      });
      expect({ rodada, defeitos: defeitosDoPlanoFinal(contasVigentes, resultado.aceitas) }).toEqual({ rodada, defeitos: [] });
      comAceitas += resultado.aceitas.length > 0 ? 1 : 0;
      comRejeitadas += resultado.rejeitadas.length > 0 ? 1 : 0;
    }
    // O gerador exercita os dois lados.
    expect(comAceitas).toBeGreaterThan(300);
    expect(comRejeitadas).toBeGreaterThan(300);
  });
});
