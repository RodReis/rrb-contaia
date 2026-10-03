/**
 * Carteira do colaborador (SPEC-009): vínculos, revisão, histórico e notificação.
 *
 * Toda função recebe o `PoolClient` da transação do caso de uso e repete
 * `tenant_id` no SQL: a RLS é a rede de proteção, não o único controle. Vínculo,
 * evento e notificações são gravados na mesma transação — falha em qualquer um
 * desfaz a operação inteira.
 */
import type { PoolClient } from 'pg';

import type {
  EmpresaParaCarteira,
  EstadoDoUsuario,
  PapelPadrao,
  UsuarioParaCarteira,
} from '@contaia/domain';

export type MotivoDeEncerramento = 'REMOCAO' | 'ARQUIVAMENTO_USUARIO' | 'ARQUIVAMENTO_EMPRESA';

export type OrigemDoEventoDeCarteira =
  | 'INDIVIDUAL'
  | 'LOTE'
  | 'AUTOATRIBUICAO'
  | 'ARQUIVAMENTO_USUARIO'
  | 'ARQUIVAMENTO_EMPRESA';

export type EmpresaResumida = Readonly<{ id: string; nome: string; cnpj: string }>;

export type UsuarioDaOperacao = UsuarioParaCarteira & Readonly<{ nome: string; email: string }>;
export type EmpresaDaOperacao = EmpresaParaCarteira & EmpresaResumida;

/** Item do evento: um por colaborador afetado, com nomes do momento da alteração. */
export type AfetadoDoEvento = Readonly<{
  usuarioId: string;
  usuarioNome: string;
  adicionadas: readonly EmpresaResumida[];
  removidas: readonly EmpresaResumida[];
  revisaoAnterior: number;
  revisaoNova: number;
}>;

export type EventoDeCarteiraParaRegistrar = Readonly<{
  origem: OrigemDoEventoDeCarteira;
  autorId: string | null;
  afetados: readonly AfetadoDoEvento[];
}>;

export type EventoDeCarteiraNaLista = Readonly<{
  id: string;
  ocorridoEm: Date;
  origem: OrigemDoEventoDeCarteira;
  autorId: string | null;
  autorNome: string | null;
  afetados: readonly AfetadoDoEvento[];
}>;

export type FiltroDeEventosDeCarteira = Readonly<{
  usuarioAfetadoId?: string;
  empresaId?: string;
  autorId?: string;
  origem?: OrigemDoEventoDeCarteira;
  de?: Date;
  /** Limite superior exclusivo. */
  ate?: Date;
  limite: number;
  deslocamento: number;
}>;

export type PaginaDeEventosDeCarteira = Readonly<{
  eventos: readonly EventoDeCarteiraNaLista[];
  total: number;
}>;

export type SituacaoDaCarteira = 'COM_EMPRESAS' | 'SEM_EMPRESAS';

export type FiltroDeColaboradores = Readonly<{
  usuarioId?: string;
  busca?: string;
  estado?: EstadoDoUsuario;
  papel?: PapelPadrao;
  carteira?: SituacaoDaCarteira;
  limite: number;
  deslocamento: number;
}>;

export type ColaboradorNaCentral = Readonly<{
  id: string;
  nome: string;
  email: string;
  estado: EstadoDoUsuario;
  papeis: readonly PapelPadrao[];
  papeisPersonalizados: readonly string[];
  empresas: number;
  revisaoCarteira: number;
}>;

export type PaginaDeColaboradores = Readonly<{
  colaboradores: readonly ColaboradorNaCentral[];
  total: number;
}>;

export type EmpresaParaAtribuicao = EmpresaResumida &
  Readonly<{
    status: 'CADASTRO_INCOMPLETO' | 'ATIVA';
    situacao: 'ativo' | 'arquivado';
    atribuida: boolean;
  }>;

export type FiltroDeEmpresasParaAtribuicao = Readonly<{
  busca?: string;
  /** `true` só atribuídas, `false` só disponíveis, ausente todas. */
  atribuida?: boolean;
  limite: number;
  deslocamento: number;
}>;

