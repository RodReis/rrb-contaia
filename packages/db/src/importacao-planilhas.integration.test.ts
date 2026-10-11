/**
 * Planilhas XLSX/ODS na tentativa de importação (SPEC-015 §3.8, §3.9, §6.3; migration 0018).
 *
 * Os dois domínios (plano de contas e empregados) ganham formato, aba, linha de cabeçalho e o
 * resultado da leitura (linhas ignoradas, ocultas, diagnósticos). Aqui ficam provados: a identidade
 * idempotente com a configuração (e o FIX #107 intacto para planilha), os CHECKs, a imutabilidade
 * da configuração depois de RECEBIDA, a gravação da leitura só em RECEBIDA|VALIDANDO, as ações
 * novas da trilha, o histórico e a migration sobre um banco da 0017 com dados.
 *
 * As suítes de banco rodam em paralelo no mesmo banco: cada teste usa empresa e hash próprios; o
 * teste da migration roda numa transação revertida, com as tabelas travadas.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { CODIGOS_DE_ERRO, contextoTecnico } from '@contaia/domain';
import type { LinhaDeStagingDeEmpregado } from '@contaia/domain';
import { HistoricoDeImportacoesSchema } from '@contaia/shared';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto } from './contexto.js';
import { gravarResultadoDaValidacaoDeEmpregados } from './repositorios/empregados.js';
import { listarHistorico } from './repositorios/importacao-ciclo-consultas.js';
import {
  DESCRITOR_EMPREGADOS,
  DESCRITOR_PLANO_CONTAS,
  buscarTentativa,
  criarTentativa,
  iniciarValidacao,
  registrarEvento,
  registrarLeituraDaPlanilha,
  type DescritorDaImportacao,
  type NovaTentativa,
} from './repositorios/importacao-ciclo.js';
import { gravarResultadoDaValidacao as gravarResultadoDoPlano } from './repositorios/plano-contas.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';
import { comoUsuario } from './testes/suporte.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();

let c: Cenario;
let usuario: string;

type Executar<T> = (cliente: PoolClient) => Promise<T>;

const como = <T>(executar: Executar<T>): Promise<T> => comoUsuario(app, c.tenantA, usuario, executar);

const comoWorker = <T>(empresaId: string, executar: Executar<T>): Promise<T> =>
  comContexto(
    app,
    contextoTecnico({
      identidadeTecnica: 'workers-planilhas',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: c.tenantA,
      empresaId,
      correlationId: 'teste-planilhas',
    }),
    executar,
  );

const erroDe = async (executar: () => Promise<unknown>): Promise<string> => {
  try {
    await executar();

    return 'nao_lancou';
  } catch (erro) {
    const comCodigo = erro as { codigo?: string; code?: string; message?: string };

    return comCodigo.codigo ?? comCodigo.code ?? String(comCodigo.message);
  }
};

let instante = Date.parse('2026-10-11T15:00:00.000Z');
const agora = (): Date => new Date((instante += 1000));
const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

let empresas = 0;

/** Empresa nova do tenant A, na carteira do usuário: versão do agregado e histórico isolados. */
const novaEmpresa = async (): Promise<string> => {
  empresas += 1;
  const cnpj = `H${String(empresas).padStart(3, '0')}${c.sufixo}`.slice(0, 14);
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao)
     values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
    [c.tenantA, cnpj, `Empresa planilhas ${cnpj}`],
  );
  const empresaId = rows[0]!.id;
  await admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
    c.tenantA,
    usuario,
    empresaId,
  ]);

  return empresaId;
};

type Dominio = Readonly<{
  nome: string;
  d: DescritorDaImportacao;
  mapeamento: Record<string, string>;
  /** Valida a tentativa com uma única linha rejeitada: termina REJEITADA na versão atual. */
  rejeitarTudo: (cliente: PoolClient, empresaId: string, tentativaId: string, versao: number) => Promise<unknown>;
}>;

const LINHA_DE_EMPREGADO_REJEITADA: LinhaDeStagingDeEmpregado = {
  numeroDaLinha: 3,
  cpf: null,
  cpfNormalizado: null,
  nome: null,
  matricula: null,
  dataNascimento: null,
  dataAdmissao: null,
  chave: null,
  status: 'REJEITADA',
  acao: null,
  codigoDeErro: 'CELULA_MESCLADA',
  campo: 'cpf',
  mensagem: 'Célula mesclada na coluna mapeada.',
};

