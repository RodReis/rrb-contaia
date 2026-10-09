/**
 * Validação integral do lote de importação do plano de contas (SPEC-013 §3.4).
 *
 * O worker valida o arquivo inteiro antes de formar a prévia. A ordem física das linhas não
 * define a hierarquia: uma conta-pai válida pode aparecer depois da filha. Erro de linha não
 * interrompe a validação das demais. A hierarquia é decidida sobre o plano RESULTANTE (vigente +
 * lote): ver `hierarquia.ts`.
 */

import { resolverHierarquia, type MotivoDeRejeicaoNaHierarquia } from './hierarquia.js';

export type TipoDaConta = 'analitica' | 'sintetica';
export type NaturezaDaConta = 'devedora' | 'credora';

export interface LinhaDeEntrada {
  readonly numeroDaLinha: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoDaConta;
  readonly natureza: NaturezaDaConta;
  readonly contaPai: string | null;
}

/**
 * Linha como sai da leitura do CSV: tipo e natureza ainda são texto livre (já normalizado por
 * `normalizarLinhas`, mas possivelmente fora do domínio ou em branco). `validarLinhasDoPlano`
 * rejeita o que não for do domínio; `LinhaDeEntrada` é atribuível a este tipo.
 */
export type DefeitoDeEstrutura = 'CAMPOS_A_MAIS';

export interface LinhaBrutaDeEntrada {
  readonly numeroDaLinha: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly natureza: string;
  readonly contaPai: string | null;
  /**
   * Defeito de leitura da linha (não do conteúdo): `CAMPOS_A_MAIS` = mais campos preenchidos que
   * o cabeçalho, o que torna as colunas da linha inconfiáveis. A linha é rejeitada.
   */
  readonly defeitoDeEstrutura?: DefeitoDeEstrutura;
}

export interface ContaVigente {
  readonly codigo: string;
  readonly tipo: TipoDaConta;
  readonly arquivada: boolean;
  /** Tem ao menos uma filha no plano vigente, inclusive arquivada. */
  readonly temFilhas: boolean;
  /** Pai no plano vigente (`null` na raiz): o ciclo é avaliado no plano resultante (SPEC §3.4). */
  readonly contaPai: string | null;
}

/**
 * Códigos estáveis de rejeição de linha. O contrato do `@contaia/shared` repete a lista (a prévia é
 * lida com parse estrito no web); um teste do shared garante que as duas são iguais.
 */
export const CODIGOS_DE_ERRO_DA_LINHA = [
  'CAMPO_OBRIGATORIO_AUSENTE',
  'VALOR_FORA_DO_DOMINIO',
  'CODIGO_DUPLICADO_NO_ARQUIVO',
  'CONTA_PAI_INEXISTENTE',
  'CONTA_PAI_REJEITADA',
  'CICLO_HIERARQUICO',
  'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA',
  'CONTA_ARQUIVADA',
] as const;
export type CodigoDeErroDaLinha = (typeof CODIGOS_DE_ERRO_DA_LINHA)[number];

export interface LinhaRejeitada {
  readonly numeroDaLinha: number;
  readonly codigo: string | null;
  readonly campo: string | null;
  readonly codigoDeErro: CodigoDeErroDaLinha;
  /** Texto acionável em PT-BR quando a rejeição não deriva só do código (ex.: defeito de estrutura). */
  readonly mensagem?: string;
}

export interface LinhaAceita {
  readonly numeroDaLinha: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoDaConta;
  readonly natureza: NaturezaDaConta;
  readonly contaPai: string | null;
}

export interface ResultadoDaValidacao {
  readonly aceitas: readonly LinhaAceita[];
  readonly rejeitadas: readonly LinhaRejeitada[];
}

const TIPOS_VALIDOS: readonly TipoDaConta[] = ['analitica', 'sintetica'];
const NATUREZAS_VALIDAS: readonly NaturezaDaConta[] = ['devedora', 'credora'];

const MENSAGEM_CAMPOS_A_MAIS = "A linha tem mais campos do que o cabeçalho; confira ';' ou aspas no texto.";
const MENSAGEM_PAI_ANALITICO = 'A conta-pai é analítica; apenas conta sintética pode ter filhas.';

/**
 * Limites do contrato da conta (os mesmos dos schemas do `@contaia/shared`). Excedê-los é erro de
 * conteúdo da linha, que vai ao relatório; nunca uma falha na gravação.
 */
export const LIMITE_DO_CODIGO_DA_CONTA = 64;
export const LIMITE_DO_NOME_DA_CONTA = 255;

