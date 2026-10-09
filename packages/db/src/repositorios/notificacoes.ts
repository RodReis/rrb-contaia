/**
 * Repositório de notificações de pendências (SPEC-006).
 *
 * Mesmo padrão de `pendencias.ts`: o caso de uso controla a transação
 * (`comContextoDeTenant`), aqui só SQL. Isolamento por RLS forçada.
 *
 * `marcarComoLida` e `marcarVariasComoLidas` não recebem `empresaId` (a rota HTTP
 * não é aninhada em empresa): o escopo é o sino do usuário — carteira dele para
 * pendências e destinatário para a notificação consolidada de carteira (SPEC-009).
 */
import type { CausaParaNotificar } from '@contaia/domain';
import type { PoolClient } from 'pg';

/** Empresa resumida que a notificação consolidada de carteira cita. */
export type EmpresaDaNotificacaoDeCarteira = Readonly<{ id: string; nome: string; cnpj: string }>;

/** Tentativa que o aviso de importação abre, com o desfecho dela (estado terminal e totais). */
export type ImportacaoDaNotificacao = Readonly<{
  tentativaId: string;
  estado: string;
  /** Nulos quando a tentativa terminou sem chegar à validação (FALHA). */
  totais: Readonly<{ lidas: number; novas: number; atualizadas: number; rejeitadas: number }> | null;
}>;

/**
 * Notificação do sino: de pendência (tem empresa) ou consolidada de carteira
 * (`tipo = 'CARTEIRA_ALTERADA'`, sem empresa, com o resumo adicionadas/removidas).
 */
export type NotificacaoPersistida = Readonly<{
  id: string;
  empresaId: string | null;
  empresaNome: string | null;
  tipo: string;
  chave: string;
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
  adicionadas: readonly EmpresaDaNotificacaoDeCarteira[] | null;
  removidas: readonly EmpresaDaNotificacaoDeCarteira[] | null;
  /** Só no aviso de recuperação do Signer (SPEC-012 §3.10): quanto o serviço ficou fora. */
  duracaoMs: number | null;
  /** Só no aviso de conclusão da importação do plano de contas (SPEC-013 §3.10). */
  importacao: ImportacaoDaNotificacao | null;
}>;

export type PaginaDeNotificacoes = Readonly<{
  notificacoes: readonly NotificacaoPersistida[];
  total: number;
}>;

type LinhaDaNotificacao = {
  id: string;
  empresa_id: string | null;
  empresa_nome: string | null;
  tipo: string;
  chave: string;
  lida: boolean;
  lida_em: Date | null;
  criado_em: Date;
  adicionadas: EmpresaDaNotificacaoDeCarteira[] | null;
  removidas: EmpresaDaNotificacaoDeCarteira[] | null;
  duracao_ms: string | null;
  tentativa_id: string | null;
  importacao_estado: string | null;
  importacao_totais: ImportacaoDaNotificacao['totais'];
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
  adicionadas: linha.adicionadas,
  removidas: linha.removidas,
  // bigint chega como texto do driver; a duração de um incidente cabe com folga em Number.
  duracaoMs: linha.duracao_ms === null ? null : Number(linha.duracao_ms),
  importacao:
    linha.tentativa_id === null || linha.importacao_estado === null
      ? null
      : { tentativaId: linha.tentativa_id, estado: linha.importacao_estado, totais: linha.importacao_totais },
});

/**
 * Sino do usuário (SPEC-009 §3.5/§3.6): as notificações de pendência valem só
 * para as empresas da carteira dele; as consolidadas de carteira são dele por
 * destinatário e não dependem de carteira — quem acabou de perder a última
 * empresa é justamente quem precisa vê-las.
 *
 * `$1` tenant, `$2` usuário. As duas fontes têm sequências próprias; o `id`
 * fecha o desempate.
 */
