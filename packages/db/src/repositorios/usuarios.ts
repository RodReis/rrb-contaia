/**
 * Usuários, papéis aditivos, convite e auditoria (SPEC-007).
 *
 * Toda função recebe o `PoolClient` da transação do caso de uso e repete
 * `tenant_id` no SQL: a RLS é a rede de proteção, não o único controle.
 * Nenhuma função devolve o token do convite — só o hash chega ao banco.
 */
import type { PoolClient } from 'pg';

import type { EstadoDoPapel, EstadoDoUsuario, PapelPadrao } from '@contaia/domain';

export type TipoDeEventoDeUsuario =
  | 'CONVITE_CRIADO'
  | 'CONVITE_REENVIADO'
  | 'CONVITE_ACEITO'
  | 'CONVITE_EXPIRADO'
  | 'EMAIL_DE_CONVITE_CORRIGIDO'
  | 'DADOS_E_PAPEIS_ALTERADOS'
  | 'SUSPENSO'
  | 'REATIVADO'
  | 'ARQUIVADO'
  | 'NOVO_CONVITE_INICIADO'
  // Eventos de papel personalizado (SPEC-008 §3.6): nomeiam o papel, não um usuário.
  | 'PAPEL_CRIADO'
  | 'PAPEL_DADOS_ALTERADOS'
  | 'PAPEL_MATRIZ_ALTERADA'
  | 'PAPEL_ARQUIVADO'
  | 'PAPEL_REATIVADO';

export type PapelPersonalizadoDoUsuario = Readonly<{
  id: string;
  nome: string;
  estado: EstadoDoPapel;
}>;

export type UsuarioPersistido = Readonly<{
  id: string;
  subOidc: string;
  email: string;
  nome: string;
  telefone: string | null;
  crc: string | null;
  estado: EstadoDoUsuario;
  papeis: readonly PapelPadrao[];
  papeisPersonalizados: readonly PapelPersonalizadoDoUsuario[];
  versao: number;
}>;

export type UsuarioNaLista = UsuarioPersistido &
  Readonly<{
    conviteExpiraEm: Date | null;
    envioFalhou: boolean;
    criadoEm: Date;
  }>;

export type NovoUsuario = Readonly<{
  subOidc: string;
  email: string;
  nome: string;
  telefone: string | null;
  crc: string | null;
}>;

export type FiltroDeUsuarios = Readonly<{
  busca?: string;
  estado?: EstadoDoUsuario;
  papel?: PapelPadrao;
  limite: number;
  deslocamento: number;
}>;

export type PaginaDeUsuarios = Readonly<{ usuarios: readonly UsuarioNaLista[]; total: number }>;

export type ConviteVigente = Readonly<{ id: string; expiraEm: Date; envioFalhou: boolean }>;

export type ConviteResolvido = Readonly<{
  conviteId: string;
  tenantId: string;
  usuarioId: string;
  usuarioEstado: EstadoDoUsuario;
  expiraEm: Date;
  usadoEm: Date | null;
  invalidadoEm: Date | null;
}>;

/**
 * Evento de usuário nomeia `usuarioAfetadoId`; evento de papel nomeia `papelId` e
 * `revisao` e deixa o usuário nulo (a constraint do banco exige um ou outro).
 */
export type EventoDeUsuarioParaRegistrar = Readonly<{
  tipo: TipoDeEventoDeUsuario;
  usuarioAfetadoId: string | null;
  papelId?: string;
  revisao?: number;
  autorId: string | null;
  antes: Readonly<Record<string, unknown>> | null;
  depois: Readonly<Record<string, unknown>> | null;
}>;

export type FiltroDeEventosDeUsuario = Readonly<{
  usuarioAfetadoId?: string;
  autorId?: string;
  tipo?: TipoDeEventoDeUsuario;
  de?: Date;
  /** Limite superior exclusivo. */
  ate?: Date;
  limite: number;
  deslocamento: number;
}>;

export type EventoDeUsuarioNaLista = Readonly<{
  id: string;
  ocorridoEm: Date;
  tipo: TipoDeEventoDeUsuario;
  usuarioAfetadoId: string | null;
  usuarioAfetadoNome: string | null;
  papelId: string | null;
  papelNome: string | null;
  revisao: number | null;
  autorId: string | null;
  autorNome: string | null;
  antes: Readonly<Record<string, unknown>> | null;
  depois: Readonly<Record<string, unknown>> | null;
}>;

