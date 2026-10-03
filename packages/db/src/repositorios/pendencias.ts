/**
 * Repositório da Central de Pendências (SPEC-005).
 *
 * O caso de uso controla a transação (`comContextoDeTenant`); aqui só SQL.
 * O isolamento de tenant nesta tabela é garantido por RLS forçada
 * (`FORCE ROW LEVEL SECURITY`) na sessão aberta pelo caso de uso — não por
 * filtro explícito de `tenant_id` em cada query aqui (as funções abaixo
 * filtram por `empresa_id`/`id`, não por `tenant_id`). A cobertura de
 * isolamento entre tenants está nos testes de concorrência/RLS (Task 3/7).
 */
import type { OrigemDaPendencia } from '@contaia/domain';
import type { PoolClient } from 'pg';

export type PendenciaPersistida = Readonly<{
  id: string;
  empresaId: string;
  origem: string;
  tipo: string;
  chave: string;
  estado: string;
  dataLimite: string | null;
  criadoEm: string;
  resolvidoEm: string | null;
}>;

export type PendenciaComEmpresa = PendenciaPersistida & Readonly<{ empresaNome: string }>;

export type CausaParaReconciliar = Readonly<{
  origem: string;
  tipo: string;
  chave: string;
  dataLimite: string | null;
}>;

export type FiltroDaCentral = Readonly<{
  /** Só as pendências das empresas da carteira deste usuário (SPEC-009). */
  carteiraDoUsuarioId: string;
  empresaId: string | null;
  origem: string | null;
  tipo: string | null;
  estado: string | null;
  vencimento: 'VENCIDAS' | 'PROXIMAS' | null;
  limite: number;
  deslocamento: number;
}>;

export type PaginaDePendencias = Readonly<{
  pendencias: readonly PendenciaComEmpresa[];
  total: number;
}>;

type LinhaDaPendencia = {
  id: string;
  empresa_id: string;
  origem: string;
  tipo: string;
  chave: string;
  estado: string;
  data_limite: string | null;
  criado_em: Date;
  resolvido_em: Date | null;
};

const linhaParaPendencia = (linha: LinhaDaPendencia): PendenciaPersistida => ({
  id: linha.id,
  empresaId: linha.empresa_id,
  origem: linha.origem,
  tipo: linha.tipo,
  chave: linha.chave,
  estado: linha.estado,
  dataLimite: linha.data_limite,
  criadoEm: linha.criado_em.toISOString(),
  resolvidoEm: linha.resolvido_em === null ? null : linha.resolvido_em.toISOString(),
});

/**
 * `origem` filtra a reconciliação por fonte (§2, §5.2, §9): o hook cadastral só
 * conhece causas `campo:*` e o documental só conhece causas `exigencia:*` —
 * misturar as duas faria um hook resolver, por engano, pendência aberta da
 * outra origem (evento `RESOLUCAO` falso, append-only, não corrigível depois).
 * `null` devolve as duas origens juntas, para quem realmente precisa ver tudo
 * (nenhum chamador de produção usa isso hoje; preservado para não estreitar a
 * função além do que o bug pede).
 */
export const listarAbertasDaEmpresa = async (
  cliente: PoolClient,
  empresaId: string,
  origem: OrigemDaPendencia | null,
): Promise<readonly Readonly<{ chave: string }>[]> => {
  const resultado = await cliente.query<{ chave: string }>(
    `select chave from app.empresa_pendencia
      where empresa_id = $1 and estado = 'ABERTA'
        and ($2::text is null or origem = $2)`,
    [empresaId, origem],
  );

  return resultado.rows;
};

export const contarAbertasPorEmpresa = async (
  cliente: PoolClient,
  empresaIds: readonly string[],
): Promise<ReadonlyMap<string, number>> => {
  if (empresaIds.length === 0) {
    return new Map();
  }

  const resultado = await cliente.query<{ empresa_id: string; total: string }>(
    `select empresa_id, count(*)::text as total
     from app.empresa_pendencia
     where estado = 'ABERTA' and empresa_id = any($1)
     group by empresa_id`,
    [empresaIds],
  );

  return new Map(resultado.rows.map((linha) => [linha.empresa_id, Number(linha.total)]));
};

/**
 * Insere as causas novas (ignorando conflito com pendência já aberta da
 * mesma causa — concorrência não duplica) e resolve as que sumiram. Cada
 * mudança de fato aplicada grava o evento correspondente na mesma transação.
 */
