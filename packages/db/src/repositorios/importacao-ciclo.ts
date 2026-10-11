/**
 * Ciclo de vida genérico da tentativa de importação (SPEC-013 e SPEC-014 §3.5–§3.11, §6.3, §6.4).
 *
 * Plano de contas e empregados usam o MESMO ciclo — criar com idempotência e obsolescência,
 * validar, confirmar com versão otimista, aplicar, finalizar, cancelar, falhar, eventos e
 * notificações — sobre tabelas próprias (as consultas genéricas ficam em `importacao-ciclo-consultas.ts`). Cada domínio
 * escolhe um descritor da allowlist abaixo; o que é próprio do domínio (formato do staging, upsert
 * na base, base vigente) fica no arquivo do domínio.
 *
 * Segurança do SQL dinâmico: nomes de tabela e coluna SÓ vêm dos descritores constantes deste
 * módulo e todo descritor recebido é conferido contra a allowlist (`exigirDescritor`) antes de
 * ser interpolado; valores são sempre parâmetros. Nenhum nome vem de entrada externa.
 *
 * Como os repositórios de domínio, roda SEMPRE dentro da transação do chamador (`comContextoHumano`
 * ou contexto técnico da empresa): aqui não se abre, confirma nem reverte transação. A RLS limita
 * tenant e empresa; ainda assim toda consulta filtra pela `empresa_id` recebida. O "agora" entra
 * sempre por parâmetro. Transições usam `UPDATE … WHERE estado = <origem>`: numa corrida a segunda
 * transação espera a primeira e, depois do commit, não encontra mais a origem (erro de estado).
 */
import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, podeTransicionar } from '@contaia/domain';
import type { EstadoDaImportacao, EventoDaImportacao } from '@contaia/domain';
import type { PoolClient } from 'pg';

// --- descritores (allowlist) ---------------------------------------------------------------------

export type DescritorDaImportacao = Readonly<{
  /** Tentativa (`app.<tabela>`). */
  tabela: string;
  tabelaLinha: string;
  tabelaEvento: string;
  tabelaNotificacao: string;
  /** Versão otimista do agregado (base vigente), uma linha por empresa. */
  tabelaVersao: string;
  /** Coluna da tentativa com a versão do agregado lida na validação. */
  colunaVersaoNoAgregado: string;
  /** Colunas do staging lidas pela amostra de rejeições (além de número, campo, código e mensagem). */
  colunasDaRejeicao: string;
  /** Colunas do staging lidas pelo relatório completo, em ordem de linha. */
  colunasDoRelatorio: string;
  /** Mensagem do conflito de versão (HTTP 409), no vocabulário do domínio. */
  mensagemDeConflito: string;
}>;

export const DESCRITOR_PLANO_CONTAS: DescritorDaImportacao = Object.freeze({
  tabela: 'importacao_plano_contas',
  tabelaLinha: 'importacao_plano_contas_linha',
  tabelaEvento: 'importacao_plano_contas_evento',
  tabelaNotificacao: 'importacao_plano_contas_notificacao',
  tabelaVersao: 'empresa_plano_versao',
  colunaVersaoNoAgregado: 'plano_versao_na_validacao',
  colunasDaRejeicao: 'codigo',
  colunasDoRelatorio: 'codigo, nome, tipo, natureza, conta_pai',
  mensagemDeConflito: 'O plano de contas mudou depois da prévia. Valide o arquivo novamente.',
});

export const DESCRITOR_EMPREGADOS: DescritorDaImportacao = Object.freeze({
  tabela: 'importacao_empregados',
  tabelaLinha: 'importacao_empregados_linha',
  tabelaEvento: 'importacao_empregados_evento',
  tabelaNotificacao: 'importacao_empregados_notificacao',
  tabelaVersao: 'empresa_empregados_versao',
  colunaVersaoNoAgregado: 'empregados_versao_na_validacao',
  colunasDaRejeicao: 'cpf, matricula',
  colunasDoRelatorio: 'cpf, nome, matricula, data_nascimento, data_admissao',
  mensagemDeConflito: 'A base de empregados mudou depois da prévia. Valide o arquivo novamente.',
});