export type PaginaDeEventosDeUsuario = Readonly<{
  eventos: readonly EventoDeUsuarioNaLista[];
  total: number;
}>;

type LinhaDeUsuario = {
  id: string;
  sub_oidc: string;
  email: string;
  nome: string;
  telefone: string | null;
  crc: string | null;
  estado: EstadoDoUsuario;
  papeis: PapelPadrao[];
  papeis_personalizados: PapelPersonalizadoDoUsuario[];
  versao: number;
};

const COLUNAS_DO_USUARIO = `
  u.id, u.sub_oidc, u.email, u.nome, u.telefone, u.crc, u.estado, u.versao,
  coalesce(
    (select array_agg(p.papel order by p.papel)
       from app.usuario_papel p
      where p.usuario_id = u.id and p.tenant_id = u.tenant_id and p.removido_em is null),
    array[]::text[]
  ) as papeis,
  coalesce(
    (select json_agg(json_build_object('id', pp.id, 'nome', pp.nome, 'estado', pp.estado)
                     order by lower(pp.nome), pp.id)
       from app.usuario_papel_personalizado v
       join app.papel_personalizado pp on pp.id = v.papel_id and pp.tenant_id = v.tenant_id
      where v.usuario_id = u.id and v.tenant_id = u.tenant_id and v.removido_em is null),
    '[]'::json
  ) as papeis_personalizados`;

const paraUsuario = (linha: LinhaDeUsuario): UsuarioPersistido => ({
  id: linha.id,
  subOidc: linha.sub_oidc,
  email: linha.email,
  nome: linha.nome,
  telefone: linha.telefone,
  crc: linha.crc,
  estado: linha.estado,
  papeis: linha.papeis,
  papeisPersonalizados: linha.papeis_personalizados,
  versao: linha.versao,
});