export type PaginaDeEmpresasParaAtribuicao = Readonly<{
  empresas: readonly EmpresaParaAtribuicao[];
  total: number;
}>;

export type ColaboradorDaEmpresa = Readonly<{
  id: string;
  nome: string;
  email: string;
  estado: EstadoDoUsuario;
  papeis: readonly PapelPadrao[];
  revisaoCarteira: number;
  desde: Date;
}>;

export type NotificacaoDeCarteiraPersistida = Readonly<{
  id: string;
  eventoId: string;
  adicionadas: readonly EmpresaResumida[];
  removidas: readonly EmpresaResumida[];
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
}>;

const escaparLike = (texto: string): string => texto.replace(/[\\%_]/gu, (c) => `\\${c}`);

const NOME_DA_EMPRESA = `coalesce(e.nome_fantasia, e.razao_social, e.cnpj)`;

// -- Leitura para o planejamento ----------------------------------------------

type LinhaDoUsuarioDaOperacao = {
  id: string;
  nome: string;
  email: string;
  estado: EstadoDoUsuario;
  revisao_carteira: string;
  empresas: string[];
};

/**
 * Carrega e TRAVA os colaboradores da operação, em ordem estável de id: duas
 * operações simultâneas sobre os mesmos usuários se enfileiram em vez de
 * entrelaçar, e a segunda planeja contra o que a primeira gravou.
 */
export const carregarUsuariosDaOperacao = async (
  cliente: PoolClient,
  tenantId: string,
  ids: readonly string[],
): Promise<UsuarioDaOperacao[]> => {
  const { rows } = await cliente.query<LinhaDoUsuarioDaOperacao>(
    `select u.id, u.nome, u.email, u.estado, u.revisao_carteira::text,
            coalesce(
              (select array_agg(v.empresa_id::text)
                 from app.carteira_vinculo v
                where v.usuario_id = u.id and v.tenant_id = u.tenant_id
                  and v.encerrado_em is null),
              array[]::text[]
            ) as empresas
       from app.usuario u
      where u.tenant_id = $1 and u.id = any($2::uuid[])
      order by u.id
        for update of u`,
    [tenantId, ids],
  );

  return rows.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    estado: linha.estado,
    revisao: Number(linha.revisao_carteira),
    empresasVinculadas: linha.empresas,
  }));
};

export const carregarEmpresasDaOperacao = async (
  cliente: PoolClient,
  tenantId: string,
  ids: readonly string[],
): Promise<EmpresaDaOperacao[]> => {
  const { rows } = await cliente.query<{
    id: string;
    nome: string;
    cnpj: string;
    status: 'CADASTRO_INCOMPLETO' | 'ATIVA';
    situacao: 'ativo' | 'arquivado';
  }>(
    `select e.id, ${NOME_DA_EMPRESA} as nome, e.cnpj, e.status, e.situacao
       from app.empresa e
      where e.tenant_id = $1 and e.id = any($2::uuid[])
      order by e.id`,
    [tenantId, ids],
  );

  return rows;
};

// -- Escrita ------------------------------------------------------------------

export type EfeitoParaAplicar = Readonly<{
  usuarioId: string;
  adicionadas: readonly string[];
  removidas: readonly string[];
  revisaoNova: number;
}>;

/**
 * Aplica os efeitos já planejados: abre vínculo novo para o que entra (nunca
 * reativa um encerrado), encerra o que sai e grava a nova revisão.
 */
