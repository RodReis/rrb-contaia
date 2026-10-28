/**
 * Rótulos próprios do plano de contas (SPEC-013 §3.3, §3.4): campos do contrato, erros de linha,
 * tipo e natureza. Estados e formatação comuns às importações ficam em `importacao/apresentacao`.
 */
import type { CampoDoContrato } from '@contaia/domain';
import type { CodigoDeErroDaLinha, TipoDeConta, NaturezaDeConta } from '@contaia/shared';

export const ROTULO_DO_CAMPO: Readonly<Record<CampoDoContrato, string>> = {
  codigo: 'Código',
  nome: 'Nome',
  tipo: 'Tipo',
  natureza: 'Natureza',
  conta_pai: 'Conta-pai',
  classe_contabil: 'Classe contábil',
};

export const AJUDA_DO_CAMPO: Readonly<Record<CampoDoContrato, string>> = {
  codigo: 'Único na empresa; é a chave que inclui ou atualiza a conta.',
  nome: 'Descrição da conta.',
  tipo: 'Valores aceitos: analítica ou sintética.',
  natureza: 'Valores aceitos: devedora ou credora.',
  conta_pai: 'Código da conta superior; vazia só na conta raiz.',
  classe_contabil: 'Classe opcional no arquivo. Classe ausente continua pendente de classificação manual.',
};

const ehCampoDoContrato = (campo: string): campo is CampoDoContrato => campo in ROTULO_DO_CAMPO;

/** Campo da rejeição como a API o devolve (`conta_pai`, `null` = a linha inteira). */
export const rotuloDoCampo = (campo: string | null): string =>
  campo === null ? 'Linha inteira' : ehCampoDoContrato(campo) ? ROTULO_DO_CAMPO[campo] : campo;

export const ROTULO_DO_ERRO_DA_LINHA: Readonly<Record<CodigoDeErroDaLinha, string>> = {
  CAMPO_OBRIGATORIO_AUSENTE: 'Campo obrigatório ausente',
  VALOR_FORA_DO_DOMINIO: 'Valor fora do permitido',
  CODIGO_DUPLICADO_NO_ARQUIVO: 'Código repetido no arquivo',
  CONTA_PAI_INEXISTENTE: 'Conta-pai inexistente',
  CONTA_PAI_REJEITADA: 'Conta-pai rejeitada',
  CICLO_HIERARQUICO: 'Ciclo na hierarquia',
  SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA: 'Sintética com filhas',
  CONTA_ARQUIVADA: 'Conta arquivada',
  CELULA_COM_FORMULA: 'Fórmula na célula',
  CELULA_MESCLADA: 'Célula mesclada',
};

/** Quando a linha não traz mensagem própria, o rótulo do código já orienta. */
export const MENSAGEM_PADRAO_DO_ERRO: Readonly<Record<CodigoDeErroDaLinha, string>> = {
  CAMPO_OBRIGATORIO_AUSENTE: 'Preencha os campos obrigatórios da linha.',
  VALOR_FORA_DO_DOMINIO: 'A linha tem um valor fora do permitido.',
  CODIGO_DUPLICADO_NO_ARQUIVO: 'Deixe uma linha só por código; todas as ocorrências foram rejeitadas.',
  CONTA_PAI_INEXISTENTE: 'A conta-pai não existe no plano nem entre as linhas válidas do arquivo.',
  CONTA_PAI_REJEITADA: 'A conta-pai foi rejeitada neste arquivo; corrija a linha dela.',
  CICLO_HIERARQUICO: 'A conta faz parte de um ciclo de conta-pai; revise a hierarquia.',
  SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA: 'A conta tem filhas no plano e não pode virar analítica.',
  CONTA_ARQUIVADA: 'A conta está arquivada; reative-a separadamente antes de importar.',
  CELULA_COM_FORMULA: 'Substitua a fórmula da célula pelo valor e reenvie a planilha.',
  CELULA_MESCLADA: 'Desfaça a mescla da célula, preencha o valor e reenvie a planilha.',
};

export const ROTULO_DO_TIPO: Readonly<Record<TipoDeConta, string>> = {
  analitica: 'Analítica',
  sintetica: 'Sintética',
};

export const ROTULO_DA_NATUREZA: Readonly<Record<NaturezaDeConta, string>> = {
  devedora: 'Devedora',
  credora: 'Credora',
};