export const criarUsuario = async (
  cliente: PoolClient,
  tenantId: string,
  novo: NovoUsuario,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, telefone, crc, estado)
     values ($1, $2, $3, $4, $5, $6, 'CONVIDADO')
     returning id`,
    [tenantId, novo.subOidc, novo.email, novo.nome, novo.telefone, novo.crc],
  );

  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error('Falha ao criar usuário.');
  }

  return id;
};

/**
 * Troca o conjunto de papéis vigentes. Papel que sai ganha `removido_em` (sem
 * DELETE, I-7); papel que entra é inserido; o que já estava vigente fica.
 */
export const substituirPapeis = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  papeis: readonly PapelPadrao[],
): Promise<void> => {
  await cliente.query(
    `update app.usuario_papel
        set removido_em = now()
      where tenant_id = $1 and usuario_id = $2 and removido_em is null
        and not (papel = any($3::text[]))`,
    [tenantId, usuarioId, papeis],
  );

  await cliente.query(
    `insert into app.usuario_papel (tenant_id, usuario_id, papel)
     select $1, $2, novo.papel
       from unnest($3::text[]) as novo(papel)
      where not exists (
        select 1 from app.usuario_papel atual
         where atual.usuario_id = $2 and atual.papel = novo.papel and atual.removido_em is null
      )`,
    [tenantId, usuarioId, papeis],
  );
};

/**
 * `travar: true` segura a linha até o fim da transação: quem vai alterar o usuário
 * carrega assim, para que duas alterações simultâneas se enfileirem e a segunda valide
 * contra o que a primeira gravou (sem evento duplicado nem atualização perdida).
 */
export const carregarUsuario = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  opcoes: Readonly<{ travar?: boolean }> = {},
): Promise<UsuarioPersistido | null> => {
  const { rows } = await cliente.query<LinhaDeUsuario>(
    `select ${COLUNAS_DO_USUARIO}
       from app.usuario u
      where u.tenant_id = $1 and u.id = $2${opcoes.travar === true ? ' for update' : ''}`,
    [tenantId, usuarioId],
  );

  const linha = rows[0];

  return linha === undefined ? null : paraUsuario(linha);
};

export const usuarioComEmailNoTenant = async (
  cliente: PoolClient,
  tenantId: string,
  emailNormalizado: string,
): Promise<Readonly<{ id: string; estado: EstadoDoUsuario }> | null> => {
  const { rows } = await cliente.query<{ id: string; estado: EstadoDoUsuario }>(
    `select id, estado from app.usuario where tenant_id = $1 and lower(email) = lower($2)`,
    [tenantId, emailNormalizado],
  );

  return rows[0] ?? null;
};

export const atualizarDados = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  dados: Readonly<{ nome: string; telefone: string | null; crc: string | null; email?: string }>,
): Promise<void> => {
  await cliente.query(
    `update app.usuario
        set nome = $3, telefone = $4, crc = $5, email = coalesce($6, email),
            versao = versao + 1, atualizado_em = now()
      where tenant_id = $1 and id = $2`,
    [tenantId, usuarioId, dados.nome, dados.telefone, dados.crc, dados.email ?? null],
  );
};

export const atualizarEstado = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  estado: EstadoDoUsuario,
): Promise<void> => {
  await cliente.query(
    `update app.usuario
        set estado = $3, versao = versao + 1, atualizado_em = now()
      where tenant_id = $1 and id = $2`,
    [tenantId, usuarioId, estado],
  );
};

/**
 * Serializa por tenant quem altera administração e devolve os administradores
 * ativos. Quem remove papel de administrador, suspende ou arquiva chama isto
 * primeiro: duas operações simultâneas se enfileiram e a segunda enxerga o
 * conjunto já reduzido pela primeira.
 *
 * O lock consultivo vem antes da consulta porque travar só as linhas de papel não
 * basta: suspender e arquivar mudam `usuario.estado`, não o papel, e a segunda
 * transação leria o estado antigo do seu snapshot.
 */
export const travarAdminsAtivos = async (
  cliente: PoolClient,
  tenantId: string,
): Promise<string[]> => {
  await cliente.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
    `admins:${tenantId}`,
  ]);

  const { rows } = await cliente.query<{ usuario_id: string }>(
    `select p.usuario_id
       from app.usuario_papel p
       join app.usuario u on u.id = p.usuario_id and u.tenant_id = p.tenant_id
      where p.tenant_id = $1
        and p.papel = 'admin_escritorio'
        and p.removido_em is null
        and u.estado = 'ATIVO'
      order by p.usuario_id
        for update of p`,
    [tenantId],
  );

  return rows.map((linha) => linha.usuario_id);
};

const escaparLike = (texto: string): string => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export const listarUsuarios = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDeUsuarios,
): Promise<PaginaDeUsuarios> => {
  const parametros: unknown[] = [tenantId];
  const condicoes = ['u.tenant_id = $1'];

  if (filtro.busca !== undefined && filtro.busca.trim() !== '') {
    parametros.push(`%${escaparLike(filtro.busca.trim())}%`);
    condicoes.push(`(u.nome ilike $${parametros.length} or u.email ilike $${parametros.length})`);
  }

  if (filtro.estado !== undefined) {
    parametros.push(filtro.estado);
    condicoes.push(`u.estado = $${parametros.length}`);
  }

  if (filtro.papel !== undefined) {
    parametros.push(filtro.papel);
    condicoes.push(
      `exists (select 1 from app.usuario_papel p
                where p.usuario_id = u.id and p.tenant_id = u.tenant_id
                  and p.removido_em is null and p.papel = $${parametros.length})`,
    );
  }

  const onde = condicoes.join(' and ');

  const contagem = await cliente.query<{ total: string }>(
    `select count(*) as total from app.usuario u where ${onde}`,
    parametros,
  );

  parametros.push(filtro.limite, filtro.deslocamento);

  const { rows } = await cliente.query<
    LinhaDeUsuario & { convite_expira_em: Date | null; envio_falhou: boolean | null; criado_em: Date }
  >(
    `select ${COLUNAS_DO_USUARIO}, u.criado_em,
            convite.expira_em as convite_expira_em, convite.envio_falhou
       from app.usuario u
       left join lateral (
         select c.expira_em, c.envio_falhou
           from app.usuario_convite c
          where c.usuario_id = u.id and c.tenant_id = u.tenant_id
            and c.usado_em is null and c.invalidado_em is null
          limit 1
       ) convite on true
      where ${onde}
      order by lower(u.nome), u.id
      limit $${parametros.length - 1} offset $${parametros.length}`,
    parametros,
  );

  return {
    total: Number(contagem.rows[0]?.total ?? 0),
    usuarios: rows.map((linha) => ({
      ...paraUsuario(linha),
      conviteExpiraEm: linha.convite_expira_em,
      envioFalhou: linha.envio_falhou ?? false,
      criadoEm: linha.criado_em,
    })),
  };
};

// -- Convite ----------------------------------------------------------------

export const criarConvite = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  convite: Readonly<{ tokenHash: string; expiraEm: Date }>,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.usuario_convite (tenant_id, usuario_id, token_hash, expira_em)
     values ($1, $2, $3, $4)
     returning id`,
    [tenantId, usuarioId, convite.tokenHash, convite.expiraEm],
  );

  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error('Falha ao criar convite.');
  }

  return id;
};

