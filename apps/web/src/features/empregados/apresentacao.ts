/**
 * Rótulos e formatação próprios de empregado (SPEC-014 §3.3, §3.4): campos do contrato, erros de
 * linha, CPF e data civil. CPF sempre completo, `000.000.000-00` (PATTERNS.md §3); data civil sem
 * passar por `Date`, que erraria o dia perto da meia-noite (FRONTEND.md §12).
 */
import {
  CAMPOS_DE_EMPREGADO,
  CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO,
  formatarCpf,
  type CampoDeEmpregado,
  type CodigoDeErroDeEmpregado,
} from '@contaia/domain';

export const ROTULO_DO_CAMPO: Readonly<Record<CampoDeEmpregado, string>> = {
  cpf: 'CPF',
  nome: 'Nome completo',
  matricula: 'Matrícula',
  data_nascimento: 'Data de nascimento',
  data_admissao: 'Data de admissão',
};

export const AJUDA_DO_CAMPO: Readonly<Record<CampoDeEmpregado, string>> = {
  cpf: 'Onze dígitos, com ou sem a pontuação 000.000.000-00. Com a matrícula, identifica o empregado.',
  nome: 'Nome do empregado, sem deixar em branco.',
  matricula: 'Lida como está: 00123 e 123 são matrículas diferentes.',
  data_nascimento: 'dd/mm/aaaa ou aaaa-mm-dd, com uma data que exista no calendário.',
  data_admissao: 'dd/mm/aaaa ou aaaa-mm-dd, posterior à data de nascimento.',
};

export const ROTULO_DO_ERRO_DA_LINHA: Readonly<Record<CodigoDeErroDeEmpregado, string>> = {
  CAMPO_OBRIGATORIO_AUSENTE: 'Campo obrigatório ausente',
  CPF_INVALIDO: 'CPF inválido',
  DATA_NASCIMENTO_INVALIDA: 'Data de nascimento inválida',
  DATA_ADMISSAO_INVALIDA: 'Data de admissão inválida',
  ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO: 'Admissão não posterior ao nascimento',
  CHAVE_DUPLICADA_NO_ARQUIVO: 'CPF e matrícula repetidos no arquivo',
  EMPREGADO_ARQUIVADO: 'Empregado arquivado',
  CELULA_COM_FORMULA: 'Fórmula na célula',
  CELULA_MESCLADA: 'Célula mesclada',
};

/** Quando a linha não traz mensagem própria, o rótulo do código já orienta. */
export const MENSAGEM_PADRAO_DO_ERRO: Readonly<Record<CodigoDeErroDeEmpregado, string>> = {
  CAMPO_OBRIGATORIO_AUSENTE: 'Preencha os campos obrigatórios da linha.',
  CPF_INVALIDO: 'Confira os 11 dígitos e os dígitos verificadores do CPF.',
  DATA_NASCIMENTO_INVALIDA: 'Use dd/mm/aaaa ou aaaa-mm-dd com uma data que exista no calendário.',
  DATA_ADMISSAO_INVALIDA: 'Use dd/mm/aaaa ou aaaa-mm-dd com uma data que exista no calendário.',
  ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO: 'A data de admissão precisa ser posterior à de nascimento.',
  CHAVE_DUPLICADA_NO_ARQUIVO: 'Deixe uma linha só por CPF e matrícula; todas as ocorrências foram rejeitadas.',
  EMPREGADO_ARQUIVADO: 'O empregado está arquivado e não é alterado nem reativado pela importação.',
  CELULA_COM_FORMULA: 'Substitua a fórmula da célula pelo valor e reenvie a planilha.',
  CELULA_MESCLADA: 'Desfaça a mescla da célula, preencha o valor e reenvie a planilha.',
};

export const ehCampoDeEmpregado = (campo: string): campo is CampoDeEmpregado =>
  (CAMPOS_DE_EMPREGADO as readonly string[]).includes(campo);

export const ehCodigoDeErroDeEmpregado = (codigo: string): codigo is CodigoDeErroDeEmpregado =>
  (CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO as readonly string[]).includes(codigo);

/** Campo da rejeição como a API o devolve (`data_admissao`, `null` = a linha inteira). */
export const rotuloDoCampo = (campo: string | null): string =>
  campo === null ? 'Linha inteira' : ehCampoDeEmpregado(campo) ? ROTULO_DO_CAMPO[campo] : campo;

/**
 * CPF para exibição: com 11 dígitos (pontuados ou não), sempre `000.000.000-00`; outro texto — um
 * CPF inválido como veio no arquivo — aparece como está, para a pessoa achar a linha na origem.
 */
export const cpfParaExibir = (cpf: string): string => (/^\d{11}$/u.test(cpf.replace(/[.-]/gu, '')) ? formatarCpf(cpf) : cpf);

/** `1990-02-14` → `14/02/1990`, por texto. */
export const formatarDataCivil = (data: string): string => {
  const [ano, mes, dia] = data.split('-');

  return ano === undefined || mes === undefined || dia === undefined ? data : `${dia}/${mes}/${ano}`;
};
