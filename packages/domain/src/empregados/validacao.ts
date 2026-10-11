/**
 * Validação integral do lote de importação de empregados (SPEC-014 §3.3–3.4 e §3.6).
 *
 * Função pura: a base vigente entra por parâmetro e nada consulta banco ou relógio. Cada linha
 * recebe no máximo UM código de erro, na ordem: estrutura → campo obrigatório (cpf, nome,
 * matrícula, nascimento, admissão) → CPF → nascimento → admissão → admissão posterior ao
 * nascimento → chave duplicada no arquivo → empregado arquivado. Erro de linha não interrompe as
 * demais. As mensagens não repetem CPF nem nome (PII fica nas colunas próprias do relatório).
 *
 * Chave natural: `${cpf11}|${matrícula}`. O CPF entra só com os 11 dígitos (máscara não conta); a
 * matrícula entra como veio da normalização (aparada, NFC, caixa e zeros preservados).
 *
 * Duplicidade: a chave está "formada" quando o CPF é válido e a matrícula não é vazia, mesmo que
 * a linha tenha outro defeito (data ruim, nome vazio). Toda chave formada que aparece mais de uma
 * vez no arquivo rejeita TODAS as suas ocorrências; a linha que já tinha outro erro mantém o
 * próprio erro. Linha com defeito de estrutura (colunas deslocadas) não forma chave.
 */
import { ehCpfValido, normalizarCpf } from '../validadores/cpf.js';
import { lerDataCivil, type DataCivil } from '../datas/data-civil.js';
import {
  MENSAGEM_DA_REJEICAO_ESTRUTURAL,
  type RejeicaoEstruturalDaLinha,
} from '../planilhas/rejeicao-estrutural.js';
import type { CampoDeEmpregado, CodigoDeErroDeEmpregado } from './campos.js';

export type DefeitoDeEstruturaDeEmpregado = 'CAMPOS_A_MAIS';

/** Linha como sai da leitura do CSV, com os textos já aparados por `normalizarLinhasDeEmpregados`. */
export interface LinhaBrutaDeEmpregado {
  readonly numeroDaLinha: number;
  readonly cpf: string;
  readonly nome: string;
  readonly matricula: string;
  readonly dataNascimento: string;
  readonly dataAdmissao: string;
  /** `CAMPOS_A_MAIS`: mais campos preenchidos que o cabeçalho; as colunas da linha são inconfiáveis. */
  readonly defeitoDeEstrutura?: DefeitoDeEstruturaDeEmpregado;
  /**
   * Fórmula ou mescla na célula de um campo mapeado (só planilha, SPEC-015): a linha é rejeitada com
   * o código e o campo, antes de qualquer outra regra.
   */
  readonly rejeicaoEstrutural?: RejeicaoEstruturalDaLinha<CampoDeEmpregado>;
}

export type EmpregadoVigente = Readonly<{ arquivado: boolean }>;

/**
 * Resultado por linha, na ordem de entrada: serve de staging e de linha do relatório.
 *
 * - `cpf`: como estava no arquivo (a máscara de exibição é da interface); `cpfNormalizado`: 11
 *   dígitos, só quando o CPF é válido.
 * - `dataNascimento` / `dataAdmissao`: `aaaa-mm-dd` quando legíveis; senão o texto original, para
 *   o relatório mostrar o que veio. Em linha `VALIDA` são sempre `aaaa-mm-dd`.
 * - `chave`: presente sempre que a chave está formada (inclusive em linha rejeitada).
 * - `campo`: `cpf | nome | matricula | data_nascimento | data_admissao`; `null` no defeito de
 *   estrutura (nenhuma coluna é confiável).
 */
export type LinhaDeStagingDeEmpregado = Readonly<{
  numeroDaLinha: number;
  cpf: string | null;
  cpfNormalizado: string | null;
  nome: string | null;
  matricula: string | null;
  dataNascimento: DataCivil | string | null;
  dataAdmissao: DataCivil | string | null;
  chave: string | null;
  status: 'VALIDA' | 'REJEITADA';
  acao: 'INCLUIR' | 'ATUALIZAR' | null;
  codigoDeErro: CodigoDeErroDeEmpregado | null;
  campo: CampoDeEmpregado | null;
  mensagem: string | null;
}>;

