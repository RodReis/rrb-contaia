/**
 * Repositório do plano de contas e da importação por CSV (SPEC-013 §3.4–§3.11, §6.3, §6.4).
 *
 * Roda SEMPRE dentro de uma transação já aberta pelo chamador com `comContextoHumano` (API) ou
 * `comContexto(pool, contextoTecnico(...))` (worker da empresa): aqui não se abre, confirma nem
 * reverte transação — o caso de uso controla. A RLS limita tenant e empresa; ainda assim toda
 * consulta filtra pela `empresa_id` recebida, para que um id de outra empresa da mesma carteira
 * nunca seja lido nem alterado. O "agora" entra sempre por parâmetro.
 *
 * Transições de estado usam `UPDATE … WHERE estado = <origem>`: numa corrida a segunda transação
 * espera a primeira e, depois do commit, não encontra mais a origem (0 linhas → erro de estado).
 */
import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, podeTransicionar } from '@contaia/domain';
import type {
  CodigoDeErroDaLinha,
  EstadoDaImportacao,
  EventoDaImportacao,
  NaturezaDaConta,
  TipoDaConta,
} from '@contaia/domain';
import type { PoolClient } from 'pg';

export type Mapeamento = Readonly<Record<string, string>>;
export type AcaoDaLinha = 'INCLUIR' | 'ATUALIZAR';

export type TotaisDaImportacao = Readonly<{
  lidas: number;
  novas: number;
  atualizadas: number;
  rejeitadas: number;
}>;
export type TotaisDaPrevia = TotaisDaImportacao;

