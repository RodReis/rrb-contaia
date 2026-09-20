/**
 * Manutenção da empresa já ativada (SPEC-003).
 *
 * A SPEC-002 cuidou do nascimento da empresa; aqui vivem as regras que só
 * existem depois da ativação: finalidade de endereço, vigência de regime e
 * CNAE, arquivamento com justificativa e o cálculo do que vira evento no
 * Histórico de Informações.
 *
 * Tudo é função pura: o "agora" entra por parâmetro, nada consulta banco,
 * relógio ou rede (`CLAUDE.md`, convenções de código).
 */

import { CODIGOS_DE_ERRO, type CampoInvalido, ErroDeDominio } from '../erros.js';
import {
  type EnderecoDaEmpresa,
  type IdentificacaoDaEmpresa,
  validarEnderecoDaEmpresa,
} from './cadastro.js';

export const FINALIDADES_DE_ENDERECO = [
  'FISCAL',
  'COBRANCA',
  'CORRESPONDENCIA',
  'OUTRO',
] as const;

export type FinalidadeDeEndereco = (typeof FINALIDADES_DE_ENDERECO)[number];

export const ehFinalidadeDeEndereco = (valor: string): valor is FinalidadeDeEndereco =>
  (FINALIDADES_DE_ENDERECO as readonly string[]).includes(valor);

export type EnderecoComFinalidade = EnderecoDaEmpresa &
  Readonly<{
    finalidade: FinalidadeDeEndereco;
    /** Obrigatória em `OUTRO` e proibida nas demais finalidades. */
    descricao: string | null;
  }>;

/** Situação de registro: arquivar substitui exclusão física (I-7). */
export type SituacaoDeRegistro = 'ativo' | 'arquivado';

export type EventoDoHistorico = Readonly<{
  aba: AbaDoHistorico;
  acao: AcaoDoHistorico;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  vigencia: string | null;
  justificativa: string | null;
}>;

export const ABAS_DO_HISTORICO = [
  'DADOS_CADASTRAIS',
  'DADOS_FISCAIS',
  'ENDERECOS',
  'STATUS_DA_EMPRESA',
] as const;

export type AbaDoHistorico = (typeof ABAS_DO_HISTORICO)[number];

export const ACOES_DO_HISTORICO = [
  'ALTERACAO',
  'INCLUSAO',
  'ARQUIVAMENTO',
  'REATIVACAO',
] as const;

export type AcaoDoHistorico = (typeof ACOES_DO_HISTORICO)[number];

export const ehAbaDoHistorico = (valor: string): valor is AbaDoHistorico =>
  (ABAS_DO_HISTORICO as readonly string[]).includes(valor);

const preenchido = (valor: string | null | undefined): boolean =>
  typeof valor === 'string' && valor.trim().length > 0;

// -- Endereços ---------------------------------------------------------------

export const validarEnderecoComFinalidade = (
  endereco: EnderecoComFinalidade,
): readonly CampoInvalido[] => {
  const campos = [...validarEnderecoDaEmpresa(endereco)];

  if (!ehFinalidadeDeEndereco(endereco.finalidade)) {
    campos.push({ campo: 'finalidade', codigo: CODIGOS_DE_ERRO.FINALIDADE_INVALIDA });
    return campos;
  }

  if (endereco.finalidade === 'OUTRO' && !preenchido(endereco.descricao)) {
    campos.push({ campo: 'descricao', codigo: CODIGOS_DE_ERRO.DESCRICAO_OBRIGATORIA });
  }

  // Descrição livre só faz sentido em `OUTRO`: nas demais, a finalidade já
  // nomeia o endereço e um texto paralelo abriria divergência.
  if (endereco.finalidade !== 'OUTRO' && preenchido(endereco.descricao)) {
    campos.push({ campo: 'descricao', codigo: CODIGOS_DE_ERRO.FINALIDADE_INVALIDA });
  }

  return campos;
};

export type EnderecoIdentificado = Readonly<{
  id: string;
  finalidade: FinalidadeDeEndereco;
}>;

export type AtribuicaoDeFinalidade = Readonly<{
  id: string;
  finalidade: FinalidadeDeEndereco;
  principal: boolean;
}>;

/**
 * Calcula as duas atribuições da troca do endereço Fiscal (SPEC-003 §3.4):
 * o novo endereço assume FISCAL e padrão, o anterior recebe a finalidade
 * escolhida pelo usuário. As duas são salvas na mesma transação; devolver o
 * par junto é o que impede salvar metade da troca.
 */