export const aplicarEfeitos = async (
  cliente: PoolClient,
  tenantId: string,
  autorId: string | null,
  efeitos: readonly EfeitoParaAplicar[],
): Promise<void> => {
  for (const efeito of efeitos) {
    if (efeito.removidas.length > 0) {
      await cliente.query(
        `update app.carteira_vinculo
            set encerrado_em = now(), encerrado_por = $4, encerrado_motivo = 'REMOCAO'
          where tenant_id = $1 and usuario_id = $2 and empresa_id = any($3::uuid[])
            and encerrado_em is null`,
        [tenantId, efeito.usuarioId, efeito.removidas, autorId],
      );
    }

    if (efeito.adicionadas.length > 0) {
      await cliente.query(
        `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id, criado_por)
         select $1, $2, empresa, $4 from unnest($3::uuid[]) as empresa`,
        [tenantId, efeito.usuarioId, efeito.adicionadas, autorId],
      );
    }

    await cliente.query(
      `update app.usuario set revisao_carteira = $3 where tenant_id = $1 and id = $2`,
      [tenantId, efeito.usuarioId, efeito.revisaoNova],
    );
  }
};

/** Autoatribuição do criador (SPEC-009 §3.1): vínculo novo e revisão, sem notificação. */
export const autoatribuirEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  empresaId: string,
): Promise<Readonly<{ usuarioNome: string; revisaoAnterior: number; revisaoNova: number }>> => {
  await cliente.query(
    `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id, criado_por)
     values ($1, $2, $3, $2)`,
    [tenantId, usuarioId, empresaId],
  );

  const { rows } = await cliente.query<{ nome: string; anterior: string; nova: string }>(
    `update app.usuario u
        set revisao_carteira = u.revisao_carteira + 1
       from (select id, revisao_carteira from app.usuario
              where tenant_id = $1 and id = $2 for update) antes
      where u.id = antes.id
      returning u.nome, antes.revisao_carteira::text as anterior, u.revisao_carteira::text as nova`,
    [tenantId, usuarioId],
  );

  return {
    usuarioNome: rows[0]?.nome ?? '',
    revisaoAnterior: Number(rows[0]?.anterior ?? 0),
    revisaoNova: Number(rows[0]?.nova ?? 0),
  };
};

type LinhaDeEncerramento = {
  usuario_id: string;
  usuario_nome: string;
  empresa_id: string;
  empresa_nome: string;
  empresa_cnpj: string;
  revisao_anterior: string;
  revisao_nova: string;
};

const agruparEncerramentos = (linhas: readonly LinhaDeEncerramento[]): AfetadoDoEvento[] => {
  const porUsuario = new Map<string, AfetadoDoEvento>();

  for (const linha of linhas) {
    const atual = porUsuario.get(linha.usuario_id);
    const empresa = { id: linha.empresa_id, nome: linha.empresa_nome, cnpj: linha.empresa_cnpj };
    porUsuario.set(linha.usuario_id, {
      usuarioId: linha.usuario_id,
      usuarioNome: linha.usuario_nome,
      adicionadas: [],
      removidas: [...(atual?.removidas ?? []), empresa],
      revisaoAnterior: Number(linha.revisao_anterior),
      revisaoNova: Number(linha.revisao_nova),
    });
  }

  return [...porUsuario.values()];
};

/**
 * Encerra todos os vínculos ativos de um lado (usuário arquivado ou empresa
 * arquivada) e devolve quem foi afetado, já com a revisão nova de cada um.
 * Não restaura nada depois: a volta exige nova atribuição.
 */
