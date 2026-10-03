/**
 * Matriz negativa de RLS (SPEC-010 §9, TESTING.md §3.1).
 *
 * Para cada tabela classificada, executa pelo PAPEL DA APLICAÇÃO, num PostgreSQL
 * real, os casos de SELECT, INSERT, UPDATE e DELETE que a classe da tabela exige:
 * dentro do recorte (controle positivo), fora da carteira, outro tenant, sem
 * contexto, contexto adulterado, usuário suspenso, finalidade administrativa e
 * job técnico em outra empresa. Cada caso registra o esperado e o obtido.
 *
 * Negação só conta como RLS quando o erro é o de política (`42501` com "row-level
 * security"); privilégio ausente e trigger de escopo imutável têm categoria própria.
 */
import {
  contextoHumano,
  contextoTecnico,
  type ContextoDeAcesso,
  type FinalidadeHumana,
} from '@contaia/domain';
import type { Pool, PoolClient } from 'pg';

import { comContexto, semContexto } from '../contexto.js';
import type { Cenario } from './cenario-rls.js';
import { FIXTURES, type Escopo, type FixtureDeTabela, type Referencias } from './fixtures-rls.js';
import type { ClasseDeTabela, EntradaDeClassificacao } from '../rls/classificacao.js';

export type Operacao = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export type Resultado =
  | 'visivel'
  | 'invisivel'
  | 'inserido'
  | 'atualizado'
  | 'nenhuma_linha_alterada'
  | 'rejeitado_por_rls'
  | 'rejeitado_por_escopo_imutavel'
  | 'negado_por_privilegio'
  | `outro:${string}`;

export type CasoDaMatriz = Readonly<{
  tabela: string;
  classe: ClasseDeTabela;
  caso: string;
  operacao: Operacao;
  esperado: Resultado;
  obtido: Resultado;
  passou: boolean;
}>;

type Ator =
  | Readonly<{ tipo: 'contexto'; contexto: ContextoDeAcesso }>
  | Readonly<{ tipo: 'nenhum' }>
  | Readonly<{ tipo: 'bruto'; parametros: Readonly<Record<string, string>> }>;

class Reverter extends Error {
  constructor(readonly valor: unknown) {
    super('reverter');
  }
}

const PARAMETROS_VAZIOS: Readonly<Record<string, string>> = {
  'app.tenant_id': '',
  'app.origem': '',
  'app.usuario_id': '',
  'app.empresa_id': '',
  'app.finalidade': '',
  'app.identidade_tecnica': '',
  'app.correlation_id': '',
  'app.empresa_em_criacao': '',
};

