/**
 * Lista do cofre, responsáveis e reconciliação de pendências e alertas (SPEC-011).
 *
 * A reconciliação é síncrona e preguiçosa (não há worker no repositório, como a
 * F6 já decidiu): roda ao consultar o cofre, o sino e a Central, e nas mutações.
 * Idempotente — pendência por chave estável e alerta por (certificado, usuário,
 * marco) únicos —, então repetir não duplica nada.
 */
import {
  causasDeCertificado,
  marcoDeVencimentoAtual,
  reconciliarPendencias,
  situacaoDoResponsavel,
  CHAVES_DE_PENDENCIA_DO_CERTIFICADO,
  type EstadoNoCofre,
  type MarcoDeVencimento,
  type PapelPadrao,
  type SituacaoDoResponsavel,
} from '@contaia/domain';
import type { PoolClient } from 'pg';

import { comFinalidade } from '../contexto.js';
import { reconciliar } from './pendencias.js';
import {
  COLUNAS_DA_VERSAO,
  linhaParaVersao,
  registrarEventoDeCertificado,
  type VersaoDoCertificado,
} from './certificados.js';

export type FiltroDeEstadoDoCofre = EstadoNoCofre | 'SEM_RESPONSAVEL';
export type OrdenacaoDoCofre = 'EMPRESA' | 'VENCIMENTO' | 'ESTADO';

export type ItemDoCofreBruto = Readonly<{
  empresaId: string;
  empresaNome: string;
  cnpj: string;
  regime: string | null;
  empresaArquivada: boolean;
  /** Cadastro concluído (`ATIVA`); só empresa ativa recebe certificado. */
  empresaAtiva: boolean;
  estado: EstadoNoCofre;
  diasParaVencer: number | null;
  semResponsavel: boolean;
  /** Vigente; sem vigente, a última versão (desativada). */
  certificado: VersaoDoCertificado | null;
  responsavel: Readonly<{ id: string; nome: string; email: string }> | null;
}>;

export type ResumoDoCofreBruto = Readonly<{
  total: number;
  validos: number;
  vencendo: number;
  vencidos: number;
  semCertificado: number;
  desativados: number;
  semResponsavel: number;
}>;

export type FiltroDoCofre = Readonly<{
  /** Só as empresas da carteira de quem consulta (SPEC-009 §3.5). */
  carteiraDoUsuarioId: string;
  busca: string | null;
  estado: FiltroDeEstadoDoCofre | null;
  ordem: OrdenacaoDoCofre;
  limite: number;
  deslocamento: number;
}>;

type LinhaDoItem = {
  empresa_id: string;
  empresa_nome: string;
  cnpj: string;
  regime: string | null;
  arquivada: boolean;
  ativa: boolean;
  certificado_id: string | null;
  estado: EstadoNoCofre;
  dias: number | null;
  sem_responsavel: boolean;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  responsavel_email: string | null;
};

/**
 * Um item por empresa: o vigente, ou a última versão quando não há vigente. O estado é
 * calculado aqui com as mesmas faixas de `estadoNoCofre`/`marcoDeVencimentoAtual` do
 * domínio (um teste de banco compara os dois) porque filtro, ordem e contagem precisam
 * rodar no SQL. `$hoje` é a data civil de São Paulo, vinda do chamador. `sem_responsavel`
 * é a pendência `certificado:responsavel` aberta — a reconciliação a mantém.
 */