const encerrarPor = async (
  cliente: PoolClient,
  tenantId: string,
  coluna: 'usuario_id' | 'empresa_id',
  alvoId: string,
  autorId: string | null,
  motivo: MotivoDeEncerramento,
): Promise<AfetadoDoEvento[]> => {
  // Trava os colaboradores em ordem de id antes de subir a revisão deles: a mesma
  // ordem de `carregarUsuariosDaOperacao`, para não haver deadlock entre operações.
  await cliente.query(
    `select u.id from app.usuario u
      where u.tenant_id = $1
        and u.id in (select v.usuario_id from app.carteira_vinculo v
                      where v.tenant_id = $1 and v.${coluna} = $2 and v.encerrado_em is null)
      order by u.id
        for update`,
    [tenantId, alvoId],
  );

  const { rows } = await cliente.query<LinhaDeEncerramento>(
    `with encerrados as (
       update app.carteira_vinculo
          set encerrado_em = now(), encerrado_por = $3, encerrado_motivo = $4
        where tenant_id = $1 and ${coluna} = $2 and encerrado_em is null
        returning usuario_id, empresa_id
     ), afetados as (
       select usuario_id, count(*) as quantos from encerrados group by usuario_id
     ), revisados as (
       update app.usuario u
          set revisao_carteira = u.revisao_carteira + 1
         from afetados a
        where u.tenant_id = $1 and u.id = a.usuario_id
        returning u.id, u.nome, u.revisao_carteira
     )
     select r.id as usuario_id, r.nome as usuario_nome,
            e.id as empresa_id, ${NOME_DA_EMPRESA} as empresa_nome, e.cnpj as empresa_cnpj,
            (r.revisao_carteira - 1)::text as revisao_anterior, r.revisao_carteira::text as revisao_nova
       from encerrados enc
       join revisados r on r.id = enc.usuario_id
       join app.empresa e on e.id = enc.empresa_id and e.tenant_id = $1
      order by r.id, e.id`,
    [tenantId, alvoId, autorId, motivo],
  );

  return agruparEncerramentos(rows);
};

export const encerrarVinculosDoUsuario = (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  autorId: string | null,
): Promise<AfetadoDoEvento[]> =>
  encerrarPor(cliente, tenantId, 'usuario_id', usuarioId, autorId, 'ARQUIVAMENTO_USUARIO');

export const encerrarVinculosDaEmpresa = (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  autorId: string | null,
): Promise<AfetadoDoEvento[]> =>
  encerrarPor(cliente, tenantId, 'empresa_id', empresaId, autorId, 'ARQUIVAMENTO_EMPRESA');

/** Grava o evento global append-only e devolve o id para as notificações. */
export const registrarEventoDeCarteira = async (
  cliente: PoolClient,
  tenantId: string,
  evento: EventoDeCarteiraParaRegistrar,
): Promise<string> => {
  const usuarios = evento.afetados.map((a) => a.usuarioId);
  const empresas = [
    ...new Set(evento.afetados.flatMap((a) => [...a.adicionadas, ...a.removidas].map((e) => e.id))),
  ];

  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.carteira_evento
       (tenant_id, origem, autor_id, afetados, usuarios_afetados, empresas_afetadas)
     values ($1, $2, $3, $4::jsonb, $5::uuid[], $6::uuid[])
     returning id`,
    [tenantId, evento.origem, evento.autorId, JSON.stringify(evento.afetados), usuarios, empresas],
  );

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('Falha ao registrar o evento de carteira.');
  }
  return id;
};

/** Uma notificação consolidada por colaborador afetado (nunca uma por vínculo). */
export const criarNotificacoesDeCarteira = async (
  cliente: PoolClient,
  tenantId: string,
  eventoId: string,
  afetados: readonly AfetadoDoEvento[],
): Promise<void> => {
  for (const afetado of afetados) {
    await cliente.query(
      `insert into app.carteira_notificacao
         (tenant_id, usuario_id, evento_id, adicionadas, removidas)
       values ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        tenantId,
        afetado.usuarioId,
        eventoId,
        JSON.stringify(afetado.adicionadas),
        JSON.stringify(afetado.removidas),
      ],
    );
  }
};

// -- Decisão de acesso --------------------------------------------------------

export const vinculoAtivo = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  empresaId: string,
): Promise<boolean> => {
  const { rows } = await cliente.query(
    `select 1 from app.carteira_vinculo
      where tenant_id = $1 and usuario_id = $2 and empresa_id = $3 and encerrado_em is null`,
    [tenantId, usuarioId, empresaId],
  );
  return rows.length > 0;
};