export const invalidarConvitesVigentes = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
): Promise<number> => {
  const resultado = await cliente.query(
    `update app.usuario_convite
        set invalidado_em = now()
      where tenant_id = $1 and usuario_id = $2
        and usado_em is null and invalidado_em is null`,
    [tenantId, usuarioId],
  );

  return resultado.rowCount ?? 0;
};

/** Uso único: devolve `false` se o convite já foi usado, invalidado ou não existe. */
export const consumirConvite = async (
  cliente: PoolClient,
  tenantId: string,
  conviteId: string,
): Promise<boolean> => {
  const { rows } = await cliente.query<{ id: string }>(
    `update app.usuario_convite
        set usado_em = now()
      where tenant_id = $1 and id = $2
        and usado_em is null and invalidado_em is null
      returning id`,
    [tenantId, conviteId],
  );

  return rows.length === 1;
};

export const marcarEnvioFalhou = async (
  cliente: PoolClient,
  tenantId: string,
  conviteId: string,
  falhou: boolean,
): Promise<void> => {
  await cliente.query(
    `update app.usuario_convite set envio_falhou = $3 where tenant_id = $1 and id = $2`,
    [tenantId, conviteId, falhou],
  );
};

export const conviteVigenteDoUsuario = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
): Promise<ConviteVigente | null> => {
  const { rows } = await cliente.query<{ id: string; expira_em: Date; envio_falhou: boolean }>(
    `select id, expira_em, envio_falhou
       from app.usuario_convite
      where tenant_id = $1 and usuario_id = $2 and usado_em is null and invalidado_em is null`,
    [tenantId, usuarioId],
  );

  const linha = rows[0];

  return linha === undefined
    ? null
    : { id: linha.id, expiraEm: linha.expira_em, envioFalhou: linha.envio_falhou };
};

/** Caminho do aceite: não há tenant ainda, então passa pela função estreita do banco. */
export const resolverConvite = async (
  cliente: PoolClient,
  tokenHash: string,
): Promise<ConviteResolvido | null> => {
  const { rows } = await cliente.query<{
    convite_id: string;
    tenant_id: string;
    usuario_id: string;
    usuario_estado: EstadoDoUsuario;
    expira_em: Date;
    usado_em: Date | null;
    invalidado_em: Date | null;
  }>('select * from app.resolver_convite($1)', [tokenHash]);

  const linha = rows[0];

  return linha === undefined
    ? null
    : {
        conviteId: linha.convite_id,
        tenantId: linha.tenant_id,
        usuarioId: linha.usuario_id,
        usuarioEstado: linha.usuario_estado,
        expiraEm: linha.expira_em,
        usadoEm: linha.usado_em,
        invalidadoEm: linha.invalidado_em,
      };
};

// -- Auditoria ---------------------------------------------------------------

