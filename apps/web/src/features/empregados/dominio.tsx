/**
 * Empregados como domínio do fluxo comum de importação (SPEC-014): rota, os cinco campos, CPF e
 * matrícula identificando a linha rejeitada, regras do arquivo, permissões e textos. Nada de cargo,
 * salário, dependentes, folha, eSocial ou IA (SPEC §5.1, §11).
 *
 * O domínio nasce com o nome da empresa: a confirmação nomeia a empresa onde a base vai mudar.
 */
import { CAMPOS_DE_EMPREGADO, validarMapeamentoDeEmpregados } from '@contaia/domain';
import { PaginaDeRejeicoesDeEmpregadosSchema, PreviaDaImportacaoDeEmpregadosSchema } from '@contaia/shared';

import { plural } from '../importacao/apresentacao';
import { sugerirMapeamento } from '../importacao/cabecalho-csv';
import type { DominioDaImportacao, RejeicaoBase, Totais } from '../importacao/dominio';
import {
  AJUDA_DO_CAMPO,
  MENSAGEM_PADRAO_DO_ERRO,
  ROTULO_DO_ERRO_DA_LINHA,
  cpfParaExibir,
  ehCampoDeEmpregado,
  ehCodigoDeErroDeEmpregado,
  rotuloDoCampo,
} from './apresentacao';
import { permissoesDeEmpregados } from './permissoes';

const Ausente = ({ texto }: { texto: string }) => (
  <span className="font-sans text-body-sm text-muted-foreground">{texto}</span>
);

const CpfDaLinha = ({ rejeicao }: { rejeicao: RejeicaoBase }) => {
  const cpf = rejeicao['cpf'];

  return typeof cpf === 'string' && cpf !== '' ? cpfParaExibir(cpf) : <Ausente texto="sem CPF" />;
};

const MatriculaDaLinha = ({ rejeicao }: { rejeicao: RejeicaoBase }) => {
  const matricula = rejeicao['matricula'];

  return typeof matricula === 'string' && matricula !== '' ? matricula : <Ausente texto="sem matrícula" />;
};

const REGRAS: readonly string[] = [
  'CPF e matrícula juntos identificam o empregado: chave nova inclui, chave existente atualiza nome, nascimento e admissão.',
  'A mesma chave repetida no arquivo rejeita todas as linhas com ela.',
  'Empregados que não estão no arquivo continuam como estão.',
  'Empregado arquivado não é alterado nem reativado pela importação.',
];

const aplicadas = (totais: Totais | null): string =>
  `${plural(totais?.novas ?? 0, 'empregado novo incluído', 'empregados novos incluídos')} e ${plural(
    totais?.atualizadas ?? 0,
    'atualizado',
    'atualizados',
  )}`;

const aplicadasNoAviso = (totais: Totais | null): string =>
  `${plural(totais?.novas ?? 0, 'empregado novo', 'empregados novos')} e ${plural(
    totais?.atualizadas ?? 0,
    'atualizado',
    'atualizados',
  )}`;

const decisao = (totais: Totais): string =>
  [
    `${plural(totais.novas, 'empregado novo será incluído', 'empregados novos serão incluídos')} e ${plural(
      totais.atualizadas,
      'existente será atualizado',
      'existentes serão atualizados',
    )} por CPF e matrícula, numa única transação.`,
    totais.rejeitadas > 0
      ? `${plural(totais.rejeitadas, 'linha rejeitada fica', 'linhas rejeitadas ficam')} de fora e no relatório.`
      : '',
    'Empregados que não estão no arquivo continuam como estão.',
  ]
    .filter((frase) => frase !== '')
    .join(' ');

export const ABA_DE_EMPREGADOS = 'empregados';