/** Nome e CNPJ da empresa do tenant, para o 403 de fora da carteira; `null` se não existir. */
export const resumoDaEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<EmpresaResumida | null> => {
  const { rows } = await cliente.query<EmpresaResumida>(
    `select e.id, ${NOME_DA_EMPRESA} as nome, e.cnpj
       from app.empresa e where e.tenant_id = $1 and e.id = $2`,
    [tenantId, empresaId],
  );
  return rows[0] ?? null;
};

export type AcessoAEmpresa = Readonly<{
  nome: string;
  cnpj: string;
  vinculado: boolean;
  arquivada: boolean;
}>;

/**
 * Uma ida ao banco por requisição empresarial: nome e CNPJ da empresa do tenant
 * e se o usuário tem vínculo ativo. `null` quando a empresa não existe no tenant
 * (outro tenant incluído) — indistinguível de inexistente.
 */
export const acessoAEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  empresaId: string,
): Promise<AcessoAEmpresa | null> => {
  const { rows } = await cliente.query<AcessoAEmpresa>(
    `select ${NOME_DA_EMPRESA} as nome, e.cnpj, (e.situacao = 'arquivado') as arquivada,
            exists (select 1 from app.carteira_vinculo v
                     where v.tenant_id = e.tenant_id and v.empresa_id = e.id
                       and v.usuario_id = $2 and v.encerrado_em is null) as vinculado
       from app.empresa e
      where e.tenant_id = $1 and e.id = $3`,
    [tenantId, usuarioId, empresaId],
  );
  return rows[0] ?? null;
};

export const empresasDaCarteira = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
): Promise<string[]> => {
  const { rows } = await cliente.query<{ empresa_id: string }>(
    `select empresa_id from app.carteira_vinculo
      where tenant_id = $1 and usuario_id = $2 and encerrado_em is null`,
    [tenantId, usuarioId],
  );
  return rows.map((linha) => linha.empresa_id);
};

// -- Central de Carteiras -----------------------------------------------------

export const listarColaboradores = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDeColaboradores,
): Promise<PaginaDeColaboradores> => {
  const parametros: unknown[] = [tenantId];
  const condicoes = ['u.tenant_id = $1'];

  if (filtro.usuarioId !== undefined) {
    parametros.push(filtro.usuarioId);
    condicoes.push(`u.id = $${parametros.length}`);
  }
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

  const ativos = `select count(*) from app.carteira_vinculo v
                   where v.usuario_id = u.id and v.tenant_id = u.tenant_id and v.encerrado_em is null`;
  if (filtro.carteira === 'COM_EMPRESAS') condicoes.push(`(${ativos}) > 0`);
  if (filtro.carteira === 'SEM_EMPRESAS') condicoes.push(`(${ativos}) = 0`);

  const onde = condicoes.join(' and ');

  const contagem = await cliente.query<{ total: string }>(
    `select count(*)::text as total from app.usuario u where ${onde}`,
    parametros,
  );

  parametros.push(filtro.limite, filtro.deslocamento);

  const { rows } = await cliente.query<{
    id: string;
    nome: string;
    email: string;
    estado: EstadoDoUsuario;
    papeis: PapelPadrao[];
    papeis_personalizados: string[];
    empresas: string;
    revisao_carteira: string;
  }>(
    `select u.id, u.nome, u.email, u.estado, u.revisao_carteira::text,
            coalesce((select array_agg(p.papel order by p.papel) from app.usuario_papel p
                       where p.usuario_id = u.id and p.tenant_id = u.tenant_id
                         and p.removido_em is null), array[]::text[]) as papeis,
            coalesce((select array_agg(pp.nome order by lower(pp.nome))
                        from app.usuario_papel_personalizado v
                        join app.papel_personalizado pp
                          on pp.id = v.papel_id and pp.tenant_id = v.tenant_id
                       where v.usuario_id = u.id and v.tenant_id = u.tenant_id
                         and v.removido_em is null), array[]::text[]) as papeis_personalizados,
            (${ativos})::text as empresas
       from app.usuario u
      where ${onde}
      order by lower(u.nome), u.id
      limit $${parametros.length - 1} offset $${parametros.length}`,
    parametros,
  );

  return {
    total: Number(contagem.rows[0]?.total ?? 0),
    colaboradores: rows.map((linha) => ({
      id: linha.id,
      nome: linha.nome,
      email: linha.email,
      estado: linha.estado,
      papeis: linha.papeis,
      papeisPersonalizados: linha.papeis_personalizados,
      empresas: Number(linha.empresas),
      revisaoCarteira: Number(linha.revisao_carteira),
    })),
  };
};

