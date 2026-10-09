/**
 * Mensagem acionável (PT-BR) gravada no staging para cada rejeição de linha (SPEC-013 §3.4: "cada
 * rejeição informa linha, código, campo, código de erro estável e mensagem acionável"). Quando a
 * validação do domínio já traz um texto próprio (defeito de estrutura, limite de coluna), ele vence;
 * senão vale o texto padrão do código de erro.
 */
import type { CodigoDeErroDaLinha, LinhaRejeitada } from '@contaia/domain';

const ROTULOS_DOS_CAMPOS: Readonly<Record<string, string>> = {
  codigo: 'código',
  nome: 'nome',
  tipo: 'tipo',
  natureza: 'natureza',
  conta_pai: 'conta-pai',
};

const rotulo = (campo: string | null): string | null => (campo === null ? null : (ROTULOS_DOS_CAMPOS[campo] ?? campo));

const foraDoDominio = (campo: string | null): string => {
  if (campo === 'tipo') {
    return 'O tipo deve ser "analítica" ou "sintética".';
  }
  if (campo === 'natureza') {
    return 'A natureza deve ser "devedora" ou "credora".';
  }
  const nome = rotulo(campo);

  return nome === null ? 'A linha tem um valor fora do permitido.' : `O valor de ${nome} está fora do permitido.`;
};

const MENSAGENS_FIXAS: Readonly<Record<Exclude<CodigoDeErroDaLinha, 'CAMPO_OBRIGATORIO_AUSENTE' | 'VALOR_FORA_DO_DOMINIO'>, string>> = {
  CODIGO_DUPLICADO_NO_ARQUIVO:
    'O código aparece mais de uma vez no arquivo e todas as ocorrências foram rejeitadas; deixe uma linha só por código.',
  CONTA_PAI_INEXISTENTE: 'A conta-pai não existe no plano de contas nem entre as linhas válidas do arquivo.',
  CONTA_PAI_REJEITADA: 'A conta-pai foi rejeitada neste arquivo; corrija a linha dela e envie de novo.',
  CICLO_HIERARQUICO: 'A conta faz parte de um ciclo de conta-pai; revise a hierarquia.',
  SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA:
    'A conta é sintética e tem filhas no plano de contas; ela não pode virar analítica.',
  CONTA_ARQUIVADA: 'A conta está arquivada e a importação não a altera; reative-a separadamente antes de importar.',
};

export const mensagemPadraoDaRejeicao = (codigoDeErro: CodigoDeErroDaLinha, campo: string | null): string => {
  switch (codigoDeErro) {
    case 'CAMPO_OBRIGATORIO_AUSENTE': {
      if (campo === 'conta_pai') {
        return 'Preencha a conta-pai: ela é obrigatória para conta que não é raiz.';
      }
      const nome = rotulo(campo);

      return nome === null ? 'Preencha os campos obrigatórios da linha.' : `Preencha o campo ${nome}: ele é obrigatório.`;
    }
    case 'VALOR_FORA_DO_DOMINIO':
      return foraDoDominio(campo);
    default:
      return MENSAGENS_FIXAS[codigoDeErro];
  }
};

/** A mensagem do domínio, quando houver; senão a padrão do código. */
export const mensagemDaRejeicao = (rejeicao: LinhaRejeitada): string =>
  rejeicao.mensagem ?? mensagemPadraoDaRejeicao(rejeicao.codigoDeErro, rejeicao.campo);
