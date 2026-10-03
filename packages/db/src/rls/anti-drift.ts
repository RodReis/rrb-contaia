/**
 * Anti-drift de RLS (SPEC-010 §3.5, TESTING.md §3.1, CI-PR.md §4).
 *
 * `lerCatalogo` fotografa o catálogo REAL do PostgreSQL; `auditarCatalogo` compara
 * a fotografia com a classificação e devolve cada lacuna com tabela e requisito.
 * Fotografia e auditoria são separadas para que a auditoria seja pura e possa
 * provar, com tabelas sintéticas, que uma tabela insegura reprova.
 *
 * Esta guarda é obrigatória e não pode ser removida: é o que impede a próxima
 * fatia de criar tabela sem isolamento (SPEC-010 §3.5, §11).
 */
import type { Pool, PoolClient } from 'pg';

import {
  CLASSES_COM_EMPRESA,
  CLASSES_SEM_EMPRESA,
  type EntradaDeClassificacao,
} from './classificacao.js';

export type ComandoDePolitica = 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
export type Operacao = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export type PoliticaDoCatalogo = Readonly<{
  nome: string;
  comando: ComandoDePolitica;
  permissiva: boolean;
  usando: string | null;
  comCheck: string | null;
}>;

export type IndiceDoCatalogo = Readonly<{
  nome: string;
  /** Colunas na ordem do índice; expressão vira `null`. */
  colunas: readonly (string | null)[];
  parcial: boolean;
}>;

export type TabelaDoCatalogo = Readonly<{
  /** `schema.tabela`. */
  nome: string;
  rlsHabilitada: boolean;
  rlsForcada: boolean;
  /** coluna → aceita NULL. */
  colunas: Readonly<Record<string, boolean>>;
  indices: readonly IndiceDoCatalogo[];
  politicas: readonly PoliticaDoCatalogo[];
  /** Privilégios que o papel da aplicação tem (inclusive por coluna). */
  privilegiosDaAplicacao: readonly string[];
}>;

export type PapelDaAplicacaoNoCatalogo = Readonly<{
  existe: boolean;
  bypassRls: boolean;
  superusuario: boolean;
}>;

export type FotografiaDoCatalogo = Readonly<{
  tabelas: readonly TabelaDoCatalogo[];
  papel: PapelDaAplicacaoNoCatalogo;
}>;

export type Violacao = Readonly<{ tabela: string; requisito: string; detalhe: string }>;

