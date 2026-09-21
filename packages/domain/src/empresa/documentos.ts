/**
 * Documentos da empresa cliente (SPEC-004).
 *
 * Aqui moram o checklist, a aplicabilidade das inscrições, a máquina de estados
 * do documento e a regra de validade. Nada consulta banco, storage ou relógio:
 * o "agora" entra por parâmetro (`CLAUDE.md`, convenções de código).
 *
 * A regra que atravessa o arquivo: **análise é sempre explícita**. Nenhuma
 * função aqui devolve `APROVADO` a partir de um envio — aprovar é ato próprio
 * do `admin_escritorio`, mesmo quando foi ele quem subiu o arquivo (§2.3).
 */

import { CODIGOS_DE_ERRO, type CampoInvalido, ErroDeDominio } from '../erros.js';
import type { SituacaoDeInscricao } from './cadastro.js';
import { dataCivilEmSaoPaulo } from './manutencao.js';

const preenchido = (valor: string | null | undefined): boolean =>
  typeof valor === 'string' && valor.trim().length > 0;

// -- Checklist ---------------------------------------------------------------

export const CODIGOS_DO_CHECKLIST = [
  'CONTRATO_SOCIAL',
  'CARTAO_CNPJ',
  'INSCRICAO_ESTADUAL',
  'INSCRICAO_MUNICIPAL',
  'ALVARA_DE_FUNCIONAMENTO',
  'DOCUMENTO_DO_RESPONSAVEL',
  'COMPROVANTE_DE_ENDERECO',
] as const;

export type CodigoDoChecklist = (typeof CODIGOS_DO_CHECKLIST)[number];

export type ItemDoChecklist = Readonly<{
  codigo: CodigoDoChecklist;
  nome: string;
  /**
   * Condicional é a exigência que só existe conforme o cadastro da empresa
   * (§2.1 e §2.2). As demais valem para toda empresa, sempre.
   */
  condicional: boolean;
}>;

/** Checklist padrão aprovado pelo PI (§2.1), na ordem em que a aba o exibe. */
export const CHECKLIST_PADRAO: readonly ItemDoChecklist[] = [
  {
    codigo: 'CONTRATO_SOCIAL',
    nome: 'Contrato social ou requerimento de empresário',
    condicional: false,
  },
  { codigo: 'CARTAO_CNPJ', nome: 'Cartão CNPJ', condicional: false },
  { codigo: 'INSCRICAO_ESTADUAL', nome: 'Inscrição estadual', condicional: true },
  { codigo: 'INSCRICAO_MUNICIPAL', nome: 'Inscrição municipal', condicional: true },
  { codigo: 'ALVARA_DE_FUNCIONAMENTO', nome: 'Alvará de funcionamento', condicional: true },
  {
    codigo: 'DOCUMENTO_DO_RESPONSAVEL',
    nome: 'Documento do responsável legal',
    condicional: false,
  },
  {
    codigo: 'COMPROVANTE_DE_ENDERECO',
    nome: 'Comprovante de endereço da empresa',
    condicional: false,
  },
];

/**
 * Motivo pelo qual uma exigência condicional é aplicável. `POSSUI` pede o
 * comprovante da inscrição; `ISENTO` pede o comprovante de isenção — são
 * documentos diferentes, e por isso o motivo acompanha a exigência em vez de
 * virar um booleano (§2.2).
 */
export type MotivoDaExigencia = Extract<SituacaoDeInscricao, 'POSSUI' | 'ISENTO'> | null;

export type ExigenciaCalculada = ItemDoChecklist &
  Readonly<{ aplicavel: boolean; motivo: MotivoDaExigencia }>;

export type AplicabilidadeDasInscricoes = Readonly<{
  inscricaoEstadual: SituacaoDeInscricao;
  inscricaoMunicipal: SituacaoDeInscricao;
}>;

const motivoDa = (situacao: SituacaoDeInscricao): MotivoDaExigencia =>
  situacao === 'NAO_SE_APLICA' ? null : situacao;

/**
 * Calcula o checklist aplicável a partir do cadastro (§2.2).
 *
 * `NAO_SE_APLICA` devolve a exigência com `aplicavel: false` em vez de omiti-la
 * da lista: a mudança cadastral na F3 precisa reconciliar a exigência sem
 * apagar o histórico dela, e uma exigência que some da lista some junto com o
 * que já foi enviado.
 *
 * O alvará não depende de inscrição: continua condicional e é decidido pelo
 * escritório na própria aba, não inferido aqui — inferir viraria regra de
 * produto que ninguém aprovou.
 */
export const exigenciasDaAplicabilidade = (
  aplicabilidade: AplicabilidadeDasInscricoes,
): readonly ExigenciaCalculada[] =>
  CHECKLIST_PADRAO.map((item) => {
    if (item.codigo === 'INSCRICAO_ESTADUAL') {
      const situacao = aplicabilidade.inscricaoEstadual;
      return { ...item, aplicavel: situacao !== 'NAO_SE_APLICA', motivo: motivoDa(situacao) };
    }

    if (item.codigo === 'INSCRICAO_MUNICIPAL') {
      const situacao = aplicabilidade.inscricaoMunicipal;
      return { ...item, aplicavel: situacao !== 'NAO_SE_APLICA', motivo: motivoDa(situacao) };
    }

    return { ...item, aplicavel: true, motivo: null };
  });