/**
 * Empresas do tenant para a gestão de um colaborador, com a marca de atribuída.
 * Só empresas ativas aparecem como opção: arquivada ou em cadastro não recebe
 * vínculo novo (SPEC-009 §3.4).
 */
export const listarEmpresasParaAtribuicao = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  filtro: FiltroDeEmpresasParaAtribuicao,
): Promise<PaginaDeEmpresasParaAtribuicao> => {
  const parametros: unknown[] = [tenantId, usuarioId];
  const condicoes = [`e.tenant_id = $1`, `e.status = 'ATIVA'`, `e.situacao = 'ativo'`];

  if (filtro.busca !== undefined && filtro.busca.trim() !== '') {
    const termo = `%${escaparLike(filtro.busca.trim())}%`;
    parametros.push(termo);
    condicoes.push(
      `(e.razao_social ilike $${parametros.length} or e.nome_fantasia ilike $${parametros.length}
        or e.cnpj like upper($${parametros.length}))`,
    );
  }

  const atribuida = `exists (select 1 from app.carteira_vinculo v
                              where v.tenant_id = e.tenant_id and v.empresa_id = e.id
                                and v.usuario_id = $2 and v.encerrado_em is null)`;
  if (filtro.atribuida === true) condicoes.push(atribuida);
  if (filtro.atribuida === false) condicoes.push(`not ${atribuida}`);

  const onde = condicoes.join(' and ');

  const contagem = await cliente.query<{ total: string }>(
    `select count(*)::text as total from app.empresa e where ${onde}`,
    parametros,
  );

  parametros.push(filtro.limite, filtro.deslocamento);

  const { rows } = await cliente.query<
    EmpresaResumida & {
      status: 'CADASTRO_INCOMPLETO' | 'ATIVA';
      situacao: 'ativo' | 'arquivado';
      atribuida: boolean;
    }
  >(
    `select e.id, ${NOME_DA_EMPRESA} as nome, e.cnpj, e.status, e.situacao, ${atribuida} as atribuida
       from app.empresa e
      where ${onde}
      order by lower(${NOME_DA_EMPRESA}), e.id
      limit $${parametros.length - 1} offset $${parametros.length}`,
    parametros,
  );

  return { total: Number(contagem.rows[0]?.total ?? 0), empresas: rows };
};

export const listarColaboradoresDaEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<ColaboradorDaEmpresa[]> => {
  const { rows } = await cliente.query<{
    id: string;
    nome: string;
    email: string;
    estado: EstadoDoUsuario;
    papeis: PapelPadrao[];
    revisao_carteira: string;
    desde: Date;
  }>(
    `select u.id, u.nome, u.email, u.estado, u.revisao_carteira::text, v.criado_em as desde,
            coalesce((select array_agg(p.papel order by p.papel) from app.usuario_papel p
                       where p.usuario_id = u.id and p.tenant_id = u.tenant_id
                         and p.removido_em is null), array[]::text[]) as papeis
       from app.carteira_vinculo v
       join app.usuario u on u.id = v.usuario_id and u.tenant_id = v.tenant_id
      where v.tenant_id = $1 and v.empresa_id = $2 and v.encerrado_em is null
      order by lower(u.nome), u.id`,
    [tenantId, empresaId],
  );

  return rows.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    estado: linha.estado,
    papeis: linha.papeis,
    revisaoCarteira: Number(linha.revisao_carteira),
    desde: linha.desde,
  }));
};