export type TentativaDeImportacao = Readonly<{
  id: string;
  tenantId: string;
  empresaId: string;
  hashArquivo: string;
  mapeamento: Mapeamento;
  arquivoNome: string;
  arquivoTamanho: number;
  arquivoChave: string;
  estado: EstadoDaImportacao;
  /** Versão do plano lida no início da validação; nula até lá. */
  planoVersaoNaValidacao: number | null;
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
export type TentativaCriada = TentativaDeImportacao & Readonly<{ reutilizada: boolean }>;

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

/** Linha aceita pela validação: valores normalizados e a ação que a prévia mostrou. */
export type LinhaDeStagingValida = Readonly<{
  status: 'VALIDA';
  numeroDaLinha: number;
  codigo: string;
  nome: string;
  tipo: TipoDaConta;
  natureza: NaturezaDaConta;
  contaPai: string | null;
  acao: AcaoDaLinha;
}>;

/** Linha rejeitada: guarda o valor cru (pode faltar ou estar fora do domínio) para o relatório. */
export type LinhaDeStagingRejeitada = Readonly<{
  status: 'REJEITADA';
  numeroDaLinha: number;
  codigo: string | null;
  nome: string | null;
  tipo: string | null;
  natureza: string | null;
  contaPai: string | null;
  codigoDeErro: CodigoDeErroDaLinha;
  campo: string | null;
  mensagem: string;
}>;

export type LinhaDeStaging = LinhaDeStagingValida | LinhaDeStagingRejeitada;

export type ResultadoDoInicioDaValidacao = Readonly<{
  /** `false` na reentrega do job com a tentativa já em VALIDANDO. */
  transicionou: boolean;
  /** Versão lida por ESTA entrega: passar a `gravarResultadoDaValidacao` (não é gravada aqui). */
  planoVersaoNaValidacao: number;
}>;

export type ResultadoDaValidacaoGravada = Readonly<{
  estado: EstadoDaImportacao;
  totais: TotaisDaPrevia;
  /** `false` quando a validação já tinha sido gravada (reentrega): não registrar evento de novo. */
  transicionou: boolean;
}>;

export type ConfirmacaoDaPrevia = Readonly<{
  empresaId: string;
  tentativaId: string;
  usuarioId: string;
  /** Versão do plano que a prévia exibiu; diferente da validada → `CONFLITO_DE_VERSAO`. */
  versaoDaPrevia: number;
}>;

export type CancelamentoDaPrevia = Readonly<{
  empresaId: string;
  tentativaId: string;
  usuarioId: string;
  agora: Date;
}>;

export type ResultadoDaAplicacao = Readonly<{
  incluidas: number;
  atualizadas: number;
  /** Códigos de linhas válidas cuja conta está arquivada: não tocadas (SPEC-013 §3.6). */
  ignoradas: readonly string[];
  /** Versão do plano depois desta aplicação. */
  versaoDoPlano: number;
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

/** O destinatário não entra: é sempre o iniciador da tentativa (SPEC-013 §3.10). */
export type NovaNotificacao = Readonly<{
  empresaId: string;
  tentativaId: string;
  agora: Date;
}>;

// --- apoio ---------------------------------------------------------------------------------------

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
  plano_versao_na_validacao: string | null;
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

const COLUNAS_DA_TENTATIVA = `id, tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome,
  arquivo_tamanho::text as arquivo_tamanho, arquivo_chave, estado,
  plano_versao_na_validacao::text as plano_versao_na_validacao, totais, usuario_iniciador_id,
  usuario_confirmador_id, usuario_cancelador_id, correlation_id, reutilizada_por_idempotencia,
  criado_em, iniciado_em, finalizado_em`;

/** Resultado terminal que o reenvio idêntico reaproveita (SPEC-013 §3.7). */
const RESULTADOS_REUTILIZAVEIS_SQL = `('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA')`;
/** Predicado da UNIQUE parcial `importacao_plano_contas_idempotente` (migration 0015), literal. */
const PREDICADO_DA_IDENTIDADE_SQL = `estado not in ('FALHA', 'CANCELADA')`;

const paraTentativa = (linha: LinhaDaTentativa): TentativaDeImportacao => ({
  id: linha.id,
  tenantId: linha.tenant_id,
  empresaId: linha.empresa_id,
  hashArquivo: linha.hash_arquivo,
  mapeamento: linha.mapeamento,
  arquivoNome: linha.arquivo_nome,
  arquivoTamanho: Number(linha.arquivo_tamanho),
  arquivoChave: linha.arquivo_chave,
  estado: linha.estado,
  planoVersaoNaValidacao: linha.plano_versao_na_validacao === null ? null : Number(linha.plano_versao_na_validacao),
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

const conflitoDeVersao = (): ErroDeConflito =>
  new ErroDeConflito(
    CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
    'O plano de contas mudou depois da prévia. Valide o arquivo novamente.',
  );

/** Tentativa da empresa travada até o fim da transação (`FOR UPDATE`); ausente → erro. */
const travarTentativa = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
): Promise<TentativaDeImportacao> => {
  const { rows } = await cliente.query<LinhaDaTentativa>(
    `select ${COLUNAS_DA_TENTATIVA}
       from app.importacao_plano_contas
      where id = $1 and empresa_id = $2
      for update`,
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
  empresaId: string,
  tentativaId: string,
): Promise<ErroDeDominio> => {
  const { rows } = await cliente.query<{ estado: EstadoDaImportacao }>(
    `select estado from app.importacao_plano_contas where id = $1 and empresa_id = $2`,
    [tentativaId, empresaId],
  );
  const linha = rows[0];

  return linha === undefined ? tentativaNaoEncontrada() : estadoInvalido(linha.estado);
};

// --- tentativa -----------------------------------------------------------------------------------

/**
 * Cria a tentativa RECEBIDA, já com o mapeamento. A identidade idempotente (tenant + empresa +
 * hash + mapeamento) é a UNIQUE parcial da tabela, que ignora FALHA e CANCELADA: o pedido
 * repetido devolve a tentativa viva ou com resultado reutilizável, com `reutilizada = true`, numa
 * única instrução (sem corrida entre ler e inserir; o segundo de dois envios simultâneos espera o
 * primeiro e cai no reuso). Depois de FALHA ou CANCELADA nasce uma tentativa nova. Se a existente
 * tem resultado reutilizável, a marca de reuso do histórico também sobe.
 */
export const criarTentativa = async (cliente: PoolClient, nova: NovaTentativa): Promise<TentativaCriada> => {
  const { rows } = await cliente.query<LinhaDaTentativa & { nova: boolean }>(
    `insert into app.importacao_plano_contas as t
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
        usuario_iniciador_id, correlation_id, criado_em)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
     on conflict (empresa_id, tenant_id, hash_arquivo, mapeamento) where ${PREDICADO_DA_IDENTIDADE_SQL}
     do update
       set reutilizada_por_idempotencia = t.reutilizada_por_idempotencia or t.estado in ${RESULTADOS_REUTILIZAVEIS_SQL}
     returning ${COLUNAS_DA_TENTATIVA}, (xmax = 0) as nova`,
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

  return { ...paraTentativa(linha), reutilizada: !linha.nova };
};

/** Tentativa da empresa informada; de outra empresa, tenant ou fora da carteira → `null`. */
export const buscarTentativa = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
): Promise<TentativaDeImportacao | null> => {
  const { rows } = await cliente.query<LinhaDaTentativa>(
    `select ${COLUNAS_DA_TENTATIVA} from app.importacao_plano_contas where id = $1 and empresa_id = $2`,
    [tentativaId, empresaId],
  );
  const linha = rows[0];

  return linha === undefined ? null : paraTentativa(linha);
};

// --- validação (worker) --------------------------------------------------------------------------

/**
 * RECEBIDA → VALIDANDO e DEVOLVE a versão do plano lida agora (cria a linha de versão sob
 * demanda). A versão NÃO é gravada aqui: cada entrega do job leva a sua até
 * `gravarResultadoDaValidacao`, que a fixa junto com o staging. Assim uma reentrega que começou
 * depois de outra aplicação nunca rotula com a versão nova o staging que a entrega anterior
 * calculou sobre o plano antigo. Chamar ANTES de carregar as contas vigentes: uma aplicação
 * concorrente no meio do caminho só pode gerar conflito na confirmação, nunca uma prévia obsoleta
 * aceita. Reentrega com a tentativa já em VALIDANDO não falha e mantém o início.
 */
export const iniciarValidacao = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  agora: Date,
): Promise<ResultadoDoInicioDaValidacao> => {
  const tentativa = await travarTentativa(cliente, empresaId, tentativaId);

  if (tentativa.estado !== 'RECEBIDA' && tentativa.estado !== 'VALIDANDO') {
    throw estadoInvalido(tentativa.estado);
  }

  await cliente.query(
    `insert into app.empresa_plano_versao (tenant_id, empresa_id) values ($1, $2)
     on conflict (empresa_id, tenant_id) do nothing`,
    [tentativa.tenantId, empresaId],
  );
  const { rows } = await cliente.query<{ versao: string }>(
    `select versao::text as versao from app.empresa_plano_versao where empresa_id = $1 and tenant_id = $2`,
    [empresaId, tentativa.tenantId],
  );
  const planoVersaoNaValidacao = Number(rows[0]!.versao);

  await cliente.query(
    `update app.importacao_plano_contas
        set estado = 'VALIDANDO', iniciado_em = coalesce(iniciado_em, $3)
      where id = $1 and empresa_id = $2`,
    [tentativaId, empresaId, agora],
  );

  return { transicionou: tentativa.estado === 'RECEBIDA', planoVersaoNaValidacao };
};

const contarTotais = async (cliente: PoolClient, empresaId: string, tentativaId: string): Promise<TotaisDaPrevia> => {
  const { rows } = await cliente.query<TotaisDaImportacao>(
    `select count(*)::int as lidas,
            count(*) filter (where status = 'VALIDA' and acao = 'INCLUIR')::int as novas,
            count(*) filter (where status = 'VALIDA' and acao = 'ATUALIZAR')::int as atualizadas,
            count(*) filter (where status = 'REJEITADA')::int as rejeitadas
       from app.importacao_plano_contas_linha
      where tentativa_id = $1 and empresa_id = $2`,
    [tentativaId, empresaId],
  );

  return rows[0]!;
};

/** Insere o lote inteiro numa instrução (`unnest` de arrays); reentrega não duplica (DO NOTHING). */
const inserirStaging = async (
  cliente: PoolClient,
  tentativa: TentativaDeImportacao,
  linhas: readonly LinhaDeStaging[],
): Promise<void> => {
  if (linhas.length === 0) {
    return;
  }

  // DO NOTHING descartaria em silêncio a segunda linha com o mesmo número e os totais sairiam
  // menores que o arquivo: lote assim é defeito de quem chama, recusado antes de gravar.
  const vistos = new Set<number>();
  for (const linha of linhas) {
    if (vistos.has(linha.numeroDaLinha)) {
      throw new Error(`Lote de staging com número de linha repetido: ${linha.numeroDaLinha}.`);
    }
    vistos.add(linha.numeroDaLinha);
  }

  const coluna = <T>(valor: (linha: LinhaDeStaging) => T): T[] => linhas.map(valor);

  await cliente.query(
    `insert into app.importacao_plano_contas_linha
       (tenant_id, empresa_id, tentativa_id, numero_linha, codigo, nome, tipo, natureza, conta_pai,
        status, acao, codigo_de_erro, campo, mensagem)
     select $1, $2, $3, l.numero_linha, l.codigo, l.nome, l.tipo, l.natureza, l.conta_pai,
            l.status, l.acao, l.codigo_de_erro, l.campo, l.mensagem
       from unnest($4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
                   $10::text[], $11::text[], $12::text[], $13::text[], $14::text[])
         as l(numero_linha, codigo, nome, tipo, natureza, conta_pai, status, acao, codigo_de_erro, campo, mensagem)
     on conflict (tentativa_id, numero_linha) do nothing`,
    [
      tentativa.tenantId,
      tentativa.empresaId,
      tentativa.id,
      coluna((l) => l.numeroDaLinha),
      coluna((l) => l.codigo),
      coluna((l) => l.nome),
      coluna((l) => l.tipo),
      coluna((l) => l.natureza),
      coluna((l) => l.contaPai),
      coluna((l) => l.status),
      coluna((l) => (l.status === 'VALIDA' ? l.acao : null)),
      coluna((l) => (l.status === 'REJEITADA' ? l.codigoDeErro : null)),
      coluna((l) => (l.status === 'REJEITADA' ? l.campo : null)),
      coluna((l) => (l.status === 'REJEITADA' ? l.mensagem : null)),
    ],
  );
};

/**
 * Grava o staging e fecha a validação: VALIDANDO → AGUARDANDO_CONFIRMACAO (ao menos uma linha
 * válida) ou REJEITADA (nenhuma; terminal, com término). Os totais vêm do que está no banco, não
 * do lote recebido. `planoVersaoNaValidacao` é a versão que ESTA entrega recebeu de
 * `iniciarValidacao` (antes de carregar as contas) e é fixada no mesmo UPDATE que muda o estado.
 * Idempotente: se a validação já foi gravada (reentrega do job), não insere nada, não troca a
 * versão e devolve o estado e os totais existentes com `transicionou = false`. Sem DELETE.
 */
export const gravarResultadoDaValidacao = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  linhas: readonly LinhaDeStaging[],
  planoVersaoNaValidacao: number,
  agora: Date,
): Promise<ResultadoDaValidacaoGravada> => {
  const tentativa = await travarTentativa(cliente, empresaId, tentativaId);

  if (tentativa.estado === 'RECEBIDA' || tentativa.estado === 'FALHA') {
    throw estadoInvalido(tentativa.estado);
  }

  if (tentativa.estado !== 'VALIDANDO') {
    return {
      estado: tentativa.estado,
      totais: tentativa.totais ?? (await contarTotais(cliente, empresaId, tentativaId)),
      transicionou: false,
    };
  }

  await inserirStaging(cliente, tentativa, linhas);
  const totais = await contarTotais(cliente, empresaId, tentativaId);
  const estado: EstadoDaImportacao = totais.novas + totais.atualizadas > 0 ? 'AGUARDANDO_CONFIRMACAO' : 'REJEITADA';

  await cliente.query(
    `update app.importacao_plano_contas
        set estado = $3, totais = $4::jsonb, finalizado_em = $5, plano_versao_na_validacao = $6
      where id = $1 and empresa_id = $2 and estado = 'VALIDANDO'`,
    [
      tentativaId,
      empresaId,
      estado,
      JSON.stringify(totais),
      estado === 'REJEITADA' ? agora : null,
      planoVersaoNaValidacao,
    ],
  );

  return { estado, totais, transicionou: true };
};

/**
 * Falha técnica (tentativas do job esgotadas): VALIDANDO | APLICANDO → FALHA, com término.
 * Devolve o estado anterior, para o evento.
 */
export const registrarFalha = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  agora: Date,
): Promise<EstadoDaImportacao> => {
  const tentativa = await travarTentativa(cliente, empresaId, tentativaId);

  if (!podeTransicionar(tentativa.estado, 'FALHA_TECNICA')) {
    throw estadoInvalido(tentativa.estado);
  }

  await cliente.query(
    `update app.importacao_plano_contas set estado = 'FALHA', finalizado_em = $3
      where id = $1 and empresa_id = $2`,
    [tentativaId, empresaId, agora],
  );

  return tentativa.estado;
};

// --- confirmação, aplicação e cancelamento (caso de uso transacional da API) ---------------------

/**
 * AGUARDANDO_CONFIRMACAO → APLICANDO, gravando o confirmador. Numa corrida só uma transação
 * encontra a origem; a outra (que esperou o commit da primeira) recebe `ESTADO_INVALIDO_PARA_ACAO`.
 * Versão da prévia diferente da validada → `CONFLITO_DE_VERSAO`.
 */
export const confirmar = async (
  cliente: PoolClient,
  confirmacao: ConfirmacaoDaPrevia,
): Promise<TentativaDeImportacao> => {
  const { rows } = await cliente.query<LinhaDaTentativa>(
    `update app.importacao_plano_contas
        set estado = 'APLICANDO', usuario_confirmador_id = $3
      where id = $1 and empresa_id = $2
        and estado = 'AGUARDANDO_CONFIRMACAO'
        and plano_versao_na_validacao = $4
      returning ${COLUNAS_DA_TENTATIVA}`,
    [confirmacao.tentativaId, confirmacao.empresaId, confirmacao.usuarioId, confirmacao.versaoDaPrevia],
  );
  const linha = rows[0];

  if (linha !== undefined) {
    return paraTentativa(linha);
  }

  const atual = await buscarTentativa(cliente, confirmacao.empresaId, confirmacao.tentativaId);

  if (atual === null) {
    throw tentativaNaoEncontrada();
  }

  if (atual.estado !== 'AGUARDANDO_CONFIRMACAO') {
    throw estadoInvalido(atual.estado);
  }

  throw conflitoDeVersao();
};

/**
 * Aplica as linhas válidas do staging ao plano, numa instrução, dentro da transação do chamador.
 * Antes, trava a versão do plano e a compara com a da validação: divergência →
 * `CONFLITO_DE_VERSAO` sem tocar conta alguma (o chamador reverte tudo). Código novo inclui
 * (`xmax = 0`); código ativo existente atualiza nome, tipo, natureza e pai; conta arquivada nunca
 * é tocada (`WHERE arquivada = false`) e volta em `ignoradas`. Valor igual ao vigente conta como
 * atualizada mas não muda instante nem versão da conta. Ausentes do CSV ficam como estão.
 */
export const aplicarLinhas = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  agora: Date,
): Promise<ResultadoDaAplicacao> => {
  const tentativa = await travarTentativa(cliente, empresaId, tentativaId);

  if (tentativa.estado !== 'APLICANDO') {
    throw estadoInvalido(tentativa.estado);
  }

  await cliente.query(
    `insert into app.empresa_plano_versao (tenant_id, empresa_id) values ($1, $2)
     on conflict (empresa_id, tenant_id) do nothing`,
    [tentativa.tenantId, empresaId],
  );
  const { rows: versoes } = await cliente.query<{ versao: string }>(
    `select versao::text as versao from app.empresa_plano_versao
      where empresa_id = $1 and tenant_id = $2
      for update`,
    [empresaId, tentativa.tenantId],
  );

  if (Number(versoes[0]!.versao) !== tentativa.planoVersaoNaValidacao) {
    throw conflitoDeVersao();
  }

  const { rows } = await cliente.query<{ incluidas: number; atualizadas: number; ignoradas: string[] }>(
    `with validas as (
       select codigo, nome, tipo, natureza, conta_pai
         from app.importacao_plano_contas_linha
        where tentativa_id = $1 and empresa_id = $2 and status = 'VALIDA'
     ), aplicadas as (
       insert into app.conta_contabil as cc
         (tenant_id, empresa_id, codigo, nome, tipo, natureza, conta_pai, criado_em, atualizado_em)
       select $3, $2, codigo, nome, tipo, natureza, conta_pai, $4, $4 from validas
       on conflict (empresa_id, codigo) do update
         set nome = excluded.nome,
             tipo = excluded.tipo,
             natureza = excluded.natureza,
             conta_pai = excluded.conta_pai,
             atualizado_em = case
               when (cc.nome, cc.tipo, cc.natureza, cc.conta_pai)
                    is distinct from (excluded.nome, excluded.tipo, excluded.natureza, excluded.conta_pai)
               then excluded.atualizado_em
               else cc.atualizado_em
             end
         where cc.arquivada = false
       returning cc.codigo, (cc.xmax = 0) as incluida
     )
     select (select count(*) from aplicadas where incluida)::int as incluidas,
            (select count(*) from aplicadas where not incluida)::int as atualizadas,
            coalesce(
              (select array_agg(v.codigo order by v.codigo) from validas v
                where not exists (select 1 from aplicadas a where a.codigo = v.codigo)),
              '{}'
            ) as ignoradas`,
    [tentativaId, empresaId, tentativa.tenantId, agora],
  );

  // A FK de conta-pai é diferida (o lote não tem ordem): conferida aqui, não só no commit, para a
  // falha aparecer na aplicação. Depois volta ao modo declarado.
  await cliente.query(`set constraints app.conta_contabil_pai_da_mesma_empresa immediate`);
  await cliente.query(`set constraints app.conta_contabil_pai_da_mesma_empresa deferred`);

  const { rows: nova } = await cliente.query<{ versao: string }>(
    `update app.empresa_plano_versao set versao = versao + 1
      where empresa_id = $1 and tenant_id = $2
      returning versao::text as versao`,
    [empresaId, tentativa.tenantId],
  );
  const resultado = rows[0]!;

  return {
    incluidas: resultado.incluidas,
    atualizadas: resultado.atualizadas,
    ignoradas: resultado.ignoradas,
    versaoDoPlano: Number(nova[0]!.versao),
  };
};

