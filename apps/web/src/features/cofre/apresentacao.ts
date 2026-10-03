/**
 * Como o cofre de certificados A1 aparece na tela (SPEC-011 §5): rótulos,
 * tons do semáforo e formatos. Só metadados — arquivo, senha e chave nunca
 * chegam aqui (SPEC-011 §6.3).
 *
 * Datas de validade são datas civis `YYYY-MM-DD` (I-11): formatam-se por texto,
 * sem passar por `Date`, que erraria o dia por fuso (FRONTEND.md §12).
 */
import { CODIGOS_DE_RECUSA_DA_INGESTAO, MENSAGEM_DA_RECUSA } from '@contaia/shared';
import type {
  AcaoDoCofre,
  AcaoDoHistoricoDeCertificado,
  CodigoDeRecusaDaIngestao,
  EstadoDaVersao,
  EstadoNoCofre,
  FiltroDeEstadoDoCofre,
  ItemDoCofre,
  OrdenacaoDoCofre,
  ResultadoDoEventoDeCertificado,
  SituacaoDoResponsavel,
} from '@contaia/shared';

import type { TomDoStatus } from '@/components/ui/status-badge';
import { mensagemDoCodigo } from '@/lib/mensagens';

type Apresentacao = Readonly<{ rotulo: string; tom: TomDoStatus }>;

/** Todo estado tem texto além da cor (SPEC-011 §5.3). */
export const APRESENTACAO_DO_ESTADO: Readonly<Record<EstadoNoCofre, Apresentacao>> = {
  SEM_CERTIFICADO: { rotulo: 'Sem certificado', tom: 'atencao' },
  VALIDO: { rotulo: 'Válido', tom: 'conforme' },
  VENCE_D30: { rotulo: 'Vence em até 30 dias', tom: 'atencao' },
  VENCE_D15: { rotulo: 'Vence em até 15 dias', tom: 'atencao' },
  VENCE_D7: { rotulo: 'Vence em até 7 dias', tom: 'critico' },
  VENCIDO: { rotulo: 'Vencido', tom: 'critico' },
  DESATIVADO: { rotulo: 'Desativado', tom: 'neutro' },
};

export const ESTADOS_QUE_VENCEM: readonly EstadoNoCofre[] = ['VENCE_D30', 'VENCE_D15', 'VENCE_D7'];

/** Estados que pedem renovação: o texto da ação deixa isso claro. */
export const pedeRenovacao = (estado: EstadoNoCofre): boolean =>
  ESTADOS_QUE_VENCEM.includes(estado) || estado === 'VENCIDO';

export const APRESENTACAO_DA_VERSAO: Readonly<Record<EstadoDaVersao, Apresentacao>> = {
  VIGENTE: { rotulo: 'Vigente', tom: 'conforme' },
  SUBSTITUIDO: { rotulo: 'Substituído', tom: 'neutro' },
  DESATIVADO: { rotulo: 'Desativado', tom: 'neutro' },
};

export const APRESENTACAO_DA_SITUACAO_DO_RESPONSAVEL: Readonly<
  Record<SituacaoDoResponsavel, Apresentacao>
> = {
  ATIVO: { rotulo: 'Ativo', tom: 'conforme' },
  INATIVO: { rotulo: 'Inativo', tom: 'atencao' },
  FORA_DA_CARTEIRA: { rotulo: 'Fora da carteira', tom: 'atencao' },
};

export const TODOS = 'todos';

export const OPCOES_DE_ESTADO: readonly Readonly<{ valor: FiltroDeEstadoDoCofre; rotulo: string }>[] =
  [
    { valor: 'VALIDO', rotulo: 'Válidos' },
    { valor: 'VENCE_D30', rotulo: 'Vencem em até 30 dias' },
    { valor: 'VENCE_D15', rotulo: 'Vencem em até 15 dias' },
    { valor: 'VENCE_D7', rotulo: 'Vencem em até 7 dias' },
    { valor: 'VENCIDO', rotulo: 'Vencidos' },
    { valor: 'DESATIVADO', rotulo: 'Desativados' },
    { valor: 'SEM_CERTIFICADO', rotulo: 'Sem certificado' },
    { valor: 'SEM_RESPONSAVEL', rotulo: 'Sem responsável' },
  ];

export const ORDENACOES: readonly Readonly<{ valor: OrdenacaoDoCofre; rotulo: string }>[] = [
  { valor: 'EMPRESA', rotulo: 'Empresa (A–Z)' },
  { valor: 'VENCIMENTO', rotulo: 'Vencimento mais próximo' },
  { valor: 'ESTADO', rotulo: 'Estado do certificado' },
];

