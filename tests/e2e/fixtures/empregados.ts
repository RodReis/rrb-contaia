/**
 * Apoio da prova E2E da SPEC-014 (importação de empregados por CSV). A mecânica de API, fila,
 * armazenamento, provas visuais e axe é a mesma da SPEC-013 e vem de `./plano-contas`, parametrizada
 * pelo domínio; aqui fica só o que é de empregados: arquivos, base, mapeamento, aba e papel
 * personalizado.
 *
 * Os CSVs pequenos ficam versionados em `tests/e2e/fixtures/empregados*.csv` com os bytes exatos (BOM,
 * CRLF, Latin-1; ver `.gitattributes`). Os grandes (acima de 10 MB e de 10.000 linhas) e o ZIP com
 * extensão `.csv` são gerados na execução, numa pasta temporária, e nunca entram no repositório.
 */
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';

import {
  PASTA_DAS_FIXTURES,
  destinatariosDaNotificacao,
  enviarPelaApi,
  esperarEstado,
  eventosDa,
  notificacoesDoUsuario,
  tentativa,
  tentativasDa,
  validarPelaTela,
  type Evento,
  type Resposta,
  type Tentativa,
} from './plano-contas';

// -- Arquivos ------------------------------------------------------------------------------------

export type NomeDaFixtureDeEmpregados =
  | 'empregados-legado.csv'
  | 'empregados-bom.csv'
  | 'empregados-sem-linhas-validas.csv'
  | 'empregados-so-cabecalho.csv'
  | 'empregados-cabecalho-invalido.csv';

export const caminhoDe = (nome: NomeDaFixtureDeEmpregados): string => join(PASTA_DAS_FIXTURES, nome);
export const bytesDe = (nome: NomeDaFixtureDeEmpregados): Buffer => readFileSync(caminhoDe(nome));

/** Mapeamento do modelo do ContaIA: o nome de cada campo é o da própria coluna. */
export const MAPEAMENTO_DO_MODELO = {
  cpf: 'cpf',
  nome: 'nome',
  matricula: 'matricula',
  data_nascimento: 'data_nascimento',
  data_admissao: 'data_admissao',
} as const;

/** Mapeamento do CSV legado (cabeçalho do ERP, em Latin-1). */
export const MAPEAMENTO_DO_LEGADO = {
  cpf: 'CPF',
  nome: 'Nome Funcionário',
  matricula: 'Matr.',
  data_nascimento: 'Dt Nascimento',
  data_admissao: 'Dt Admissão',
} as const;

const CABECALHO_DO_MODELO = 'cpf;nome;matricula;data_nascimento;data_admissao';
const LIMITE_EM_BYTES = 10 * 1024 * 1024;
const LIMITE_DE_LINHAS = 10_000;

export type ArquivosGeradosDeEmpregados = Readonly<{
  pasta: string;
  /** Acima de 10 MB (e com menos de 10.000 linhas): a recusa é pelo tamanho. */
  acimaDoTamanho: string;
  /** 10.001 linhas de dados em poucas centenas de KB: a recusa é pela quantidade. */
  acimaDasLinhas: string;
  /** Um ZIP de verdade com extensão `.csv`: conteúdo que não é CSV. */
  zipComExtensaoCsv: string;
  /** O arquivo bom com um empregado a mais: outro hash, para o conflito concorrente. */
  variante: string;
}>;

export const gerarArquivosDeEmpregados = (): ArquivosGeradosDeEmpregados => {
  const pasta = mkdtempSync(join(tmpdir(), 'e2e-f14-'));
  const nomeLongo = 'Empregado com nome propositalmente longo '.repeat(30);
  const linhasGrandes: string[] = [CABECALHO_DO_MODELO];
  let bytes = CABECALHO_DO_MODELO.length + 2;

  for (let indice = 1; bytes <= LIMITE_EM_BYTES + 64 * 1024; indice += 1) {
    const linha = `529.982.247-25;${nomeLongo}${indice};${indice};15/03/1990;01/02/2015`;

    linhasGrandes.push(linha);
    bytes += linha.length + 2;
  }
  const acimaDoTamanho = join(pasta, 'empregados-acima-de-10mb.csv');
  writeFileSync(acimaDoTamanho, `${linhasGrandes.join('\r\n')}\r\n`, 'utf8');

  const linhasDemais = [CABECALHO_DO_MODELO];
  for (let indice = 1; indice <= LIMITE_DE_LINHAS + 1; indice += 1) {
    linhasDemais.push(`529.982.247-25;Empregado ${indice};${indice};15/03/1990;01/02/2015`);
  }
  const acimaDasLinhas = join(pasta, 'empregados-10001-linhas.csv');
  writeFileSync(acimaDasLinhas, `${linhasDemais.join('\r\n')}\r\n`, 'utf8');

  // Cabeçalho local de um ZIP (PK\x03\x04) com um nome de entrada e bytes binários: o que um
  // usuário manda ao renomear `empregados.zip` para `.csv`.
  const zipComExtensaoCsv = join(pasta, 'empregados-zip.csv');
  writeFileSync(
    zipComExtensaoCsv,
    Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]),
      Buffer.from('empregados.csv', 'latin1'),
      Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x10, 0x1f, 0x7f, 0x80, 0x9c]),
    ]),
  );

  const variante = join(pasta, 'empregados-variante.csv');
  writeFileSync(
    variante,
    Buffer.concat([bytesDe('empregados-bom.csv'), Buffer.from('153.153.153-98;Nina Concorrente;00013;09/09/1993;02/02/2022\r\n', 'utf8')]),
  );

  return { pasta, acimaDoTamanho, acimaDasLinhas, zipComExtensaoCsv, variante };
};