const ITENS = (condicaoDaEmpresa: string): string => `
  select e.id as empresa_id, coalesce(e.nome_fantasia, e.razao_social, e.cnpj) as empresa_nome,
         e.cnpj, e.regime_tributario as regime, (e.situacao = 'arquivado') as arquivada,
         (e.status = 'ATIVA') as ativa,
         c.id as certificado_id, c.valido_ate, c.responsavel_id,
         case
           when c.id is null then 'SEM_CERTIFICADO'
           when c.estado <> 'VIGENTE' then 'DESATIVADO'
           when c.valido_ate < $2::date then 'VENCIDO'
           when c.valido_ate <= $2::date + 7 then 'VENCE_D7'
           when c.valido_ate <= $2::date + 15 then 'VENCE_D15'
           when c.valido_ate <= $2::date + 30 then 'VENCE_D30'
           else 'VALIDO'
         end as estado,
         case when c.estado = 'VIGENTE' then c.valido_ate - $2::date end as dias,
         exists (select 1 from app.empresa_pendencia p
                  where p.empresa_id = e.id and p.estado = 'ABERTA'
                    and p.chave = '${CHAVES_DE_PENDENCIA_DO_CERTIFICADO.responsavel}') as sem_responsavel,
         r.nome as responsavel_nome, r.email as responsavel_email
    from app.empresa e
    left join lateral (
      select * from app.empresa_certificado x
       where x.empresa_id = e.id and x.tenant_id = e.tenant_id
       order by (x.estado = 'VIGENTE') desc, x.versao desc limit 1) c on true
    left join app.usuario r on r.id = c.responsavel_id and r.tenant_id = e.tenant_id
   where e.tenant_id = $1 and ${condicaoDaEmpresa}`;

const DA_CARTEIRA = `e.status = 'ATIVA' and e.situacao = 'ativo' and exists (
  select 1 from app.carteira_vinculo v
   where v.tenant_id = e.tenant_id and v.empresa_id = e.id and v.usuario_id = $3 and v.encerrado_em is null)`;

const ORDEM: Readonly<Record<OrdenacaoDoCofre, string>> = {
  EMPRESA: 'lower(empresa_nome), empresa_id',
  VENCIMENTO: 'valido_ate asc nulls last, lower(empresa_nome), empresa_id',
  ESTADO: `case estado when 'VENCIDO' then 0 when 'VENCE_D7' then 1 when 'VENCE_D15' then 2
             when 'VENCE_D30' then 3 when 'SEM_CERTIFICADO' then 4 when 'DESATIVADO' then 5
             else 6 end, lower(empresa_nome), empresa_id`,
};

/** `%` e `_` do usuário não podem virar curinga. */
const escaparLike = (texto: string): string => texto.replace(/[\\%_]/gu, (c) => `\\${c}`);

const versoesPorId = async (
  cliente: PoolClient,
  tenantId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, VersaoDoCertificado>> => {
  if (ids.length === 0) {
    return new Map();
  }

  const { rows } = await cliente.query<Parameters<typeof linhaParaVersao>[0]>(
    `select ${COLUNAS_DA_VERSAO} from app.empresa_certificado c
      where c.tenant_id = $1 and c.id = any($2)`,
    [tenantId, ids],
  );

  return new Map(rows.map((linha) => [linha.id, linhaParaVersao(linha)]));
};

const paraItem = (
  linha: LinhaDoItem,
  versoes: ReadonlyMap<string, VersaoDoCertificado>,
): ItemDoCofreBruto => ({
  empresaId: linha.empresa_id,
  empresaNome: linha.empresa_nome,
  cnpj: linha.cnpj,
  regime: linha.regime,
  empresaArquivada: linha.arquivada,
  empresaAtiva: linha.ativa,
  estado: linha.estado,
  diasParaVencer: linha.dias,
  semResponsavel: linha.sem_responsavel,
  certificado: linha.certificado_id === null ? null : (versoes.get(linha.certificado_id) ?? null),
  responsavel:
    linha.responsavel_id === null || linha.responsavel_nome === null
      ? null
      : {
          id: linha.responsavel_id,
          nome: linha.responsavel_nome,
          email: linha.responsavel_email ?? '',
        },
});

const resumir = async (
  cliente: PoolClient,
  tenantId: string,
  carteiraDoUsuarioId: string,
  hoje: string,
): Promise<ResumoDoCofreBruto> => {
  const { rows } = await cliente.query<Record<keyof ResumoDoCofreBruto, number>>(
    `select count(*)::int as total,
            (count(*) filter (where estado = 'VALIDO'))::int as validos,
            (count(*) filter (where estado in ('VENCE_D30', 'VENCE_D15', 'VENCE_D7')))::int as vencendo,
            (count(*) filter (where estado = 'VENCIDO'))::int as vencidos,
            (count(*) filter (where estado = 'SEM_CERTIFICADO'))::int as "semCertificado",
            (count(*) filter (where estado = 'DESATIVADO'))::int as desativados,
            (count(*) filter (where sem_responsavel))::int as "semResponsavel"
       from (${ITENS(DA_CARTEIRA)}) itens`,
    [tenantId, hoje, carteiraDoUsuarioId],
  );

  return (
    rows[0] ?? {
      total: 0,
      validos: 0,
      vencendo: 0,
      vencidos: 0,
      semCertificado: 0,
      desativados: 0,
      semResponsavel: 0,
    }
  );
};

/** Lista paginada do cofre, filtrada e ordenada no banco (SPEC-011 §5.2). */
export const listarCofre = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDoCofre,
  hoje: string,
): Promise<
  Readonly<{ resumo: ResumoDoCofreBruto; itens: readonly ItemDoCofreBruto[]; total: number }>