export const planejarTrocaDeFinalidadeFiscal = (entrada: {
  enderecosAtivos: readonly EnderecoIdentificado[];
  novoFiscalId: string;
  finalidadeDoAnterior: FinalidadeDeEndereco;
}): readonly AtribuicaoDeFinalidade[] => {
  const { enderecosAtivos, novoFiscalId, finalidadeDoAnterior } = entrada;

  const novoFiscal = enderecosAtivos.find((endereco) => endereco.id === novoFiscalId);

  if (novoFiscal === undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.ENDERECO_NAO_ENCONTRADO,
      'O endereço escolhido para receber a finalidade Fiscal não existe entre os endereços ativos.',
    );
  }

  const fiscalAtual = enderecosAtivos.find((endereco) => endereco.finalidade === 'FISCAL');

  if (fiscalAtual === undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.ENDERECO_FISCAL_OBRIGATORIO,
      'A empresa ativa precisa ter um endereço Fiscal antes de trocá-lo.',
    );
  }

  if (fiscalAtual.id === novoFiscalId) {
    return [];
  }

  if (finalidadeDoAnterior === 'FISCAL') {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA,
      'O endereço Fiscal anterior precisa de uma finalidade diferente de Fiscal.',
      [{ campo: 'finalidadeDoAnterior', codigo: CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA }],
    );
  }

  // A finalidade que o anterior vai receber precisa estar livre — descontando
  // o próprio endereço promovido, que deixa a dele vaga na mesma transação.
  const ocupada = enderecosAtivos.some(
    (endereco) =>
      endereco.id !== fiscalAtual.id &&
      endereco.id !== novoFiscalId &&
      endereco.finalidade === finalidadeDoAnterior,
  );

  if (ocupada) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA,
      'A finalidade escolhida para o endereço Fiscal anterior já pertence a outro endereço ativo.',
      [{ campo: 'finalidadeDoAnterior', codigo: CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA }],
    );
  }

  return [
    { id: fiscalAtual.id, finalidade: finalidadeDoAnterior, principal: false },
    { id: novoFiscalId, finalidade: 'FISCAL', principal: true },
  ];
};

// -- Vigência ----------------------------------------------------------------

const FORMATO_DE_DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** Data civil em `America/Sao_Paulo` (I-11), no formato `YYYY-MM-DD`. */
export const dataCivilEmSaoPaulo = (agora: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);

/**
 * Regime tributário e CNAEs exigem vigência passada ou atual; futura é
 * rejeitada (SPEC-003 §3.2). A comparação é lexicográfica porque `YYYY-MM-DD`
 * ordena como texto — e evita fuso na conversão para `Date`.
 */
export const validarVigencia = (
  vigencia: string,
  agora: Date,
): readonly CampoInvalido[] => {
  if (!FORMATO_DE_DATA_CIVIL.test(vigencia)) {
    return [{ campo: 'vigencia', codigo: CODIGOS_DE_ERRO.VIGENCIA_OBRIGATORIA }];
  }

  if (Number.isNaN(Date.parse(`${vigencia}T00:00:00Z`))) {
    return [{ campo: 'vigencia', codigo: CODIGOS_DE_ERRO.VIGENCIA_OBRIGATORIA }];
  }

  if (vigencia > dataCivilEmSaoPaulo(agora)) {
    return [{ campo: 'vigencia', codigo: CODIGOS_DE_ERRO.VIGENCIA_FUTURA }];
  }

  return [];
};

// -- Arquivamento ------------------------------------------------------------

export const validarJustificativa = (
  justificativa: string | null,
): readonly CampoInvalido[] =>
  preenchido(justificativa)
    ? []
    : [{ campo: 'justificativa', codigo: CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA }];

const exigirJustificativa = (justificativa: string | null): void => {
  const campos = validarJustificativa(justificativa);

  if (campos.length > 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA,
      'Arquivamento e reativação exigem justificativa.',
      campos,
    );
  }
};

export const arquivarEmpresa = (
  situacaoAtual: SituacaoDeRegistro,
  justificativa: string | null,
): SituacaoDeRegistro => {
  exigirJustificativa(justificativa);

  if (situacaoAtual === 'arquivado') {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
      'A empresa já está arquivada.',
    );
  }

  return 'arquivado';
};

