/**
 * O plano de contas como domínio do fluxo comum de importação (SPEC-013): rota, campos, colunas da
 * rejeição, regras do arquivo, permissões e textos. Os textos são os que a tela da F13 sempre teve.
 */
import { CAMPOS_DO_CONTRATO, CAMPO_CLASSE_CONTABIL } from '@contaia/domain';
import { PaginaDeRejeicoesDaImportacaoSchema, PreviaDaImportacaoSchema, type CodigoDeErroDaLinha } from '@contaia/shared';

import { mensagemDoCodigo } from '@/lib/mensagens';
import { plural } from '../importacao/apresentacao';
import type { DominioDaImportacao, RejeicaoBase, Totais } from '../importacao/dominio';
import { AJUDA_DO_CAMPO, MENSAGEM_PADRAO_DO_ERRO, ROTULO_DO_CAMPO, ROTULO_DO_ERRO_DA_LINHA, rotuloDoCampo } from './apresentacao';
import { mapeamentoSugerido, pendenciasDoRascunho } from './cabecalho-csv';
import { permissoesDoPlano } from './permissoes';

const ehCodigoDeErro = (codigo: string): codigo is CodigoDeErroDaLinha => codigo in ROTULO_DO_ERRO_DA_LINHA;
const ehCampo = (campo: string): campo is keyof typeof AJUDA_DO_CAMPO => campo in AJUDA_DO_CAMPO;

const CodigoDaConta = ({ rejeicao }: { rejeicao: RejeicaoBase }) => {
  const codigo = rejeicao['codigo'];

  return typeof codigo === 'string' ? (
    codigo
  ) : (
    <span className="font-sans text-body-sm text-muted-foreground">sem código</span>
  );
};

const REGRAS: readonly string[] = [
  'A ordem das linhas não importa: a conta-pai pode vir depois da filha.',
  'Código repetido no arquivo rejeita todas as linhas com esse código.',
  'Código novo inclui a conta; código existente atualiza nome, tipo, natureza e conta-pai. A classe só muda quando a coluna opcional é informada.',
  'Contas que não estão no arquivo continuam como estão.',
  'Conta arquivada não é alterada nem reativada pela importação.',
];

const aplicadas = (totais: Totais | null): string =>
  `${plural(totais?.novas ?? 0, 'conta nova incluída', 'contas novas incluídas')} e ${plural(
    totais?.atualizadas ?? 0,
    'atualizada',
    'atualizadas',
  )}`;

const aplicadasNoAviso = (totais: Totais | null): string =>
  `${plural(totais?.novas ?? 0, 'conta nova', 'contas novas')} e ${plural(totais?.atualizadas ?? 0, 'atualizada', 'atualizadas')}`;

const decisao = (totais: Totais): string =>
  [
    `${plural(totais.novas, 'conta nova será incluída', 'contas novas serão incluídas')} e ${plural(
      totais.atualizadas,
      'existente será atualizada',
      'existentes serão atualizadas',
    )} pelo código, numa única transação.`,
    totais.rejeitadas > 0
      ? `${plural(totais.rejeitadas, 'linha rejeitada fica', 'linhas rejeitadas ficam')} de fora e no relatório.`
      : '',
    'Contas que não estão no arquivo continuam como estão.',
  ]
    .filter((frase) => frase !== '')
    .join(' ');