> => {
  const busca = filtro.busca?.trim() ?? '';
  const porNome = busca.length === 0 ? null : `%${escaparLike(busca.toLowerCase())}%`;
  const cnpjBuscado = busca.replace(/[^0-9A-Za-z]/gu, '').toUpperCase();
  const porCnpj = cnpjBuscado.length < 3 ? null : `%${escaparLike(cnpjBuscado)}%`;

  const condicoes = `
    ($4::text is null or lower(empresa_nome) like $4 or ($5::text is not null and cnpj like $5))
    and ($6::text is null
         or case when $6 = 'SEM_RESPONSAVEL' then sem_responsavel else estado = $6 end)`;
  const parametros = [tenantId, hoje, filtro.carteiraDoUsuarioId, porNome, porCnpj, filtro.estado];

  const { rows } = await cliente.query<LinhaDoItem>(
    `select * from (${ITENS(DA_CARTEIRA)}) itens
      where ${condicoes}
      order by ${ORDEM[filtro.ordem]}
      limit $7 offset $8`,
    [...parametros, filtro.limite, filtro.deslocamento],
  );
  const total = await cliente.query<{ total: string }>(
    `select count(*)::text as total from (${ITENS(DA_CARTEIRA)}) itens where ${condicoes}`,
    parametros,
  );
  const versoes = await versoesPorId(
    cliente,
    tenantId,
    rows.flatMap((linha) => (linha.certificado_id === null ? [] : [linha.certificado_id])),
  );

  return {
    resumo: await resumir(cliente, tenantId, filtro.carteiraDoUsuarioId, hoje),
    itens: rows.map((linha) => paraItem(linha, versoes)),
    total: Number(total.rows[0]?.total ?? '0'),
  };
};

/** Item de uma empresa do tenant (a autorização é do guard e da RLS); `null` se não existir. */
export const carregarItemDoCofre = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  hoje: string,
): Promise<ItemDoCofreBruto | null> => {
  const { rows } = await cliente.query<LinhaDoItem>(
    `select * from (${ITENS('e.id = $3')}) itens`,
    [tenantId, hoje, empresaId],
  );
  const linha = rows[0];

  if (linha === undefined) {
    return null;
  }

  return paraItem(
    linha,
    await versoesPorId(cliente, tenantId, linha.certificado_id === null ? [] : [linha.certificado_id]),
  );
};

// -- Responsáveis ------------------------------------------------------------------------

export type ResponsavelElegivelPersistido = Readonly<{
  id: string;
  nome: string;
  email: string;
  papel: PapelPadrao;
}>;

/**
 * `admin_escritorio` e `contador` ATIVOS com a empresa na carteira (SPEC-011 §3.5). Lê a
 * carteira de outros colaboradores, o que só a gestão de acesso enxerga: a finalidade é
 * trocada só neste trecho, escolhida aqui — nunca por controller ou payload.
 */