const DESCRITORES: readonly DescritorDaImportacao[] = [DESCRITOR_PLANO_CONTAS, DESCRITOR_EMPREGADOS];

/** Só a identidade dos objetos da allowlist passa: cópia ou objeto montado fora daqui é recusado. */
export const exigirDescritor = (d: DescritorDaImportacao): DescritorDaImportacao => {
  if (!DESCRITORES.includes(d)) {
    throw new Error('Descritor de importação fora da allowlist.');
  }

  return d;
};

// --- tipos ---------------------------------------------------------------------------------------

export type Mapeamento = Readonly<Record<string, string>>;
export type AcaoDaLinha = 'INCLUIR' | 'ATUALIZAR';

export type TotaisDaImportacao = Readonly<{
  lidas: number;
  novas: number;
  atualizadas: number;
  rejeitadas: number;
}>;

export type TentativaDoCiclo = Readonly<{
  id: string;
  tenantId: string;
  empresaId: string;
  hashArquivo: string;
  mapeamento: Mapeamento;
  arquivoNome: string;
  arquivoTamanho: number;
  arquivoChave: string;
  estado: EstadoDaImportacao;
  /** Versão do agregado sobre a qual a prévia foi formada; nula até a validação terminar. */
  versaoNaValidacao: number | null;
  /** Nulos até a validação terminar. */
  totais: TotaisDaImportacao | null;
  usuarioIniciadorId: string;
  usuarioConfirmadorId: string | null;
  usuarioCanceladorId: string | null;
  correlationId: string;
  /** Marca do histórico: o último pedido idêntico reutilizou o resultado terminal. */
  reutilizadaPorIdempotencia: boolean;
  criadoEm: Date;
  iniciadoEm: Date | null;
  finalizadoEm: Date | null;
}>;

/** `reutilizada`: ESTE pedido caiu numa tentativa existente (mesmo tenant, empresa, hash e mapeamento). */
export type TentativaCriadaNoCiclo = TentativaDoCiclo & Readonly<{ reutilizada: boolean }>;

export type NovaTentativa = Readonly<{
  tenantId: string;
  empresaId: string;
  /** SHA-256 hexadecimal minúsculo, calculado no servidor. */
  hashArquivo: string;
  mapeamento: Mapeamento;
  arquivoNome: string;
  arquivoTamanho: number;
  /** Chave do original no object storage local. */
  arquivoChave: string;
  usuarioIniciadorId: string;
  correlationId: string;
  agora: Date;
}>;

export type InicioDaValidacao = Readonly<{
  /** `false` na reentrega do job com a tentativa já em VALIDANDO. */
  transicionou: boolean;
  /** Versão lida por ESTA entrega: passar a `gravarResultadoDaValidacao` (não é gravada aqui). */
  versaoNaValidacao: number;
}>;

export type ResultadoDaValidacaoGravada = Readonly<{
  estado: EstadoDaImportacao;
  totais: TotaisDaImportacao;
  /** `false` quando a validação já tinha sido gravada (reentrega): não registrar evento de novo. */
  transicionou: boolean;
}>;

export type ConfirmacaoDaPrevia = Readonly<{
  empresaId: string;
  tentativaId: string;
  usuarioId: string;
  /** Versão do agregado que a prévia exibiu; diferente da validada → `CONFLITO_DE_VERSAO`. */
  versaoDaPrevia: number;
}>;

export type CancelamentoDaPrevia = Readonly<{
  empresaId: string;
  tentativaId: string;
  usuarioId: string;
  agora: Date;
}>;

export type EstadoFinalDaAplicacao = 'CONCLUIDA' | 'CONCLUIDA_COM_REJEICOES';