export const DOMINIO_DO_PLANO: DominioDaImportacao = {
  aba: 'plano-contas',
  recurso: 'plano-contas',
  tipoDeArquivo: 'IMPORTACAO_PLANO_CONTAS',
  lerPrevia: (corpo) => PreviaDaImportacaoSchema.parse(corpo),
  lerRejeicoes: (corpo) => PaginaDeRejeicoesDaImportacaoSchema.parse(corpo),
  campos: [...CAMPOS_DO_CONTRATO, CAMPO_CLASSE_CONTABIL],
  rotuloDoCampo,
  ajudaDoCampo: (campo) => (ehCampo(campo) ? AJUDA_DO_CAMPO[campo] : ''),
  mapeamentoSugerido,
  pendenciasDoRascunho,
  rotuloDoErro: (codigo) => (ehCodigoDeErro(codigo) ? ROTULO_DO_ERRO_DA_LINHA[codigo] : codigo),
  mensagemPadraoDoErro: (codigo) => (ehCodigoDeErro(codigo) ? MENSAGEM_PADRAO_DO_ERRO[codigo] : ''),
  colunasDaRejeicao: [{ titulo: ROTULO_DO_CAMPO.codigo, celula: (rejeicao) => <CodigoDaConta rejeicao={rejeicao} /> }],
  regras: REGRAS,
  nomeDoModelo: 'modelo-plano-de-contas.csv',
  permissoes: permissoesDoPlano,
  textos: {
    arquivoCsv: 'Arquivo CSV do plano de contas',
    arquivoPlanilha: 'Planilha XLSX ou ODS do plano de contas',
    modelos: 'Modelos oficiais do plano de contas',
    arrasteAqui: 'Arraste o CSV do plano de contas aqui',
    semPermissaoDeImportar: {
      titulo: 'Seu papel pode consultar o plano de contas, mas não tem permissão para importar.',
      descricao:
        'O envio de arquivos é feito por quem tem a permissão Importar em Empresas → Plano de contas. O histórico, o plano vigente e os relatórios continuam disponíveis abaixo.',
    },
    emAndamento: 'Acompanhe o processamento; nada muda no plano antes da sua confirmação.',
    anuncioAplicando: 'Aplicando as linhas válidas ao plano de contas.',
    tituloAplicando: 'Aplicando ao plano de contas',
    descricaoValidando:
      'Cada linha é conferida contra o plano atual e contra as demais linhas do arquivo. Nada muda no plano antes da sua confirmação; você pode sair desta tela e voltar pelo histórico.',
    tituloDaConfirmacao: (arquivo) => `Confirmar a importação de ${arquivo}?`,
    decisao,
    descricaoDoCancelamento:
      'Nenhuma conta é criada ou alterada. A tentativa, o arquivo e o relatório ficam no histórico como cancelados.',
    conflito: {
      titulo: 'O plano de contas mudou depois desta validação',
      descricao:
        'Nenhuma conta foi alterada. Esta prévia ficou obsoleta: cancele-a e envie o arquivo de novo, para a validação usar o plano atual.',
      cancelar: (arquivo) =>
        `A tentativa de ${arquivo} fica no histórico como cancelada e o plano não muda. Em seguida, envie o arquivo de novo.`,
    },
    confirmando: 'Confirmação em andamento: aplicando as linhas válidas ao plano de contas.',
    confirmacaoNegada: 'A confirmação ou o cancelamento desta prévia é feito por quem tem a permissão Confirmar importação.',
    aplicadas,
    aplicadasNoAviso,
    concluida: 'As contas que não estavam no arquivo continuam como estavam.',
    rejeitada:
      'Nenhuma linha do arquivo pôde ser aplicada. Veja os motivos abaixo, corrija o arquivo de origem e envie de novo. Enquanto a empresa não tiver nenhuma conta válida, a pendência de plano de contas segue aberta na Central de Pendências.',
    cancelada: 'O plano de contas não foi alterado. A tentativa, o arquivo e o relatório ficam no histórico.',
    falhaTecnica: mensagemDoCodigo('FALHA_TECNICA'),
    previstasNaoAplicadas: 'Nenhuma foi aplicada: a aplicação falhou e o plano não mudou.',
    rejeicoesNaoEntram: 'Corrija no arquivo de origem e envie uma nova tentativa; estas linhas não entram no plano.',
    legendaDoHistorico: 'Importações do plano de contas',
    avisoDeCancelamento: 'Importação cancelada. O plano de contas não foi alterado.',
  },
};
