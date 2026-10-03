/**
 * Papéis personalizados, revisões da matriz e vínculos com usuários (SPEC-008).
 *
 * Toda função recebe o `PoolClient` da transação do caso de uso e repete
 * `tenant_id` no SQL: a RLS é a rede de proteção, não o único controle.
 * A matriz vigente de um papel é a revisão cujo número é `papel.revisao`;
 * revisões antigas ficam intactas (append-only).
 */
import type { PoolClient } from 'pg';

import type { EstadoDoPapel, PapelPadrao } from '@contaia/domain';

export type PapelPersistido = Readonly<{
  id: string;
  nome: string;
  descricao: string | null;
  papelBase: PapelPadrao;
  estado: EstadoDoPapel;
  revisao: number;
  /** Matriz da revisão vigente: chaves do catálogo (pode conter chave já obsoleta). */
  permissoes: readonly string[];
  criadoEm: Date;
  atualizadoEm: Date;
}>;

export type PapelNaLista = PapelPersistido & Readonly<{ usuariosVinculados: number }>;

export type NovoPapel = Readonly<{
  nome: string;
  descricao: string | null;
  papelBase: PapelPadrao;
  permissoes: readonly string[];
  autorId: string;
}>;

export type NovaRevisaoDoPapel = Readonly<{
  nome: string;
  descricao: string | null;
  estado: EstadoDoPapel;
  permissoes: readonly string[];
  autorId: string;
}>;

export type FiltroDePapeis = Readonly<{
  busca?: string;
  estado?: EstadoDoPapel;
  limite: number;
  deslocamento: number;
}>;

export type PaginaDePapeis = Readonly<{ papeis: readonly PapelNaLista[]; total: number }>;

export type UsuarioVinculadoAoPapel = Readonly<{ id: string; nome: string }>;

type LinhaDePapel = {
  id: string;
  nome: string;
  descricao: string | null;
  papel_base: PapelPadrao;
  estado: EstadoDoPapel;
  revisao: number;
  permissoes: string[];
  criado_em: Date;
  atualizado_em: Date;
};

const COLUNAS_DO_PAPEL = `
  p.id, p.nome, p.descricao, p.papel_base, p.estado, p.revisao, p.criado_em, p.atualizado_em,
  r.permissoes`;

const JUNTA_REVISAO_VIGENTE = `
  join app.papel_personalizado_revisao r
    on r.papel_id = p.id and r.tenant_id = p.tenant_id and r.revisao = p.revisao`;

/** Usuário arquivado não tem acesso e não segura o arquivamento do papel (ver SPEC-008 §3.5). */
const VINCULOS_VIGENTES = `
  (select count(*) from app.usuario_papel_personalizado v
     join app.usuario u on u.id = v.usuario_id and u.tenant_id = v.tenant_id
    where v.papel_id = p.id and v.tenant_id = p.tenant_id
      and v.removido_em is null and u.estado <> 'ARQUIVADO')`;

const paraPapel = (linha: LinhaDePapel): PapelPersistido => ({
  id: linha.id,
  nome: linha.nome,
  descricao: linha.descricao,
  papelBase: linha.papel_base,
  estado: linha.estado,
  revisao: linha.revisao,
  permissoes: linha.permissoes,
  criadoEm: linha.criado_em,
  atualizadoEm: linha.atualizado_em,
});

const inserirRevisao = async (
  cliente: PoolClient,
  tenantId: string,
  papelId: string,
  revisao: number,
  permissoes: readonly string[],
  autorId: string,
): Promise<void> => {
  await cliente.query(
    `insert into app.papel_personalizado_revisao
       (tenant_id, papel_id, revisao, permissoes, autor_id)
     values ($1, $2, $3, $4::text[], $5)`,
    [tenantId, papelId, revisao, permissoes, autorId],
  );
};