/** Ações da trilha: criação, reuso idempotente e os eventos da máquina de estados do domínio. */
export type AcaoDoEvento = 'CRIACAO' | 'REUTILIZACAO' | EventoDaImportacao;

export type NovoEvento = Readonly<{
  empresaId: string;
  tentativaId: string;
  acao: AcaoDoEvento;
  estadoAnterior: EstadoDaImportacao | null;
  estadoNovo: EstadoDaImportacao;
  /** Autor humano; nulo no evento do worker. */
  usuarioId: string | null;
  totais: TotaisDaImportacao | null;
  /** Código estável da falha técnica (`^[A-Z][A-Z0-9_]*$`), nunca mensagem crua. */
  codigo: string | null;
  correlationId: string;
  agora: Date;
}>;

export type NovasNotificacoes = Readonly<{
  empresaId: string;
  tentativaId: string;
  /** Usuários do tenant; repetidos contam uma vez. */
  destinatarios: readonly string[];
  agora: Date;
}>;

type LinhaDaTentativa = {
  id: string;
  tenant_id: string;
  empresa_id: string;
  hash_arquivo: string;
  mapeamento: Record<string, string>;
  arquivo_nome: string;
  arquivo_tamanho: string;
  arquivo_chave: string;
  estado: EstadoDaImportacao;
  versao_na_validacao: string | null;
  totais: TotaisDaImportacao | null;
  usuario_iniciador_id: string;
  usuario_confirmador_id: string | null;
  usuario_cancelador_id: string | null;
  correlation_id: string;
  reutilizada_por_idempotencia: boolean;
  criado_em: Date;
  iniciado_em: Date | null;
  finalizado_em: Date | null;
};

const colunasDaTentativa = (d: DescritorDaImportacao): string => `id, tenant_id, empresa_id, hash_arquivo,
  mapeamento, arquivo_nome, arquivo_tamanho::text as arquivo_tamanho, arquivo_chave, estado,
  ${d.colunaVersaoNoAgregado}::text as versao_na_validacao, totais, usuario_iniciador_id,
  usuario_confirmador_id, usuario_cancelador_id, correlation_id, reutilizada_por_idempotencia,
  criado_em, iniciado_em, finalizado_em`;

/** Resultado terminal que o reenvio idêntico reaproveita (SPEC-013/014 §3.7). */
const RESULTADOS_REUTILIZAVEIS_SQL = `('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA')`;
/** Predicado da UNIQUE parcial `*_idempotente` (migrations 0016 e 0017), literal. */
const PREDICADO_DA_IDENTIDADE_SQL = `estado not in ('FALHA', 'CANCELADA') and not obsoleta`;
/**
 * O agregado mudou depois que o resultado terminal `t` terminou (FIX #107). REJEITADA terminou na
 * versão da validação; CONCLUIDA* nela + 1 (a confirmação exige a versão validada e a aplicação a
 * sobe uma vez, na mesma transação). Versão desconhecida → não obsoleto.
 */
const agregadoMudouDepoisDoResultado = (d: DescritorDaImportacao): string => `exists (
  select 1 from app.${d.tabelaVersao} v
   where v.empresa_id = t.empresa_id and v.tenant_id = t.tenant_id
     and v.versao <> t.${d.colunaVersaoNoAgregado} + case when t.estado = 'REJEITADA' then 0 else 1 end)`;