// -- Histórico de Informações → Carteiras -------------------------------------

export const listarEventosDeCarteira = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDeEventosDeCarteira,
): Promise<PaginaDeEventosDeCarteira> => {
  const parametros: unknown[] = [tenantId];
  const condicoes = ['ev.tenant_id = $1'];

  if (filtro.usuarioAfetadoId !== undefined) {
    parametros.push(filtro.usuarioAfetadoId);
    condicoes.push(`$${parametros.length}::uuid = any(ev.usuarios_afetados)`);
  }
  if (filtro.empresaId !== undefined) {
    parametros.push(filtro.empresaId);
    condicoes.push(`$${parametros.length}::uuid = any(ev.empresas_afetadas)`);
  }
  if (filtro.autorId !== undefined) {
    parametros.push(filtro.autorId);
    condicoes.push(`ev.autor_id = $${parametros.length}`);
  }
  if (filtro.origem !== undefined) {
    parametros.push(filtro.origem);
    condicoes.push(`ev.origem = $${parametros.length}`);
  }
  if (filtro.de !== undefined) {
    parametros.push(filtro.de);
    condicoes.push(`ev.ocorrido_em >= $${parametros.length}`);
  }
  if (filtro.ate !== undefined) {
    parametros.push(filtro.ate);
    condicoes.push(`ev.ocorrido_em < $${parametros.length}`);
  }

  const onde = condicoes.join(' and ');

  const contagem = await cliente.query<{ total: string }>(
    `select count(*)::text as total from app.carteira_evento ev where ${onde}`,
    parametros,
  );

  parametros.push(filtro.limite, filtro.deslocamento);

  const { rows } = await cliente.query<{
    id: string;
    ocorrido_em: Date;
    origem: OrigemDoEventoDeCarteira;
    autor_id: string | null;
    autor_nome: string | null;
    afetados: AfetadoDoEvento[];
  }>(
    `select ev.id, ev.ocorrido_em, ev.origem, ev.autor_id, a.nome as autor_nome, ev.afetados
       from app.carteira_evento ev
       left join app.usuario a on a.id = ev.autor_id and a.tenant_id = ev.tenant_id
      where ${onde}
      order by ev.ocorrido_em desc, ev.sequencia desc
      limit $${parametros.length - 1} offset $${parametros.length}`,
    parametros,
  );

  return {
    total: Number(contagem.rows[0]?.total ?? 0),
    eventos: rows.map((linha) => ({
      id: linha.id,
      ocorridoEm: linha.ocorrido_em,
      origem: linha.origem,
      autorId: linha.autor_id,
      autorNome: linha.autor_nome,
      afetados: linha.afetados,
    })),
  };
};

/** Cabeçalho da página de gestão: o colaborador com a revisão que o cliente precisa devolver. */
export const carregarColaborador = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
): Promise<ColaboradorNaCentral | null> => {
  const pagina = await listarColaboradores(cliente, tenantId, {
    usuarioId,
    limite: 1,
    deslocamento: 0,
  });
  return pagina.colaboradores[0] ?? null;
};

/** Empresas da carteira de um colaborador, em qualquer situação (a própria carteira). */
export const listarEmpresasDaCarteira = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
): Promise<EmpresaParaAtribuicao[]> => {
  const { rows } = await cliente.query<
    EmpresaResumida & {
      status: 'CADASTRO_INCOMPLETO' | 'ATIVA';
      situacao: 'ativo' | 'arquivado';
    }
  >(
    `select e.id, ${NOME_DA_EMPRESA} as nome, e.cnpj, e.status, e.situacao
       from app.carteira_vinculo v
       join app.empresa e on e.id = v.empresa_id and e.tenant_id = v.tenant_id
      where v.tenant_id = $1 and v.usuario_id = $2 and v.encerrado_em is null
      order by lower(${NOME_DA_EMPRESA}), e.id`,
    [tenantId, usuarioId],
  );
  return rows.map((linha) => ({ ...linha, atribuida: true }));
};