export const reativarEmpresa = (
  situacaoAtual: SituacaoDeRegistro,
  justificativa: string | null,
): SituacaoDeRegistro => {
  exigirJustificativa(justificativa);

  if (situacaoAtual !== 'arquivado') {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.EMPRESA_NAO_ARQUIVADA,
      'Só uma empresa arquivada pode ser reativada.',
    );
  }

  return 'ativo';
};

// -- Diferenças auditáveis ---------------------------------------------------

export type CampoAlterado = Readonly<{
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
}>;

const normalizar = (valor: string | null | undefined): string | null => {
  if (typeof valor !== 'string') {
    return null;
  }

  const limpo = valor.trim();
  return limpo.length === 0 ? null : limpo;
};

const compararCampos = <T extends Record<string, unknown>>(
  anterior: T,
  novo: T,
  campos: readonly (keyof T & string)[],
): readonly CampoAlterado[] =>
  campos.flatMap((campo) => {
    const valorAnterior = normalizar(anterior[campo] as string | null | undefined);
    const valorNovo = normalizar(novo[campo] as string | null | undefined);

    return valorAnterior === valorNovo
      ? []
      : [{ campo, valorAnterior, valorNovo }];
  });

/**
 * Campos auditáveis da Identificação. O CNPJ fica de fora de propósito: é
 * imutável após a ativação (SPEC-003 §3.2) e tentativa de alteração é rejeitada
 * antes de chegar aqui, não registrada como mudança.
 */
const CAMPOS_DA_IDENTIFICACAO = [
  'razaoSocial',
  'nomeFantasia',
  'logoArquivoId',
  'telefone',
  'email',
] as const;

export const camposAlteradosNaIdentificacao = (
  anterior: IdentificacaoDaEmpresa,
  novo: IdentificacaoDaEmpresa,
): readonly CampoAlterado[] =>
  compararCampos(anterior, novo, CAMPOS_DA_IDENTIFICACAO);

const CAMPOS_DOS_DADOS_FISCAIS = [
  'regimeTributario',
  'enquadramentoSimples',
  'cnaePrincipal',
] as const;

export const camposAlteradosNosDadosFiscais = <
  T extends Record<(typeof CAMPOS_DOS_DADOS_FISCAIS)[number], string | null>,
>(
  anterior: T,
  novo: T,
): readonly CampoAlterado[] => compararCampos(anterior, novo, CAMPOS_DOS_DADOS_FISCAIS);

export type DiferencaExterna = Readonly<{
  campo: string;
  valorAtual: string | null;
  valorExterno: string | null;
}>;

/**
 * Campos que a CNPJá pode atualizar (SPEC-003 §3.3). O CNPJ não entra: é a
 * chave da consulta e é imutável, então nunca vira diferença selecionável.
 */
const CAMPOS_COMPARAVEIS_COM_A_FONTE = [
  'razaoSocial',
  'nomeFantasia',
  'telefone',
  'email',
  'cnaePrincipal',
] as const;

export type CamposDaFonteExterna = Readonly<
  Record<(typeof CAMPOS_COMPARAVEIS_COM_A_FONTE)[number], string | null>
>;

/**
 * Compara o cadastro com o retorno da fonte externa e devolve as diferenças
 * para o usuário escolher campo a campo. **Nada é aplicado aqui**: a função é
 * de leitura e a aplicação exige confirmação humana (SPEC-003 §3.3).
 *
 * Campo que a fonte não trouxe (`null`) não vira diferença — ausência na fonte
 * não é motivo para apagar dado já cadastrado.
 */
export const diferencasDaFonteExterna = (
  atuais: CamposDaFonteExterna,
  externos: CamposDaFonteExterna,
): readonly DiferencaExterna[] =>
  CAMPOS_COMPARAVEIS_COM_A_FONTE.flatMap((campo) => {
    const valorAtual = normalizar(atuais[campo]);
    const valorExterno = normalizar(externos[campo]);

    if (valorExterno === null || valorAtual === valorExterno) {
      return [];
    }

    return [{ campo, valorAtual, valorExterno }];
  });

/** Aba do histórico a que cada campo pertence (SPEC-003 §3.6). */
export const abaDoCampo = (campo: string): AbaDoHistorico => {
  if (campo.startsWith('enderecos.')) {
    return 'ENDERECOS';
  }

  return (CAMPOS_DOS_DADOS_FISCAIS as readonly string[]).includes(campo) ||
    campo.startsWith('cnaesSecundarios') ||
    campo.startsWith('inscricao')
    ? 'DADOS_FISCAIS'
    : 'DADOS_CADASTRAIS';
};