const DOMINIOS: readonly Dominio[] = [
  {
    nome: 'plano de contas',
    d: DESCRITOR_PLANO_CONTAS,
    mapeamento: { codigo: 'A', nome: 'B', tipo: 'C', natureza: 'D', contaPai: 'E' },
    rejeitarTudo: (cli, empresaId, tentativaId, versao) =>
      gravarResultadoDoPlano(
        cli,
        empresaId,
        tentativaId,
        [
          {
            status: 'REJEITADA',
            numeroDaLinha: 3,
            codigo: null,
            nome: null,
            tipo: null,
            natureza: null,
            contaPai: null,
            codigoDeErro: 'CELULA_COM_FORMULA',
            campo: 'codigo',
            mensagem: 'Fórmula na coluna mapeada.',
          },
        ],
        versao,
        agora(),
      ),
  },
  {
    nome: 'empregados',
    d: DESCRITOR_EMPREGADOS,
    mapeamento: { cpf: 'A', nome: 'B', matricula: 'C', data_nascimento: 'D', data_admissao: 'E' },
    rejeitarTudo: (cli, empresaId, tentativaId, versao) =>
      gravarResultadoDaValidacaoDeEmpregados(cli, empresaId, tentativaId, [LINHA_DE_EMPREGADO_REJEITADA], versao, agora()),
  },
];

type Configuracao = Readonly<{
  formato?: 'CSV' | 'XLSX' | 'ODS';
  abaNome?: string | null;
  abaPosicao?: number;
  linhaCabecalho?: number;
}>;

const nova = (
  dominio: Dominio,
  empresaId: string,
  hash: string,
  configuracao: Configuracao = {},
  mapeamento: Record<string, string> = dominio.mapeamento,
): NovaTentativa => ({
  tenantId: c.tenantA,
  empresaId,
  hashArquivo: hash,
  mapeamento,
  arquivoNome: configuracao.formato === undefined || configuracao.formato === 'CSV' ? 'dados.csv' : 'dados.xlsx',
  arquivoTamanho: 4096,
  arquivoChave: `${c.tenantA}/${empresaId}/planilhas/${randomUUID()}`,
  usuarioIniciadorId: usuario,
  correlationId: 'teste-planilhas',
  agora: agora(),
  ...configuracao,
});

const XLSX_ABA_2: Configuracao = { formato: 'XLSX', abaNome: 'Contas', abaPosicao: 2, linhaCabecalho: 3 };