const paraTentativa = (linha: LinhaDaTentativa): TentativaDoCiclo => ({
  id: linha.id,
  tenantId: linha.tenant_id,
  empresaId: linha.empresa_id,
  hashArquivo: linha.hash_arquivo,
  mapeamento: linha.mapeamento,
  arquivoNome: linha.arquivo_nome,
  arquivoTamanho: Number(linha.arquivo_tamanho),
  arquivoChave: linha.arquivo_chave,
  estado: linha.estado,
  versaoNaValidacao: linha.versao_na_validacao === null ? null : Number(linha.versao_na_validacao),
  totais: linha.totais,
  usuarioIniciadorId: linha.usuario_iniciador_id,
  usuarioConfirmadorId: linha.usuario_confirmador_id,
  usuarioCanceladorId: linha.usuario_cancelador_id,
  correlationId: linha.correlation_id,
  reutilizadaPorIdempotencia: linha.reutilizada_por_idempotencia,
  criadoEm: linha.criado_em,
  iniciadoEm: linha.iniciado_em,
  finalizadoEm: linha.finalizado_em,
});

const tentativaNaoEncontrada = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA, 'Tentativa de importação não encontrada.');

const estadoInvalido = (estado: EstadoDaImportacao): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO,
    `A tentativa de importação está em ${estado} e não aceita esta ação.`,
  );

const conflitoDeVersao = (d: DescritorDaImportacao): ErroDeConflito =>
  new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO, d.mensagemDeConflito);

/** Tentativa da empresa travada até o fim da transação (`FOR UPDATE`); ausente → erro. */
export const travarTentativa = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
): Promise<TentativaDoCiclo> => {
  const d = exigirDescritor(descritor);
  const { rows } = await cliente.query<LinhaDaTentativa>(
    `select ${colunasDaTentativa(d)} from app.${d.tabela} where id = $1 and empresa_id = $2 for update`,
    [tentativaId, empresaId],
  );
  const linha = rows[0];

  if (linha === undefined) {
    throw tentativaNaoEncontrada();
  }

  return paraTentativa(linha);
};

/** Explica por que um `UPDATE … WHERE estado = …` não alterou nada. */
const erroDaTransicao = async (
  cliente: PoolClient,
  d: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
): Promise<ErroDeDominio> => {
  const { rows } = await cliente.query<{ estado: EstadoDaImportacao }>(
    `select estado from app.${d.tabela} where id = $1 and empresa_id = $2`,
    [tentativaId, empresaId],
  );
  const linha = rows[0];

  return linha === undefined ? tentativaNaoEncontrada() : estadoInvalido(linha.estado);
};

/** Cria sob demanda a linha de versão do agregado da empresa (`versao = 0`). */
const garantirVersao = async (
  cliente: PoolClient,
  d: DescritorDaImportacao,
  tenantId: string,
  empresaId: string,
): Promise<void> => {
  await cliente.query(
    `insert into app.${d.tabelaVersao} (tenant_id, empresa_id) values ($1, $2)
     on conflict (empresa_id, tenant_id) do nothing`,
    [tenantId, empresaId],
  );
};

// --- tentativa -----------------------------------------------------------------------------------

/** Uma instrução: insere a tentativa ou cai na existente da identidade (ver `criarTentativa`). */
const inserirOuReutilizar = async (
  cliente: PoolClient,
  d: DescritorDaImportacao,
  nova: NovaTentativa,
): Promise<Readonly<{ tentativa: TentativaCriadaNoCiclo; obsoleta: boolean }>> => {
  const mudou = agregadoMudouDepoisDoResultado(d);
  const { rows } = await cliente.query<LinhaDaTentativa & { nova: boolean; obsoleta: boolean }>(
    `insert into app.${d.tabela} as t
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
        usuario_iniciador_id, correlation_id, criado_em)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
     on conflict (empresa_id, tenant_id, hash_arquivo, mapeamento) where ${PREDICADO_DA_IDENTIDADE_SQL}
     do update
       set obsoleta = t.estado in ${RESULTADOS_REUTILIZAVEIS_SQL} and ${mudou},
           reutilizada_por_idempotencia = t.reutilizada_por_idempotencia
             or (t.estado in ${RESULTADOS_REUTILIZAVEIS_SQL} and not ${mudou})
     returning ${colunasDaTentativa(d)}, (xmax = 0) as nova, obsoleta`,
    [
      nova.tenantId,
      nova.empresaId,
      nova.hashArquivo,
      JSON.stringify(nova.mapeamento),
      nova.arquivoNome,
      nova.arquivoTamanho,
      nova.arquivoChave,
      nova.usuarioIniciadorId,
      nova.correlationId,
      nova.agora,
    ],
  );
  const linha = rows[0]!;

  return { tentativa: { ...paraTentativa(linha), reutilizada: !linha.nova }, obsoleta: linha.obsoleta };
};