export const registrarEventoDeUsuario = async (
  cliente: PoolClient,
  tenantId: string,
  evento: EventoDeUsuarioParaRegistrar,
): Promise<void> => {
  await cliente.query(
    `insert into app.usuario_evento
       (tenant_id, tipo, usuario_afetado_id, papel_id, revisao, autor_id, antes, depois)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [
      tenantId,
      evento.tipo,
      evento.usuarioAfetadoId,
      evento.papelId ?? null,
      evento.revisao ?? null,
      evento.autorId,
      evento.antes === null ? null : JSON.stringify(evento.antes),
      evento.depois === null ? null : JSON.stringify(evento.depois),
    ],
  );
};

/**
 * Expiração preguiçosa (sem worker): registra um evento por convite pendente
 * já vencido. O índice único parcial torna a operação idempotente e segura sob
 * concorrência. Devolve quantos eventos novos foram gravados.
 */
export const reconciliarConvitesExpirados = async (
  cliente: PoolClient,
  tenantId: string,
  agora: Date,
): Promise<number> => {
  const resultado = await cliente.query(
    `insert into app.usuario_evento (tenant_id, tipo, usuario_afetado_id, autor_id, antes, depois)
     select c.tenant_id, 'CONVITE_EXPIRADO', c.usuario_id, null, null,
            jsonb_build_object('conviteId', c.id::text)
       from app.usuario_convite c
      where c.tenant_id = $1 and c.expira_em <= $2
        and c.usado_em is null and c.invalidado_em is null
     on conflict ((depois ->> 'conviteId')) where tipo = 'CONVITE_EXPIRADO' do nothing`,
    [tenantId, agora],
  );

  return resultado.rowCount ?? 0;
};

export const listarEventosDeUsuario = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDeEventosDeUsuario,
): Promise<PaginaDeEventosDeUsuario> => {
  const parametros: unknown[] = [tenantId];
  const condicoes = ['e.tenant_id = $1'];

  const adicionar = (coluna: string, operador: string, valor: unknown): void => {
    parametros.push(valor);
    condicoes.push(`${coluna} ${operador} $${parametros.length}`);
  };

  if (filtro.usuarioAfetadoId !== undefined) adicionar('e.usuario_afetado_id', '=', filtro.usuarioAfetadoId);
  if (filtro.autorId !== undefined) adicionar('e.autor_id', '=', filtro.autorId);
  if (filtro.tipo !== undefined) adicionar('e.tipo', '=', filtro.tipo);
  if (filtro.de !== undefined) adicionar('e.ocorrido_em', '>=', filtro.de);
  if (filtro.ate !== undefined) adicionar('e.ocorrido_em', '<', filtro.ate);

  const onde = condicoes.join(' and ');

  const contagem = await cliente.query<{ total: string }>(
    `select count(*) as total from app.usuario_evento e where ${onde}`,
    parametros,
  );

  parametros.push(filtro.limite, filtro.deslocamento);

  const { rows } = await cliente.query<{
    id: string;
    ocorrido_em: Date;
    tipo: TipoDeEventoDeUsuario;
    usuario_afetado_id: string | null;
    usuario_afetado_nome: string | null;
    papel_id: string | null;
    papel_nome: string | null;
    revisao: number | null;
    autor_id: string | null;
    autor_nome: string | null;
    antes: Record<string, unknown> | null;
    depois: Record<string, unknown> | null;
  }>(
    `select e.id, e.ocorrido_em, e.tipo, e.usuario_afetado_id,
            afetado.nome as usuario_afetado_nome, e.papel_id, papel.nome as papel_nome,
            e.revisao, e.autor_id, autor.nome as autor_nome, e.antes, e.depois
       from app.usuario_evento e
       left join app.usuario afetado
         on afetado.id = e.usuario_afetado_id and afetado.tenant_id = e.tenant_id
       left join app.papel_personalizado papel
         on papel.id = e.papel_id and papel.tenant_id = e.tenant_id
       left join app.usuario autor
         on autor.id = e.autor_id and autor.tenant_id = e.tenant_id
      where ${onde}
      order by e.sequencia desc
      limit $${parametros.length - 1} offset $${parametros.length}`,
    parametros,
  );

  return {
    total: Number(contagem.rows[0]?.total ?? 0),
    eventos: rows.map((linha) => ({
      id: linha.id,
      ocorridoEm: linha.ocorrido_em,
      tipo: linha.tipo,
      usuarioAfetadoId: linha.usuario_afetado_id,
      usuarioAfetadoNome: linha.usuario_afetado_nome,
      papelId: linha.papel_id,
      papelNome: linha.papel_nome,
      revisao: linha.revisao,
      autorId: linha.autor_id,
      autorNome: linha.autor_nome,
      antes: linha.antes,
      depois: linha.depois,
    })),
  };
};