const ITENS_DO_SINO = `
  select n.id, n.empresa_id, coalesce(e.nome_fantasia, e.razao_social, e.cnpj) as empresa_nome,
         n.tipo, n.chave, n.lida, n.lida_em, n.criado_em, n.sequencia,
         null::jsonb as adicionadas, null::jsonb as removidas, null::bigint as duracao_ms,
         null::uuid as tentativa_id, null::text as importacao_estado, null::jsonb as importacao_totais
    from app.empresa_notificacao n
    join app.empresa e on e.id = n.empresa_id
   where n.tenant_id = $1
     and exists (
       select 1 from app.carteira_vinculo cv
        where cv.tenant_id = n.tenant_id and cv.empresa_id = n.empresa_id
          and cv.usuario_id = $2 and cv.encerrado_em is null)
  union all
  select c.id, null::uuid, null::text, 'CARTEIRA_ALTERADA', c.evento_id::text,
         c.lida, c.lida_em, c.criado_em, c.sequencia, c.adicionadas, c.removidas, null::bigint,
         null::uuid, null::text, null::jsonb
    from app.carteira_notificacao c
   where c.tenant_id = $1 and c.usuario_id = $2
  union all
  -- Alerta do cofre de certificados (SPEC-011 §3.6): individual, uma vez por marco. O tipo
  -- leva o marco (CERTIFICADO_D30...) e a chave aponta o certificado; a RLS limita às
  -- empresas da carteira de quem lê. Abre o cofre da empresa, que mostra o estado atual.
  select k.id, k.empresa_id, coalesce(e.nome_fantasia, e.razao_social, e.cnpj),
         'CERTIFICADO_' || k.marco, 'certificado:' || k.certificado_id::text || ':' || k.marco,
         k.lida, k.lida_em, k.criado_em, k.sequencia, null::jsonb, null::jsonb, null::bigint,
         null::uuid, null::text, null::jsonb
    from app.empresa_certificado_notificacao k
    join app.empresa e on e.id = k.empresa_id
   where k.tenant_id = $1 and k.usuario_id = $2
  union all
  -- Incidente do Signer (SPEC-012 §3.10): do administrador destinatário, sem empresa (o serviço é
  -- global). O tipo diz o que houve e a chave aponta o incidente; a duração só vem na recuperação.
  select s.id, null::uuid, null::text,
         case s.tipo when 'INDISPONIBILIDADE' then 'SIGNER_INDISPONIVEL' else 'SIGNER_RECUPERADO' end,
         'signer:' || s.incidente_id::text || ':' || s.tipo,
         s.lida, s.lida_em, s.criado_em, s.sequencia, null::jsonb, null::jsonb, s.duracao_ms,
         null::uuid, null::text, null::jsonb
    from app.signer_notificacao s
   where s.tenant_id = $1 and s.usuario_id = $2
  union all
  -- Conclusão da importação do plano de contas (SPEC-013 §3.10): só de quem iniciou a tentativa. A RLS
  -- deixa a carteira inteira ler a notificação da empresa, então o filtro por destinatário é este.
  -- Estado e totais vêm da tentativa, que já é terminal e imutável quando a notificação nasce.
  select i.id, i.empresa_id, coalesce(e.nome_fantasia, e.razao_social, e.cnpj),
         'IMPORTACAO_PLANO_CONTAS_CONCLUIDA', 'importacao-plano-contas:' || i.tentativa_id::text,
         i.lida, i.lida_em, i.criado_em, i.sequencia, null::jsonb, null::jsonb, null::bigint,
         t.id, t.estado, t.totais
    from app.importacao_plano_contas_notificacao i
    join app.importacao_plano_contas t on t.id = i.tentativa_id and t.empresa_id = i.empresa_id
    join app.empresa e on e.id = i.empresa_id
   where i.tenant_id = $1 and i.usuario_id = $2`;

const SELECAO_DO_SINO = `select * from (${ITENS_DO_SINO}) itens`;

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
       on conflict (empresa_id, chave, tipo) where lida = false do nothing
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
  usuarioId: string,
): Promise<readonly NotificacaoPersistida[]> => {
  const resultado = await cliente.query<LinhaDaNotificacao>(
    `${SELECAO_DO_SINO}
     order by criado_em desc, sequencia desc, id desc
     limit 15`,
    [tenantId, usuarioId],
  );

  return resultado.rows.map(linhaParaNotificacao);
};

/** "Ver todas" — histórico completo paginado (seção 3). */
export const listarHistorico = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  limite: number,
  deslocamento: number,
): Promise<PaginaDeNotificacoes> => {
  const linhas = await cliente.query<LinhaDaNotificacao>(
    `${SELECAO_DO_SINO}
     order by criado_em desc, sequencia desc, id desc
     limit $3 offset $4`,
    [tenantId, usuarioId, limite, deslocamento],
  );

  const total = await cliente.query<{ total: string }>(
    `select count(*)::text as total from (${ITENS_DO_SINO}) itens`,
    [tenantId, usuarioId],
  );

  return {
    notificacoes: linhas.rows.map(linhaParaNotificacao),
    total: Number(total.rows[0]?.total ?? '0'),
  };
};