// -- API -----------------------------------------------------------------------------------------

export const enviarEmpregadosPelaApi = (
  page: Page,
  empresaId: string,
  arquivo: Readonly<{ nome: string; conteudo: Buffer }>,
  mapeamento: Readonly<Record<string, string>> = MAPEAMENTO_DO_MODELO,
  correlationId: string = randomUUID(),
): Promise<Resposta> => enviarPelaApi(page, empresaId, arquivo, mapeamento, correlationId, 'empregados');

// -- Banco ---------------------------------------------------------------------------------------

const TABELA = 'importacao_empregados';

export const tentativaDeEmpregados = (pool: Pool, id: string): Promise<Tentativa | undefined> => tentativa(pool, id, TABELA);
export const tentativasDeEmpregadosDa = (pool: Pool, empresaId: string): Promise<Tentativa[]> =>
  tentativasDa(pool, empresaId, TABELA);
export const eventosDaTentativa = (pool: Pool, id: string): Promise<Evento[]> => eventosDa(pool, id, TABELA);
export const destinatariosDosEmpregados = (pool: Pool, id: string): Promise<string[]> =>
  destinatariosDaNotificacao(pool, id, TABELA);
export const avisosDeEmpregadosDo = (pool: Pool, usuarioId: string): Promise<number> =>
  notificacoesDoUsuario(pool, usuarioId, TABELA);
export const esperarEstadoDosEmpregados = (pool: Pool, id: string, estado: string, timeout = 90_000): Promise<void> =>
  esperarEstado(pool, id, estado, timeout, TABELA);

export type Empregado = Readonly<{
  cpf: string;
  nome: string;
  matricula: string;
  data_nascimento: string;
  data_admissao: string;
  arquivado: boolean;
  versao: string;
  atualizado_em: string;
}>;

/** Base vigente indexada pela chave natural `cpf|matrícula`. */
export const empregadosDa = async (pool: Pool, empresaId: string): Promise<Map<string, Empregado>> => {
  const { rows } = await pool.query<Empregado>(
    `select cpf, nome, matricula, data_nascimento::text as data_nascimento, data_admissao::text as data_admissao,
            arquivado, versao::text as versao, atualizado_em::text as atualizado_em
       from app.empregado where empresa_id = $1 order by cpf, matricula`,
    [empresaId],
  );

  return new Map(rows.map((empregado) => [`${empregado.cpf}|${empregado.matricula}`, empregado]));
};

/** Empregado gravado direto no banco: é a base vigente que a importação encontra. */
export const semearEmpregados = async (
  pool: Pool,
  tenantId: string,
  empresaId: string,
  empregados: ReadonlyArray<
    readonly [cpf: string, nome: string, matricula: string, nascimento: string, admissao: string, arquivado?: boolean]
  >,
): Promise<void> => {
  for (const [cpf, nome, matricula, nascimento, admissao, arquivado] of empregados) {
    await pool.query(
      `insert into app.empregado
         (tenant_id, empresa_id, cpf, nome, matricula, data_nascimento, data_admissao, arquivado, arquivado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8 then now() end)`,
      [tenantId, empresaId, cpf, nome, matricula, nascimento, admissao, arquivado === true],
    );
  }
};

export const pendenciaDosEmpregados = async (pool: Pool, empresaId: string): Promise<string[]> =>
  (
    await pool.query<{ estado: string }>(
      `select estado from app.empresa_pendencia
        where empresa_id = $1 and origem = 'EMPREGADOS' order by criado_em`,
      [empresaId],
    )
  ).rows.map((linha) => linha.estado);

/**
 * Papel personalizado com as quatro ações de Empresas → Empregados (o `dp` do MVP-3 ainda não existe
 * como papel padrão: SPEC-014 §3.12 e a decisão registrada no Card #16), mais a consulta do
 * cadastro da empresa, para a pessoa chegar à página da empresa. Atribuído ao usuário.
 */
export const atribuirPapelDeDepartamentoPessoal = async (
  pool: Pool,
  tenantId: string,
  usuarioId: string,
): Promise<void> => {
  const cliente = await pool.connect();

  try {
    await cliente.query('begin');
    await cliente.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const papelId =
      (
        await cliente.query<{ id: string }>(
          `insert into app.papel_personalizado (tenant_id, nome, papel_base)
           values ($1, 'Departamento Pessoal E2E', 'auxiliar') returning id`,
          [tenantId],
        )
      ).rows[0]?.id ?? '';

    await cliente.query(
      `insert into app.papel_personalizado_revisao (tenant_id, papel_id, revisao, permissoes)
       values ($1, $2, 1, $3)`,
      [
        tenantId,
        papelId,
        [
          'empresas.cadastro.consultar',
          'empresas.empregados.consultar',
          'empresas.empregados.importar',
          'empresas.empregados.confirmar_importacao',
          'empresas.empregados.baixar_relatorio',
        ],
      ],
    );
    await cliente.query(
      `insert into app.usuario_papel_personalizado (tenant_id, usuario_id, papel_id) values ($1, $2, $3)`,
      [tenantId, usuarioId, papelId],
    );
    await cliente.query('commit');
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }
};

// -- Tela ----------------------------------------------------------------------------------------

export const ROTULO_DO_ARQUIVO = 'Arquivo CSV dos empregados';

export const abrirAbaDeEmpregados = async (page: Page, empresaId: string, consulta = ''): Promise<void> => {
  await page.goto(`/empresas/${empresaId}?aba=empregados${consulta}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Empregados' })).toBeVisible({ timeout: 30_000 });
};

export const validarEmpregadosPelaTela = (page: Page): Promise<Readonly<{ tentativaId: string; correlationId: string }>> =>
  validarPelaTela(page, 'empregados');