export const reconciliar = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  paraAbrir: readonly CausaParaReconciliar[],
  paraResolverChaves: readonly string[],
  usuarioId: string | null,
): Promise<void> => {
  for (const causa of paraAbrir) {
    const inserida = await cliente.query<{ id: string }>(
      `insert into app.empresa_pendencia
         (tenant_id, empresa_id, origem, tipo, chave, data_limite)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (empresa_id, chave) where estado = 'ABERTA' do nothing
       returning id`,
      [tenantId, empresaId, causa.origem, causa.tipo, causa.chave, causa.dataLimite],
    );

    const pendenciaId = inserida.rows[0]?.id;
    if (pendenciaId !== undefined) {
      await cliente.query(
        `insert into app.empresa_evento_de_pendencia
           (tenant_id, empresa_id, pendencia_id, acao, usuario_id)
         values ($1, $2, $3, 'CRIACAO', $4)`,
        [tenantId, empresaId, pendenciaId, usuarioId],
      );
    }
  }

  for (const chave of paraResolverChaves) {
    const resolvida = await cliente.query<{ id: string }>(
      `update app.empresa_pendencia
       set estado = 'RESOLVIDA', resolvido_em = now()
       where empresa_id = $1 and chave = $2 and estado = 'ABERTA'
       returning id`,
      [empresaId, chave],
    );

    const pendenciaId = resolvida.rows[0]?.id;
    if (pendenciaId !== undefined) {
      await cliente.query(
        `insert into app.empresa_evento_de_pendencia
           (tenant_id, empresa_id, pendencia_id, acao, usuario_id)
         values ($1, $2, $3, 'RESOLUCAO', $4)`,
        [tenantId, empresaId, pendenciaId, usuarioId],
      );
    }
  }
};

/**
 * Placeholders fixos, na ordem: $1 = hoje, $2 = empresaId, $3 = origem,
 * $4 = tipo, $5 = estado, $6 = vencimento — mesmo padrão de `listarEmpresas`
 * em `repositorios/empresa.ts` (uma única string de condições, reaproveitada
 * na query de dados e na de contagem, sem deslocar índice de parâmetro).
 */
const CONDICOES_DA_CENTRAL = `
      ($2::uuid is null or p.empresa_id = $2)
      and ($3::text is null or p.origem = $3)
      and ($4::text is null or p.tipo = $4)
      and ($5::text is null or p.estado = $5)
      and case
        when $6::text = 'VENCIDAS' then p.data_limite is not null and p.data_limite < $1::date
        when $6::text = 'PROXIMAS'
          then p.data_limite is not null
           and p.data_limite between $1::date and ($1::date + 3)
        else true
      end
      and exists (
        select 1 from app.carteira_vinculo cv
         where cv.empresa_id = p.empresa_id and cv.usuario_id = $7 and cv.encerrado_em is null
      )`;

const ORDEM_DE_PRIORIDADE = `
    case
      when p.data_limite is not null and p.data_limite < $1::date then 0
      when p.tipo = 'DOCUMENTO_VENCIDO' then 1
      when p.tipo = 'DOCUMENTO_REJEITADO' then 2
      when p.data_limite is not null
       and p.data_limite >= $1::date and p.data_limite <= ($1::date + 3) then 3
      else 4
    end, p.criado_em asc, p.id`;

export const listarCentral = async (
  cliente: PoolClient,
  filtro: FiltroDaCentral,
  hoje: string,
): Promise<PaginaDePendencias> => {
  const parametrosBase = [
    hoje,
    filtro.empresaId,
    filtro.origem,
    filtro.tipo,
    filtro.estado,
    filtro.vencimento,
    filtro.carteiraDoUsuarioId,
  ];

  const linhas = await cliente.query<LinhaDaPendencia & { empresa_nome: string }>(
    `select p.*, coalesce(e.nome_fantasia, e.razao_social, e.cnpj) as empresa_nome
     from app.empresa_pendencia p
     join app.empresa e on e.id = p.empresa_id
     where ${CONDICOES_DA_CENTRAL}
     order by ${ORDEM_DE_PRIORIDADE}
     limit $8 offset $9`,
    [...parametrosBase, filtro.limite, filtro.deslocamento],
  );

  const total = await cliente.query<{ total: string }>(
    `select count(*)::text as total
     from app.empresa_pendencia p
     where ${CONDICOES_DA_CENTRAL}`,
    parametrosBase,
  );

  return {
    pendencias: linhas.rows.map((linha) => ({
      ...linhaParaPendencia(linha),
      empresaNome: linha.empresa_nome,
    })),
    total: Number(total.rows[0]?.total ?? '0'),
  };
};

export const dispensar = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  pendenciaId: string,
  usuarioId: string,
  justificativa: string,
): Promise<PendenciaPersistida | null> => {
  const resultado = await cliente.query<LinhaDaPendencia>(
    `update app.empresa_pendencia
     set estado = 'RESOLVIDA', resolvido_em = now()
     where id = $1 and empresa_id = $2 and estado = 'ABERTA'
     returning *`,
    [pendenciaId, empresaId],
  );

  const linha = resultado.rows[0];
  if (linha === undefined) {
    return null;
  }

  await cliente.query(
    `insert into app.empresa_evento_de_pendencia
       (tenant_id, empresa_id, pendencia_id, acao, justificativa, usuario_id)
     values ($1, $2, $3, 'DISPENSA', $4, $5)`,
    [tenantId, empresaId, pendenciaId, justificativa, usuarioId],
  );

  return linhaParaPendencia(linha);
};