/**
 * Cria a tentativa RECEBIDA, já com o mapeamento. A identidade idempotente (tenant + empresa +
 * hash + mapeamento) é a UNIQUE parcial da tabela, que ignora FALHA e CANCELADA: o pedido repetido
 * devolve a tentativa viva ou com resultado reutilizável, com `reutilizada = true`, numa única
 * instrução (sem corrida entre ler e inserir). Se a existente tem resultado reutilizável, a marca
 * de reuso do histórico também sobe.
 *
 * Resultado terminal de um agregado que já mudou (FIX #107) não é reaproveitado: a mesma
 * instrução, com a linha travada, o marca `obsoleta` (sai da identidade, fica intacto no
 * histórico) e a inserção é refeita, abrindo a tentativa nova. O envio simultâneo espera essa
 * transação e cai no reuso da nova (I-9: uma só).
 */
export const criarTentativa = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  nova: NovaTentativa,
): Promise<TentativaCriadaNoCiclo> => {
  const d = exigirDescritor(descritor);
  const primeira = await inserirOuReutilizar(cliente, d, nova);

  if (!primeira.obsoleta) {
    return primeira.tentativa;
  }

  return (await inserirOuReutilizar(cliente, d, nova)).tentativa;
};

/** Tentativa da empresa informada; de outra empresa, tenant ou fora da carteira → `null`. */
export const buscarTentativa = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
): Promise<TentativaDoCiclo | null> => {
  const d = exigirDescritor(descritor);
  const { rows } = await cliente.query<LinhaDaTentativa>(
    `select ${colunasDaTentativa(d)} from app.${d.tabela} where id = $1 and empresa_id = $2`,
    [tentativaId, empresaId],
  );
  const linha = rows[0];

  return linha === undefined ? null : paraTentativa(linha);
};

// --- validação (worker) --------------------------------------------------------------------------

/**
 * RECEBIDA → VALIDANDO e DEVOLVE a versão do agregado lida agora (cria a linha de versão sob
 * demanda). A versão NÃO é gravada aqui: cada entrega do job leva a sua até
 * `gravarResultadoDaValidacao`, que a fixa junto com o staging — uma reentrega iniciada depois de
 * outra aplicação nunca rotula com a versão nova o staging calculado sobre a base antiga. Chamar
 * ANTES de carregar a base vigente. Reentrega com a tentativa já em VALIDANDO não falha.
 */
export const iniciarValidacao = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
  agora: Date,
): Promise<InicioDaValidacao> => {
  const d = exigirDescritor(descritor);
  const tentativa = await travarTentativa(cliente, d, empresaId, tentativaId);

  if (tentativa.estado !== 'RECEBIDA' && tentativa.estado !== 'VALIDANDO') {
    throw estadoInvalido(tentativa.estado);
  }

  await garantirVersao(cliente, d, tentativa.tenantId, empresaId);
  const { rows } = await cliente.query<{ versao: string }>(
    `select versao::text as versao from app.${d.tabelaVersao} where empresa_id = $1 and tenant_id = $2`,
    [empresaId, tentativa.tenantId],
  );

  await cliente.query(
    `update app.${d.tabela} set estado = 'VALIDANDO', iniciado_em = coalesce(iniciado_em, $3)
      where id = $1 and empresa_id = $2`,
    [tentativaId, empresaId, agora],
  );

  return { transicionou: tentativa.estado === 'RECEBIDA', versaoNaValidacao: Number(rows[0]!.versao) };
};

