/**
 * Repositório de notificações de pendências (SPEC-006).
 *
 * Mesmo padrão de `pendencias.ts`: o caso de uso controla a transação
 * (`comContextoDeTenant`), aqui só SQL. Isolamento por RLS forçada.
 *
 * `marcarComoLida` e `marcarVariasComoLidas` filtram só por `id`/`tenant_id`
 * (sem `empresaId`): a RLS forçada já garante isolamento de tenant, e a rota
 * HTTP de notificações não é aninhada em empresa — não há `empresaId`
 * disponível no controller que chama isso (Task 5).
 */
import type { CausaParaNotificar } from '@contaia/domain';
import type { PoolClient } from 'pg';

export type NotificacaoPersistida = Readonly<{
  id: string;
  empresaId: string;
  empresaNome: string;
  tipo: string;
  chave: string;
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
}>;

export type PaginaDeNotificacoes = Readonly<{
  notificacoes: readonly NotificacaoPersistida[];
  total: number;
}>;

type LinhaDaNotificacao = {
  id: string;
  empresa_id: string;
  empresa_nome: string;
  tipo: string;
  chave: string;
  lida: boolean;
  lida_em: Date | null;
  criado_em: Date;
};

const linhaParaNotificacao = (linha: LinhaDaNotificacao): NotificacaoPersistida => ({
  id: linha.id,
  empresaId: linha.empresa_id,
  empresaNome: linha.empresa_nome,
  tipo: linha.tipo,
  chave: linha.chave,
  lida: linha.lida,
  lidaEm: linha.lida_em === null ? null : linha.lida_em.toISOString(),
  criadoEm: linha.criado_em.toISOString(),
});

const SELECAO_COM_EMPRESA = `
  select n.*, coalesce(e.nome_fantasia, e.razao_social, e.cnpj) as empresa_nome
  from app.empresa_notificacao n
  join app.empresa e on e.id = n.empresa_id`;

/**
 * Insere as causas novas (ignora conflito com notificação não lida já
 * existente da mesma causa — reprocessamento e concorrência não duplicam,
 * seção 2). Cada inserção efetiva grava o evento `CRIACAO` na mesma
 * transação.
 */
export const criarNotificacoes = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  causas: readonly CausaParaNotificar[],
): Promise<void> => {
  for (const causa of causas) {
    const inserida = await cliente.query<{ id: string }>(
      `insert into app.empresa_notificacao
         (tenant_id, empresa_id, tipo, chave)
       values ($1, $2, $3, $4)
       on conflict (empresa_id, chave) where lida = false do nothing
       returning id`,
      [tenantId, empresaId, causa.tipo, causa.chave],
    );

    const notificacaoId = inserida.rows[0]?.id;
    if (notificacaoId !== undefined) {
      await cliente.query(
        `insert into app.empresa_evento_de_notificacao
           (tenant_id, empresa_id, notificacao_id, acao)
         values ($1, $2, $3, 'CRIACAO')`,
        [tenantId, empresaId, notificacaoId],
      );
    }
  }
};

/** Painel do sino: 15 mais recentes, lidas e não lidas (seção 3). */
export const listarPainel = async (
  cliente: PoolClient,
  tenantId: string,
): Promise<readonly NotificacaoPersistida[]> => {
  const resultado = await cliente.query<LinhaDaNotificacao>(
    `${SELECAO_COM_EMPRESA}
     where n.tenant_id = $1
     order by n.criado_em desc, n.sequencia desc
     limit 15`,
    [tenantId],
  );

  return resultado.rows.map(linhaParaNotificacao);
};