const executarComoAtor = async <T>(
  pool: Pool,
  ator: Ator,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => {
  if (ator.tipo === 'nenhum') {
    return semContexto(pool, executar);
  }

  if (ator.tipo === 'contexto') {
    return comContexto(pool, ator.contexto, executar);
  }

  // Contexto adulterado: grava variável de sessão crua, sem passar pelo domínio.
  const cliente = await pool.connect();

  try {
    await cliente.query('begin');

    for (const [nome, valor] of Object.entries({ ...PARAMETROS_VAZIOS, ...ator.parametros })) {
      await cliente.query('select set_config($1, $2, true)', [nome, valor]);
    }

    const resultado = await executar(cliente);
    await cliente.query('commit');

    return resultado;
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }
};

type ErroDePg = { code?: string; message?: string };

const classificarErro = (erro: unknown): Resultado => {
  const { code, message } = (erro ?? {}) as ErroDePg;

  if (code === '42501' && /row-level security/iu.test(message ?? '')) {
    return 'rejeitado_por_rls';
  }
  if (code === '42501') {
    return 'negado_por_privilegio';
  }
  if (code === '23001') {
    return 'rejeitado_por_escopo_imutavel';
  }

  return `outro:${code ?? 'sem-codigo'}`;
};

/** Executa a operação e SEMPRE reverte: a matriz não deixa efeito no banco. */
const tentar = async (
  pool: Pool,
  ator: Ator,
  operacao: (cliente: PoolClient) => Promise<Resultado>,
): Promise<Resultado> => {
  try {
    await executarComoAtor(pool, ator, async (cliente) => {
      throw new Reverter(await operacao(cliente));
    });
  } catch (erro) {
    if (erro instanceof Reverter) {
      return erro.valor as Resultado;
    }

    return classificarErro(erro);
  }

  return 'outro:sem-resultado';
};

const ler = (tabela: string, linhaId: string) => async (cliente: PoolClient): Promise<Resultado> => {
  const { rows } = await cliente.query<{ n: string }>(
    `select count(*)::text as n from ${tabela} where id = $1`,
    [linhaId],
  );

  return rows[0]?.n === '1' ? 'visivel' : 'invisivel';
};

const inserir =
  (fixture: FixtureDeTabela, escopo: Escopo, referencias: Referencias) =>
  async (cliente: PoolClient): Promise<Resultado> => {
    await fixture.inserir(cliente, escopo, referencias);

    return 'inserido';
  };

const atualizar =
  (tabela: string, linhaId: string, coluna: string, definicao?: string) =>
  async (cliente: PoolClient): Promise<Resultado> => {
    const { rowCount } = await cliente.query(
      `update ${tabela} set ${definicao ?? `${coluna} = ${coluna}`} where id = $1`,
      [linhaId],
    );

    return (rowCount ?? 0) > 0 ? 'atualizado' : 'nenhuma_linha_alterada';
  };

const apagar = (tabela: string, linhaId: string) => async (cliente: PoolClient): Promise<Resultado> => {
  const { rowCount } = await cliente.query(`delete from ${tabela} where id = $1`, [linhaId]);

  return (rowCount ?? 0) > 0 ? 'atualizado' : 'nenhuma_linha_alterada';
};

type Privilegios = Readonly<{ update: boolean; atualizaTenant: boolean; atualizaEmpresa: boolean }>;

const privilegiosDe = async (pool: Pool, tabela: string): Promise<Privilegios> => {
  const coluna = (nome: string): string =>
    `coalesce((select has_column_privilege(current_user, $1::regclass, a.attnum, 'UPDATE')
                 from pg_attribute a
                where a.attrelid = $1::regclass and a.attname = '${nome}' and not a.attisdropped), false)`;
  const { rows } = await pool.query<{ pode: boolean; tenant: boolean; empresa: boolean }>(
    `select has_any_column_privilege(current_user, $1::regclass, 'UPDATE') as pode,
            ${coluna('tenant_id')} as tenant, ${coluna('empresa_id')} as empresa`,
    [tabela],
  );

  return {
    update: rows[0]?.pode === true,
    atualizaTenant: rows[0]?.tenant === true,
    atualizaEmpresa: rows[0]?.empresa === true,
  };
};

export type EntradaDaMatriz = Readonly<{
  app: Pool;
  admin: Pool;
  cenario: Cenario;
  classificacao: readonly EntradaDeClassificacao[];
}>;

export const executarMatriz = async (entrada: EntradaDaMatriz): Promise<CasoDaMatriz[]> => {
  const { app, admin, cenario: c, classificacao } = entrada;
  const resultados: CasoDaMatriz[] = [];

  const humano = (
    usuarioId: string,
    finalidade: FinalidadeHumana = 'COMUM',
    tenantId: string = c.tenantA,
  ): Ator => ({
    tipo: 'contexto',
    contexto: contextoHumano({ tenantId, usuarioId, finalidade, correlationId: 'matriz-rls' }),
  });
  const tecnico = (empresaId: string, tenantId: string = c.tenantA): Ator => ({
    tipo: 'contexto',
    contexto: contextoTecnico({
      identidadeTecnica: 'matriz-rls',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId,
      empresaId,
      correlationId: 'matriz-rls',
    }),
  });
  const u = c.usuarios;
  const nenhum: Ator = { tipo: 'nenhum' };
  const adulterados: ReadonlyArray<readonly [string, Ator]> = [
    ['tenant adulterado (não é uuid)', { tipo: 'bruto', parametros: { 'app.tenant_id': 'x', 'app.origem': 'HUMANA', 'app.usuario_id': u.naCarteira, 'app.finalidade': 'COMUM' } }],
    ['humano sem usuário', { tipo: 'bruto', parametros: { 'app.tenant_id': c.tenantA, 'app.origem': 'HUMANA', 'app.finalidade': 'COMUM' } }],
    ['finalidade inventada', { tipo: 'bruto', parametros: { 'app.tenant_id': c.tenantA, 'app.origem': 'HUMANA', 'app.usuario_id': u.naCarteira, 'app.finalidade': 'SUPERUSUARIO' } }],
    ['origem inventada', { tipo: 'bruto', parametros: { 'app.tenant_id': c.tenantA, 'app.origem': 'ROOT', 'app.usuario_id': u.naCarteira, 'app.finalidade': 'COMUM' } }],
    ['técnico sem correlationId', { tipo: 'bruto', parametros: { 'app.tenant_id': c.tenantA, 'app.origem': 'TECNICA', 'app.empresa_id': c.empresaA1, 'app.finalidade': 'PROCESSAMENTO_DE_EMPRESA', 'app.identidade_tecnica': 'x' } }],
    ['técnico sem empresa', { tipo: 'bruto', parametros: { 'app.tenant_id': c.tenantA, 'app.origem': 'TECNICA', 'app.finalidade': 'PROCESSAMENTO_DE_EMPRESA', 'app.identidade_tecnica': 'x', 'app.correlation_id': 'y' } }],
  ];

  // Empresa em criação (SPEC-009 §3.1): o criador escreve nela antes de ter vínculo — só nela.
  const humanoCriando = (
    usuarioId: string,
    empresaEmCriacao: string,
    sobre: Readonly<Record<string, string>> = {},
  ): Ator => ({
    tipo: 'bruto',
    parametros: {
      'app.tenant_id': c.tenantA,
      'app.origem': 'HUMANA',
      'app.usuario_id': usuarioId,
      'app.finalidade': 'COMUM',
      'app.empresa_em_criacao': empresaEmCriacao,
      ...sobre,
    },
  });

  const registrar = (
    tabela: string,
    classe: ClasseDeTabela,
    caso: string,
    operacao: Operacao,
    esperado: Resultado,
    obtido: Resultado,
  ): void => {
    resultados.push({ tabela, classe, caso, operacao, esperado, obtido, passou: esperado === obtido });
  };

  for (const entrada of classificacao) {
    const { tabela, classe } = entrada;

    if (classe === 'global') {
      continue;
    }

    const fixture = FIXTURES[tabela];

    if (fixture === undefined) {
      continue; // a ausência é reprovada pelo teste de cobertura, com mensagem própria.
    }

    const { update: temUpdate, atualizaTenant, atualizaEmpresa } = await privilegiosDe(app, tabela);
    const moverTenant: Resultado = atualizaTenant ? 'rejeitado_por_escopo_imutavel' : 'negado_por_privilegio';
    const moverEmpresa: Resultado = atualizaEmpresa ? 'rejeitado_por_escopo_imutavel' : 'negado_por_privilegio';
    const coluna = fixture.colunaDeAtualizacao ?? 'id';
    const escopoA1: Escopo = {
      tenantId: c.tenantA,
      empresaId: c.empresaA1,
      autorId: u.naCarteira,
      sufixo: c.sufixo,
    };
    // Pais próprios da semente e das tentativas: tabela com unicidade por pai (ex.:
    // um papel por usuário) colidiria entre a linha-alvo e o controle positivo.
    const referenciasDaSemente = await (fixture.preparar?.(admin, escopoA1) ?? Promise.resolve({}));
    const referencias = await (fixture.preparar?.(admin, escopoA1) ?? Promise.resolve({}));

    // Linha-alvo: a da própria classe, semeada pelo papel administrativo.
    let linhaA1: string;
    if (classe === 'raiz_tenant') {
      linhaA1 = c.tenantA;
    } else if (classe === 'raiz_empresa') {
      linhaA1 = c.empresaA1;
    } else if (classe === 'vinculo') {
      linhaA1 = c.vinculos.naCarteiraA1;
    } else {
      linhaA1 = await fixture.inserir(admin, escopoA1, referenciasDaSemente);
    }

    const leitura = (caso: string, ator: Ator, esperado: Resultado, linha = linhaA1): Promise<void> =>
      tentar(app, ator, ler(tabela, linha)).then((obtido) =>
        registrar(tabela, classe, caso, 'SELECT', esperado, obtido),
      );
    const insercao = (
      caso: string,
      ator: Ator,
      esperado: Resultado,
      escopo: Escopo = escopoA1,
    ): Promise<void> =>
      tentar(app, ator, inserir(fixture, escopo, referencias)).then((obtido) =>
        registrar(tabela, classe, caso, 'INSERT', esperado, obtido),
      );
    const alteracao = (
      caso: string,
      ator: Ator,
      esperado: Resultado,
      linha = linhaA1,
      definicao?: string,
    ): Promise<void> =>
      tentar(app, ator, atualizar(tabela, linha, coluna, definicao ?? fixture.atualizacao)).then((obtido) =>
        registrar(tabela, classe, caso, 'UPDATE', esperado, obtido),
      );

    // -- SELECT / INSERT / UPDATE por classe ------------------------------------

    if (classe === 'empresa') {
      await leitura('na carteira (controle positivo)', humano(u.naCarteira), 'visivel');
      await leitura('na carteira de duas empresas', humano(u.duasEmpresas), 'visivel');
      await leitura('empresa do mesmo tenant fora da carteira', humano(u.fora), 'invisivel');
      await leitura('usuário suspenso com vínculo preservado', humano(u.suspenso), 'invisivel');
      await leitura('outro tenant', humano(u.deB, 'COMUM', c.tenantB), 'invisivel');
      await leitura('tenant do contexto trocado pelo de B com usuário de A', humano(u.naCarteira, 'COMUM', c.tenantB), 'invisivel');
      await leitura('administrador sem vínculo, empresa ativa', humano(u.admin), 'invisivel');
      await leitura('finalidade administrativa não abre dado operacional', humano(u.naCarteira, 'ADMIN_ACESSO'), 'invisivel');
      await leitura('localização básica não abre dado operacional', humano(u.naCarteira, 'LOCALIZACAO_BASICA_EMPRESA'), 'invisivel');
      await leitura('sem contexto', nenhum, 'invisivel');
      await leitura('job técnico na empresa do trabalho', tecnico(c.empresaA1), 'visivel');
      await leitura('job técnico em outra empresa', tecnico(c.empresaA2), 'invisivel');
      await leitura('job técnico com tenant incompatível', tecnico(c.empresaA1, c.tenantB), 'invisivel');
      for (const [nome, ator] of adulterados) {
        await leitura(`contexto adulterado: ${nome}`, ator, 'invisivel');
      }
      await leitura('criador sem vínculo na empresa que está criando', humanoCriando(u.fora, c.empresaA1), 'visivel');
      await leitura('criação de outra empresa não abre esta', humanoCriando(u.fora, c.empresaA2), 'invisivel');
      await leitura('criação com usuário suspenso', humanoCriando(u.suspenso, c.empresaA3Arquivada), 'invisivel');
      await leitura('criação sob finalidade administrativa', humanoCriando(u.fora, c.empresaA1, { 'app.finalidade': 'ADMIN_ACESSO' }), 'invisivel');
      await leitura('criação sob outro tenant', humanoCriando(u.deB, c.empresaA1, { 'app.tenant_id': c.tenantB }), 'invisivel');
      await leitura(
        'job técnico não herda a marca de criação',
        { tipo: 'bruto', parametros: { 'app.tenant_id': c.tenantA, 'app.origem': 'TECNICA', 'app.empresa_id': c.empresaA2, 'app.finalidade': 'PROCESSAMENTO_DE_EMPRESA', 'app.identidade_tecnica': 'x', 'app.correlation_id': 'y', 'app.empresa_em_criacao': c.empresaA1 } },
        'invisivel',
      );

      await insercao('na carteira (controle positivo)', humano(u.naCarteira), 'inserido');
      await insercao('criador sem vínculo na empresa que está criando', humanoCriando(u.fora, c.empresaA1), 'inserido');
      await insercao('criação de outra empresa não abre esta', humanoCriando(u.fora, c.empresaA2), 'rejeitado_por_rls');
      await insercao('fora da carteira', humano(u.fora), 'rejeitado_por_rls');
      await insercao('usuário suspenso', humano(u.suspenso), 'rejeitado_por_rls');
      await insercao('outro tenant gravando no tenant A', humano(u.deB, 'COMUM', c.tenantB), 'rejeitado_por_rls');
      await insercao('tenant do contexto B, linha do tenant A', humano(u.naCarteira, 'COMUM', c.tenantB), 'rejeitado_por_rls');
      await insercao('finalidade administrativa', humano(u.naCarteira, 'ADMIN_ACESSO'), 'rejeitado_por_rls');
      await insercao('sem contexto', nenhum, 'rejeitado_por_rls');
      await insercao('job técnico na empresa do trabalho', tecnico(c.empresaA1), 'inserido');
      await insercao('job técnico gravando em outra empresa', tecnico(c.empresaA2), 'rejeitado_por_rls');
      for (const [nome, ator] of adulterados) {
        await insercao(`contexto adulterado: ${nome}`, ator, 'rejeitado_por_rls');
      }

      const negadoSemUpdate: Resultado = 'negado_por_privilegio';
      await alteracao('na carteira (controle positivo)', humano(u.naCarteira), temUpdate ? 'atualizado' : negadoSemUpdate);
      await alteracao('fora da carteira', humano(u.fora), temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao('usuário suspenso', humano(u.suspenso), temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao('outro tenant', humano(u.deB, 'COMUM', c.tenantB), temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao('administrador sem vínculo, empresa ativa', humano(u.admin), temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao('finalidade administrativa', humano(u.naCarteira, 'ADMIN_ACESSO'), temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao('sem contexto', nenhum, temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao('job técnico em outra empresa', tecnico(c.empresaA2), temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao(
        'mover a linha para outra empresa da própria carteira',
        humano(u.duasEmpresas),
        temUpdate ? moverEmpresa : negadoSemUpdate,
        linhaA1,
        `empresa_id = '${c.empresaA2}'`,
      );
      await alteracao(
        'mover a linha para outro tenant',
        humano(u.naCarteira),
        temUpdate ? moverTenant : negadoSemUpdate,
        linhaA1,
        `tenant_id = '${c.tenantB}'`,
      );
    }

    if (classe === 'vinculo') {
      const donoSuspenso = c.vinculos.suspensoA1;
      await leitura('o próprio vínculo (controle positivo)', humano(u.naCarteira), 'visivel');
      await leitura('vínculo alheio na finalidade comum', humano(u.fora), 'invisivel');
      await leitura('vínculo do usuário suspenso', humano(u.suspenso), 'invisivel', donoSuspenso);
      await leitura('gestão de acesso lê todos do tenant', humano(u.admin, 'ADMIN_ACESSO'), 'visivel');
      await leitura('gestão de acesso de outro tenant', humano(u.deB, 'ADMIN_ACESSO', c.tenantB), 'invisivel');
      await leitura('outro tenant na finalidade comum', humano(u.deB, 'COMUM', c.tenantB), 'invisivel');
      await leitura('sem contexto', nenhum, 'invisivel');
      await leitura('job técnico não lê carteira', tecnico(c.empresaA1), 'invisivel');
      for (const [nome, ator] of adulterados) {
        await leitura(`contexto adulterado: ${nome}`, ator, 'invisivel');
      }

      await insercao('gestão de acesso (controle positivo)', humano(u.admin, 'ADMIN_ACESSO'), 'inserido');
      await insercao('finalidade comum não atribui carteira', humano(u.naCarteira), 'rejeitado_por_rls');
      await insercao('outro tenant na gestão de acesso', humano(u.deB, 'ADMIN_ACESSO', c.tenantB), 'rejeitado_por_rls');
      await insercao('localização básica não atribui carteira', humano(u.admin, 'LOCALIZACAO_BASICA_EMPRESA'), 'rejeitado_por_rls');
      await insercao('sem contexto', nenhum, 'rejeitado_por_rls');
      await insercao('job técnico', tecnico(c.empresaA1), 'rejeitado_por_rls');
      for (const [nome, ator] of adulterados) {
        await insercao(`contexto adulterado: ${nome}`, ator, 'rejeitado_por_rls');
      }

      await alteracao('gestão de acesso (controle positivo)', humano(u.admin, 'ADMIN_ACESSO'), 'atualizado');
      await alteracao('finalidade comum', humano(u.naCarteira), 'nenhuma_linha_alterada');
      await alteracao('outro tenant na gestão de acesso', humano(u.deB, 'ADMIN_ACESSO', c.tenantB), 'nenhuma_linha_alterada');
      await alteracao('sem contexto', nenhum, 'nenhuma_linha_alterada');
      await alteracao(
        'mover o vínculo para outra empresa',
        humano(u.admin, 'ADMIN_ACESSO'),
        'rejeitado_por_escopo_imutavel',
        linhaA1,
        `empresa_id = '${c.empresaA2}'`,
      );
    }

    if (classe === 'tenant') {
      await leitura('mesmo tenant (controle positivo)', humano(u.naCarteira), 'visivel');
      await leitura('outro tenant', humano(u.deB, 'COMUM', c.tenantB), 'invisivel');
      await leitura('sem contexto', nenhum, 'invisivel');
      await leitura('job técnico não lê gestão do escritório', tecnico(c.empresaA1), 'invisivel');
      for (const [nome, ator] of adulterados) {
        await leitura(`contexto adulterado: ${nome}`, ator, 'invisivel');
      }

      await insercao('mesmo tenant (controle positivo)', humano(u.naCarteira), 'inserido');
      await insercao('outro tenant gravando no tenant A', humano(u.deB, 'COMUM', c.tenantB), 'rejeitado_por_rls');
      await insercao('sem contexto', nenhum, 'rejeitado_por_rls');
      await insercao('job técnico', tecnico(c.empresaA1), 'rejeitado_por_rls');
      for (const [nome, ator] of adulterados) {
        await insercao(`contexto adulterado: ${nome}`, ator, 'rejeitado_por_rls');
      }

      const negadoSemUpdate: Resultado = 'negado_por_privilegio';
      await alteracao('mesmo tenant (controle positivo)', humano(u.naCarteira), temUpdate ? 'atualizado' : negadoSemUpdate);
      await alteracao('outro tenant', humano(u.deB, 'COMUM', c.tenantB), temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao('sem contexto', nenhum, temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao('job técnico', tecnico(c.empresaA1), temUpdate ? 'nenhuma_linha_alterada' : negadoSemUpdate);
      await alteracao(
        'mover a linha para outro tenant',
        humano(u.naCarteira),
        temUpdate ? moverTenant : negadoSemUpdate,
        linhaA1,
        `tenant_id = '${c.tenantB}'`,
      );
    }

    if (classe === 'raiz_tenant') {
      await leitura('o próprio escritório (controle positivo)', humano(u.naCarteira), 'visivel');
      await leitura('outro tenant', humano(u.deB, 'COMUM', c.tenantB), 'invisivel');
      await leitura('sem contexto', nenhum, 'invisivel');
      for (const [nome, ator] of adulterados) {
        await leitura(`contexto adulterado: ${nome}`, ator, 'invisivel');
      }

      await insercao('escritório novo pela aplicação', humano(u.naCarteira), 'rejeitado_por_rls');
      await insercao('sem contexto', nenhum, 'rejeitado_por_rls');

      await alteracao('o próprio escritório (controle positivo)', humano(u.naCarteira), 'atualizado');
      await alteracao('outro tenant', humano(u.deB, 'COMUM', c.tenantB), 'nenhuma_linha_alterada');
      await alteracao('sem contexto', nenhum, 'nenhuma_linha_alterada');
    }

    if (classe === 'raiz_empresa') {
      const arquivada = c.empresaA3Arquivada;
      await leitura('na carteira (controle positivo)', humano(u.naCarteira), 'visivel');
      await leitura('fora da carteira', humano(u.fora), 'invisivel');
      await leitura('usuário suspenso', humano(u.suspenso), 'invisivel');
      await leitura('outro tenant', humano(u.deB, 'COMUM', c.tenantB), 'invisivel');
      await leitura('administrador sem vínculo, empresa ativa', humano(u.admin), 'invisivel');
      await leitura('administrador alcança empresa arquivada', humano(u.admin), 'visivel', arquivada);
      await leitura('colaborador comum não alcança empresa arquivada', humano(u.fora), 'invisivel', arquivada);
      await leitura('gestão de acesso lê o cadastro básico', humano(u.admin, 'ADMIN_ACESSO'), 'visivel');
      await leitura('localização básica lê o cadastro básico', humano(u.fora, 'LOCALIZACAO_BASICA_EMPRESA'), 'visivel');
      await leitura('gestão de acesso de outro tenant', humano(u.deB, 'ADMIN_ACESSO', c.tenantB), 'invisivel');
      await leitura('sem contexto', nenhum, 'invisivel');
      await leitura('job técnico na empresa do trabalho', tecnico(c.empresaA1), 'visivel');
      await leitura('job técnico em outra empresa', tecnico(c.empresaA2), 'invisivel');
      await leitura('criador sem vínculo na empresa que está criando', humanoCriando(u.fora, c.empresaA1), 'visivel');
      await leitura('criação de outra empresa não abre esta', humanoCriando(u.fora, c.empresaA2), 'invisivel');
      for (const [nome, ator] of adulterados) {
        await leitura(`contexto adulterado: ${nome}`, ator, 'invisivel');
      }

      await insercao('gestão de acesso cria empresa (controle positivo)', humano(u.admin, 'ADMIN_ACESSO'), 'inserido');
      await insercao('finalidade comum não cria empresa', humano(u.naCarteira), 'rejeitado_por_rls');
      await insercao('localização básica não cria empresa', humano(u.admin, 'LOCALIZACAO_BASICA_EMPRESA'), 'rejeitado_por_rls');
      await insercao('outro tenant na gestão de acesso', humano(u.deB, 'ADMIN_ACESSO', c.tenantB), 'rejeitado_por_rls');
      await insercao('sem contexto', nenhum, 'rejeitado_por_rls');
      await insercao('job técnico', tecnico(c.empresaA1), 'rejeitado_por_rls');

      await alteracao('na carteira (controle positivo)', humano(u.naCarteira), 'atualizado');
      await alteracao('fora da carteira', humano(u.fora), 'nenhuma_linha_alterada');
      await alteracao('usuário suspenso', humano(u.suspenso), 'nenhuma_linha_alterada');
      await alteracao('outro tenant', humano(u.deB, 'COMUM', c.tenantB), 'nenhuma_linha_alterada');
      await alteracao('administrador sem vínculo, empresa ativa', humano(u.admin), 'nenhuma_linha_alterada');
      await alteracao('administrador reativa empresa arquivada', humano(u.admin), 'atualizado', arquivada);
      await alteracao('criador sem vínculo completa a empresa que está criando', humanoCriando(u.fora, c.empresaA1), 'atualizado');
      await alteracao('criação de outra empresa não abre esta', humanoCriando(u.fora, c.empresaA2), 'nenhuma_linha_alterada');
      await alteracao('gestão de acesso trava mas não altera', humano(u.admin, 'ADMIN_ACESSO'), 'rejeitado_por_rls');
      await alteracao('sem contexto', nenhum, 'nenhuma_linha_alterada');
      await alteracao('job técnico em outra empresa', tecnico(c.empresaA2), 'nenhuma_linha_alterada');
    }

    // -- DELETE: a aplicação não tem o privilégio em tabela alguma (I-7) ------------

    await tentar(app, humano(u.naCarteira), apagar(tabela, linhaA1)).then((obtido) =>
      registrar(tabela, classe, 'o papel da aplicação não apaga', 'DELETE', 'negado_por_privilegio', obtido),
    );
    await tentar(app, humano(u.admin, 'ADMIN_ACESSO'), apagar(tabela, linhaA1)).then((obtido) =>
      registrar(tabela, classe, 'nem na finalidade administrativa', 'DELETE', 'negado_por_privilegio', obtido),
    );
  }

  return resultados;
};