/** Insere direto (admin), para provar CHECKs e triggers sem passar pelo repositório. */
const inserirCru = async (d: DescritorDaImportacao, empresaId: string, colunas: Record<string, unknown> = {}): Promise<string> => {
  const base: Record<string, unknown> = {
    tenant_id: c.tenantA,
    empresa_id: empresaId,
    hash_arquivo: hex64(),
    mapeamento: '{}',
    arquivo_nome: 'dados.xlsx',
    arquivo_tamanho: 10,
    arquivo_chave: `${c.tenantA}/${empresaId}/cru/${randomUUID()}`,
    usuario_iniciador_id: usuario,
    correlation_id: 'teste-planilhas',
    ...colunas,
  };
  const nomes = Object.keys(base);
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.${d.tabela} (${nomes.join(', ')})
     values (${nomes.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(base),
  );

  return rows[0]!.id;
};

const levarPara = async (d: DescritorDaImportacao, id: string, estado: string): Promise<void> => {
  const terminal = ['CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'].includes(estado);
  await admin.query(
    `update app.${d.tabela}
        set estado = $2, finalizado_em = case when $3 then now() end,
            usuario_cancelador_id = case when $2 = 'CANCELADA' then usuario_iniciador_id end
      where id = $1`,
    [id, estado, terminal],
  );
};

const DIAGNOSTICOS = [
  { codigo: 'LINHAS_OCULTAS_PROCESSADAS', mensagem: 'Linhas ocultas foram processadas.', quantidade: 2 },
  { codigo: 'LINHAS_COM_FORMULA_REJEITADAS', mensagem: 'Linhas com fórmula foram rejeitadas.', quantidade: 1 },
] as const;

beforeAll(async () => {
  c = await montarCenario(admin);
  usuario = c.usuarios.naCarteira;
}, 60_000);

afterAll(async () => {
  await limparCenario(admin, c);
  await Promise.all([admin.end(), app.end()]);
});

// Primeiro do arquivo: nada desta suíte foi gravado ainda (ver a limpeza das planilhas abaixo).
//
// Janela de lock: o rollback e a reaplicação da 0018 são DDL (ACCESS EXCLUSIVE) dentro de uma
// transação aberta, enquanto os outros arquivos de `test:banco` rodam em paralelo no mesmo banco. As
// quatro tabelas que a 0018 altera são travadas logo no `begin`, todas de uma vez e antes de qualquer
// outra: quem chega depois só ESPERA o rollback (dezenas de ms), sem deadlock nem leitura do esquema
// sem as colunas — a transação nunca confirma. Rodar este arquivo isolado exigiria `projects` com
// `groupOrder` no `criarConfigVitest` compartilhado (e não isolaria das suítes de banco de api e
// workers, que podem rodar ao mesmo tempo); a trava explícita já cobre os dois casos.
describe('migration 0018 sobre um banco da 0017 com dados', () => {
  it('aplica, reverte pelo plano de rollback e reaplica; tentativas antigas leem como CSV', async () => {
    const sql = await readFile(new URL('../migrations/0018_importacao_planilhas.sql', import.meta.url), 'utf8');
    const rollback = /-- ROLLBACK:INICIO\r?\n([\s\S]*?)-- ROLLBACK:FIM/u.exec(sql)?.[1]?.replace(/^-- ?/gmu, '');
    expect(rollback).toBeDefined();

    const empresaId = await novaEmpresa();
    const cliente = await admin.connect();

    try {
      await cliente.query('begin');
      await cliente.query(
        `lock table app.importacao_plano_contas, app.importacao_empregados,
                    app.importacao_plano_contas_evento, app.importacao_empregados_evento in access exclusive mode`,
      );
      // Um banco da 0017 não tem tentativa de planilha: as de outras rodadas saem (só nesta transação).
      await cliente.query(`set local session_replication_role = replica`);
      await cliente.query(`delete from app.importacao_plano_contas where formato <> 'CSV'`);
      await cliente.query(`delete from app.importacao_empregados where formato <> 'CSV'`);
      await cliente.query(`set local session_replication_role = origin`);

      await cliente.query(rollback!);
      const semColunas = await cliente.query(
        `select 1 from information_schema.columns
          where table_schema = 'app' and table_name in ('importacao_plano_contas', 'importacao_empregados')
            and column_name in ('formato', 'aba_nome', 'aba_posicao', 'linha_cabecalho',
                                'linhas_ignoradas_antes_do_cabecalho', 'linhas_ocultas', 'diagnosticos')`,
      );
      expect(semColunas.rowCount).toBe(0);

      const ids: string[] = [];
      for (const { d, mapeamento } of DOMINIOS) {
        const { rows } = await cliente.query<{ id: string }>(
          `insert into app.${d.tabela}
             (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
              usuario_iniciador_id, correlation_id)
           values ($1, $2, $3, $4::jsonb, 'antigo.csv', 10, 'chave', $5, 'teste-planilhas') returning id`,
          [c.tenantA, empresaId, hex64(), JSON.stringify(mapeamento), usuario],
        );
        ids.push(rows[0]!.id);
      }

      await cliente.query(sql);

      for (const [i, { d }] of DOMINIOS.entries()) {
        const { rows } = await cliente.query(
          `select formato, aba_nome, aba_posicao, linha_cabecalho, linhas_ignoradas_antes_do_cabecalho,
                  linhas_ocultas, diagnosticos
             from app.${d.tabela} where id = $1`,
          [ids[i]],
        );
        expect(rows).toEqual([
          {
            formato: 'CSV',
            aba_nome: null,
            aba_posicao: 0,
            linha_cabecalho: 1,
            linhas_ignoradas_antes_do_cabecalho: 0,
            linhas_ocultas: 0,
            diagnosticos: [],
          },
        ]);
      }
    } finally {
      await cliente.query('rollback');
      cliente.release();
    }
  });
});

describe.each(DOMINIOS)('$nome: colunas, CHECKs e triggers (0018)', ({ d }) => {
  it('tentativa gravada sem as colunas novas é CSV, sem aba, cabeçalho 1 e leitura zerada', async () => {
    const empresaId = await novaEmpresa();
    const id = await inserirCru(d, empresaId, { arquivo_nome: 'dados.csv' });
    const { rows } = await admin.query(
      `select formato, aba_nome, aba_posicao, linha_cabecalho, linhas_ignoradas_antes_do_cabecalho,
              linhas_ocultas, diagnosticos from app.${d.tabela} where id = $1`,
      [id],
    );

    expect(rows[0]).toEqual({
      formato: 'CSV',
      aba_nome: null,
      aba_posicao: 0,
      linha_cabecalho: 1,
      linhas_ignoradas_antes_do_cabecalho: 0,
      linhas_ocultas: 0,
      diagnosticos: [],
    });
  });

  it('recusa configuração incoerente (23514) e aceita planilha com aba', async () => {
    const empresaId = await novaEmpresa();
    const tentar = (colunas: Record<string, unknown>) => erroDe(() => inserirCru(d, empresaId, colunas));

    expect(await tentar({ formato: 'XLS' })).toBe('23514');
    expect(await tentar({ formato: 'CSV', aba_nome: 'Plan1' })).toBe('23514');
    expect(await tentar({ formato: 'CSV', aba_posicao: 1 })).toBe('23514');
    expect(await tentar({ formato: 'XLSX' })).toBe('23514');
    expect(await tentar({ formato: 'ODS', aba_posicao: 1 })).toBe('23514');
    expect(await tentar({ formato: 'XLSX', aba_nome: 'Plan1', aba_posicao: 0 })).toBe('23514');
    expect(await tentar({ formato: 'XLSX', aba_nome: 'Plan1', aba_posicao: -1 })).toBe('23514');
    expect(await tentar({ formato: 'XLSX', aba_nome: 'Plan1', aba_posicao: 1, linha_cabecalho: 0 })).toBe('23514');
    expect(await tentar({ formato: 'CSV', linha_cabecalho: 0 })).toBe('23514');
    expect(await tentar({ diagnosticos: '{}' })).toBe('23514');
    expect(await tentar({ formato: 'CSV', linhas_ocultas: -1 })).toBe('23514');
    expect(await tentar({ formato: 'CSV', linhas_ignoradas_antes_do_cabecalho: -1 })).toBe('23514');
    expect(await tentar({ formato: 'ODS', aba_nome: 'Plan1', aba_posicao: 1, linha_cabecalho: 4 })).toBe('nao_lancou');

    // CSV não escolhe cabeçalho: outra linha abriria identidade separada para o mesmo arquivo.
    expect(await tentar({ formato: 'CSV', linha_cabecalho: 2 })).toBe('23514');
    expect(await tentar({ formato: 'XLSX', aba_nome: 'Plan1', aba_posicao: 1, linha_cabecalho: 7 })).toBe('nao_lancou');
    // Nome da aba no limite do contrato compartilhado (IdentificacaoDaAbaSchema: 1–255).
    expect(await tentar({ formato: 'XLSX', aba_nome: '', aba_posicao: 1 })).toBe('23514');
    expect(await tentar({ formato: 'ODS', aba_nome: 'a'.repeat(256), aba_posicao: 1 })).toBe('23514');
    expect(await tentar({ formato: 'ODS', aba_nome: 'a'.repeat(255), aba_posicao: 1 })).toBe('nao_lancou');
  });

  it('configuração só muda enquanto RECEBIDA; a aplicação nem tem o privilégio', async () => {
    const empresaId = await novaEmpresa();
    const id = await inserirCru(d, empresaId, { formato: 'XLSX', aba_nome: 'Plan1', aba_posicao: 1 });
    const trocar = (definicao: string) =>
      erroDe(() => admin.query(`update app.${d.tabela} set ${definicao} where id = $1`, [id]));

    expect(await trocar(`linha_cabecalho = 2`)).toBe('nao_lancou');
    expect(
      await erroDe(() =>
        como((cli) => cli.query(`update app.${d.tabela} set linha_cabecalho = 3 where id = $1`, [id])),
      ),
    ).toBe('42501');

    await levarPara(d, id, 'VALIDANDO');

    for (const definicao of [
      `formato = 'ODS'`,
      `aba_nome = 'Outra'`,
      `aba_posicao = 2`,
      `linha_cabecalho = 5`,
    ]) {
      expect(await trocar(definicao)).toBe('23001');
    }
  });

  it('leitura (ignoradas, ocultas, diagnósticos) muda em RECEBIDA e VALIDANDO; depois, congelada', async () => {
    const empresaId = await novaEmpresa();
    const gravar = (id: string, ocultas: number) =>
      erroDe(() =>
        como((cli) =>
          cli.query(
            `update app.${d.tabela}
                set linhas_ignoradas_antes_do_cabecalho = 1, linhas_ocultas = $2, diagnosticos = '[]'
              where id = $1`,
            [id, ocultas],
          ),
        ),
      );

    const recebida = await inserirCru(d, empresaId, { formato: 'XLSX', aba_nome: 'Plan1', aba_posicao: 1 });
    expect(await gravar(recebida, 1)).toBe('nao_lancou');
    await levarPara(d, recebida, 'VALIDANDO');
    expect(await gravar(recebida, 2)).toBe('nao_lancou');

    for (const estado of ['AGUARDANDO_CONFIRMACAO', 'REJEITADA', 'FALHA']) {
      const id = await inserirCru(d, empresaId, { formato: 'XLSX', aba_nome: 'Plan1', aba_posicao: 1 });
      await levarPara(d, id, estado);
      expect(
        await erroDe(() => admin.query(`update app.${d.tabela} set linhas_ocultas = 9 where id = $1`, [id])),
      ).toBe('23001');
    }
  });

  it('a aplicação atualiza a leitura, mas não a configuração', async () => {
    const { rows } = await admin.query<{ coluna: string }>(
      `select column_name as coluna from information_schema.column_privileges
        where table_schema = 'app' and table_name = $1 and grantee = 'contaia_app' and privilege_type = 'UPDATE'
          and column_name in ('formato', 'aba_nome', 'aba_posicao', 'linha_cabecalho',
                              'linhas_ignoradas_antes_do_cabecalho', 'linhas_ocultas', 'diagnosticos')
        order by 1`,
      [d.tabela],
    );

    expect(rows.map((linha) => linha.coluna)).toEqual(['diagnosticos', 'linhas_ignoradas_antes_do_cabecalho', 'linhas_ocultas']);
  });

  it('trilha aceita SELECAO_DE_PLANILHA e LEITURA_PLANILHA, recusa ação desconhecida e segue append-only', async () => {
    const empresaId = await novaEmpresa();
    const id = await inserirCru(d, empresaId, { formato: 'ODS', aba_nome: 'Plan1', aba_posicao: 1 });
    const evento = (acao: string) =>
      como((cli) =>
        registrarEvento(cli, d, {
          empresaId,
          tentativaId: id,
          acao: acao as 'LEITURA_PLANILHA',
          estadoAnterior: null,
          estadoNovo: 'RECEBIDA',
          usuarioId: usuario,
          totais: null,
          codigo: null,
          correlationId: 'teste-planilhas',
          agora: agora(),
        }),
      );

    expect(await erroDe(() => evento('SELECAO_DE_PLANILHA'))).toBe('nao_lancou');
    expect(await erroDe(() => evento('LEITURA_PLANILHA'))).toBe('nao_lancou');
    expect(await erroDe(() => evento('LEITURA_DE_PLANILHA'))).toBe('23514');

    const { rows } = await admin.query<{ acao: string }>(
      `select acao from app.${d.tabelaEvento} where tentativa_id = $1 order by sequencia`,
      [id],
    );
    expect(rows.map((linha) => linha.acao)).toEqual(['SELECAO_DE_PLANILHA', 'LEITURA_PLANILHA']);
    expect(
      await erroDe(() => admin.query(`update app.${d.tabelaEvento} set codigo = 'X' where tentativa_id = $1`, [id])),
    ).not.toBe('nao_lancou');
    expect(await erroDe(() => admin.query(`delete from app.${d.tabelaEvento} where tentativa_id = $1`, [id]))).not.toBe(
      'nao_lancou',
    );
  });
});

describe.each(DOMINIOS)('$nome: identidade idempotente com a configuração (SPEC-015 §3.8)', (dominio) => {
  const { d } = dominio;

  it('CSV sem configuração continua como antes: reutiliza e devolve os padrões de CSV', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const primeira = await como((cli) => criarTentativa(cli, d, nova(dominio, empresaId, hash)));
    const segunda = await como((cli) => criarTentativa(cli, d, nova(dominio, empresaId, hash, { formato: 'CSV' })));

    expect(primeira).toMatchObject({
      reutilizada: false,
      formato: 'CSV',
      aba: null,
      linhaCabecalho: 1,
      linhasIgnoradasAntesDoCabecalho: 0,
      linhasOcultas: 0,
      diagnosticosDaPlanilha: [],
    });
    expect(segunda).toMatchObject({ id: primeira.id, reutilizada: true });
  });

  it('formato, aba, cabeçalho ou mapeamento diferentes abrem tentativa nova; configuração igual reutiliza', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const criar = (configuracao: Configuracao, mapeamento?: Record<string, string>) =>
      como((cli) => criarTentativa(cli, d, nova(dominio, empresaId, hash, configuracao, mapeamento)));

    const base = await criar(XLSX_ABA_2);
    expect(base).toMatchObject({
      reutilizada: false,
      formato: 'XLSX',
      aba: { nome: 'Contas', posicao: 2 },
      linhaCabecalho: 3,
    });

    const variacoes = [
      await criar({ ...XLSX_ABA_2, formato: 'ODS' }),
      await criar({ ...XLSX_ABA_2, abaNome: 'Outra', abaPosicao: 1 }),
      await criar({ ...XLSX_ABA_2, linhaCabecalho: 1 }),
      await criar(XLSX_ABA_2, { ...dominio.mapeamento, nome: 'F' }),
      await criar({}),
    ];
    expect(variacoes.map((t) => t.reutilizada)).toEqual([false, false, false, false, false]);
    expect(new Set([base.id, ...variacoes.map((t) => t.id)]).size).toBe(6);

    expect(await criar(XLSX_ABA_2)).toMatchObject({ id: base.id, reutilizada: true });
  });

  it('resultado terminal de planilha é reaproveitado só enquanto a versão do agregado não muda (FIX #107)', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const criar = () => como((cli) => criarTentativa(cli, d, nova(dominio, empresaId, hash, XLSX_ABA_2)));
    const primeira = await criar();
    const inicio = await comoWorker(empresaId, (cli) => iniciarValidacao(cli, d, empresaId, primeira.id, agora()));
    await comoWorker(empresaId, (cli) => dominio.rejeitarTudo(cli, empresaId, primeira.id, inicio.versaoNaValidacao));

    expect(await criar()).toMatchObject({ id: primeira.id, reutilizada: true, estado: 'REJEITADA' });

    await admin.query(`update app.${d.tabelaVersao} set versao = versao + 1 where empresa_id = $1`, [empresaId]);
    const depois = await criar();

    expect(depois).toMatchObject({ reutilizada: false, estado: 'RECEBIDA', formato: 'XLSX', linhaCabecalho: 3 });
    expect(depois.id).not.toBe(primeira.id);
    const { rows } = await admin.query<{ obsoleta: boolean }>(`select obsoleta from app.${d.tabela} where id = $1`, [
      primeira.id,
    ]);
    expect(rows[0]?.obsoleta).toBe(true);
  });
});