/** "Ver todas" — histórico completo paginado (seção 3). */
export const listarHistorico = async (
  cliente: PoolClient,
  tenantId: string,
  limite: number,
  deslocamento: number,
): Promise<PaginaDeNotificacoes> => {
  const linhas = await cliente.query<LinhaDaNotificacao>(
    `${SELECAO_COM_EMPRESA}
     where n.tenant_id = $1
     order by n.criado_em desc, n.sequencia desc
     limit $2 offset $3`,
    [tenantId, limite, deslocamento],
  );

  const total = await cliente.query<{ total: string }>(
    `select count(*)::text as total from app.empresa_notificacao where tenant_id = $1`,
    [tenantId],
  );

  return {
    notificacoes: linhas.rows.map(linhaParaNotificacao),
    total: Number(total.rows[0]?.total ?? '0'),
  };
};

export const contarNaoLidas = async (cliente: PoolClient, tenantId: string): Promise<number> => {
  const resultado = await cliente.query<{ total: string }>(
    `select count(*)::text as total from app.empresa_notificacao
     where tenant_id = $1 and lida = false`,
    [tenantId],
  );

  return Number(resultado.rows[0]?.total ?? '0');
};

/**
 * Idempotente: já lida retorna a linha atual sem gravar novo evento nem erro
 * (seção 5). Filtra só por `id` e `tenant_id` — sem `empresaId`: a RLS forçada
 * já isola por tenant, e a rota HTTP não é aninhada em empresa.
 */
export const marcarComoLida = async (
  cliente: PoolClient,
  tenantId: string,
  notificacaoId: string,
  usuarioId: string,
): Promise<NotificacaoPersistida | null> => {
  const jaLida = await cliente.query<LinhaDaNotificacao>(
    `${SELECAO_COM_EMPRESA}
     where n.id = $1 and n.tenant_id = $2 and n.lida = true`,
    [notificacaoId, tenantId],
  );

  if (jaLida.rows[0] !== undefined) {
    return linhaParaNotificacao(jaLida.rows[0]);
  }

  const atualizada = await cliente.query<{ id: string; empresa_id: string }>(
    `update app.empresa_notificacao
     set lida = true, lida_em = now()
     where id = $1 and tenant_id = $2 and lida = false
     returning id, empresa_id`,
    [notificacaoId, tenantId],
  );

  const linhaAtualizada = atualizada.rows[0];
  if (linhaAtualizada === undefined) {
    return null;
  }

  await cliente.query(
    `insert into app.empresa_evento_de_notificacao
       (tenant_id, empresa_id, notificacao_id, acao, usuario_id)
     values ($1, $2, $3, 'LEITURA', $4)`,
    [tenantId, linhaAtualizada.empresa_id, linhaAtualizada.id, usuarioId],
  );

  const linha = await cliente.query<LinhaDaNotificacao>(`${SELECAO_COM_EMPRESA} where n.id = $1`, [
    linhaAtualizada.id,
  ]);

  return linha.rows[0] === undefined ? null : linhaParaNotificacao(linha.rows[0]);
};

/**
 * Marca em lote (checkbox "Todas" — seção 3). Retorna quantas foram
 * efetivamente marcadas agora; já lidas não contam de novo (idempotência).
 * Filtra só por `id`/`tenant_id`, sem `empresaId` — mesmo motivo de
 * `marcarComoLida`.
 */
export const marcarVariasComoLidas = async (
  cliente: PoolClient,
  tenantId: string,
  ids: readonly string[],
  usuarioId: string,
): Promise<number> => {
  if (ids.length === 0) {
    return 0;
  }

  const atualizadas = await cliente.query<{ id: string; empresa_id: string }>(
    `update app.empresa_notificacao
     set lida = true, lida_em = now()
     where id = any($1) and tenant_id = $2 and lida = false
     returning id, empresa_id`,
    [ids, tenantId],
  );

  for (const linha of atualizadas.rows) {
    await cliente.query(
      `insert into app.empresa_evento_de_notificacao
         (tenant_id, empresa_id, notificacao_id, acao, usuario_id)
       values ($1, $2, $3, 'LEITURA', $4)`,
      [tenantId, linha.empresa_id, linha.id, usuarioId],
    );
  }

  return atualizadas.rows.length;
};
