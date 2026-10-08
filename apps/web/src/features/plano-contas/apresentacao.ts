/**
 * Textos e tons da importação do plano de contas (SPEC-013 §3.11, §5.3). Fonte única para tela e
 * teste: o estado é sempre dito por texto, nunca só pela cor do selo.
 */
import type { CampoDoContrato } from '@contaia/domain';
import type { CodigoDeErroDaLinha, EstadoDaImportacao, TipoDeConta, NaturezaDeConta } from '@contaia/shared';

import type { TomDoStatus } from '@/components/ui/status-badge';

export const APARENCIA_DO_ESTADO: Readonly<Record<EstadoDaImportacao, { rotulo: string; tom: TomDoStatus }>> = {
  RECEBIDA: { rotulo: 'Recebida', tom: 'processando' },
  VALIDANDO: { rotulo: 'Validando', tom: 'processando' },
  AGUARDANDO_CONFIRMACAO: { rotulo: 'Aguardando confirmação', tom: 'atencao' },
  APLICANDO: { rotulo: 'Aplicando', tom: 'processando' },
  CONCLUIDA: { rotulo: 'Concluída', tom: 'conforme' },
  CONCLUIDA_COM_REJEICOES: { rotulo: 'Concluída com rejeições', tom: 'atencao' },
  REJEITADA: { rotulo: 'Rejeitada', tom: 'critico' },
  CANCELADA: { rotulo: 'Cancelada', tom: 'neutro' },
  FALHA: { rotulo: 'Falha técnica', tom: 'critico' },
};

/** Estados em que o worker ou a aplicação ainda trabalham: a tela acompanha por consulta. */
export const ESTADOS_EM_ANDAMENTO: readonly EstadoDaImportacao[] = ['RECEBIDA', 'VALIDANDO', 'APLICANDO'];

export const emAndamento = (estado: EstadoDaImportacao | undefined): boolean =>
  estado !== undefined && ESTADOS_EM_ANDAMENTO.includes(estado);

/** Ainda não terminou: aparece como aviso para retomar quando a aba abre sem tentativa. */
export const naoTerminada = (estado: EstadoDaImportacao): boolean =>
  emAndamento(estado) || estado === 'AGUARDANDO_CONFIRMACAO';

export const ROTULO_DO_CAMPO: Readonly<Record<CampoDoContrato, string>> = {
  codigo: 'Código',
  nome: 'Nome',
  tipo: 'Tipo',
  natureza: 'Natureza',
  conta_pai: 'Conta-pai',
};

export const AJUDA_DO_CAMPO: Readonly<Record<CampoDoContrato, string>> = {
  codigo: 'Único na empresa; é a chave que inclui ou atualiza a conta.',
  nome: 'Descrição da conta.',
  tipo: 'Valores aceitos: analítica ou sintética.',
  natureza: 'Valores aceitos: devedora ou credora.',
  conta_pai: 'Código da conta superior; vazia só na conta raiz.',
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
};

export const ROTULO_DO_TIPO: Readonly<Record<TipoDeConta, string>> = {
  analitica: 'Analítica',
  sintetica: 'Sintética',
};

export const ROTULO_DA_NATUREZA: Readonly<Record<NaturezaDeConta, string>> = {
  devedora: 'Devedora',
  credora: 'Credora',
};

const NUMERO = new Intl.NumberFormat('pt-BR');

export const formatarNumero = (valor: number): string => NUMERO.format(valor);

/** `14/03/2026 09:30`, sempre no horário de Brasília (FRONTEND.md §12). */
export const formatarInstante = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(',', '');

/** Hash SHA-256 truncado: 8 + … + 4 (PATTERNS.md §3); o completo fica no `title` e na cópia. */
export const hashCurto = (hash: string): string =>
  hash.length <= 12 ? hash : `${hash.slice(0, 8)}…${hash.slice(-4)}`;

export const plural = (quantidade: number, singular: string, varios: string): string =>
  `${formatarNumero(quantidade)} ${quantidade === 1 ? singular : varios}`;
