/**
 * Dublês da inspeção de planilha (SPEC-015 §6.2) para as provas de tela dos dois domínios. Só os
 * testes importam este arquivo.
 *
 * A planilha dublada tem um título na linha 1, o cabeçalho na linha 2 (campos do domínio em A..E,
 * `Obs` em F e H, G sem nome) e dados nas linhas 3 a 5, com a 4 oculta. A primeira linha preenchida
 * é o título: é a linha sugerida, e a pessoa escolhe a 2.
 */
import type { InspecaoDePlanilha } from '@contaia/shared';

import { json, problema } from '../carteira/carteira.fixtures';

export type AbaDublada = Readonly<{ nome: string; posicao: number; utilizavel: boolean }>;

const TITULO = 'Relatório exportado do sistema legado';

const letra = (indice: number): string => String.fromCharCode('A'.charCodeAt(0) + indice);

const linhaDoCabecalho = (campos: readonly string[]): Record<string, string> => ({
  ...Object.fromEntries(campos.map((campo, indice) => [letra(indice), campo])),
  F: 'Obs',
  H: 'Obs',
});

const linhaDeDados = (campos: readonly string[], numero: number): Record<string, string> =>
  Object.fromEntries(campos.map((campo, indice) => [letra(indice), `${campo}-${numero}`]));

export const amostraDublada = (campos: readonly string[]): InspecaoDePlanilha['amostra'] => [
  { numero: 1, oculta: false, celulas: { A: TITULO } },
  { numero: 2, oculta: false, celulas: linhaDoCabecalho(campos) },
  { numero: 3, oculta: false, celulas: linhaDeDados(campos, 3) },
  { numero: 4, oculta: true, celulas: linhaDeDados(campos, 4) },
  { numero: 5, oculta: false, celulas: linhaDeDados(campos, 5) },
];

const colunasDaLinha = (campos: readonly string[], linhaCabecalho: number): InspecaoDePlanilha['colunas'] => {
  if (linhaCabecalho === 1) {
    return [{ letra: 'A', nome: TITULO, rotulo: `Coluna A — ${TITULO}` }];
  }

  const nomes: readonly (string | null)[] = [...campos, 'Obs', null, 'Obs'];

  return nomes.map((nome, indice) => ({
    letra: letra(indice),
    nome,
    rotulo: nome === null ? `Coluna ${letra(indice)} (sem nome)` : `Coluna ${letra(indice)} — ${nome}`,
  }));
};

/**
 * Inspeção como a API responde: sem `aba` e com várias abas utilizáveis, nada é escolhido; com uma
 * aba (pedida ou única), cabeçalho pedido ou o sugerido (linha 1).
 */
export const inspecaoDublada = (
  campos: readonly string[],
  opcoes: Readonly<{
    abas?: readonly AbaDublada[];
    aba?: number | undefined;
    linhaCabecalho?: number | undefined;
    formato?: 'XLSX' | 'ODS';
    sobrescritas?: Partial<InspecaoDePlanilha>;
  }> = {},
): InspecaoDePlanilha => {
  const abas = opcoes.abas ?? [{ nome: 'Plano', posicao: 1, utilizavel: true }];
  const utilizaveis = abas.filter((aba) => aba.utilizavel);
  const escolhida =
    opcoes.aba === undefined ? (utilizaveis.length === 1 ? utilizaveis[0] : undefined) : abas.find((aba) => aba.posicao === opcoes.aba);
  const formato = opcoes.formato ?? 'XLSX';

  if (escolhida === undefined) {
    return {
      formato,
      abas: [...abas],
      abaSelecionada: null,
      linhaCabecalhoSugerida: null,
      linhaCabecalho: null,
      colunas: [],
      amostra: [],
      linhasIgnoradasAntesDoCabecalho: 0,
      linhasOcultas: 0,
      cabecalhoMesclado: false,
      diagnosticos: [],
      ...opcoes.sobrescritas,
    };
  }

  const linhaCabecalho = opcoes.linhaCabecalho ?? 1;

  return {
    formato,
    abas: [...abas],
    abaSelecionada: { nome: escolhida.nome, posicao: escolhida.posicao },
    linhaCabecalhoSugerida: 1,
    linhaCabecalho,
    colunas: colunasDaLinha(campos, linhaCabecalho),
    amostra: amostraDublada(campos),
    linhasIgnoradasAntesDoCabecalho: linhaCabecalho - 1,
    linhasOcultas: 1,
    cabecalhoMesclado: false,
    diagnosticos: [],
    ...opcoes.sobrescritas,
  };
};

export type PedidoDeInspecao = Readonly<{ aba: number | undefined; linhaCabecalho: number | undefined; arquivo: File | null }>;

const numeroDoCampo = (corpo: FormData, campo: string): number | undefined => {
  const valor = corpo.get(campo);

  return typeof valor === 'string' ? Number(valor) : undefined;
};

export const pedidoDeInspecao = (init: RequestInit | undefined): PedidoDeInspecao => {
  const corpo = init?.body instanceof FormData ? init.body : new FormData();
  const arquivo = corpo.get('arquivo');

  return {
    aba: numeroDoCampo(corpo, 'aba'),
    linhaCabecalho: numeroDoCampo(corpo, 'linhaCabecalho'),
    arquivo: arquivo instanceof File ? arquivo : null,
  };
};

/** Resposta padrão da inspeção para os campos do domínio; os testes trocam por cenário. */
export const responderInspecao =
  (campos: readonly string[], abas?: readonly AbaDublada[]) =>
  (init: RequestInit | undefined): Response => {
    const pedido = pedidoDeInspecao(init);

    return json(
      inspecaoDublada(campos, {
        ...(abas === undefined ? {} : { abas }),
        aba: pedido.aba,
        linhaCabecalho: pedido.linhaCabecalho,
      }),
    );
  };

export const ocupado = (segundos: number): Response =>
  new Response(
    JSON.stringify({ type: 'x', title: 'x', status: 503, code: 'SERVICO_OCUPADO', correlationId: 'corr-ocupado' }),
    { status: 503, headers: { 'content-type': 'application/problem+json', 'retry-after': String(segundos) } },
  );

export { problema };

/** Bytes de um ZIP: o navegador não confere o conteúdo da planilha, quem decide é a API. */
export const planilha = (nome: string, tamanho = 64): File =>
  new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(Math.max(0, tamanho - 4))])], nome, { type: '' });