export const ORDENACAO_PADRAO: OrdenacaoDoCofre = 'EMPRESA';

export const ehEstadoDoFiltro = (valor: string | null): valor is FiltroDeEstadoDoCofre =>
  valor !== null && OPCOES_DE_ESTADO.some((opcao) => opcao.valor === valor);

export const ehOrdenacao = (valor: string | null): valor is OrdenacaoDoCofre =>
  valor !== null && ORDENACOES.some((opcao) => opcao.valor === valor);

// -- Formatos ----------------------------------------------------------------

/** `2026-11-14` → `14/11/2026`, sem `Date`: data civil não tem fuso. */
export const formatarDataCivil = (data: string): string => {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(data);

  return partes === null ? data : `${partes[3]}/${partes[2]}/${partes[1]}`;
};

/** Dia civil de um instante, no fuso de São Paulo (I-11). */
export const formatarDiaDoInstante = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));

/** Dias até o fim da vigência, dito por extenso (negativo = vencido). */
export const prazoEmTexto = (dias: number | null): string | null => {
  if (dias === null) {
    return null;
  }

  if (dias > 1) {
    return `${dias.toLocaleString('pt-BR')} dias restantes`;
  }

  if (dias === 1) {
    return '1 dia restante';
  }

  if (dias === 0) {
    return 'Vence hoje';
  }

  return dias === -1 ? 'Venceu ontem' : `Venceu há ${(-dias).toLocaleString('pt-BR')} dias`;
};

/** Impressão digital truncada, 8 + … + 4 (PATTERNS.md §3); a completa fica no detalhe e é copiável. */
export const impressaoDigitalCurta = (hash: string): string =>
  hash.length <= 12 ? hash : `${hash.slice(0, 8)}…${hash.slice(-4)}`;

/** Pares separados por espaço: o valor completo quebra de linha sem perder a leitura. */
export const impressaoDigitalAgrupada = (hash: string): string =>
  (hash.match(/.{1,2}/gu) ?? []).join(' ');

export const iniciaisDe = (nome: string): string => {
  const palavras = nome.trim().split(/\s+/u).filter((palavra) => palavra.length > 0);
  const primeira = palavras[0]?.[0] ?? '';
  const ultima = palavras.length > 1 ? (palavras[palavras.length - 1]?.[0] ?? '') : '';

  return `${primeira}${ultima}`.toUpperCase();
};

// -- Ações -------------------------------------------------------------------

export const temAcao = (item: Pick<ItemDoCofre, 'acoes'>, acao: AcaoDoCofre): boolean =>
  item.acoes.includes(acao);

/** Cadastrar e substituir são a mesma tarefa na tela: levar um arquivo ao cofre. */
export const podeEnviar = (item: Pick<ItemDoCofre, 'acoes'>): boolean =>
  temAcao(item, 'CADASTRAR') || temAcao(item, 'SUBSTITUIR');

export const rotuloDoEnvio = (item: Pick<ItemDoCofre, 'acoes' | 'estado'>): string => {
  if (temAcao(item, 'CADASTRAR')) {
    return 'Cadastrar certificado';
  }

  return pedeRenovacao(item.estado) ? 'Renovar certificado' : 'Substituir certificado';
};

/** Versão curta para a linha da tabela, onde a coluna é estreita; o nome acessível leva o texto inteiro. */
export const rotuloCurtoDoEnvio = (item: Pick<ItemDoCofre, 'acoes' | 'estado'>): string => {
  if (temAcao(item, 'CADASTRAR')) {
    return 'Cadastrar';
  }

  return pedeRenovacao(item.estado) ? 'Renovar' : 'Substituir';
};

// -- Recusa da ingestão ------------------------------------------------------

export type CampoDoEnvio = 'arquivo' | 'senha' | 'empresa' | 'responsavel';

/**
 * Onde cada recusa se prende (SPEC-011 §3.1 e §7): o erro aparece no campo que a
 * pessoa precisa corrigir. `null` = problema do envio como um todo (ticket, cofre).
 */