const ROTULO_DO_CAMPO: Readonly<Record<CampoDeEmpregado, string>> = {
  cpf: 'CPF',
  nome: 'nome completo',
  matricula: 'matrícula',
  data_nascimento: 'data de nascimento',
  data_admissao: 'data de admissão',
};

const FORMATOS_DE_DATA = 'use dd/mm/aaaa ou aaaa-mm-dd, em uma data que exista no calendário';

const MENSAGEM: Readonly<Record<Exclude<CodigoDeErroDeEmpregado, 'CAMPO_OBRIGATORIO_AUSENTE'>, string>> = {
  ...MENSAGEM_DA_REJEICAO_ESTRUTURAL,
  CPF_INVALIDO: 'CPF inválido: informe 11 dígitos com os dígitos verificadores corretos.',
  DATA_NASCIMENTO_INVALIDA: `Data de nascimento inválida: ${FORMATOS_DE_DATA}.`,
  DATA_ADMISSAO_INVALIDA: `Data de admissão inválida: ${FORMATOS_DE_DATA}.`,
  ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO: 'A data de admissão deve ser posterior à data de nascimento.',
  CHAVE_DUPLICADA_NO_ARQUIVO:
    'A combinação CPF + matrícula aparece mais de uma vez no arquivo; todas as ocorrências foram rejeitadas.',
  EMPREGADO_ARQUIVADO:
    'Empregado arquivado: a importação não reativa; a reativação é feita no cadastro de empregados (MVP-3).',
};

const MENSAGEM_CAMPOS_A_MAIS = "A linha tem mais campos do que o cabeçalho; confira ';' ou aspas no texto.";

/**
 * Forma aceita do CPF no arquivo: 11 dígitos, ou o padrão `000.000.000-00` (a pontuação, quando
 * presente, só nas posições da máscara). `ehCpfValido` descarta todo não-dígito, então sozinho
 * aceitaria `5299822472x5` ou `CPF 52998224725`; a forma é exigida aqui, no importador.
 */
const FORMA_DO_CPF = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/u;

const cpfAceito = (cpf: string): boolean => FORMA_DO_CPF.test(cpf) && ehCpfValido(cpf);

const vazioParaNulo = (valor: string): string | null => (valor === '' ? null : valor);

const comoLida = (texto: string): DataCivil | string | null => lerDataCivil(texto) ?? vazioParaNulo(texto);

const montarChave = (linha: LinhaBrutaDeEmpregado): string | null =>
  linha.defeitoDeEstrutura === undefined && cpfAceito(linha.cpf) && linha.matricula !== ''
    ? `${normalizarCpf(linha.cpf)}|${linha.matricula}`
    : null;

/** Primeira regra de conteúdo violada pela linha, isolada das demais; `null` se a linha passa. */
const primeiroErroDaLinha = (
  linha: LinhaBrutaDeEmpregado,
): Readonly<{ codigo: CodigoDeErroDeEmpregado; campo: CampoDeEmpregado | null; mensagem: string }> | null => {
  if (linha.rejeicaoEstrutural !== undefined) {
    const { codigo, campo } = linha.rejeicaoEstrutural;
    return { codigo, campo, mensagem: MENSAGEM[codigo] };
  }
  if (linha.defeitoDeEstrutura === 'CAMPOS_A_MAIS') {
    return { codigo: 'CAMPO_OBRIGATORIO_AUSENTE', campo: null, mensagem: MENSAGEM_CAMPOS_A_MAIS };
  }

  const obrigatorios: ReadonlyArray<readonly [CampoDeEmpregado, string]> = [
    ['cpf', linha.cpf],
    ['nome', linha.nome],
    ['matricula', linha.matricula],
    ['data_nascimento', linha.dataNascimento],
    ['data_admissao', linha.dataAdmissao],
  ];
  const ausente = obrigatorios.find(([, valor]) => valor === '');
  if (ausente) {
    return {
      codigo: 'CAMPO_OBRIGATORIO_AUSENTE',
      campo: ausente[0],
      mensagem: `O campo ${ROTULO_DO_CAMPO[ausente[0]]} é obrigatório e está em branco.`,
    };
  }

  if (!cpfAceito(linha.cpf)) {
    return { codigo: 'CPF_INVALIDO', campo: 'cpf', mensagem: MENSAGEM.CPF_INVALIDO };
  }

  const nascimento = lerDataCivil(linha.dataNascimento);
  if (nascimento === null) {
    return { codigo: 'DATA_NASCIMENTO_INVALIDA', campo: 'data_nascimento', mensagem: MENSAGEM.DATA_NASCIMENTO_INVALIDA };
  }

  const admissao = lerDataCivil(linha.dataAdmissao);
  if (admissao === null) {
    return { codigo: 'DATA_ADMISSAO_INVALIDA', campo: 'data_admissao', mensagem: MENSAGEM.DATA_ADMISSAO_INVALIDA };
  }

  // `aaaa-mm-dd` ordena como texto.
  if (admissao <= nascimento) {
    return {
      codigo: 'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO',
      campo: 'data_admissao',
      mensagem: MENSAGEM.ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO,
    };
  }

  return null;
};