export const listarResponsaveisElegiveis = (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<readonly ResponsavelElegivelPersistido[]> =>
  comFinalidade(cliente, 'ADMIN_ACESSO', async () => {
    const { rows } = await cliente.query<{
      id: string;
      nome: string;
      email: string;
      papel: PapelPadrao;
    }>(
      `select u.id, u.nome, u.email,
              case when exists (select 1 from app.usuario_papel p
                                 where p.usuario_id = u.id and p.tenant_id = u.tenant_id
                                   and p.papel = 'admin_escritorio' and p.removido_em is null)
                   then 'admin_escritorio' else 'contador' end as papel
         from app.usuario u
         join app.carteira_vinculo v
           on v.usuario_id = u.id and v.tenant_id = u.tenant_id
          and v.empresa_id = $2 and v.encerrado_em is null
        where u.tenant_id = $1 and u.estado = 'ATIVO'
          and exists (select 1 from app.usuario_papel p
                       where p.usuario_id = u.id and p.tenant_id = u.tenant_id
                         and p.papel in ('admin_escritorio', 'contador') and p.removido_em is null)
        order by lower(u.nome), u.id`,
      [tenantId, empresaId],
    );

    return rows;
  });

type ParDeResponsavel = Readonly<{ responsavelId: string; empresaId: string }>;

/** Situação de cada par (responsável, empresa): ativo, inativo ou fora da carteira. */
export const situacoesDeResponsaveis = (
  cliente: PoolClient,
  tenantId: string,
  pares: readonly ParDeResponsavel[],
): Promise<ReadonlyMap<string, SituacaoDoResponsavel>> =>
  comFinalidade(cliente, 'ADMIN_ACESSO', async () => {
    const resultado = new Map<string, SituacaoDoResponsavel>();

    if (pares.length === 0) {
      return resultado;
    }

    const { rows } = await cliente.query<{
      id: string;
      estado: string;
      papeis: PapelPadrao[];
      empresas: string[];
    }>(
      `select u.id, u.estado,
              coalesce((select array_agg(p.papel) from app.usuario_papel p
                         where p.usuario_id = u.id and p.tenant_id = u.tenant_id
                           and p.removido_em is null), array[]::text[]) as papeis,
              coalesce((select array_agg(v.empresa_id) from app.carteira_vinculo v
                         where v.usuario_id = u.id and v.tenant_id = u.tenant_id
                           and v.encerrado_em is null), array[]::uuid[]) as empresas
         from app.usuario u
        where u.tenant_id = $1 and u.id = any($2)`,
      [tenantId, [...new Set(pares.map((par) => par.responsavelId))]],
    );
    const porUsuario = new Map(rows.map((linha) => [linha.id, linha]));

    for (const par of pares) {
      const usuario = porUsuario.get(par.responsavelId);

      resultado.set(
        chaveDoPar(par),
        usuario === undefined
          ? 'INATIVO'
          : situacaoDoResponsavel({
              estado: usuario.estado,
              papeis: usuario.papeis,
              vinculoAtivo: usuario.empresas.includes(par.empresaId),
            }),
      );
    }

    return resultado;
  });

export const chaveDoPar = (par: ParDeResponsavel): string => `${par.responsavelId}:${par.empresaId}`;

/** Administradores ATIVOS com a empresa na carteira, por empresa (destino do alerta de responsável). */
const administradoresDasEmpresas = (
  cliente: PoolClient,
  tenantId: string,
  empresaIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> =>
  comFinalidade(cliente, 'ADMIN_ACESSO', async () => {
    const { rows } = await cliente.query<{ empresa_id: string; usuario_id: string }>(
      `select v.empresa_id, u.id as usuario_id
         from app.carteira_vinculo v
         join app.usuario u on u.id = v.usuario_id and u.tenant_id = v.tenant_id
        where v.tenant_id = $1 and v.empresa_id = any($2) and v.encerrado_em is null
          and u.estado = 'ATIVO'
          and exists (select 1 from app.usuario_papel p
                       where p.usuario_id = u.id and p.tenant_id = u.tenant_id
                         and p.papel = 'admin_escritorio' and p.removido_em is null)
        order by v.empresa_id, u.id`,
      [tenantId, empresaIds],
    );
    const porEmpresa = new Map<string, string[]>();

    for (const linha of rows) {
      porEmpresa.set(linha.empresa_id, [...(porEmpresa.get(linha.empresa_id) ?? []), linha.usuario_id]);
    }

    return porEmpresa;
  });

// -- Alertas individuais -----------------------------------------------------------------

type MarcoDeAlerta = MarcoDeVencimento | 'RESPONSAVEL_INCONSISTENTE';

/** `true` quando o alerta nasceu agora; `false` quando o marco já havia sido emitido. */
export const registrarAlerta = async (
  cliente: PoolClient,
  alerta: Readonly<{
    tenantId: string;
    empresaId: string;
    certificadoId: string;
    usuarioId: string;
    marco: MarcoDeAlerta;
  }>,
): Promise<boolean> => {
  const { rows } = await cliente.query(
    `insert into app.empresa_certificado_notificacao
       (tenant_id, empresa_id, certificado_id, usuario_id, marco)
     values ($1, $2, $3, $4, $5)
     on conflict (certificado_id, usuario_id, marco) do nothing
     returning id`,
    [alerta.tenantId, alerta.empresaId, alerta.certificadoId, alerta.usuarioId, alerta.marco],
  );

  return rows.length > 0;
};

// -- Reconciliação -----------------------------------------------------------------------

export type EntradaDaReconciliacao = Readonly<{
  tenantId: string;
  /** Quem dispara: define as empresas pela carteira dele. */
  usuarioId: string;
  correlationId: string;
  /** Data civil de São Paulo (I-11). */
  hoje: string;
  /** Restringe a estas empresas (mutações, ativação); `null` = toda a carteira. */
  empresaIds: readonly string[] | null;
}>;

export type ResultadoDaReconciliacao = Readonly<{
  pendenciasAbertas: number;
  pendenciasResolvidas: number;
  alertasEmitidos: number;
  responsaveisPerdidos: number;
}>;

type EmpresaParaReconciliar = Readonly<{ id: string; vigente: VersaoDoCertificado | null }>;

const empresasParaReconciliar = async (
  cliente: PoolClient,
  entrada: EntradaDaReconciliacao,
): Promise<readonly EmpresaParaReconciliar[]> => {
  const { rows } = await cliente.query<{ id: string }>(
    `select e.id from app.empresa e
      where e.tenant_id = $1 and e.status = 'ATIVA' and e.situacao = 'ativo'
        and ($3::uuid[] is null or e.id = any($3))
        and exists (select 1 from app.carteira_vinculo v
                     where v.tenant_id = e.tenant_id and v.empresa_id = e.id
                       and v.usuario_id = $2 and v.encerrado_em is null)
      order by e.id`,
    [entrada.tenantId, entrada.usuarioId, entrada.empresaIds],
  );
  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return [];
  }

  const vigentes = await cliente.query<Parameters<typeof linhaParaVersao>[0]>(
    `select ${COLUNAS_DA_VERSAO} from app.empresa_certificado c
      where c.tenant_id = $1 and c.empresa_id = any($2) and c.estado = 'VIGENTE'`,
    [entrada.tenantId, ids],
  );
  const porEmpresa = new Map(vigentes.rows.map((linha) => [linha.empresa_id, linhaParaVersao(linha)]));

  return ids.map((id) => ({ id, vigente: porEmpresa.get(id) ?? null }));
};

const abertasDeCertificado = async (
  cliente: PoolClient,
  empresaIds: readonly string[],
): Promise<ReadonlyMap<string, readonly Readonly<{ chave: string }>[]>> => {
  const { rows } = await cliente.query<{ empresa_id: string; chave: string }>(
    `select empresa_id, chave from app.empresa_pendencia
      where empresa_id = any($1) and estado = 'ABERTA' and origem = 'CERTIFICADO'`,
    [empresaIds],
  );
  const porEmpresa = new Map<string, { chave: string }[]>();

  for (const linha of rows) {
    porEmpresa.set(linha.empresa_id, [...(porEmpresa.get(linha.empresa_id) ?? []), { chave: linha.chave }]);
  }

  return porEmpresa;
};

/**
 * Mantém as pendências do certificado (ausente, vencido, sem responsável) e os alertas
 * individuais (D-30/15/7/vencido ao responsável; responsável inconsistente aos
 * administradores) em dia, para as empresas ATIVAS da carteira de quem dispara. Não gera
 * `empresa_notificacao`: os avisos do cofre são os individuais (decisão a confirmar).
 */
export const reconciliarCofre = async (
  cliente: PoolClient,
  entrada: EntradaDaReconciliacao,
): Promise<ResultadoDaReconciliacao> => {
  const empresas = await empresasParaReconciliar(cliente, entrada);
  const resultado = {
    pendenciasAbertas: 0,
    pendenciasResolvidas: 0,
    alertasEmitidos: 0,
    responsaveisPerdidos: 0,
  };

  if (empresas.length === 0) {
    return resultado;
  }

  const situacoes = await situacoesDeResponsaveis(
    cliente,
    entrada.tenantId,
    empresas.flatMap((empresa) =>
      empresa.vigente === null
        ? []
        : [{ responsavelId: empresa.vigente.responsavelId, empresaId: empresa.id }],
    ),
  );
  const abertas = await abertasDeCertificado(
    cliente,
    empresas.map((empresa) => empresa.id),
  );
  const inconsistente = (empresa: EmpresaParaReconciliar): boolean =>
    empresa.vigente !== null &&
    situacoes.get(
      chaveDoPar({ responsavelId: empresa.vigente.responsavelId, empresaId: empresa.id }),
    ) !== 'ATIVO';
  const administradores = await administradoresDasEmpresas(
    cliente,
    entrada.tenantId,
    empresas.filter(inconsistente).map((empresa) => empresa.id),
  );

  for (const empresa of empresas) {
    const causas = causasDeCertificado(
      {
        vigente: empresa.vigente === null ? null : { validoAte: empresa.vigente.validoAte },
        responsavelInconsistente: inconsistente(empresa),
      },
      entrada.hoje,
    );
    const { paraAbrir, paraResolver } = reconciliarPendencias(causas, abertas.get(empresa.id) ?? []);

    if (paraAbrir.length > 0 || paraResolver.length > 0) {
      await reconciliar(
        cliente,
        entrada.tenantId,
        empresa.id,
        paraAbrir,
        paraResolver,
        // Reconciliação automática: o evento de pendência não tem autor humano (como F4/F5).
        null,
      );
      resultado.pendenciasAbertas += paraAbrir.length;
      resultado.pendenciasResolvidas += paraResolver.length;
    }

    if (empresa.vigente === null) {
      continue;
    }

    const perdeuOResponsavel = paraAbrir.some(
      (causa) => causa.chave === CHAVES_DE_PENDENCIA_DO_CERTIFICADO.responsavel,
    );

    if (perdeuOResponsavel) {
      resultado.responsaveisPerdidos += 1;
      await registrarEventoDeCertificado(cliente, {
        tenantId: entrada.tenantId,
        empresaId: empresa.id,
        certificadoId: empresa.vigente.id,
        acao: 'RESPONSAVEL_PERDIDO',
        usuarioId: empresa.vigente.responsavelId,
        identidadeTecnica: 'verificacao-de-responsavel',
        correlationId: entrada.correlationId,
      });

      for (const administradorId of administradores.get(empresa.id) ?? []) {
        await registrarAlerta(cliente, {
          tenantId: entrada.tenantId,
          empresaId: empresa.id,
          certificadoId: empresa.vigente.id,
          usuarioId: administradorId,
          marco: 'RESPONSAVEL_INCONSISTENTE',
        });
      }
    }

    // Só o marco atual, e só para um responsável que ainda pode agir: o inconsistente
    // já gera o alerta aos administradores.
    const marco = marcoDeVencimentoAtual(empresa.vigente.validoAte, entrada.hoje);

    if (marco !== null && !inconsistente(empresa)) {
      const nasceu = await registrarAlerta(cliente, {
        tenantId: entrada.tenantId,
        empresaId: empresa.id,
        certificadoId: empresa.vigente.id,
        usuarioId: empresa.vigente.responsavelId,
        marco,
      });

      if (nasceu) {
        resultado.alertasEmitidos += 1;
        await registrarEventoDeCertificado(cliente, {
          tenantId: entrada.tenantId,
          empresaId: empresa.id,
          certificadoId: empresa.vigente.id,
          acao: 'ALERTA_EMITIDO',
          codigo: marco,
          usuarioId: empresa.vigente.responsavelId,
          identidadeTecnica: 'alertas-de-vencimento',
          correlationId: entrada.correlationId,
        });
      }
    }
  }

  return resultado;
};