/** APLICANDO → CONCLUIDA | CONCLUIDA_COM_REJEICOES, com os totais finais e o término. */
export const finalizar = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  estadoFinal: EstadoFinalDaAplicacao,
  totais: TotaisDaImportacao,
  agora: Date,
): Promise<void> => {
  const { rowCount } = await cliente.query(
    `update app.importacao_plano_contas
        set estado = $3, totais = $4::jsonb, finalizado_em = $5
      where id = $1 and empresa_id = $2 and estado = 'APLICANDO'`,
    [tentativaId, empresaId, estadoFinal, JSON.stringify(totais), agora],
  );

  if (rowCount !== 1) {
    throw await erroDaTransicao(cliente, empresaId, tentativaId);
  }
};

/** AGUARDANDO_CONFIRMACAO → CANCELADA, com cancelador e término. Não toca o plano nem o staging. */
export const cancelar = async (
  cliente: PoolClient,
  cancelamento: CancelamentoDaPrevia,
): Promise<TentativaDeImportacao> => {
  const { rows } = await cliente.query<LinhaDaTentativa>(
    `update app.importacao_plano_contas
        set estado = 'CANCELADA', usuario_cancelador_id = $3, finalizado_em = $4
      where id = $1 and empresa_id = $2 and estado = 'AGUARDANDO_CONFIRMACAO'
      returning ${COLUNAS_DA_TENTATIVA}`,
    [cancelamento.tentativaId, cancelamento.empresaId, cancelamento.usuarioId, cancelamento.agora],
  );
  const linha = rows[0];

  if (linha === undefined) {
    throw await erroDaTransicao(cliente, cancelamento.empresaId, cancelamento.tentativaId);
  }

  return paraTentativa(linha);
};