export const validarNomeDaExigencia = (nome: string | null): readonly CampoInvalido[] =>
  preenchido(nome)
    ? []
    : [{ campo: 'nome', codigo: CODIGOS_DE_ERRO.NOME_DA_EXIGENCIA_OBRIGATORIO }];

// -- Estados -----------------------------------------------------------------

export const ESTADOS_DO_DOCUMENTO = [
  'PENDENTE',
  'ENVIADO',
  'APROVADO',
  'REJEITADO',
  'DISPENSADO',
  'VENCIDO',
] as const;

export type EstadoDoDocumento = (typeof ESTADOS_DO_DOCUMENTO)[number];

export const ehEstadoDoDocumento = (valor: string): valor is EstadoDoDocumento =>
  (ESTADOS_DO_DOCUMENTO as readonly string[]).includes(valor);

const transicaoInvalida = (atual: EstadoDoDocumento, acao: string): never => {
  throw new ErroDeDominio(
    CODIGOS_DE_ERRO.TRANSICAO_DOCUMENTAL_INVALIDA,
    `Não é possível ${acao} um documento no estado ${atual}.`,
  );
};

/**
 * Envio e substituição (§2.3): o arquivo novo entra sempre como `ENVIADO`.
 *
 * Substituir um documento já aprovado também volta para análise — a versão
 * anterior continua preservada, mas o que passa a valer é o arquivo novo, e ele
 * ainda não foi analisado por ninguém.
 *
 * `DISPENSADO` é o único estado que recusa envio: a exigência foi liberada com
 * justificativa, e aceitar arquivo em silêncio deixaria o registro contando
 * duas histórias. Reverter a dispensa é ato próprio.
 */
export const registrarEnvio = (atual: EstadoDoDocumento): EstadoDoDocumento => {
  if (atual === 'DISPENSADO') {
    return transicaoInvalida(atual, 'enviar arquivo para');
  }

  return 'ENVIADO';
};

/** Aprovação (§2.4): só alcança o que está aguardando análise. */
export const aprovarVersao = (atual: EstadoDoDocumento): EstadoDoDocumento => {
  if (atual !== 'ENVIADO') {
    return transicaoInvalida(atual, 'aprovar');
  }

  return 'APROVADO';
};

const exigirJustificativa = (justificativa: string | null, acao: string): void => {
  if (!preenchido(justificativa)) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA,
      `${acao} exige justificativa.`,
      [{ campo: 'justificativa', codigo: CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA }],
    );
  }
};

/**
 * Rejeição (§2.4): exige justificativa e **mantém a exigência pendente** até
 * uma nova versão ser aprovada. Não vira `PENDENTE` porque o histórico precisa
 * distinguir "nunca enviaram" de "enviaram e foi recusado".
 */
export const rejeitarVersao = (
  atual: EstadoDoDocumento,
  justificativa: string | null,
): EstadoDoDocumento => {
  exigirJustificativa(justificativa, 'Rejeição');

  if (atual !== 'ENVIADO') {
    return transicaoInvalida(atual, 'rejeitar');
  }

  return 'REJEITADO';
};

/** Dispensa (§2.4): libera a exigência mediante justificativa. */
export const dispensarExigencia = (
  atual: EstadoDoDocumento,
  justificativa: string | null,
): EstadoDoDocumento => {
  exigirJustificativa(justificativa, 'Dispensa');

  if (atual === 'DISPENSADO') {
    return transicaoInvalida(atual, 'dispensar');
  }

  return 'DISPENSADO';
};

// -- Validade ----------------------------------------------------------------

const FORMATO_DE_DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validade é opcional (§2.4). Diferente da vigência da F3, validade **futura é
 * o caso normal** — o documento vale até lá, e por isso nada aqui compara com
 * o "agora": o que se valida é só o formato de data civil. Quem decide se já
 * venceu é `estadoComVencimento`, que recebe o relógio por parâmetro.
 */
export const validarValidade = (validade: string | null): readonly CampoInvalido[] => {
  if (validade === null) {
    return [];
  }

  if (!FORMATO_DE_DATA_CIVIL.test(validade) || Number.isNaN(Date.parse(`${validade}T00:00:00Z`))) {
    return [{ campo: 'validade', codigo: CODIGOS_DE_ERRO.VALIDADE_INVALIDA }];
  }

  return [];
};

/**
 * Estado observado considerando o vencimento (§2.4).
 *
 * Só o `APROVADO` vence: o enviado ainda aguarda análise, o rejeitado já está
 * pendente de nova versão e o dispensado não tem arquivo para vencer. A
 * comparação é lexicográfica porque `YYYY-MM-DD` ordena como texto — e evita
 * conversão para `Date`, que traria fuso de volta (I-11).
 */
export const estadoComVencimento = (
  estado: EstadoDoDocumento,
  validade: string | null,
  agora: Date,
): EstadoDoDocumento => {
  if (estado !== 'APROVADO' || validade === null) {
    return estado;
  }

  return validade < dataCivilEmSaoPaulo(agora) ? 'VENCIDO' : estado;
};