const OPERACOES: readonly Operacao[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
/** Privilégios que a aplicação não deve ter em tabela nenhuma. */
const PRIVILEGIOS_PROIBIDOS = ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

/** Função de contexto que a política de cada classe precisa invocar. */
const EXIGE_NA_POLITICA: Readonly<Record<string, readonly string[]>> = {
  raiz_tenant: ['tenant_atual'],
  raiz_empresa: ['tenant_atual'],
  empresa: ['tenant_atual', 'empresa_autorizada'],
  vinculo: ['tenant_atual', 'contexto_humano'],
  tenant: ['tenant_atual', 'contexto_humano'],
};

const violacao = (tabela: string, requisito: string, detalhe: string): Violacao => ({
  tabela,
  requisito,
  detalhe,
});

const cobreOperacao = (politica: PoliticaDoCatalogo, operacao: Operacao): boolean =>
  politica.comando === 'ALL' || politica.comando === operacao;

const expressaoDaOperacao = (politica: PoliticaDoCatalogo, operacao: Operacao): string | null =>
  operacao === 'INSERT' ? (politica.comCheck ?? politica.usando) : politica.usando;

const auditarChaves = (
  tabela: TabelaDoCatalogo,
  entrada: EntradaDeClassificacao,
): Violacao[] => {
  const achados: Violacao[] = [];
  const { classe } = entrada;

  if (classe === 'raiz_tenant' || classe === 'global') {
    return achados;
  }

  if (tabela.colunas['tenant_id'] !== false) {
    achados.push(
      violacao(
        tabela.nome,
        'tenant_id NOT NULL',
        tabela.colunas['tenant_id'] === undefined
          ? 'coluna tenant_id ausente'
          : 'tenant_id aceita NULL',
      ),
    );
  }

  if (
    !tabela.indices.some((indice) => !indice.parcial && indice.colunas.includes('tenant_id'))
  ) {
    achados.push(violacao(tabela.nome, 'índice por tenant_id', 'nenhum índice completo com tenant_id'));
  }

  if (CLASSES_COM_EMPRESA.includes(classe)) {
    if (tabela.colunas['empresa_id'] !== false) {
      achados.push(
        violacao(
          tabela.nome,
          'empresa_id NOT NULL',
          tabela.colunas['empresa_id'] === undefined
            ? 'coluna empresa_id ausente'
            : 'empresa_id aceita NULL',
        ),
      );
    }

    const temIndice = tabela.indices.some(
      (indice) =>
        !indice.parcial &&
        (indice.colunas[0] === 'empresa_id' ||
          (indice.colunas[0] === 'tenant_id' && indice.colunas[1] === 'empresa_id')),
    );

    if (!temIndice) {
      achados.push(
        violacao(
          tabela.nome,
          'índice por empresa_id',
          'nenhum índice completo começando por empresa_id (ou tenant_id, empresa_id)',
        ),
      );
    }
  }

  return achados;
};

const auditarPoliticas = (
  tabela: TabelaDoCatalogo,
  entrada: EntradaDeClassificacao,
): Violacao[] => {
  const achados: Violacao[] = [];
  const exigidas = EXIGE_NA_POLITICA[entrada.classe] ?? [];

  for (const operacao of OPERACOES) {
    if (!tabela.privilegiosDaAplicacao.includes(operacao)) {
      continue;
    }

    const cobrem = tabela.politicas.filter(
      (politica) => politica.permissiva && cobreOperacao(politica, operacao),
    );

    if (cobrem.length === 0) {
      achados.push(
        violacao(
          tabela.nome,
          `política de ${operacao}`,
          `a aplicação tem ${operacao}, mas nenhuma política permissiva o cobre`,
        ),
      );
      continue;
    }

    for (const politica of cobrem) {
      const expressao = expressaoDaOperacao(politica, operacao) ?? '';
      const ausentes = exigidas.filter((funcao) => !expressao.includes(funcao));

      if (ausentes.length > 0) {
        achados.push(
          violacao(
            tabela.nome,
            `política de ${operacao} com contexto`,
            `a política "${politica.nome}" não usa ${ausentes.join(', ')}`,
          ),
        );
      }
    }
  }

  return achados;
};

const auditarPrivilegios = (
  tabela: TabelaDoCatalogo,
  entrada: EntradaDeClassificacao,
): Violacao[] => {
  const achados: Violacao[] = [];

  if (entrada.classe === 'global' && tabela.privilegiosDaAplicacao.length > 0) {
    achados.push(
      violacao(
        tabela.nome,
        'tabela global sem privilégio da aplicação',
        `a aplicação tem ${tabela.privilegiosDaAplicacao.join(', ')}`,
      ),
    );
  }

  for (const proibido of PRIVILEGIOS_PROIBIDOS) {
    if (tabela.privilegiosDaAplicacao.includes(proibido)) {
      achados.push(
        violacao(tabela.nome, `sem ${proibido} para a aplicação`, `a aplicação tem ${proibido}`),
      );
    }
  }

  if (entrada.appendOnly === true && tabela.privilegiosDaAplicacao.includes('UPDATE')) {
    achados.push(
      violacao(tabela.nome, 'append-only (I-6)', 'a aplicação tem UPDATE em tabela append-only'),
    );
  }

  return achados;
};

/** Cada lacuna entre catálogo e classificação, com tabela e requisito ausente. */
export const auditarCatalogo = (
  fotografia: FotografiaDoCatalogo,
  classificacao: readonly EntradaDeClassificacao[],
): Violacao[] => {
  const achados: Violacao[] = [];
  const porNome = new Map(classificacao.map((entrada) => [entrada.tabela, entrada]));

  if (!fotografia.papel.existe) {
    achados.push(violacao('(papel contaia_app)', 'papel da aplicação', 'o papel não existe'));
  }
  if (fotografia.papel.bypassRls) {
    achados.push(violacao('(papel contaia_app)', 'sem BYPASSRLS', 'o papel da aplicação tem BYPASSRLS'));
  }
  if (fotografia.papel.superusuario) {
    achados.push(violacao('(papel contaia_app)', 'sem SUPERUSER', 'o papel da aplicação é superusuário'));
  }

  const nomesDoCatalogo = new Set(fotografia.tabelas.map((tabela) => tabela.nome));

  for (const entrada of classificacao) {
    if (!nomesDoCatalogo.has(entrada.tabela)) {
      achados.push(
        violacao(entrada.tabela, 'classificação órfã', 'consta na classificação, mas não existe no banco'),
      );
    }

    if (
      CLASSES_SEM_EMPRESA.includes(entrada.classe) &&
      (entrada.justificativa === undefined || entrada.justificativa.trim().length === 0)
    ) {
      achados.push(
        violacao(entrada.tabela, 'allowlist justificada', 'classe sem empresa_id exige justificativa'),
      );
    }
  }

  for (const tabela of fotografia.tabelas) {
    const entrada = porNome.get(tabela.nome);

    if (entrada === undefined) {
      achados.push(
        violacao(
          tabela.nome,
          'tabela classificada',
          'sem classe: transacional (tenant + empresa) ou allowlist justificada em classificacao.ts',
        ),
      );
      continue;
    }

    if (entrada.classe !== 'global') {
      if (!tabela.rlsHabilitada) {
        achados.push(violacao(tabela.nome, 'RLS habilitada', 'ENABLE ROW LEVEL SECURITY ausente'));
      }
      if (!tabela.rlsForcada) {
        achados.push(violacao(tabela.nome, 'RLS forçada', 'FORCE ROW LEVEL SECURITY ausente'));
      }

      achados.push(...auditarChaves(tabela, entrada), ...auditarPoliticas(tabela, entrada));
    }

    achados.push(...auditarPrivilegios(tabela, entrada));
  }

  return achados;
};

/** Toda tabela classificada, exceto global, precisa de caso na matriz de cobertura. */
export const auditarCobertura = (
  classificacao: readonly EntradaDeClassificacao[],
  tabelasCobertas: readonly string[],
): Violacao[] => {
  const cobertas = new Set(tabelasCobertas);

  return classificacao
    .filter((entrada) => entrada.classe !== 'global' && !cobertas.has(entrada.tabela))
    .map((entrada) =>
      violacao(entrada.tabela, 'matriz de cobertura', 'tabela sensível sem casos em rls-matrix'),
    );
};

type Consultavel = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

type LinhaDeTabela = {
  nome: string;
  rls: boolean;
  forcada: boolean;
  privilegios: string[];
};

/** Fotografia do catálogo dos schemas pedidos, do ponto de vista de um papel. */
export const lerCatalogo = async (
  banco: Consultavel,
  opcoes: Readonly<{ schemas: readonly string[]; papel: string }>,
): Promise<FotografiaDoCatalogo> => {
  const { schemas, papel } = opcoes;

  const tabelas = await banco.query<LinhaDeTabela>(
    `select n.nspname || '.' || c.relname as nome,
            c.relrowsecurity as rls,
            c.relforcerowsecurity as forcada,
            array_remove(array[
              case when has_any_column_privilege($2, c.oid, 'SELECT') then 'SELECT' end,
              case when has_any_column_privilege($2, c.oid, 'INSERT') then 'INSERT' end,
              case when has_any_column_privilege($2, c.oid, 'UPDATE') then 'UPDATE' end,
              case when has_table_privilege($2, c.oid, 'DELETE') then 'DELETE' end,
              case when has_table_privilege($2, c.oid, 'TRUNCATE') then 'TRUNCATE' end,
              case when has_any_column_privilege($2, c.oid, 'REFERENCES') then 'REFERENCES' end,
              case when has_table_privilege($2, c.oid, 'TRIGGER') then 'TRIGGER' end
            ], null) as privilegios
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p')
      order by 1`,
    [schemas, papel],
  );

  const colunas = await banco.query<{ tabela: string; coluna: string; anulavel: boolean }>(
    `select table_schema || '.' || table_name as tabela, column_name as coluna,
            (is_nullable = 'YES') as anulavel
       from information_schema.columns
      where table_schema = any($1)`,
    [schemas],
  );

  const indices = await banco.query<{
    tabela: string;
    nome: string;
    parcial: boolean;
    colunas: (string | null)[];
  }>(
    `select n.nspname || '.' || t.relname as tabela, i.relname as nome,
            ix.indpred is not null as parcial,
            array(
              select a.attname::text
                from unnest(ix.indkey::int2[]) with ordinality as k(attnum, ord)
                left join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
               order by k.ord
            ) as colunas
       from pg_index ix
       join pg_class i on i.oid = ix.indexrelid
       join pg_class t on t.oid = ix.indrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = any($1)`,
    [schemas],
  );

  const politicas = await banco.query<{
    tabela: string;
    nome: string;
    comando: ComandoDePolitica;
    permissiva: string;
    usando: string | null;
    com_check: string | null;
  }>(
    `select schemaname || '.' || tablename as tabela, policyname as nome, cmd as comando,
            permissive as permissiva, qual as usando, with_check as com_check
       from pg_policies
      where schemaname = any($1)`,
    [schemas],
  );

  const roles = await banco.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
    'select rolbypassrls, rolsuper from pg_roles where rolname = $1',
    [papel],
  );
  const role = roles.rows[0];

  return {
    papel: {
      existe: role !== undefined,
      bypassRls: role?.rolbypassrls ?? false,
      superusuario: role?.rolsuper ?? false,
    },
    tabelas: tabelas.rows.map((linha) => ({
      nome: linha.nome,
      rlsHabilitada: linha.rls,
      rlsForcada: linha.forcada,
      privilegiosDaAplicacao: linha.privilegios,
      colunas: Object.fromEntries(
        colunas.rows.filter((c) => c.tabela === linha.nome).map((c) => [c.coluna, c.anulavel]),
      ),
      indices: indices.rows
        .filter((i) => i.tabela === linha.nome)
        .map((i) => ({ nome: i.nome, parcial: i.parcial, colunas: i.colunas })),
      politicas: politicas.rows
        .filter((p) => p.tabela === linha.nome)
        .map((p) => ({
          nome: p.nome,
          comando: p.comando,
          permissiva: p.permissiva === 'PERMISSIVE',
          usando: p.usando,
          comCheck: p.com_check,
        })),
    })),
  };
};