export const contarTotais = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
): Promise<TotaisDaImportacao> => {
  const d = exigirDescritor(descritor);
  const { rows } = await cliente.query<TotaisDaImportacao>(
    `select count(*)::int as lidas,
            count(*) filter (where status = 'VALIDA' and acao = 'INCLUIR')::int as novas,
            count(*) filter (where status = 'VALIDA' and acao = 'ATUALIZAR')::int as atualizadas,
            count(*) filter (where status = 'REJEITADA')::int as rejeitadas
       from app.${d.tabelaLinha}
      where tentativa_id = $1 and empresa_id = $2`,
    [tentativaId, empresaId],
  );

  return rows[0]!;
};

/** Recusa lote com número de linha repetido: DO NOTHING o descartaria em silêncio (totais menores). */
export const exigirNumerosDeLinhaUnicos = (numeros: readonly number[]): void => {
  const vistos = new Set<number>();

  for (const numero of numeros) {
    if (vistos.has(numero)) {
      throw new Error(`Lote de staging com número de linha repetido: ${numero}.`);
    }
    vistos.add(numero);
  }
};

/**
 * Grava o staging (pela função do domínio) e fecha a validação: VALIDANDO → AGUARDANDO_CONFIRMACAO
 * (ao menos uma linha válida) ou REJEITADA (nenhuma; terminal, com término). Os totais vêm do
 * banco, não do lote. `versaoNaValidacao` é a que ESTA entrega recebeu de `iniciarValidacao` e é
 * fixada no mesmo UPDATE que muda o estado. Idempotente: se a validação já foi gravada
 * (reentrega), não insere nada, não troca a versão e devolve o que existe com `transicionou = false`.
 */
export const gravarResultadoDaValidacao = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
  versaoNaValidacao: number,
  agora: Date,
  inserirStaging: (tentativa: TentativaDoCiclo) => Promise<void>,
): Promise<ResultadoDaValidacaoGravada> => {
  const d = exigirDescritor(descritor);
  const tentativa = await travarTentativa(cliente, d, empresaId, tentativaId);

  if (tentativa.estado === 'RECEBIDA' || tentativa.estado === 'FALHA') {
    throw estadoInvalido(tentativa.estado);
  }

  if (tentativa.estado !== 'VALIDANDO') {
    return {
      estado: tentativa.estado,
      totais: tentativa.totais ?? (await contarTotais(cliente, d, empresaId, tentativaId)),
      transicionou: false,
    };
  }

  await inserirStaging(tentativa);
  const totais = await contarTotais(cliente, d, empresaId, tentativaId);
  const estado: EstadoDaImportacao = totais.novas + totais.atualizadas > 0 ? 'AGUARDANDO_CONFIRMACAO' : 'REJEITADA';

  await cliente.query(
    `update app.${d.tabela}
        set estado = $3, totais = $4::jsonb, finalizado_em = $5, ${d.colunaVersaoNoAgregado} = $6
      where id = $1 and empresa_id = $2 and estado = 'VALIDANDO'`,
    [tentativaId, empresaId, estado, JSON.stringify(totais), estado === 'REJEITADA' ? agora : null, versaoNaValidacao],
  );

  return { estado, totais, transicionou: true };
};

/**
 * Falha técnica (tentativas do job esgotadas): VALIDANDO | APLICANDO → FALHA, com término.
 * Devolve o estado anterior, para o evento.
 */
export const registrarFalha = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
  agora: Date,
): Promise<EstadoDaImportacao> => {
  const d = exigirDescritor(descritor);
  const tentativa = await travarTentativa(cliente, d, empresaId, tentativaId);

  if (!podeTransicionar(tentativa.estado, 'FALHA_TECNICA')) {
    throw estadoInvalido(tentativa.estado);
  }

  await cliente.query(`update app.${d.tabela} set estado = 'FALHA', finalizado_em = $3 where id = $1 and empresa_id = $2`, [
    tentativaId,
    empresaId,
    agora,
  ]);

  return tentativa.estado;
};