// --- trilha e notificação ------------------------------------------------------------------------

/** Evento append-only da tentativa. Tenant e empresa vêm da própria tentativa (nunca de fora). */
export const registrarEvento = async (cliente: PoolClient, evento: NovoEvento): Promise<void> => {
  const { rowCount } = await cliente.query(
    `insert into app.importacao_plano_contas_evento
       (tenant_id, empresa_id, tentativa_id, acao, estado_anterior, estado_novo, usuario_id, totais,
        codigo, correlation_id, ocorrido_em)
     select t.tenant_id, t.empresa_id, t.id, $3, $4, $5, $6, $7::jsonb, $8, $9, $10
       from app.importacao_plano_contas t
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
 * Notificação de conclusão, sempre para o iniciador: o destinatário vem da própria tentativa,
 * nunca de quem chama (SPEC-013 §3.10). Uma por tentativa: repetir devolve `false` e não cria
 * outra (reprocessar ou reusar não notifica de novo). Tentativa ausente nesta empresa →
 * `TENTATIVA_NAO_ENCONTRADA`, nunca confundida com "já existia". A RLS deixa a carteira ver as
 * notificações da empresa: quem lê filtra por `usuario_id`.
 */
export const criarNotificacao = async (cliente: PoolClient, notificacao: NovaNotificacao): Promise<boolean> => {
  const tentativa = await buscarTentativa(cliente, notificacao.empresaId, notificacao.tentativaId);

  if (tentativa === null) {
    throw tentativaNaoEncontrada();
  }

  const { rowCount } = await cliente.query(
    `insert into app.importacao_plano_contas_notificacao (tenant_id, empresa_id, tentativa_id, usuario_id, criado_em)
     values ($1, $2, $3, $4, $5)
     on conflict (tentativa_id, usuario_id) do nothing`,
    [tentativa.tenantId, tentativa.empresaId, tentativa.id, tentativa.usuarioIniciadorId, notificacao.agora],
  );

  return rowCount === 1;
};