const ehTipoDaConta = (valor: string): valor is TipoDaConta =>
  (TIPOS_VALIDOS as readonly string[]).includes(valor);

const ehNaturezaDaConta = (valor: string): valor is NaturezaDaConta =>
  (NATUREZAS_VALIDAS as readonly string[]).includes(valor);

/**
 * Campo de cada rejeição (SPEC-013 §3.4: linha, código, **campo**, código de erro e mensagem).
 * Determinístico pelo código de erro quando a regra é sobre um campo só: repetição e conflito com
 * conta arquivada são do `codigo`; pai ausente, pai rejeitado e ciclo, da `conta_pai`; sintética
 * com filhas que viraria analítica, do `tipo`. Ausente e fora do domínio dizem o campo na chamada.
 * Sem campo (`null`) só quando a linha inteira é inconfiável: campos a mais que o cabeçalho
 * deslocam todas as colunas, e nenhuma delas pode ser apontada.
 */
const CAMPO_DO_ERRO: Readonly<Record<CodigoDeErroDaLinha, string | null>> = {
  CAMPO_OBRIGATORIO_AUSENTE: null,
  VALOR_FORA_DO_DOMINIO: null,
  CODIGO_DUPLICADO_NO_ARQUIVO: 'codigo',
  CONTA_PAI_INEXISTENTE: 'conta_pai',
  CONTA_PAI_REJEITADA: 'conta_pai',
  CICLO_HIERARQUICO: 'conta_pai',
  SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA: 'tipo',
  CONTA_ARQUIVADA: 'codigo',
};

const rejeicao = (
  linha: LinhaBrutaDeEntrada,
  codigoDeErro: CodigoDeErroDaLinha,
  campo: string | null = CAMPO_DO_ERRO[codigoDeErro],
): LinhaRejeitada => ({
  numeroDaLinha: linha.numeroDaLinha,
  codigo: linha.codigo || null,
  campo,
  codigoDeErro,
});

const acimaDoLimite = (
  linha: LinhaBrutaDeEntrada,
  campo: 'codigo' | 'nome',
  rotulo: string,
  tamanho: number,
  limite: number,
): LinhaRejeitada => ({
  ...rejeicao(linha, 'VALOR_FORA_DO_DOMINIO', campo),
  mensagem: `${rotulo} tem ${tamanho} caracteres; o limite é ${limite}.`,
});

/**
 * Valida os campos obrigatórios e o domínio de cada linha, isoladamente das demais, e devolve a
 * linha com tipo e natureza estreitados. Em branco → obrigatório ausente; preenchido fora do
 * domínio → valor fora do domínio. Não decide hierarquia, duplicidade nem conflito com o vigente.
 */
const validarCamposDaLinha = (linha: LinhaBrutaDeEntrada): LinhaRejeitada | LinhaDeEntrada => {
  if (linha.defeitoDeEstrutura === 'CAMPOS_A_MAIS') {
    // Linha inteira: com colunas deslocadas, nenhum campo é confiável o bastante para ser apontado.
    return { ...rejeicao(linha, 'VALOR_FORA_DO_DOMINIO', null), mensagem: MENSAGEM_CAMPOS_A_MAIS };
  }
  if (!linha.codigo) {
    return rejeicao(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'codigo');
  }
  if (linha.codigo.length > LIMITE_DO_CODIGO_DA_CONTA) {
    return acimaDoLimite(linha, 'codigo', 'O código', linha.codigo.length, LIMITE_DO_CODIGO_DA_CONTA);
  }
  if (!linha.nome) {
    return rejeicao(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'nome');
  }
  if (linha.nome.length > LIMITE_DO_NOME_DA_CONTA) {
    return acimaDoLimite(linha, 'nome', 'O nome', linha.nome.length, LIMITE_DO_NOME_DA_CONTA);
  }
  if (!linha.tipo) {
    return rejeicao(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'tipo');
  }
  if (!ehTipoDaConta(linha.tipo)) {
    return rejeicao(linha, 'VALOR_FORA_DO_DOMINIO', 'tipo');
  }
  if (!linha.natureza) {
    return rejeicao(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'natureza');
  }
  if (!ehNaturezaDaConta(linha.natureza)) {
    return rejeicao(linha, 'VALOR_FORA_DO_DOMINIO', 'natureza');
  }

  return { ...linha, tipo: linha.tipo, natureza: linha.natureza };
};

const ehRejeicao = (resultado: LinhaRejeitada | LinhaDeEntrada): resultado is LinhaRejeitada =>
  'codigoDeErro' in resultado;