// --- confirmação, aplicação e cancelamento (caso de uso transacional da API) ---------------------

/**
 * AGUARDANDO_CONFIRMACAO → APLICANDO, gravando o confirmador. Numa corrida só uma transação
 * encontra a origem; a outra recebe `ESTADO_INVALIDO_PARA_ACAO`. Versão da prévia diferente da
 * validada → `CONFLITO_DE_VERSAO`.
 */
export const confirmar = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  confirmacao: ConfirmacaoDaPrevia,
): Promise<TentativaDoCiclo> => {
  const d = exigirDescritor(descritor);
  const { rows } = await cliente.query<LinhaDaTentativa>(
    `update app.${d.tabela}
        set estado = 'APLICANDO', usuario_confirmador_id = $3
      where id = $1 and empresa_id = $2
        and estado = 'AGUARDANDO_CONFIRMACAO'
        and ${d.colunaVersaoNoAgregado} = $4
      returning ${colunasDaTentativa(d)}`,
    [confirmacao.tentativaId, confirmacao.empresaId, confirmacao.usuarioId, confirmacao.versaoDaPrevia],
  );
  const linha = rows[0];

  if (linha !== undefined) {
    return paraTentativa(linha);
  }

  const atual = await buscarTentativa(cliente, d, confirmacao.empresaId, confirmacao.tentativaId);

  if (atual === null) {
    throw tentativaNaoEncontrada();
  }

  if (atual.estado !== 'AGUARDANDO_CONFIRMACAO') {
    throw estadoInvalido(atual.estado);
  }

  throw conflitoDeVersao(d);
};

/**
 * Abertura da aplicação, antes do upsert do domínio: a tentativa precisa estar em APLICANDO; a
 * versão do agregado é criada sob demanda, TRAVADA (`FOR UPDATE`) até o fim da transação e
 * comparada com a da validação — divergência → `CONFLITO_DE_VERSAO` sem tocar a base (o chamador
 * reverte tudo). Devolve a tentativa travada.
 */
export const travarVersaoParaAplicar = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
): Promise<TentativaDoCiclo> => {
  const d = exigirDescritor(descritor);
  const tentativa = await travarTentativa(cliente, d, empresaId, tentativaId);

  if (tentativa.estado !== 'APLICANDO') {
    throw estadoInvalido(tentativa.estado);
  }

  await garantirVersao(cliente, d, tentativa.tenantId, empresaId);
  const { rows } = await cliente.query<{ versao: string }>(
    `select versao::text as versao from app.${d.tabelaVersao} where empresa_id = $1 and tenant_id = $2 for update`,
    [empresaId, tentativa.tenantId],
  );

  if (Number(rows[0]!.versao) !== tentativa.versaoNaValidacao) {
    throw conflitoDeVersao(d);
  }

  return tentativa;
};

/** Fecho da aplicação: sobe a versão do agregado (já travada) e devolve a nova. */
export const subirVersao = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  tenantId: string,
  empresaId: string,
): Promise<number> => {
  const d = exigirDescritor(descritor);
  const { rows } = await cliente.query<{ versao: string }>(
    `update app.${d.tabelaVersao} set versao = versao + 1
      where empresa_id = $1 and tenant_id = $2
      returning versao::text as versao`,
    [empresaId, tenantId],
  );

  return Number(rows[0]!.versao);
};

/** APLICANDO → CONCLUIDA | CONCLUIDA_COM_REJEICOES, com os totais finais e o término. */
export const finalizar = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
  estadoFinal: EstadoFinalDaAplicacao,
  totais: TotaisDaImportacao,
  agora: Date,
): Promise<void> => {
  const d = exigirDescritor(descritor);
  const { rowCount } = await cliente.query(
    `update app.${d.tabela} set estado = $3, totais = $4::jsonb, finalizado_em = $5
      where id = $1 and empresa_id = $2 and estado = 'APLICANDO'`,
    [tentativaId, empresaId, estadoFinal, JSON.stringify(totais), agora],
  );

  if (rowCount !== 1) {
    throw await erroDaTransicao(cliente, d, empresaId, tentativaId);
  }
};

