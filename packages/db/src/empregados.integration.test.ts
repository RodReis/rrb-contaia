/**
 * Banco dos empregados e da importação por CSV (SPEC-014 §3.6–§3.10, §4, §6.3, §9).
 *
 * Roda como `contaia_app` (sem BYPASSRLS) sobre o PostgreSQL real: RLS por tenant/empresa, chave
 * natural empresa + CPF + matrícula, CHECKs de CPF e de datas, FKs compostas, append-only,
 * privilégios por coluna, versão otimista da base, staging com valor cru e a pendência "empregados
 * não importados". O semeador (superusuário) só prepara o que a aplicação não pode gravar (ex.:
 * empregado já arquivado).
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { contextoTecnico } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto } from './contexto.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';
import { comoUsuario } from './testes/suporte.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();

let c: Cenario;

type Executar<T> = (cliente: PoolClient) => Promise<T>;
type Banco = Pick<PoolClient, 'query'>;

const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

const como = <T>(usuarioId: string, executar: Executar<T>, tenantId: string | null = c.tenantA): Promise<T> =>
  comoUsuario(app, tenantId, usuarioId, executar);

const comoWorker = <T>(empresaId: string, executar: Executar<T>): Promise<T> =>
  comContexto(
    app,
    contextoTecnico({
      identidadeTecnica: 'workers-empregados',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: c.tenantA,
      empresaId,
      correlationId: 'teste-empregados',
    }),
    executar,
  );

const codigoPg = async (executar: () => Promise<unknown>): Promise<string> => {
  try {
    await executar();

    return 'nao_lancou';
  } catch (erro) {
    return (erro as { code?: string }).code ?? 'sem_codigo';
  }
};

const idDe = async (banco: Banco, sql: string, parametros: unknown[]): Promise<string> => {
  const { rows } = await banco.query<{ id: string }>(sql, parametros);

  return rows[0]!.id;
};

// CPFs válidos (dígitos verificadores corretos), só dígitos como a tabela guarda.
const CPF_A = '52998224725';
const CPF_B = '11144477735';

type Empregado = Readonly<{
  cpf?: string;
  matricula?: string;
  nome?: string;
  nascimento?: string;
  admissao?: string;
  tenantId?: string;
}>;

const inserirEmpregado = (banco: Banco, empresaId: string, e: Empregado = {}): Promise<string> =>
  idDe(
    banco,
    `insert into app.empregado (tenant_id, empresa_id, cpf, nome, matricula, data_nascimento, data_admissao)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      e.tenantId ?? c.tenantA,
      empresaId,
      e.cpf ?? CPF_A,
      e.nome ?? 'Maria da Prova',
      e.matricula ?? `M-${randomUUID().slice(0, 8)}`,
      e.nascimento ?? '1990-05-10',
      e.admissao ?? '2015-03-01',
    ],
  );

const MAPEAMENTO = {
  cpf: 'CPF',
  nome: 'Nome',
  matricula: 'Matricula',
  data_nascimento: 'Nascimento',
  data_admissao: 'Admissao',
};

const inserirTentativa = (
  banco: Banco,
  empresaId: string,
  opcoes: Readonly<{ hash?: string; mapeamento?: object; usuarioId?: string }> = {},
): Promise<string> =>
  idDe(
    banco,
    `insert into app.importacao_empregados
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
        usuario_iniciador_id, correlation_id)
     values ($1, $2, $3, $4::jsonb, 'empregados.csv', 120, $5, $6, 'teste-empregados')
     returning id`,
    [
      c.tenantA,
      empresaId,
      opcoes.hash ?? hex64(),
      JSON.stringify(opcoes.mapeamento ?? MAPEAMENTO),
      `${c.tenantA}/${empresaId}/empregados/${randomUUID()}.csv`,
      opcoes.usuarioId ?? c.usuarios.naCarteira,
    ],
  );

type Linha = Readonly<{
  numero: number;
  cpf?: string | null;
  cpfNormalizado?: string | null;
  nome?: string | null;
  matricula?: string | null;
  nascimento?: string | null;
  admissao?: string | null;
  status?: 'VALIDA' | 'REJEITADA';
  acao?: 'INCLUIR' | 'ATUALIZAR' | null;
  codigoDeErro?: string | null;
  campo?: string | null;
}>;

const valor = <T>(dado: T | undefined, padrao: T): T => (dado === undefined ? padrao : dado);

const inserirLinha = (banco: Banco, empresaId: string, tentativaId: string, linha: Linha): Promise<string> => {
  const valida = (linha.status ?? 'VALIDA') === 'VALIDA';

  return idDe(
    banco,
    `insert into app.importacao_empregados_linha
       (tenant_id, empresa_id, tentativa_id, numero_linha, cpf, cpf_normalizado, nome, matricula,
        data_nascimento, data_admissao, status, acao, codigo_de_erro, campo, mensagem)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning id`,
    [
      c.tenantA,
      empresaId,
      tentativaId,
      linha.numero,
      valor(linha.cpf, '529.982.247-25'),
      valor(linha.cpfNormalizado, valida ? CPF_A : null),
      valor(linha.nome, 'Maria da Prova'),
      valor(linha.matricula, `M${linha.numero}`),
      valor(linha.nascimento, '1990-05-10'),
      valor(linha.admissao, '2015-03-01'),
      linha.status ?? 'VALIDA',
      valor(linha.acao, valida ? 'INCLUIR' : null),
      valor(linha.codigoDeErro, valida ? null : 'DATA_NASCIMENTO_INVALIDA'),
      linha.campo ?? null,
      valida ? null : 'Data inválida.',
    ],
  );
};

const inserirEvento = (banco: Banco, empresaId: string, tentativaId: string): Promise<string> =>
  idDe(
    banco,
    `insert into app.importacao_empregados_evento
       (tenant_id, empresa_id, tentativa_id, acao, estado_anterior, estado_novo, usuario_id, correlation_id)
     values ($1, $2, $3, 'CRIACAO', null, 'RECEBIDA', $4, 'teste-empregados')
     returning id`,
    [c.tenantA, empresaId, tentativaId, c.usuarios.naCarteira],
  );

const inserirNotificacao = (
  banco: Banco,
  empresaId: string,
  tentativaId: string,
  usuarioId: string = c.usuarios.naCarteira,
): Promise<string> =>
  idDe(
    banco,
    `insert into app.importacao_empregados_notificacao (tenant_id, empresa_id, tentativa_id, usuario_id)
     values ($1, $2, $3, $4) returning id`,
    [c.tenantA, empresaId, tentativaId, usuarioId],
  );

const contar = async (cliente: PoolClient, tabela: string, id: string): Promise<number> => {
  const { rows } = await cliente.query<{ n: string }>(`select count(*)::text as n from app.${tabela} where id = $1`, [
    id,
  ]);

  return Number(rows[0]?.n);
};

const colunasAtualizaveis = async (tabela: string): Promise<string[]> => {
  const { rows } = await admin.query<{ coluna: string }>(
    `select column_name as coluna from information_schema.column_privileges
      where table_schema = 'app' and table_name = $1 and grantee = 'contaia_app'
        and privilege_type = 'UPDATE' order by 1`,
    [tabela],
  );

  return rows.map((linha) => linha.coluna);
};

const TABELAS = [
  'empregado',
  'empresa_empregados_versao',
  'importacao_empregados',
  'importacao_empregados_linha',
  'importacao_empregados_evento',
  'importacao_empregados_notificacao',
] as const;

let deA1: Readonly<Record<(typeof TABELAS)[number], string>>;

beforeAll(async () => {
  c = await montarCenario(admin);
  deA1 = await como(c.usuarios.naCarteira, async (cli) => {
    const tentativa = await inserirTentativa(cli, c.empresaA1);
    const versao = await idDe(
      cli,
      `insert into app.empresa_empregados_versao (tenant_id, empresa_id) values ($1, $2) returning id`,
      [c.tenantA, c.empresaA1],
    );

    return {
      empregado: await inserirEmpregado(cli, c.empresaA1),
      empresa_empregados_versao: versao,
      importacao_empregados: tentativa,
      importacao_empregados_linha: await inserirLinha(cli, c.empresaA1, tentativa, { numero: 1 }),
      importacao_empregados_evento: await inserirEvento(cli, c.empresaA1, tentativa),
      importacao_empregados_notificacao: await inserirNotificacao(cli, c.empresaA1, tentativa),
    };
  });
}, 60_000);

afterAll(async () => {
  await limparCenario(admin, c);
  await Promise.all([admin.end(), app.end()]);
});

describe('empregado: chave natural empresa + CPF + matrícula (SPEC-014 §3.6)', () => {
  it('a mesma chave na mesma empresa falha com 23505; outra empresa, outra matrícula ou outro CPF é outro empregado', async () => {
    const matricula = `dup-${c.sufixo}`;
    await como(c.usuarios.duasEmpresas, (cli) => inserirEmpregado(cli, c.empresaA1, { matricula }));

    const inserir = (empresaId: string, e: Empregado) =>
      codigoPg(() => como(c.usuarios.duasEmpresas, (cli) => inserirEmpregado(cli, empresaId, e)));

    expect(await inserir(c.empresaA1, { matricula })).toBe('23505');
    expect(await inserir(c.empresaA2, { matricula })).toBe('nao_lancou');
    expect(await inserir(c.empresaA1, { matricula: `${matricula}-2` })).toBe('nao_lancou');
    expect(await inserir(c.empresaA1, { matricula, cpf: CPF_B })).toBe('nao_lancou');
  });

  it('matrícula com zeros à esquerda é outra chave: "00123" e "123" convivem', async () => {
    const sufixo = c.sufixo.slice(-4);

    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, async (cli) => {
          await inserirEmpregado(cli, c.empresaA1, { matricula: `00123${sufixo}`, cpf: CPF_B });
          await inserirEmpregado(cli, c.empresaA1, { matricula: `123${sufixo}`, cpf: CPF_B });
        }),
      ),
    ).toBe('nao_lancou');
  });

  it('CPF só com 11 dígitos; nome e matrícula não vazios', async () => {
    const inserir = (e: Empregado) => codigoPg(() => inserirEmpregado(admin, c.empresaA1, e));

    expect(await inserir({ cpf: '529.982.247-25' })).toBe('23514');
    expect(await inserir({ cpf: '5299822472' })).toBe('23514');
    expect(await inserir({ cpf: '5299822472a' })).toBe('23514');
    expect(await inserir({ nome: '   ' })).toBe('23514');
    expect(await inserir({ matricula: ' ' })).toBe('23514');
  });

  it('a admissão é posterior ao nascimento', async () => {
    const inserir = (e: Empregado) => codigoPg(() => inserirEmpregado(admin, c.empresaA1, e));

    expect(await inserir({ nascimento: '2000-01-01', admissao: '2000-01-01' })).toBe('23514');
    expect(await inserir({ nascimento: '2000-01-02', admissao: '2000-01-01' })).toBe('23514');
    expect(await inserir({ nascimento: '2000-01-01', admissao: '2000-01-02' })).toBe('nao_lancou');
  });

  it('CPF e matrícula não mudam: negado à aplicação e recusado pela trigger mesmo ao superusuário', async () => {
    const id = await como(c.usuarios.naCarteira, (cli) => inserirEmpregado(cli, c.empresaA1));

    for (const definicao of [`cpf = '${CPF_B}'`, `matricula = 'outra'`]) {
      expect(
        await codigoPg(() =>
          como(c.usuarios.naCarteira, (cli) => cli.query(`update app.empregado set ${definicao} where id = $1`, [id])),
        ),
      ).toBe('42501');
      expect(await codigoPg(() => admin.query(`update app.empregado set ${definicao} where id = $1`, [id]))).toBe(
        '23001',
      );
    }
  });

  it('empregado arquivado não é atualizado nem reativado', async () => {
    const id = await inserirEmpregado(admin, c.empresaA1);
    await admin.query(`update app.empregado set arquivado = true, arquivado_em = now() where id = $1`, [id]);

    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) => cli.query(`update app.empregado set nome = 'Outro' where id = $1`, [id])),
      ),
    ).toBe('23001');
    expect(
      await codigoPg(() =>
        admin.query(`update app.empregado set arquivado = false, arquivado_em = null where id = $1`, [id]),
      ),
    ).toBe('23001');
    expect(
      await codigoPg(() => admin.query(`update app.empregado set arquivado = true, arquivado_em = null where id = $1`, [deA1.empregado])),
    ).toBe('23514');
  });

  it('a aplicação atualiza só nome, datas e instante; a versão do empregado sobe só com mudança real', async () => {
    expect(await colunasAtualizaveis('empregado')).toEqual([
      'atualizado_em',
      'data_admissao',
      'data_nascimento',
      'nome',
    ]);

    const id = await como(c.usuarios.naCarteira, (cli) => inserirEmpregado(cli, c.empresaA1));
    const atualizar = (definicao: string) =>
      como(c.usuarios.naCarteira, (cli) =>
        cli.query<{ versao: string }>(`update app.empregado set ${definicao} where id = $1 returning versao::text`, [
          id,
        ]),
      );

    expect((await atualizar(`nome = nome`)).rows[0]?.versao).toBe('1');
    expect((await atualizar(`nome = 'Maria Atualizada', data_admissao = '2016-01-01'`)).rows[0]?.versao).toBe('2');
  });
});

describe('tentativa de importação: idempotência, obsolescência e estado (SPEC-014 §3.7, §3.11)', () => {
  it('mesmo hash e mapeamento → 23505; mapeamento diferente é nova tentativa', async () => {
    const hash = hex64();
    await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1, { hash }));

    expect(
      await codigoPg(() => como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1, { hash }))),
    ).toBe('23505');
    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) =>
          inserirTentativa(cli, c.empresaA1, { hash, mapeamento: { ...MAPEAMENTO, nome: 'Nome completo' } }),
        ),
      ),
    ).toBe('nao_lancou');
  });

  it('depois de FALHA ou CANCELADA o mesmo arquivo e mapeamento entram de novo; REJEITADA continua fechando', async () => {
    const fechar = async (estado: 'FALHA' | 'CANCELADA' | 'REJEITADA'): Promise<string> => {
      const hash = hex64();
      const id = await inserirTentativa(admin, c.empresaA1, { hash });
      await admin.query(
        `update app.importacao_empregados
            set estado = $2, finalizado_em = now(),
                usuario_cancelador_id = case when $2 = 'CANCELADA' then usuario_iniciador_id end
          where id = $1`,
        [id, estado],
      );

      return codigoPg(() => como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1, { hash })));
    };

    expect(await fechar('FALHA')).toBe('nao_lancou');
    expect(await fechar('CANCELADA')).toBe('nao_lancou');
    expect(await fechar('REJEITADA')).toBe('23505');
  });

  it('resultado obsoleto sai da identidade; a marca só sobe, sozinha, e só em resultado reutilizável', async () => {
    const hash = hex64();
    const id = await inserirTentativa(admin, c.empresaA1, { hash });
    await admin.query(
      `update app.importacao_empregados set estado = 'CONCLUIDA', finalizado_em = now(), iniciado_em = now() where id = $1`,
      [id],
    );
    const atualizar = (definicao: string, alvo: string = id) =>
      codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) =>
          cli.query(`update app.importacao_empregados set ${definicao} where id = $1`, [alvo]),
        ),
      );

    expect(await atualizar(`estado = 'VALIDANDO', finalizado_em = null`)).toBe('23001');
    expect(await atualizar(`obsoleta = true, totais = '{}'::jsonb`)).toBe('23001');
    expect(await atualizar(`reutilizada_por_idempotencia = true`)).toBe('nao_lancou');
    expect(await atualizar(`obsoleta = true`)).toBe('nao_lancou');
    expect(await atualizar(`obsoleta = false`)).toBe('23001');
    expect(
      await codigoPg(() => como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1, { hash }))),
    ).toBe('nao_lancou');

    const viva = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));
    expect(await atualizar(`obsoleta = true`, viva)).toBe('23514');
  });

  it('o mapeamento só muda enquanto RECEBIDA', async () => {
    const id = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));
    const trocar = (nome: string) =>
      codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) =>
          cli.query(`update app.importacao_empregados set mapeamento = $2::jsonb where id = $1`, [
            id,
            JSON.stringify({ ...MAPEAMENTO, nome }),
          ]),
        ),
      );

    expect(await trocar('Funcionario')).toBe('nao_lancou');
    await comoWorker(c.empresaA1, (cli) =>
      cli.query(`update app.importacao_empregados set estado = 'VALIDANDO' where id = $1`, [id]),
    );
    expect(await trocar('Outro')).toBe('23001');
  });

  it('a aplicação atualiza só o ciclo de vida da tentativa; arquivo, hash e iniciador são imutáveis', async () => {
    expect(await colunasAtualizaveis('importacao_empregados')).toEqual([
      'empregados_versao_na_validacao',
      'estado',
      'finalizado_em',
      'iniciado_em',
      'mapeamento',
      'obsoleta',
      'reutilizada_por_idempotencia',
      'totais',
      'usuario_cancelador_id',
      'usuario_confirmador_id',
    ]);

    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) =>
          cli.query(`update app.importacao_empregados set hash_arquivo = $2 where id = $1`, [
            deA1.importacao_empregados,
            hex64(),
          ]),
        ),
      ),
    ).toBe('42501');
  });

  it('as filhas não apontam para a tentativa de outra empresa (FK composta)', async () => {
    const tentativaA1 = await inserirTentativa(admin, c.empresaA1);

    expect(await codigoPg(() => inserirLinha(admin, c.empresaA2, tentativaA1, { numero: 1 }))).toBe('23503');
    expect(await codigoPg(() => inserirEvento(admin, c.empresaA2, tentativaA1))).toBe('23503');
    expect(await codigoPg(() => inserirNotificacao(admin, c.empresaA2, tentativaA1, c.usuarios.fora))).toBe('23503');
  });
});

describe('staging da validação (SPEC-014 §3.4, §6.4)', () => {
  it('linha rejeitada guarda o texto cru, inclusive data impossível e campos ausentes', async () => {
    const tentativa = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));

    expect(
      await codigoPg(() =>
        comoWorker(c.empresaA1, async (cli) => {
          await inserirLinha(cli, c.empresaA1, tentativa, {
            numero: 2,
            status: 'REJEITADA',
            nascimento: '31/02/2020',
            admissao: '45123',
            campo: 'data_nascimento',
          });
          await inserirLinha(cli, c.empresaA1, tentativa, {
            numero: 3,
            status: 'REJEITADA',
            cpf: null,
            nome: null,
            matricula: null,
            nascimento: null,
            admissao: null,
            codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE',
            campo: 'cpf',
          });
        }),
      ),
    ).toBe('nao_lancou');
  });

  it('linha válida exige CPF normalizado, datas ISO reais, admissão posterior e ação; rejeitada exige código', async () => {
    const tentativa = await inserirTentativa(admin, c.empresaA1);
    const inserir = (linha: Linha) => codigoPg(() => inserirLinha(admin, c.empresaA1, tentativa, linha));

    expect(await inserir({ numero: 1, cpfNormalizado: null })).toBe('23514');
    expect(await inserir({ numero: 2, cpfNormalizado: '529.982.247-25' })).toBe('23514');
    expect(await inserir({ numero: 3, nascimento: '10/05/1990' })).toBe('23514');
    expect(await inserir({ numero: 4, nascimento: '2020-02-30' })).toBe('23514');
    expect(await inserir({ numero: 5, admissao: '2019-13-01' })).toBe('23514');
    expect(await inserir({ numero: 6, nascimento: '2015-03-01', admissao: '2015-03-01' })).toBe('23514');
    expect(await inserir({ numero: 7, nome: '  ' })).toBe('23514');
    expect(await inserir({ numero: 8, acao: null })).toBe('23514');
    expect(await inserir({ numero: 9, status: 'REJEITADA', codigoDeErro: null })).toBe('23514');
    expect(await inserir({ numero: 10, nascimento: '2024-02-29', admissao: '2024-03-01' })).toBe('nao_lancou');
  });

  it('a mesma linha da mesma tentativa não duplica: 23505', async () => {
    const tentativa = await inserirTentativa(admin, c.empresaA1);
    await comoWorker(c.empresaA1, (cli) => inserirLinha(cli, c.empresaA1, tentativa, { numero: 7 }));

    expect(
      await codigoPg(() => comoWorker(c.empresaA1, (cli) => inserirLinha(cli, c.empresaA1, tentativa, { numero: 7 }))),
    ).toBe('23505');
  });
});

describe('isolamento (I-1, I-2) e ausência de DELETE (I-7)', () => {
  it('controle positivo: a carteira de A1 e o worker de A1 leem as seis tabelas', async () => {
    for (const tabela of TABELAS) {
      expect(await como(c.usuarios.naCarteira, (cli) => contar(cli, tabela, deA1[tabela]))).toBe(1);
      expect(await comoWorker(c.empresaA1, (cli) => contar(cli, tabela, deA1[tabela]))).toBe(1);
    }
  });

  it('o tenant B não enxerga nada do tenant A', async () => {
    for (const tabela of TABELAS) {
      expect(await como(c.usuarios.deB, (cli) => contar(cli, tabela, deA1[tabela]), c.tenantB)).toBe(0);
    }
  });

  it('humano fora da carteira, administrador sem vínculo e worker de outra empresa não leem', async () => {
    for (const tabela of TABELAS) {
      expect(await como(c.usuarios.fora, (cli) => contar(cli, tabela, deA1[tabela]))).toBe(0);
      expect(await como(c.usuarios.admin, (cli) => contar(cli, tabela, deA1[tabela]))).toBe(0);
      expect(await comoWorker(c.empresaA2, (cli) => contar(cli, tabela, deA1[tabela]))).toBe(0);
    }
  });

  it('sem contexto nada é retornado', async () => {
    for (const tabela of TABELAS) {
      expect(await como(c.usuarios.naCarteira, (cli) => contar(cli, tabela, deA1[tabela]), null)).toBe(0);
    }
  });

  it('DELETE é negado em todas as tabelas; UPDATE é negado no staging e no evento', async () => {
    for (const tabela of TABELAS) {
      expect(
        await codigoPg(() =>
          como(c.usuarios.naCarteira, (cli) => cli.query(`delete from app.${tabela} where id = $1`, [deA1[tabela]])),
        ),
      ).toBe('42501');
    }

    for (const tabela of ['importacao_empregados_linha', 'importacao_empregados_evento'] as const) {
      expect(
        await codigoPg(() =>
          como(c.usuarios.naCarteira, (cli) => cli.query(`update app.${tabela} set id = id where id = $1`, [deA1[tabela]])),
        ),
      ).toBe('42501');
    }
  });
});

describe('trilha append-only (I-6)', () => {
  it('nem o superusuário altera ou apaga evento; só há políticas de SELECT e INSERT', async () => {
    const evento = deA1.importacao_empregados_evento;

    expect(
      await codigoPg(() =>
        admin.query(`update app.importacao_empregados_evento set correlation_id = 'x' where id = $1`, [evento]),
      ),
    ).toBe('23001');
    expect(await codigoPg(() => admin.query(`delete from app.importacao_empregados_evento where id = $1`, [evento]))).toBe(
      '23001',
    );

    const { rows } = await admin.query<{ comando: string }>(
      `select cmd as comando from pg_policies
        where schemaname = 'app' and tablename = 'importacao_empregados_evento' order by 1`,
    );
    expect(rows.map((linha) => linha.comando)).toEqual(['INSERT', 'SELECT']);
  });
});

describe('notificação de conclusão (SPEC-014 §3.10)', () => {
  it('vários destinatários por tentativa, um aviso por destinatário; a leitura é só lida/lida_em', async () => {
    const tentativa = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));

    expect(await codigoPg(() => comoWorker(c.empresaA1, (cli) => inserirNotificacao(cli, c.empresaA1, tentativa)))).toBe(
      'nao_lancou',
    );
    expect(
      await codigoPg(() =>
        comoWorker(c.empresaA1, (cli) => inserirNotificacao(cli, c.empresaA1, tentativa, c.usuarios.admin)),
      ),
    ).toBe('nao_lancou');
    expect(await codigoPg(() => comoWorker(c.empresaA1, (cli) => inserirNotificacao(cli, c.empresaA1, tentativa)))).toBe(
      '23505',
    );
    expect(await colunasAtualizaveis('importacao_empregados_notificacao')).toEqual(['lida', 'lida_em']);
  });
});

describe('versão otimista da base de empregados (SPEC-014 §6.3)', () => {
  it('uma por empresa e só sobe', async () => {
    await como(c.usuarios.fora, (cli) =>
      cli.query(
        `insert into app.empresa_empregados_versao (tenant_id, empresa_id) values ($1, $2)
         on conflict (empresa_id, tenant_id) do nothing`,
        [c.tenantA, c.empresaA2],
      ),
    );
    const subir = await como(c.usuarios.fora, (cli) =>
      cli.query<{ versao: string }>(
        `update app.empresa_empregados_versao set versao = versao + 1 where empresa_id = $1 returning versao::text`,
        [c.empresaA2],
      ),
    );

    expect(subir.rows).toEqual([{ versao: '1' }]);
    expect(
      await codigoPg(() =>
        como(c.usuarios.fora, (cli) =>
          cli.query(`update app.empresa_empregados_versao set versao = 0 where empresa_id = $1`, [c.empresaA2]),
        ),
      ),
    ).toBe('23001');
    expect(await colunasAtualizaveis('empresa_empregados_versao')).toEqual(['versao']);
  });
});

describe('pendência "empregados não importados" (SPEC-014 §3.10)', () => {
  const lerBackfill = async (): Promise<string> => {
    const sql = await readFile(new URL('../migrations/0017_importacao_empregados.sql', import.meta.url), 'utf8');
    const backfill = /WITH novas AS \([\s\S]*?FROM novas;/u.exec(sql)?.[0];

    expect(backfill).toBeDefined();

    return backfill ?? '';
  };

  const pendenciasDeEmpregados = async (cliente: PoolClient, empresaId: string): Promise<string[]> => {
    const { rows } = await cliente.query<{ tipo: string }>(
      `select origem || ':' || tipo || ':' || chave as tipo from app.empresa_pendencia
        where empresa_id = $1 and estado = 'ABERTA' and origem = 'EMPREGADOS'`,
      [empresaId],
    );

    return rows.map((linha) => linha.tipo);
  };

  it('abre para empresa ATIVA sem empregado confirmado, poupa a que tem e é idempotente', async () => {
    const backfill = await lerBackfill();
    const cliente = await admin.connect();

    // Transação revertida: o backfill varre o banco inteiro (ver o teste equivalente da F13).
    try {
      await cliente.query('begin');
      await cliente.query('lock table app.empresa in share mode');
      const nova = (rotulo: string, status: string) =>
        idDe(
          cliente,
          `insert into app.empresa (tenant_id, cnpj, razao_social, status) values ($1, $2, $3, $4) returning id`,
          [c.tenantA, `${rotulo}${c.sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa ${rotulo}`, status],
        );
      const semEmpregado = await nova('Q1', 'ATIVA');
      const emCadastro = await nova('Q2', 'CADASTRO_INCOMPLETO');
      const soArquivado = await nova('Q3', 'ATIVA');
      const id = await inserirEmpregado(cliente, soArquivado);
      await cliente.query(`update app.empregado set arquivado = true, arquivado_em = now() where id = $1`, [id]);

      await cliente.query(backfill);
      await cliente.query(backfill);

      const esperado = ['EMPREGADOS:EMPREGADOS_NAO_IMPORTADOS:empregados:nao-importados'];
      expect(await pendenciasDeEmpregados(cliente, semEmpregado)).toEqual(esperado);
      expect(await pendenciasDeEmpregados(cliente, soArquivado)).toEqual(esperado);
      expect(await pendenciasDeEmpregados(cliente, emCadastro)).toEqual([]);
      expect(await pendenciasDeEmpregados(cliente, c.empresaA1)).toEqual([]);

      const eventos = await cliente.query(
        `select 1 from app.empresa_evento_de_pendencia e join app.empresa_pendencia p on p.id = e.pendencia_id
          where p.empresa_id = $1 and p.chave = 'empregados:nao-importados' and e.acao = 'CRIACAO'`,
        [semEmpregado],
      );
      expect(eventos.rowCount).toBe(1);
    } finally {
      await cliente.query('rollback');
      cliente.release();
    }
  });

  it('a pendência aceita a origem e o tipo novos sem perder os anteriores', async () => {
    const inserir = (origem: string, tipo: string) =>
      admin.query(
        `insert into app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave) values ($1, $2, $3, $4, $5)`,
        [c.tenantA, c.empresaA2, origem, tipo, `chk:${origem}:${tipo}:${randomUUID()}`],
      );

    expect(await codigoPg(() => inserir('EMPREGADOS', 'EMPREGADOS_NAO_IMPORTADOS'))).toBe('nao_lancou');
    expect(await codigoPg(() => inserir('PLANO_CONTAS', 'PLANO_CONTAS_INCOMPLETO'))).toBe('nao_lancou');
    expect(await codigoPg(() => inserir('CADASTRAL', 'CAMPO_AUSENTE'))).toBe('nao_lancou');
    expect(await codigoPg(() => inserir('EMPREGADOS', 'EMPREGADO_INVENTADO'))).toBe('23514');
    expect(await codigoPg(() => inserir('RH', 'EMPREGADOS_NAO_IMPORTADOS'))).toBe('23514');
  });
});
