/**
 * Repositório do plano de contas e da importação por CSV (SPEC-013 §3.4–§3.11, §6.3, §6.4).
 *
 * O ciclo de vida da tentativa é o genérico de `importacao-ciclo.ts` com `DESCRITOR_PLANO_CONTAS`;
 * aqui ficam o que é do plano (formato do staging e upsert das contas) e as assinaturas que a F13
 * já expunha, inalteradas. Roda SEMPRE dentro da transação do chamador (`comContextoHumano` ou
 * contexto técnico da empresa) e filtra pela `empresa_id` recebida, além da RLS.
 */
import type { CodigoDeErroDaLinha, EstadoDaImportacao, NaturezaDaConta, TipoDaConta } from '@contaia/domain';
import type { PoolClient } from 'pg';

import {
  DESCRITOR_PLANO_CONTAS as D,
  buscarTentativa as buscarNoCiclo,
  cancelar as cancelarNoCiclo,
  confirmar as confirmarNoCiclo,
  criarNotificacoes,
  criarTentativa as criarNoCiclo,
  exigirNumerosDeLinhaUnicos,
  finalizar as finalizarNoCiclo,
  gravarResultadoDaValidacao as gravarNoCiclo,
  iniciarValidacao as iniciarNoCiclo,
  registrarEvento as registrarEventoNoCiclo,
  registrarFalha as registrarFalhaNoCiclo,
  registrarLeituraDaPlanilha as registrarLeituraNoCiclo,
  subirVersao,
  travarVersaoParaAplicar,
} from './importacao-ciclo.js';
import type {
  AcaoDaLinha,
  CancelamentoDaPrevia,
  ConfirmacaoDaPrevia,
  EstadoFinalDaAplicacao,
  LeituraDaPlanilhaParaRegistrar,
  NovaTentativa,
  NovoEvento,
  ResultadoDaValidacaoGravada,
  TentativaDoCiclo,
  TotaisDaImportacao,
} from './importacao-ciclo.js';

export type {
  AcaoDaLinha,
  AcaoDoEvento,
  CancelamentoDaPrevia,
  ConfirmacaoDaPrevia,
  EstadoFinalDaAplicacao,
  LeituraDaPlanilhaParaRegistrar,
  Mapeamento,
  NovaTentativa,
  NovoEvento,
  ResultadoDaValidacaoGravada,
  TotaisDaImportacao,
} from './importacao-ciclo.js';

export type TotaisDaPrevia = TotaisDaImportacao;

/** A tentativa do ciclo com o nome que a F13 expõe para a versão: a do plano. */
export type TentativaDeImportacao = Omit<TentativaDoCiclo, 'versaoNaValidacao'> &
  Readonly<{
    /** Versão do plano lida no início da validação; nula até lá. */
    planoVersaoNaValidacao: number | null;
  }>;

/** `reutilizada`: ESTE pedido caiu numa tentativa existente (mesmo tenant, empresa, hash e mapeamento). */
export type TentativaCriada = TentativaDeImportacao & Readonly<{ reutilizada: boolean }>;

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

export type ResultadoDaAplicacao = Readonly<{
  incluidas: number;
  atualizadas: number;
  /** Códigos de linhas válidas cuja conta está arquivada: não tocadas (SPEC-013 §3.6). */
  ignoradas: readonly string[];
  /** Versão do plano depois desta aplicação. */
  versaoDoPlano: number;
}>;

/** O destinatário não entra: é sempre o iniciador da tentativa (SPEC-013 §3.10). */
export type NovaNotificacao = Readonly<{
  empresaId: string;
  tentativaId: string;
  agora: Date;
}>;

const doPlano = ({ versaoNaValidacao, ...resto }: TentativaDoCiclo): TentativaDeImportacao => ({
  ...resto,
  planoVersaoNaValidacao: versaoNaValidacao,
});

// --- tentativa -----------------------------------------------------------------------------------

/** Ver `importacao-ciclo.criarTentativa` (identidade idempotente e obsolescência do FIX #107). */
export const criarTentativa = async (cliente: PoolClient, nova: NovaTentativa): Promise<TentativaCriada> => {
  const { reutilizada, ...tentativa } = await criarNoCiclo(cliente, D, nova);

  return { ...doPlano(tentativa), reutilizada };
};

/** Tentativa da empresa informada; de outra empresa, tenant ou fora da carteira → `null`. */
export const buscarTentativa = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
): Promise<TentativaDeImportacao | null> => {
  const tentativa = await buscarNoCiclo(cliente, D, empresaId, tentativaId);

  return tentativa === null ? null : doPlano(tentativa);
};

// --- validação (worker) --------------------------------------------------------------------------

/** RECEBIDA → VALIDANDO; devolve a versão do plano lida agora. Ver `importacao-ciclo.iniciarValidacao`. */
export const iniciarValidacao = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  agora: Date,
): Promise<ResultadoDoInicioDaValidacao> => {
  const { transicionou, versaoNaValidacao } = await iniciarNoCiclo(cliente, D, empresaId, tentativaId, agora);

  return { transicionou, planoVersaoNaValidacao: versaoNaValidacao };
};