/** Nulo = empresa sem nome fantasia nem razão social; a frase muda para não sair "em a empresa". */
export const criarDominioDeEmpregados = (nomeDaEmpresa: string | null): DominioDaImportacao => ({
  aba: ABA_DE_EMPREGADOS,
  recurso: 'empregados',
  tipoDeArquivo: 'IMPORTACAO_EMPREGADOS',
  lerPrevia: (corpo) => PreviaDaImportacaoDeEmpregadosSchema.parse(corpo),
  lerRejeicoes: (corpo) => PaginaDeRejeicoesDeEmpregadosSchema.parse(corpo),
  campos: CAMPOS_DE_EMPREGADO,
  rotuloDoCampo,
  ajudaDoCampo: (campo) => (ehCampoDeEmpregado(campo) ? AJUDA_DO_CAMPO[campo] : ''),
  mapeamentoSugerido: (cabecalho) => sugerirMapeamento(CAMPOS_DE_EMPREGADO, cabecalho),
  pendenciasDoRascunho: (cabecalho, rascunho) => {
    const resultado = validarMapeamentoDeEmpregados(rascunho, cabecalho);

    return resultado.ok ? [] : resultado.pendencias;
  },
  rotuloDoErro: (codigo) => (ehCodigoDeErroDeEmpregado(codigo) ? ROTULO_DO_ERRO_DA_LINHA[codigo] : codigo),
  mensagemPadraoDoErro: (codigo) => (ehCodigoDeErroDeEmpregado(codigo) ? MENSAGEM_PADRAO_DO_ERRO[codigo] : ''),
  colunasDaRejeicao: [
    { titulo: 'CPF', celula: (rejeicao) => <CpfDaLinha rejeicao={rejeicao} /> },
    { titulo: 'Matrícula', celula: (rejeicao) => <MatriculaDaLinha rejeicao={rejeicao} /> },
  ],
  regras: REGRAS,
  nomeDoModelo: 'modelo-empregados.csv',
  permissoes: permissoesDeEmpregados,
  textos: {
    arquivoCsv: 'Arquivo CSV dos empregados',
    arrasteAqui: 'Arraste o CSV dos empregados aqui',
    semPermissaoDeImportar: {
      titulo: 'Seu papel pode consultar os empregados, mas não tem permissão para importar.',
      descricao:
        'O envio de CSV é feito por quem tem a permissão Importar em Empresas → Empregados. O histórico e a base importada continuam disponíveis abaixo.',
    },
    emAndamento: 'Acompanhe o processamento; nenhum empregado muda antes da sua confirmação.',
    anuncioAplicando: 'Aplicando as linhas válidas à base de empregados.',
    tituloAplicando: 'Aplicando à base de empregados',
    descricaoValidando:
      'Cada linha é conferida contra a base atual e contra as demais linhas do arquivo. Nenhum empregado muda antes da sua confirmação; você pode sair desta tela e voltar pelo histórico.',
    tituloDaConfirmacao: (arquivo) =>
      nomeDaEmpresa === null
        ? `Confirmar a importação de ${arquivo} nesta empresa?`
        : `Confirmar a importação de ${arquivo} em ${nomeDaEmpresa}?`,
    decisao,
    descricaoDoCancelamento:
      'Nenhum empregado é incluído ou alterado. A tentativa, o arquivo e o relatório ficam no histórico como cancelados.',
    conflito: {
      titulo: 'A base de empregados mudou depois desta validação',
      descricao:
        'Nenhum empregado foi alterado. Esta prévia ficou obsoleta: cancele-a e valide novamente, enviando o arquivo de novo para a validação usar a base atual.',
      cancelar: (arquivo) =>
        `A tentativa de ${arquivo} fica no histórico como cancelada e nenhum empregado muda. Em seguida, envie o arquivo de novo.`,
    },
    confirmando: 'Confirmação em andamento: aplicando as linhas válidas à base de empregados.',
    confirmacaoNegada:
      'A confirmação ou o cancelamento desta prévia é feito por quem tem a permissão Confirmar importação em Empresas → Empregados.',
    aplicadas,
    aplicadasNoAviso,
    concluida: 'Os empregados que não estavam no arquivo continuam como estavam.',
    rejeitada:
      'Nenhuma linha do arquivo pôde ser aplicada. Veja os motivos abaixo, corrija o CSV de origem e envie de novo. Enquanto a empresa não tiver nenhum empregado confirmado, a pendência de empregados não importados segue aberta na Central de Pendências.',
    cancelada: 'Nenhum empregado foi incluído ou alterado. A tentativa, o arquivo e o relatório ficam no histórico.',
    falhaTecnica:
      'A importação falhou por um problema técnico. Nenhum empregado foi alterado; envie o arquivo de novo para uma nova tentativa.',
    previstasNaoAplicadas: 'Nenhuma foi aplicada: a aplicação falhou e a base de empregados não mudou.',
    rejeicoesNaoEntram: 'Corrija no CSV de origem e envie uma nova tentativa; estas linhas não entram na base de empregados.',
    legendaDoHistorico: 'Importações de empregados',
    avisoDeCancelamento: 'Importação cancelada. Nenhum empregado foi alterado.',
  },
});