/** Cria o papel `ATIVO` com a revisão 1 e a matriz completa, na transação do chamador. */
export const criarPapel = async (
  cliente: PoolClient,
  tenantId: string,
  novo: NovoPapel,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.papel_personalizado (tenant_id, nome, descricao, papel_base)
     values ($1, $2, $3, $4)
     returning id`,
    [tenantId, novo.nome, novo.descricao, novo.papelBase],
  );

  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error('Falha ao criar papel.');
  }

  await inserirRevisao(cliente, tenantId, id, 1, novo.permissoes, novo.autorId);

  return id;
};

/**
 * `travar: true` segura a linha até o fim da transação: quem vai alterar,
 * arquivar ou atribuir o papel o carrega assim, e as operações concorrentes se
 * enfileiram em vez de decidir sobre um estado que a outra já mudou.
 */
export const carregarPapel = async (
  cliente: PoolClient,
  tenantId: string,
  papelId: string,
  opcoes: Readonly<{ travar?: boolean }> = {},
): Promise<PapelPersistido | null> => {
  // `for update of p` trava só o papel; a revisão é imutável.
  const { rows } = await cliente.query<LinhaDePapel>(
    `select ${COLUNAS_DO_PAPEL}
       from app.papel_personalizado p ${JUNTA_REVISAO_VIGENTE}
      where p.tenant_id = $1 and p.id = $2${opcoes.travar === true ? ' for update of p' : ''}`,
    [tenantId, papelId],
  );

  const linha = rows[0];

  return linha === undefined ? null : paraPapel(linha);
};

export const papelComNome = async (
  cliente: PoolClient,
  tenantId: string,
  nome: string,
): Promise<string | null> => {
  const { rows } = await cliente.query<{ id: string }>(
    `select id from app.papel_personalizado
      where tenant_id = $1
        and nome_normalizado = lower(regexp_replace(btrim($2), '\\s+', ' ', 'g'))`,
    [tenantId, nome],
  );

  return rows[0]?.id ?? null;
};

/**
 * Grava a revisão seguinte: atualiza identidade e estado, incrementa a revisão e
 * guarda o snapshot integral da matriz. Devolve o número da nova revisão.
 */
export const gravarNovaRevisao = async (
  cliente: PoolClient,
  tenantId: string,
  papelId: string,
  dados: NovaRevisaoDoPapel,
): Promise<number> => {
  const { rows } = await cliente.query<{ revisao: number }>(
    `update app.papel_personalizado
        set nome = $3, descricao = $4, estado = $5,
            revisao = revisao + 1, atualizado_em = now()
      where tenant_id = $1 and id = $2
      returning revisao`,
    [tenantId, papelId, dados.nome, dados.descricao, dados.estado],
  );

  const revisao = rows[0]?.revisao;

  if (revisao === undefined) {
    throw new Error('Falha ao gravar a revisão do papel.');
  }

  await inserirRevisao(cliente, tenantId, papelId, revisao, dados.permissoes, dados.autorId);

  return revisao;
};

const escaparLike = (texto: string): string => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export const listarPapeis = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDePapeis,
): Promise<PaginaDePapeis> => {
  const parametros: unknown[] = [tenantId];
  const condicoes = ['p.tenant_id = $1'];

  if (filtro.busca !== undefined && filtro.busca.trim() !== '') {
    parametros.push(`%${escaparLike(filtro.busca.trim())}%`);
    condicoes.push(`p.nome ilike $${parametros.length}`);
  }

  if (filtro.estado !== undefined) {
    parametros.push(filtro.estado);
    condicoes.push(`p.estado = $${parametros.length}`);
  }

  const onde = condicoes.join(' and ');

  const contagem = await cliente.query<{ total: string }>(
    `select count(*) as total from app.papel_personalizado p where ${onde}`,
    parametros,
  );

  parametros.push(filtro.limite, filtro.deslocamento);

  const { rows } = await cliente.query<LinhaDePapel & { vinculados: string }>(
    `select ${COLUNAS_DO_PAPEL}, ${VINCULOS_VIGENTES} as vinculados
       from app.papel_personalizado p ${JUNTA_REVISAO_VIGENTE}
      where ${onde}
      order by lower(p.nome), p.id
      limit $${parametros.length - 1} offset $${parametros.length}`,
    parametros,
  );

  return {
    total: Number(contagem.rows[0]?.total ?? 0),
    papeis: rows.map((linha) => ({
      ...paraPapel(linha),
      usuariosVinculados: Number(linha.vinculados),
    })),
  };
};

export const contarVinculosDoPapel = async (
  cliente: PoolClient,
  tenantId: string,
  papelId: string,
): Promise<number> => {
  const { rows } = await cliente.query<{ total: string }>(
    `select count(*) as total
       from app.usuario_papel_personalizado v
       join app.usuario u on u.id = v.usuario_id and u.tenant_id = v.tenant_id
      where v.tenant_id = $1 and v.papel_id = $2
        and v.removido_em is null and u.estado <> 'ARQUIVADO'`,
    [tenantId, papelId],
  );

  return Number(rows[0]?.total ?? 0);
};

/** Usuários que a mudança no papel alcança, para a confirmação de redução. */
export const listarUsuariosVinculados = async (
  cliente: PoolClient,
  tenantId: string,
  papelId: string,
): Promise<readonly UsuarioVinculadoAoPapel[]> => {
  const { rows } = await cliente.query<{ id: string; nome: string }>(
    `select u.id, u.nome
       from app.usuario_papel_personalizado v
       join app.usuario u on u.id = v.usuario_id and u.tenant_id = v.tenant_id
      where v.tenant_id = $1 and v.papel_id = $2
        and v.removido_em is null and u.estado <> 'ARQUIVADO'
      order by lower(u.nome), u.id`,
    [tenantId, papelId],
  );

  return rows;
};

/**
 * Troca o conjunto de papéis personalizados vigentes do usuário. Vínculo que sai
 * ganha `removido_em` (sem DELETE, I-7); o que entra é inserido; o que já estava
 * vigente fica. Quem chama garante que os papéis novos existem e estão `ATIVO`.
 */
export const substituirPapeisPersonalizados = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  papelIds: readonly string[],
): Promise<void> => {
  await cliente.query(
    `update app.usuario_papel_personalizado
        set removido_em = now()
      where tenant_id = $1 and usuario_id = $2 and removido_em is null
        and not (papel_id = any($3::uuid[]))`,
    [tenantId, usuarioId, papelIds],
  );

  await cliente.query(
    `insert into app.usuario_papel_personalizado (tenant_id, usuario_id, papel_id)
     select $1, $2, novo.papel_id
       from unnest($3::uuid[]) as novo(papel_id)
      where not exists (
        select 1 from app.usuario_papel_personalizado atual
         where atual.usuario_id = $2 and atual.papel_id = novo.papel_id
           and atual.removido_em is null
      )`,
    [tenantId, usuarioId, papelIds],
  );
};

/**
 * Papéis pedidos para atribuição, travados em modo compartilhado: o arquivamento
 * concorrente (`for update`) espera esta transação e vice-versa, então nunca
 * se atribui papel que acabou de ser arquivado.
 */
export const carregarPapeisParaAtribuir = async (
  cliente: PoolClient,
  tenantId: string,
  papelIds: readonly string[],
): Promise<ReadonlyArray<Readonly<{ id: string; estado: EstadoDoPapel }>>> => {
  const { rows } = await cliente.query<{ id: string; estado: EstadoDoPapel }>(
    `select id, estado
       from app.papel_personalizado
      where tenant_id = $1 and id = any($2::uuid[])
      order by id
        for share`,
    [tenantId, papelIds],
  );

  return rows;
};