export const contarNaoLidas = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
): Promise<number> => {
  const resultado = await cliente.query<{ total: string }>(
    `select count(*)::text as total from (${ITENS_DO_SINO}) itens where not lida`,
    [tenantId, usuarioId],
  );

  return Number(resultado.rows[0]?.total ?? '0');
};

const BUSCAR_NO_SINO = `${SELECAO_DO_SINO} where id = $3`;

/**
 * Idempotente: já lida retorna a linha atual sem gravar novo evento nem erro
 * (seção 5). A rota HTTP não é aninhada em empresa; o escopo é o do SINO do
 * usuário (empresas da carteira dele e notificações de carteira endereçadas a ele),
 * então id de notificação alheia responde como inexistente (`null`).
 */
export const marcarComoLida = async (
  cliente: PoolClient,
  tenantId: string,
  notificacaoId: string,
  usuarioId: string,
): Promise<NotificacaoPersistida | null> => {
  const atual = await cliente.query<LinhaDaNotificacao>(BUSCAR_NO_SINO, [
    tenantId,
    usuarioId,
    notificacaoId,
  ]);
  const linhaAtual = atual.rows[0];

  if (linhaAtual === undefined) {
    return null;
  }
  if (linhaAtual.lida) {
    return linhaParaNotificacao(linhaAtual);
  }

  await marcarVariasComoLidas(cliente, tenantId, [notificacaoId], usuarioId);

  const depois = await cliente.query<LinhaDaNotificacao>(BUSCAR_NO_SINO, [
    tenantId,
    usuarioId,
    notificacaoId,
  ]);

  return depois.rows[0] === undefined ? null : linhaParaNotificacao(depois.rows[0]);
};

/**
 * Marca em lote (checkbox "Todas" — seção 3). Retorna quantas foram
 * efetivamente marcadas agora; já lidas não contam de novo (idempotência).
 * Só alcança o que está no sino do usuário (mesmo escopo de `marcarComoLida`).
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

  const deEmpresa = await cliente.query<{ id: string; empresa_id: string }>(
    `update app.empresa_notificacao n
        set lida = true, lida_em = now()
      where n.id = any($1) and n.tenant_id = $2 and n.lida = false
        and exists (
          select 1 from app.carteira_vinculo cv
           where cv.tenant_id = n.tenant_id and cv.empresa_id = n.empresa_id
             and cv.usuario_id = $3 and cv.encerrado_em is null)
      returning n.id, n.empresa_id`,
    [ids, tenantId, usuarioId],
  );

  for (const linha of deEmpresa.rows) {
    await cliente.query(
      `insert into app.empresa_evento_de_notificacao
         (tenant_id, empresa_id, notificacao_id, acao, usuario_id)
       values ($1, $2, $3, 'LEITURA', $4)`,
      [tenantId, linha.empresa_id, linha.id, usuarioId],
    );
  }

  const deCarteira = await cliente.query(
    `update app.carteira_notificacao
        set lida = true, lida_em = now()
      where id = any($1) and tenant_id = $2 and usuario_id = $3 and lida = false`,
    [ids, tenantId, usuarioId],
  );

  const doCofre = await cliente.query(
    `update app.empresa_certificado_notificacao
        set lida = true, lida_em = now()
      where id = any($1) and tenant_id = $2 and usuario_id = $3 and lida = false`,
    [ids, tenantId, usuarioId],
  );

  const doSigner = await cliente.query(
    `update app.signer_notificacao
        set lida = true, lida_em = now()
      where id = any($1) and tenant_id = $2 and usuario_id = $3 and lida = false`,
    [ids, tenantId, usuarioId],
  );

  const daImportacao = await cliente.query(
    `update app.importacao_plano_contas_notificacao
        set lida = true, lida_em = now()
      where id = any($1) and tenant_id = $2 and usuario_id = $3 and lida = false`,
    [ids, tenantId, usuarioId],
  );

  return (
    deEmpresa.rows.length +
    (deCarteira.rowCount ?? 0) +
    (doCofre.rowCount ?? 0) +
    (doSigner.rowCount ?? 0) +
    (daImportacao.rowCount ?? 0)
  );
};