/** AGUARDANDO_CONFIRMACAO → CANCELADA, com cancelador e término. Não toca a base nem o staging. */
export const cancelar = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  cancelamento: CancelamentoDaPrevia,
): Promise<TentativaDoCiclo> => {
  const d = exigirDescritor(descritor);
  const { rows } = await cliente.query<LinhaDaTentativa>(
    `update app.${d.tabela}
        set estado = 'CANCELADA', usuario_cancelador_id = $3, finalizado_em = $4
      where id = $1 and empresa_id = $2 and estado = 'AGUARDANDO_CONFIRMACAO'
      returning ${colunasDaTentativa(d)}`,
    [cancelamento.tentativaId, cancelamento.empresaId, cancelamento.usuarioId, cancelamento.agora],
  );
  const linha = rows[0];

  if (linha === undefined) {
    throw await erroDaTransicao(cliente, d, cancelamento.empresaId, cancelamento.tentativaId);
  }

  return paraTentativa(linha);
};

// --- trilha e notificação ------------------------------------------------------------------------

/** Evento append-only da tentativa. Tenant e empresa vêm da própria tentativa (nunca de fora). */
export const registrarEvento = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  evento: NovoEvento,
): Promise<void> => {
  const d = exigirDescritor(descritor);
  const { rowCount } = await cliente.query(
    `insert into app.${d.tabelaEvento}
       (tenant_id, empresa_id, tentativa_id, acao, estado_anterior, estado_novo, usuario_id, totais,
        codigo, correlation_id, ocorrido_em)
     select t.tenant_id, t.empresa_id, t.id, $3, $4, $5, $6, $7::jsonb, $8, $9, $10
       from app.${d.tabela} t
      where t.id = $1 and t.empresa_id = $2`,
    [
      evento.tentativaId,
      evento.empresaId,
      evento.acao,
      evento.estadoAnterior,
      evento.estadoNovo,
      evento.usuarioId,
      evento.totais === null ? null : JSON.stringify(evento.totais),
      evento.codigo,
      evento.correlationId,
      evento.agora,
    ],
  );

  if (rowCount !== 1) {
    throw tentativaNaoEncontrada();
  }
};

/**
 * Avisos de conclusão, um por destinatário (UNIQUE tentativa + usuário): repetir não cria outro
 * (I-9; reprocessar ou reusar não notifica de novo). Devolve quantos nasceram agora. Tenant e
 * empresa vêm da própria tentativa; ausente nesta empresa → `TENTATIVA_NAO_ENCONTRADA`, nunca
 * confundida com "já existia". Destinatário de outro tenant cai na FK composta.
 */
export const criarNotificacoes = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  novas: NovasNotificacoes,
): Promise<number> => {
  const d = exigirDescritor(descritor);
  const tentativa = await buscarTentativa(cliente, d, novas.empresaId, novas.tentativaId);

  if (tentativa === null) {
    throw tentativaNaoEncontrada();
  }

  if (novas.destinatarios.length === 0) {
    return 0;
  }

  const { rowCount } = await cliente.query(
    `insert into app.${d.tabelaNotificacao} (tenant_id, empresa_id, tentativa_id, usuario_id, criado_em)
     select $1, $2, $3, u.id, $5 from (select distinct unnest($4::uuid[]) as id) u
     on conflict (tentativa_id, usuario_id) do nothing`,
    [tentativa.tenantId, tentativa.empresaId, tentativa.id, [...novas.destinatarios], novas.agora],
  );

  return rowCount ?? 0;
};