const rejeitada = (
  base: Omit<LinhaDeStagingDeEmpregado, 'status' | 'acao' | 'codigoDeErro' | 'campo' | 'mensagem'>,
  codigo: CodigoDeErroDeEmpregado,
  campo: CampoDeEmpregado | null,
  mensagem: string,
): LinhaDeStagingDeEmpregado => ({
  ...base,
  status: 'REJEITADA',
  acao: null,
  codigoDeErro: codigo,
  campo,
  mensagem,
});

/** Defesa em profundidade: `normalizarLinhasDeEmpregados` já apara, mas a validação não confia. */
const aparar = (linha: LinhaBrutaDeEmpregado): LinhaBrutaDeEmpregado => ({
  ...linha,
  cpf: linha.cpf.trim(),
  nome: linha.nome.trim(),
  matricula: linha.matricula.trim(),
  dataNascimento: linha.dataNascimento.trim(),
  dataAdmissao: linha.dataAdmissao.trim(),
});

export const validarLinhasDeEmpregados = (
  entrada: readonly LinhaBrutaDeEmpregado[],
  vigentes: ReadonlyMap<string, EmpregadoVigente>,
): readonly LinhaDeStagingDeEmpregado[] => {
  const linhas = entrada.map(aparar);
  const chaves = linhas.map(montarChave);
  const ocorrencias = new Map<string, number>();
  for (const chave of chaves) {
    if (chave !== null) {
      ocorrencias.set(chave, (ocorrencias.get(chave) ?? 0) + 1);
    }
  }

  return linhas.map((linha, indice): LinhaDeStagingDeEmpregado => {
    const chave = chaves[indice] ?? null;
    const base = {
      numeroDaLinha: linha.numeroDaLinha,
      cpf: vazioParaNulo(linha.cpf),
      cpfNormalizado: cpfAceito(linha.cpf) ? normalizarCpf(linha.cpf) : null,
      nome: vazioParaNulo(linha.nome),
      matricula: vazioParaNulo(linha.matricula),
      dataNascimento: comoLida(linha.dataNascimento),
      dataAdmissao: comoLida(linha.dataAdmissao),
      chave,
    };

    const erro = primeiroErroDaLinha(linha);
    if (erro) {
      return rejeitada(base, erro.codigo, erro.campo, erro.mensagem);
    }
    if (chave === null) {
      // Invariante: sem erro de conteúdo, CPF válido e matrícula presente formam a chave.
      throw new Error('Linha sem erro de conteúdo e sem chave natural.');
    }
    if ((ocorrencias.get(chave) ?? 0) > 1) {
      return rejeitada(base, 'CHAVE_DUPLICADA_NO_ARQUIVO', 'matricula', MENSAGEM.CHAVE_DUPLICADA_NO_ARQUIVO);
    }

    const vigente = vigentes.get(chave);
    if (vigente?.arquivado) {
      return rejeitada(base, 'EMPREGADO_ARQUIVADO', 'matricula', MENSAGEM.EMPREGADO_ARQUIVADO);
    }

    return {
      ...base,
      status: 'VALIDA',
      acao: vigente ? 'ATUALIZAR' : 'INCLUIR',
      codigoDeErro: null,
      campo: null,
      mensagem: null,
    };
  });
};