describe.each(DOMINIOS)('$nome: leitura da planilha, busca e histórico (SPEC-015 §3.9, §6.3)', (dominio) => {
  const { d } = dominio;

  it('histórico qualifica as colunas da tentativa: coluna homônima em usuario não gera ambiguidade', async () => {
    const empresaId = await novaEmpresa();
    const planilha = await como((cli) => criarTentativa(cli, d, nova(dominio, empresaId, hex64(), XLSX_ABA_2)));
    const cliente = await admin.connect();

    try {
      await cliente.query('begin');
      // Só nesta transação (revertida): `usuario` passa a ter colunas com os nomes das de planilha.
      await cliente.query(
        `alter table app.usuario
           add column formato text, add column aba_nome text, add column aba_posicao integer,
           add column linha_cabecalho integer, add column linhas_ignoradas_antes_do_cabecalho integer,
           add column linhas_ocultas integer, add column diagnosticos jsonb`,
      );
      const pagina = await listarHistorico(cliente, d, empresaId, 1);

      expect(pagina.itens[0]).toMatchObject({ id: planilha.id, formato: 'XLSX', aba: { nome: 'Contas', posicao: 2 } });
    } finally {
      await cliente.query('rollback');
      cliente.release();
    }
  });

  it('registra a leitura em RECEBIDA e VALIDANDO, sobrescrevendo na repetição; depois recusa', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, d, nova(dominio, empresaId, hex64(), XLSX_ABA_2)));
    const registrar = (diagnosticos: readonly object[] = DIAGNOSTICOS, ocultas = 2) =>
      comoWorker(empresaId, (cli) =>
        registrarLeituraDaPlanilha(cli, d, {
          empresaId,
          tentativaId: criada.id,
          linhasIgnoradasAntesDoCabecalho: 2,
          linhasOcultas: ocultas,
          diagnosticos: diagnosticos as typeof DIAGNOSTICOS,
        }),
      );

    await registrar([], 7);
    await comoWorker(empresaId, (cli) => iniciarValidacao(cli, d, empresaId, criada.id, agora()));
    await registrar();
    await registrar();

    expect(await como((cli) => buscarTentativa(cli, d, empresaId, criada.id))).toMatchObject({
      formato: 'XLSX',
      aba: { nome: 'Contas', posicao: 2 },
      linhaCabecalho: 3,
      linhasIgnoradasAntesDoCabecalho: 2,
      linhasOcultas: 2,
      diagnosticosDaPlanilha: DIAGNOSTICOS,
    });

    expect(await erroDe(() => registrar([{ codigo: 'INVENTADO', mensagem: 'x', quantidade: 1 }]))).not.toBe(
      'nao_lancou',
    );
    expect(
      await erroDe(() =>
        comoWorker(empresaId, (cli) =>
          registrarLeituraDaPlanilha(cli, d, {
            empresaId,
            tentativaId: randomUUID(),
            linhasIgnoradasAntesDoCabecalho: 0,
            linhasOcultas: 0,
            diagnosticos: [],
          }),
        ),
      ),
    ).toBe(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA);

    await comoWorker(empresaId, (cli) => dominio.rejeitarTudo(cli, empresaId, criada.id, 0));
    expect(await erroDe(() => registrar())).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
  });

  it('histórico traz formato, aba, cabeçalho, leitura e diagnósticos; CSV sai com os padrões', async () => {
    const empresaId = await novaEmpresa();
    const csv = await como((cli) => criarTentativa(cli, d, nova(dominio, empresaId, hex64())));
    const planilha = await como((cli) =>
      criarTentativa(cli, d, nova(dominio, empresaId, hex64(), { formato: 'ODS', abaNome: 'Base', abaPosicao: 1 })),
    );
    await comoWorker(empresaId, (cli) =>
      registrarLeituraDaPlanilha(cli, d, {
        empresaId,
        tentativaId: planilha.id,
        linhasIgnoradasAntesDoCabecalho: 0,
        linhasOcultas: 2,
        diagnosticos: [DIAGNOSTICOS[0]],
      }),
    );

    const pagina = await como((cli) => listarHistorico(cli, d, empresaId, 1));

    expect(HistoricoDeImportacoesSchema.parse(pagina)).toEqual(pagina);
    expect(pagina.itens.map((t) => t.id)).toEqual([planilha.id, csv.id]);
    expect(pagina.itens[0]).toMatchObject({
      formato: 'ODS',
      aba: { nome: 'Base', posicao: 1 },
      linhaCabecalho: 1,
      linhasIgnoradasAntesDoCabecalho: 0,
      linhasOcultas: 2,
      diagnosticosDaPlanilha: [DIAGNOSTICOS[0]],
      reutilizadaPorIdempotencia: false,
    });
    expect(pagina.itens[1]).toMatchObject({
      formato: 'CSV',
      aba: null,
      linhaCabecalho: 1,
      linhasIgnoradasAntesDoCabecalho: 0,
      linhasOcultas: 0,
      diagnosticosDaPlanilha: [],
    });
  });
});