const CAMPO_DA_RECUSA: Readonly<Record<CodigoDeRecusaDaIngestao, CampoDoEnvio | null>> = {
  CERTIFICADO_TICKET_INVALIDO: null,
  CERTIFICADO_EXTENSAO_INVALIDA: 'arquivo',
  CERTIFICADO_TAMANHO_EXCEDIDO: 'arquivo',
  CERTIFICADO_ARQUIVO_VAZIO: 'arquivo',
  CERTIFICADO_CONTEINER_INVALIDO: 'arquivo',
  CERTIFICADO_SENHA_INCORRETA: 'senha',
  CERTIFICADO_EXPIRADO: 'arquivo',
  CERTIFICADO_AINDA_NAO_VIGENTE: 'arquivo',
  CERTIFICADO_TIPO_INCOMPATIVEL: 'arquivo',
  CERTIFICADO_CNPJ_DIVERGENTE: 'empresa',
  CERTIFICADO_RESPONSAVEL_INVALIDO: 'responsavel',
  COFRE_INDISPONIVEL: null,
};

export const ehCodigoDeRecusa = (codigo: string): codigo is CodigoDeRecusaDaIngestao =>
  (CODIGOS_DE_RECUSA_DA_INGESTAO as readonly string[]).includes(codigo);

export const campoDaRecusa = (codigo: string): CampoDoEnvio | null =>
  ehCodigoDeRecusa(codigo) ? CAMPO_DA_RECUSA[codigo] : null;

/** Estado do cofre da empresa que não aceita a operação pedida (409): quase sempre tela velha. */
const MENSAGEM_DO_ESTADO_DO_COFRE: Readonly<Record<string, string>> = {
  CERTIFICADO_JA_VIGENTE:
    'Esta empresa já tem certificado vigente. Recarregue a página e use "Substituir certificado".',
  CERTIFICADO_VIGENTE_INEXISTENTE:
    'Esta empresa não tem certificado vigente para esta ação. Recarregue a página e veja como ela está.',
  CERTIFICADO_MOTIVO_OBRIGATORIO: 'Informe o motivo da desativação.',
};

/** Recusa conhecida, ou a mensagem genérica acionável do cliente HTTP (FRONTEND.md §14). */
export const mensagemDoCofre = (codigo: string): string => {
  if (ehCodigoDeRecusa(codigo)) {
    return MENSAGEM_DA_RECUSA[codigo];
  }

  return MENSAGEM_DO_ESTADO_DO_COFRE[codigo] ?? mensagemDoCodigo(codigo);
};

// -- Histórico ---------------------------------------------------------------

export const APRESENTACAO_DA_ACAO_DO_HISTORICO: Readonly<
  Record<AcaoDoHistoricoDeCertificado, Apresentacao>
> = {
  CADASTRO: { rotulo: 'Cadastro', tom: 'conforme' },
  SUBSTITUICAO: { rotulo: 'Substituição', tom: 'conforme' },
  DESATIVACAO: { rotulo: 'Desativação', tom: 'neutro' },
  RESPONSAVEL_ALTERADO: { rotulo: 'Responsável alterado', tom: 'processando' },
  RESPONSAVEL_PERDIDO: { rotulo: 'Responsável perdido', tom: 'atencao' },
  ALERTA_EMITIDO: { rotulo: 'Alerta emitido', tom: 'atencao' },
  RECUSA: { rotulo: 'Tentativa recusada', tom: 'critico' },
};

export const ROTULO_DO_RESULTADO: Readonly<Record<ResultadoDoEventoDeCertificado, string>> = {
  SUCESSO: 'Concluído',
  RECUSADO: 'Recusado',
};

const ROTULO_DO_MARCO: Readonly<Record<string, string>> = {
  D30: 'Faltam 30 dias para o vencimento',
  D15: 'Faltam 15 dias para o vencimento',
  D7: 'Faltam 7 dias para o vencimento',
  VENCIDO: 'Certificado vencido',
  RESPONSAVEL_INCONSISTENTE: 'Responsável sem alçada sobre a empresa',
};

const ROTULO_DA_IDENTIDADE_TECNICA: Readonly<Record<string, string>> = {
  cofre: 'Cofre',
  'job-de-alertas': 'Verificação de vencimentos',
};

/** Detalhe legível do evento: motivo da recusa, marco do alerta ou a justificativa. */
export const detalheDoEvento = (
  acao: AcaoDoHistoricoDeCertificado,
  codigo: string | null,
  motivo: string | null,
): string | null => {
  if (acao === 'RECUSA' && codigo !== null) {
    return mensagemDoCofre(codigo);
  }

  if (acao === 'ALERTA_EMITIDO' && codigo !== null) {
    return ROTULO_DO_MARCO[codigo] ?? codigo;
  }

  return motivo;
};

export const autorDoEvento = (
  usuarioNome: string | null,
  identidadeTecnica: string | null,
): string =>
  usuarioNome ??
  (identidadeTecnica === null
    ? 'Sistema'
    : (ROTULO_DA_IDENTIDADE_TECNICA[identidadeTecnica] ?? identidadeTecnica));