const rejeicaoDaHierarquia = (linha: LinhaDeEntrada, motivo: MotivoDeRejeicaoNaHierarquia): LinhaRejeitada =>
  motivo === 'PAI_ANALITICO'
    ? // Interpretação da SPEC §3.4 ("analítica não tem filhas") sem código novo: o valor da conta-pai
      // está fora do domínio aceito para uma filha. A filha é a linha recusada.
      { ...rejeicao(linha, 'VALOR_FORA_DO_DOMINIO', 'conta_pai'), mensagem: MENSAGEM_PAI_ANALITICO }
    : rejeicao(linha, motivo);

/**
 * Sintética que viraria analítica tendo filhas (SPEC §3.4) — avaliado sobre o plano resultante:
 * filhas no plano vigente (mesmo que o lote as mova, pois a linha delas pode ser recusada e a filha
 * ficar sob o pai antigo) ou filhas que o próprio lote lhe dá.
 */
const viraAnaliticaComFilhas = (
  linha: LinhaDeEntrada,
  vigente: ContaVigente | undefined,
  paisNoLote: ReadonlySet<string>,
): boolean =>
  vigente !== undefined &&
  vigente.tipo === 'sintetica' &&
  linha.tipo === 'analitica' &&
  (vigente.temFilhas || paisNoLote.has(linha.codigo));

export const validarLinhasDoPlano = (entrada: {
  readonly linhas: readonly LinhaBrutaDeEntrada[];
  readonly contasVigentes: readonly ContaVigente[];
}): ResultadoDaValidacao => {
  const { linhas, contasVigentes } = entrada;
  const rejeitadas: LinhaRejeitada[] = [];
  const vigentePorCodigo = new Map(contasVigentes.map((c) => [c.codigo, c]));

  // 1) campos obrigatórios e domínio — isolado por linha.
  const comCamposValidos: LinhaDeEntrada[] = [];
  for (const linha of linhas) {
    const resultado = validarCamposDaLinha(linha);
    if (ehRejeicao(resultado)) {
      rejeitadas.push(resultado);
    } else {
      comCamposValidos.push(resultado);
    }
  }

  // 2) duplicidade de código no arquivo — o código que aparece mais de uma vez em QUALQUER linha
  //    (válida ou não) tem todas as ocorrências rejeitadas; a inválida mantém o próprio erro.
  const repeticoes = new Map<string, number>();
  for (const linha of linhas) {
    if (linha.codigo) repeticoes.set(linha.codigo, (repeticoes.get(linha.codigo) ?? 0) + 1);
  }
  const semDuplicidade: LinhaDeEntrada[] = [];
  for (const linha of comCamposValidos) {
    if ((repeticoes.get(linha.codigo) ?? 0) > 1) {
      rejeitadas.push(rejeicao(linha, 'CODIGO_DUPLICADO_NO_ARQUIVO'));
    } else {
      semDuplicidade.push(linha);
    }
  }

  // 3) conflito com o plano vigente: conta arquivada; sintética com filhas que viraria analítica.
  const naoArquivadas: LinhaDeEntrada[] = [];
  for (const linha of semDuplicidade) {
    if (vigentePorCodigo.get(linha.codigo)?.arquivada) {
      rejeitadas.push(rejeicao(linha, 'CONTA_ARQUIVADA'));
    } else {
      naoArquivadas.push(linha);
    }
  }
  const paisNoLote = new Set(
    naoArquivadas.filter((l) => l.contaPai !== null && l.contaPai !== l.codigo).map((l) => l.contaPai as string),
  );
  const candidatas: LinhaDeEntrada[] = [];
  for (const linha of naoArquivadas) {
    if (viraAnaliticaComFilhas(linha, vigentePorCodigo.get(linha.codigo), paisNoLote)) {
      rejeitadas.push(rejeicao(linha, 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA'));
    } else {
      candidatas.push(linha);
    }
  }

  // 4) hierarquia resultante: pai inexistente ou rejeitado, pai analítico e ciclo — com o vigente.
  const codigosRejeitados = new Set(rejeitadas.map((r) => r.codigo).filter((c): c is string => c !== null));
  const hierarquia = resolverHierarquia(candidatas, vigentePorCodigo, codigosRejeitados);
  for (const { linha, motivo } of hierarquia.rejeicoes) {
    rejeitadas.push(rejeicaoDaHierarquia(linha, motivo));
  }

  const aceitas: LinhaAceita[] = [...hierarquia.aceitas].sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);
  rejeitadas.sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);

  return { aceitas, rejeitadas };
};
