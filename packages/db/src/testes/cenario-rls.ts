/**
 * Cenário de dois escritórios para as provas negativas de RLS (SPEC-010 §9).
 *
 * Semeia e limpa SEMPRE pelo papel administrativo (contornando a RLS de propósito):
 * o que está sob prova é o papel da aplicação, nunca o semeador. A limpeza usa
 * `session_replication_role = replica` para apagar tabelas append-only e FKs sem
 * desligar nenhuma trigger de produção.
 */
import type { Pool } from 'pg';

export type Cenario = Readonly<{
  sufixo: string;
  tenantA: string;
  tenantB: string;
  /** Ativa, na carteira de `naCarteira` e `duasEmpresas`. */
  empresaA1: string;
  /** Ativa, na carteira de `fora` e `duasEmpresas`. */
  empresaA2: string;
  /** Arquivada, sem vínculo ativo (a exceção do administrador). */
  empresaA3Arquivada: string;
  empresaB1: string;
  usuarios: Readonly<{
    /** ATIVO, vínculo com A1. */
    naCarteira: string;
    /** ATIVO, vínculo só com A2. */
    fora: string;
    /** SUSPENSO, vínculo preservado com A1. */
    suspenso: string;
    /** ATIVO, papel admin_escritorio, sem vínculo com A1. */
    admin: string;
    /** ATIVO, vínculos com A1 e A2. */
    duasEmpresas: string;
    /** ATIVO no escritório B, vínculo com B1. */
    deB: string;
  }>;
  vinculos: Readonly<{ naCarteiraA1: string; suspensoA1: string }>;
}>;

type Linha = { id: string };

const unico = async (admin: Pool, sql: string, parametros: unknown[]): Promise<string> => {
  const { rows } = await admin.query<Linha>(sql, parametros);
  const linha = rows[0];

  if (linha === undefined) {
    throw new Error(`o semeador não devolveu id: ${sql}`);
  }

  return linha.id;
};

export const montarCenario = async (admin: Pool): Promise<Cenario> => {
  const sufixo = `${String(process.pid).padStart(6, '0').slice(-6)}${String(Date.now()).slice(-6)}`;

  const tenant = (letra: 'A' | 'B'): Promise<string> =>
    unico(
      admin,
      `insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`,
      [`Matriz RLS ${letra} ${sufixo}`, `M${letra}${sufixo}`],
    );

  const tenantA = await tenant('A');
  const tenantB = await tenant('B');

  const empresa = (tenantId: string, rotulo: string, arquivada = false): Promise<string> =>
    unico(
      admin,
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao)
       values ($1, $2, $3, 'ATIVA', $4) returning id`,
      [tenantId, `E${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa ${rotulo} ${sufixo}`, arquivada ? 'arquivado' : 'ativo'],
    );

  const empresaA1 = await empresa(tenantA, 'A1');
  const empresaA2 = await empresa(tenantA, 'A2');
  const empresaA3Arquivada = await empresa(tenantA, 'A3', true);
  const empresaB1 = await empresa(tenantB, 'B1');

  const usuario = (tenantId: string, rotulo: string, estado = 'ATIVO'): Promise<string> =>
    unico(
      admin,
      `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
       values ($1, $2, $3, $4, $5) returning id`,
      [tenantId, `sub-${rotulo}-${sufixo}`, `${rotulo}.${sufixo}@matriz.local`, `Usuário ${rotulo}`, estado],
    );

  const naCarteira = await usuario(tenantA, 'carteira');
  const fora = await usuario(tenantA, 'fora');
  const suspenso = await usuario(tenantA, 'suspenso', 'SUSPENSO');
  const administrador = await usuario(tenantA, 'admin');
  const duasEmpresas = await usuario(tenantA, 'duas');
  const deB = await usuario(tenantB, 'b');

  await admin.query(
    `insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'admin_escritorio')`,
    [tenantA, administrador],
  );

  const vinculo = (tenantId: string, usuarioId: string, empresaId: string): Promise<string> =>
    unico(
      admin,
      `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3) returning id`,
      [tenantId, usuarioId, empresaId],
    );

  const naCarteiraA1 = await vinculo(tenantA, naCarteira, empresaA1);
  const suspensoA1 = await vinculo(tenantA, suspenso, empresaA1);
  await vinculo(tenantA, fora, empresaA2);
  await vinculo(tenantA, duasEmpresas, empresaA1);
  await vinculo(tenantA, duasEmpresas, empresaA2);
  await vinculo(tenantB, deB, empresaB1);

  return {
    sufixo,
    tenantA,
    tenantB,
    empresaA1,
    empresaA2,
    empresaA3Arquivada,
    empresaB1,
    usuarios: { naCarteira, fora, suspenso, admin: administrador, duasEmpresas, deB },
    vinculos: { naCarteiraA1, suspensoA1 },
  };
};

/** Apaga tudo o que pertence aos dois tenants do cenário, em qualquer ordem. */
export const limparCenario = async (admin: Pool, cenario: Cenario): Promise<void> => {
  const cliente = await admin.connect();

  try {
    await cliente.query(`set session_replication_role = replica`);

    const { rows } = await cliente.query<{ tabela: string }>(
      `select table_name as tabela from information_schema.columns
        where table_schema = 'app' and column_name = 'tenant_id'`,
    );

    for (const { tabela } of rows) {
      await cliente.query(`delete from app.${tabela} where tenant_id = any($1)`, [
        [cenario.tenantA, cenario.tenantB],
      ]);
    }

    await cliente.query(`delete from app.tenant where id = any($1)`, [
      [cenario.tenantA, cenario.tenantB],
    ]);
  } finally {
    await cliente.query(`reset session_replication_role`);
    cliente.release();
  }
};
