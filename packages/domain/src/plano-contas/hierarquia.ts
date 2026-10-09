/**
 * Resolução da hierarquia RESULTANTE de um lote do plano de contas (SPEC-013 §3.4, §7).
 *
 * O plano final é o vigente com as linhas aceitas aplicadas por cima: uma conta do lote passa a
 * ter o pai da linha; a conta vigente fora do lote, ou cuja linha foi rejeitada, fica com o pai
 * que já tinha. Uma linha só é aceita quando, NESSE plano final, a sua cadeia de pais chega a uma
 * raiz sem voltar a ela mesma — por isso a decisão considera as contas vigentes e não só o lote.
 *
 * Algoritmo (linear no caso comum): uma conta fica "ancorada" quando a cadeia dela já chega a uma
 * raiz no plano final. Raízes e contas vigentes sem pai ancoram primeiro; cada ancoragem acorda as
 * filhas que esperavam por ela (índice pai → filhas), que são avaliadas uma única vez. O que não
 * ancora depende de um ciclo: os ciclos são achados percorrendo os pais (cada conta visitada uma
 * vez por rodada) e as LINHAS que os formam são rejeitadas. Uma linha rejeitada que é conta vigente
 * volta ao pai antigo, o que pode ancorar outras contas — ou fechar um ciclo novo, procurado na
 * rodada seguinte só a partir das contas que voltaram ao pai antigo.
 */

import type { ContaVigente, LinhaDeEntrada } from './validacao.js';

export type MotivoDeRejeicaoNaHierarquia =
  | 'CONTA_PAI_INEXISTENTE'
  | 'CONTA_PAI_REJEITADA'
  | 'CICLO_HIERARQUICO'
  /** A conta-pai é analítica no plano final (SPEC §3.4: analítica não tem filhas). */
  | 'PAI_ANALITICO';

export interface RejeicaoNaHierarquia {
  readonly linha: LinhaDeEntrada;
  readonly motivo: MotivoDeRejeicaoNaHierarquia;
}

export interface ResultadoDaHierarquia {
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
export const resolverHierarquia = (
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