/** Insere o lote inteiro numa instrução (`unnest` de arrays); reentrega não duplica (DO NOTHING). */
const inserirStaging = async (
  cliente: PoolClient,
  tentativa: TentativaDoCiclo,
  linhas: readonly LinhaDeStaging[],
): Promise<void> => {
  if (linhas.length === 0) {
    return;
  }

  exigirNumerosDeLinhaUnicos(linhas.map((linha) => linha.numeroDaLinha));
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
 * Grava o staging e fecha a validação (AGUARDANDO_CONFIRMACAO ou REJEITADA), fixando a versão do
 * plano que ESTA entrega leu. Idempotente na reentrega. Ver `importacao-ciclo.gravarResultadoDaValidacao`.
 */
export const gravarResultadoDaValidacao = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  linhas: readonly LinhaDeStaging[],
  planoVersaoNaValidacao: number,
  agora: Date,
): Promise<ResultadoDaValidacaoGravada> =>
  gravarNoCiclo(cliente, D, empresaId, tentativaId, planoVersaoNaValidacao, agora, (tentativa) =>
    inserirStaging(cliente, tentativa, linhas),
  );

/** Leitura da planilha (só em RECEBIDA | VALIDANDO; repetição sobrescreve). Ver `importacao-ciclo.registrarLeituraDaPlanilha`. */
export const registrarLeituraDaPlanilha = (cliente: PoolClient, leitura: LeituraDaPlanilhaParaRegistrar): Promise<void> =>
  registrarLeituraNoCiclo(cliente, D, leitura);

/** Falha técnica: VALIDANDO | APLICANDO → FALHA, com término. Devolve o estado anterior. */
export const registrarFalha = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  agora: Date,
): Promise<EstadoDaImportacao> => registrarFalhaNoCiclo(cliente, D, empresaId, tentativaId, agora);

// --- confirmação, aplicação e cancelamento (caso de uso transacional da API) ---------------------

/** AGUARDANDO_CONFIRMACAO → APLICANDO; versão diferente → `CONFLITO_DE_VERSAO`. */
export const confirmar = async (
  cliente: PoolClient,
  confirmacao: ConfirmacaoDaPrevia,
): Promise<TentativaDeImportacao> => doPlano(await confirmarNoCiclo(cliente, D, confirmacao));

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
  const tentativa = await travarVersaoParaAplicar(cliente, D, empresaId, tentativaId);

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

  const versaoDoPlano = await subirVersao(cliente, D, tentativa.tenantId, empresaId);
  const resultado = rows[0]!;

  return {
    incluidas: resultado.incluidas,
    atualizadas: resultado.atualizadas,
    ignoradas: resultado.ignoradas,
    versaoDoPlano,
  };
};

/** APLICANDO → CONCLUIDA | CONCLUIDA_COM_REJEICOES, com os totais finais e o término. */
export const finalizar = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  estadoFinal: EstadoFinalDaAplicacao,
  totais: TotaisDaImportacao,
  agora: Date,
): Promise<void> => finalizarNoCiclo(cliente, D, empresaId, tentativaId, estadoFinal, totais, agora);

/** AGUARDANDO_CONFIRMACAO → CANCELADA, com cancelador e término. Não toca o plano nem o staging. */
export const cancelar = async (
  cliente: PoolClient,
  cancelamento: CancelamentoDaPrevia,
): Promise<TentativaDeImportacao> => doPlano(await cancelarNoCiclo(cliente, D, cancelamento));

// --- trilha e notificação ------------------------------------------------------------------------

/** Evento append-only da tentativa. Tenant e empresa vêm da própria tentativa (nunca de fora). */
export const registrarEvento = (cliente: PoolClient, evento: NovoEvento): Promise<void> =>
  registrarEventoNoCiclo(cliente, D, evento);

/**
 * Notificação de conclusão, sempre para o iniciador: o destinatário vem da própria tentativa,
 * nunca de quem chama (SPEC-013 §3.10). Uma por tentativa: repetir devolve `false` e não cria
 * outra. Tentativa ausente nesta empresa → `TENTATIVA_NAO_ENCONTRADA`, nunca confundida com
 * "já existia". A RLS deixa a carteira ver as notificações da empresa: quem lê filtra por `usuario_id`.
 */
export const criarNotificacao = async (cliente: PoolClient, notificacao: NovaNotificacao): Promise<boolean> => {
  const tentativa = await buscarNoCiclo(cliente, D, notificacao.empresaId, notificacao.tentativaId);
  // Sem tentativa, `criarNotificacoes` lança TENTATIVA_NAO_ENCONTRADA.
  const destinatarios = tentativa === null ? [] : [tentativa.usuarioIniciadorId];

  return (await criarNotificacoes(cliente, D, { ...notificacao, destinatarios })) === 1;
};
