/**
 * Repositório da importação do plano de contas (SPEC-013 §3.4–§3.11, §6.3, §6.4).
 *
 * Roda como `contaia_app` (sem BYPASSRLS) sobre o PostgreSQL real, sempre dentro de
 * `comContextoHumano` (usuário da carteira) ou `comContexto` técnico (worker da empresa). O
 * semeador (superusuário) só prepara o que a aplicação não grava (conta já arquivada, empresa
 * isolada para o teste) e confere o estado final por fora da RLS.
 */
import { randomUUID } from 'node:crypto';

import { ErroDeConflito, ErroDeDominio, contextoTecnico } from '@contaia/domain';
import { HistoricoDeImportacoesSchema } from '@contaia/shared';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto } from './contexto.js';
import {
  ITENS_DO_HISTORICO,
  carregarContasVigentes,
  contarContasValidas,
  listarHistorico,
  listarLinhasParaRelatorio,
  listarPlano,
  listarRejeicoes,
} from './repositorios/plano-contas-consultas.js';
import {
  aplicarLinhas,
  buscarTentativa,
  cancelar,
  confirmar,
  criarNotificacao,
  criarTentativa,
  finalizar,
  gravarResultadoDaValidacao,
  iniciarValidacao,
  registrarEvento,
  registrarFalha,
} from './repositorios/plano-contas.js';
import type {
  LinhaDeStaging,
  NovaTentativa,
  ResultadoDaAplicacao,
  TentativaDeImportacao,
} from './repositorios/plano-contas.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';
import { comoUsuario } from './testes/suporte.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();

let c: Cenario;
let usuario: string;

type Executar<T> = (cliente: PoolClient) => Promise<T>;

const como = <T>(executar: Executar<T>, usuarioId: string = usuario, tenantId: string = c.tenantA): Promise<T> =>
  comoUsuario(app, tenantId, usuarioId, executar);

const comoWorker = <T>(empresaId: string, executar: Executar<T>): Promise<T> =>
  comContexto(
    app,
    contextoTecnico({
      identidadeTecnica: 'workers-plano-contas',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: c.tenantA,
      empresaId,
      correlationId: 'teste-plano-contas',
    }),
    executar,
  );

/** Código estável do erro de domínio, ou o SQLSTATE do banco. */
const erroDe = async (executar: () => Promise<unknown>): Promise<string> => {
  try {
    await executar();

    return 'nao_lancou';
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro.codigo;
    }

    return (erro as { code?: string }).code ?? 'sem_codigo';
  }
};

let instante = Date.parse('2026-10-08T12:00:00.000Z');
/** Relógio do teste: cada chamada anda um segundo (o "agora" entra por parâmetro). */
const agora = (): Date => new Date((instante += 1000));

const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

const MAPEAMENTO = { codigo: 'Codigo', nome: 'Nome', tipo: 'Tipo', natureza: 'Natureza', conta_pai: 'Pai' };

let empresas = 0;

/** Empresa nova do tenant A, na carteira do usuário do teste: versão do plano e contas isoladas. */
const novaEmpresa = async (): Promise<string> => {
  empresas += 1;
  const cnpj = `P${String(empresas).padStart(3, '0')}${c.sufixo}`.slice(0, 14);
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao)
     values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
    [c.tenantA, cnpj, `Empresa plano ${cnpj}`],
  );
  const empresaId = rows[0]!.id;
  await admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
    c.tenantA,
    usuario,
    empresaId,
  ]);

  return empresaId;
};

const novaTentativa = (empresaId: string, opcoes: Readonly<{ hash?: string; mapeamento?: object }> = {}): NovaTentativa => ({
  tenantId: c.tenantA,
  empresaId,
  hashArquivo: opcoes.hash ?? hex64(),
  mapeamento: (opcoes.mapeamento ?? MAPEAMENTO) as Record<string, string>,
  arquivoNome: 'plano.csv',
  arquivoTamanho: 120,
  arquivoChave: `${c.tenantA}/${empresaId}/IMPORTACAO_PLANO_CONTAS/${randomUUID()}.csv`,
  usuarioIniciadorId: usuario,
  correlationId: 'teste-plano-contas',
  agora: agora(),
});

const valida = (
  numeroDaLinha: number,
  codigo: string,
  opcoes: Readonly<{ acao?: 'INCLUIR' | 'ATUALIZAR'; contaPai?: string | null; nome?: string }> = {},
): LinhaDeStaging => ({
  status: 'VALIDA',
  numeroDaLinha,
  codigo,
  nome: opcoes.nome ?? `Conta ${codigo}`,
  tipo: 'sintetica',
  natureza: 'devedora',
  contaPai: opcoes.contaPai ?? null,
  acao: opcoes.acao ?? 'INCLUIR',
});

const rejeitada = (numeroDaLinha: number, codigo: string | null): LinhaDeStaging => ({
  status: 'REJEITADA',
  numeroDaLinha,
  codigo,
  nome: null,
  tipo: 'Analitíca?',
  natureza: null,
  contaPai: null,
  codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
  campo: 'tipo',
  mensagem: 'Tipo fora do domínio: use analítica ou sintética.',
});

/** Upload → validação no worker → prévia em AGUARDANDO_CONFIRMACAO (ou REJEITADA). */
const prepararPrevia = async (empresaId: string, linhas: readonly LinhaDeStaging[]): Promise<TentativaDeImportacao> => {
  const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
  const inicio = await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, agora()));
  await comoWorker(empresaId, (cli) =>
    gravarResultadoDaValidacao(cli, empresaId, criada.id, linhas, inicio.planoVersaoNaValidacao, agora()),
  );

  return (await como((cli) => buscarTentativa(cli, empresaId, criada.id)))!;
};

/** O caso de uso da confirmação, numa transação só: confirmar → aplicar → finalizar. */
const confirmarEAplicar = (empresaId: string, tentativa: TentativaDeImportacao): Promise<ResultadoDaAplicacao> =>
  como(async (cli) => {
    await confirmar(cli, {
      empresaId,
      tentativaId: tentativa.id,
      usuarioId: usuario,
      versaoDaPrevia: tentativa.planoVersaoNaValidacao!,
    });
    const resultado = await aplicarLinhas(cli, empresaId, tentativa.id, agora());
    await finalizar(cli, empresaId, tentativa.id, 'CONCLUIDA', tentativa.totais!, agora());

    return resultado;
  });

const inserirContaComoAdmin = async (
  empresaId: string,
  codigo: string,
  opcoes: Readonly<{ arquivada?: boolean; contaPai?: string | null; tipo?: string }> = {},
): Promise<void> => {
  await admin.query(
    `insert into app.conta_contabil
       (tenant_id, empresa_id, codigo, nome, tipo, natureza, conta_pai, arquivada, arquivada_em)
     values ($1, $2, $3, $4, $5, 'devedora', $6, $7, case when $7 then now() end)`,
    [c.tenantA, empresaId, codigo, `Conta ${codigo}`, opcoes.tipo ?? 'sintetica', opcoes.contaPai ?? null, opcoes.arquivada ?? false],
  );
};

type ContaNoBanco = { codigo: string; nome: string; versao: string; atualizado_em: Date; arquivada: boolean };

const contasNoBanco = async (empresaId: string): Promise<Map<string, ContaNoBanco>> => {
  const { rows } = await admin.query<ContaNoBanco>(
    `select codigo, nome, versao::text as versao, atualizado_em, arquivada
       from app.conta_contabil where empresa_id = $1`,
    [empresaId],
  );

  return new Map(rows.map((r) => [r.codigo, r]));
};

const versaoDoPlano = async (empresaId: string): Promise<number | null> => {
  const { rows } = await admin.query<{ versao: string }>(
    `select versao::text as versao from app.empresa_plano_versao where empresa_id = $1`,
    [empresaId],
  );

  return rows[0] === undefined ? null : Number(rows[0].versao);
};

const estadoNoBanco = async (tentativaId: string): Promise<string> => {
  const { rows } = await admin.query<{ estado: string }>(`select estado from app.importacao_plano_contas where id = $1`, [
    tentativaId,
  ]);

  return rows[0]!.estado;
};

beforeAll(async () => {
  c = await montarCenario(admin);
  usuario = c.usuarios.naCarteira;
}, 60_000);

afterAll(async () => {
  await limparCenario(admin, c);
  await Promise.all([admin.end(), app.end()]);
});

describe('tentativa: criação idempotente e leitura por empresa (SPEC-013 §3.7)', () => {
  it('nasce RECEBIDA com o mapeamento, o arquivo e o instante informados', async () => {
    const empresaId = await novaEmpresa();
    const nova = novaTentativa(empresaId);
    const criada = await como((cli) => criarTentativa(cli, nova));

    expect(criada).toMatchObject({
      tenantId: c.tenantA,
      empresaId,
      hashArquivo: nova.hashArquivo,
      mapeamento: MAPEAMENTO,
      arquivoNome: 'plano.csv',
      arquivoTamanho: 120,
      arquivoChave: nova.arquivoChave,
      estado: 'RECEBIDA',
      planoVersaoNaValidacao: null,
      totais: null,
      usuarioIniciadorId: usuario,
      usuarioConfirmadorId: null,
      usuarioCanceladorId: null,
      correlationId: 'teste-plano-contas',
      reutilizadaPorIdempotencia: false,
      reutilizada: false,
      iniciadoEm: null,
      finalizadoEm: null,
    });
    expect(criada.criadoEm.toISOString()).toBe(nova.agora.toISOString());
  });

  it('mesmo hash e mapeamento devolve a mesma tentativa com reutilizada=true; mapeamento diferente é nova', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const primeira = await como((cli) => criarTentativa(cli, novaTentativa(empresaId, { hash })));
    const repetida = await como((cli) => criarTentativa(cli, novaTentativa(empresaId, { hash })));
    const outroMapeamento = await como((cli) =>
      criarTentativa(cli, novaTentativa(empresaId, { hash, mapeamento: { ...MAPEAMENTO, nome: 'Descricao' } })),
    );

    expect(repetida.id).toBe(primeira.id);
    expect(repetida.reutilizada).toBe(true);
    // Em andamento: o resultado ainda não existe, então a marca de reuso do histórico não muda.
    expect(repetida.reutilizadaPorIdempotencia).toBe(false);
    expect(outroMapeamento.id).not.toBe(primeira.id);
    expect(outroMapeamento.reutilizada).toBe(false);
  });

  it('reenvio de tentativa terminal reutiliza o resultado e marca a tentativa no histórico', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const primeira = await como((cli) => criarTentativa(cli, novaTentativa(empresaId, { hash })));
    await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, primeira.id, agora()));
    await comoWorker(empresaId, (cli) =>
      gravarResultadoDaValidacao(cli, empresaId, primeira.id, [rejeitada(1, 'X')], 0, agora()),
    );

    const repetida = await como((cli) => criarTentativa(cli, novaTentativa(empresaId, { hash })));

    expect(repetida).toMatchObject({ id: primeira.id, estado: 'REJEITADA', reutilizada: true, reutilizadaPorIdempotencia: true });
  });

  it('depois de FALHA ou CANCELADA o mesmo arquivo e mapeamento abre nova tentativa; prévia pendente é reutilizada', async () => {
    const empresaId = await novaEmpresa();
    const hashFalha = hex64();
    const falhou = await como((cli) => criarTentativa(cli, novaTentativa(empresaId, { hash: hashFalha })));
    await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, falhou.id, agora()));
    await comoWorker(empresaId, (cli) => registrarFalha(cli, empresaId, falhou.id, agora()));

    const depoisDaFalha = await como((cli) => criarTentativa(cli, novaTentativa(empresaId, { hash: hashFalha })));
    expect(depoisDaFalha).toMatchObject({ estado: 'RECEBIDA', reutilizada: false });
    expect(depoisDaFalha.id).not.toBe(falhou.id);

    const pendente = await prepararPrevia(empresaId, [valida(1, '1')]);
    const reenvioPendente = await como((cli) =>
      criarTentativa(cli, novaTentativa(empresaId, { hash: pendente.hashArquivo })),
    );
    expect(reenvioPendente).toMatchObject({ id: pendente.id, estado: 'AGUARDANDO_CONFIRMACAO', reutilizada: true });

    await como((cli) => cancelar(cli, { empresaId, tentativaId: pendente.id, usuarioId: usuario, agora: agora() }));
    const depoisDoCancelamento = await como((cli) =>
      criarTentativa(cli, novaTentativa(empresaId, { hash: pendente.hashArquivo })),
    );
    expect(depoisDoCancelamento).toMatchObject({ estado: 'RECEBIDA', reutilizada: false });
    expect(depoisDoCancelamento.id).not.toBe(pendente.id);
  });

  it('dois envios idênticos simultâneos: uma tentativa nova e um reuso', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const enviar = (): Promise<TentativaDeImportacao & { reutilizada: boolean }> =>
      como(async (cli) => {
        const criada = await criarTentativa(cli, novaTentativa(empresaId, { hash }));
        await cli.query('select pg_sleep(0.2)');

        return criada;
      });

    const [a, b] = await Promise.all([enviar(), enviar()]);

    expect(a.id).toBe(b.id);
    expect([a.reutilizada, b.reutilizada].sort()).toEqual([false, true]);
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from app.importacao_plano_contas where empresa_id = $1`,
      [empresaId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('buscarTentativa só encontra pela empresa certa e dentro do tenant e da carteira', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));

    expect((await como((cli) => buscarTentativa(cli, empresaId, criada.id)))?.id).toBe(criada.id);
    expect(await como((cli) => buscarTentativa(cli, c.empresaA2, criada.id), c.usuarios.duasEmpresas)).toBeNull();
    expect(await como((cli) => buscarTentativa(cli, empresaId, criada.id), c.usuarios.fora)).toBeNull();
    expect(await como((cli) => buscarTentativa(cli, empresaId, criada.id), c.usuarios.deB, c.tenantB)).toBeNull();
  });
});

describe('validação no worker: staging idempotente (SPEC-013 §3.4, §6.4)', () => {
  it('iniciarValidacao passa a VALIDANDO e lê a versão do plano, criando-a sob demanda', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
    const inicio = agora();

    expect(await versaoDoPlano(empresaId)).toBeNull();
    const resultado = await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, inicio));

    expect(resultado).toEqual({ transicionou: true, planoVersaoNaValidacao: 0 });
    expect(await versaoDoPlano(empresaId)).toBe(0);
    const lida = await como((cli) => buscarTentativa(cli, empresaId, criada.id));
    // A versão só é fixada junto com o staging (gravarResultadoDaValidacao), nunca no início.
    expect(lida).toMatchObject({ estado: 'VALIDANDO', planoVersaoNaValidacao: null });
    expect(lida?.iniciadoEm?.toISOString()).toBe(inicio.toISOString());

    // Reentrega do job durante a validação: não falha nem troca o início.
    expect(await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, agora()))).toEqual({
      transicionou: false,
      planoVersaoNaValidacao: 0,
    });
    expect((await como((cli) => buscarTentativa(cli, empresaId, criada.id)))?.iniciadoEm?.toISOString()).toBe(
      inicio.toISOString(),
    );
  });

  it('iniciarValidacao fora de RECEBIDA/VALIDANDO e em tentativa de outra empresa é recusada', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, '1')]);

    expect(await erroDe(() => comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, previa.id, agora()))))
      .toBe('ESTADO_INVALIDO_PARA_ACAO');
    expect(await erroDe(() => como((cli) => iniciarValidacao(cli, c.empresaA1, previa.id, agora()))))
      .toBe('TENTATIVA_NAO_ENCONTRADA');
  });

  it('grava staging e totais e vai a AGUARDANDO_CONFIRMACAO; repetir não duplica linhas', async () => {
    const empresaId = await novaEmpresa();
    await inserirContaComoAdmin(empresaId, '1');
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
    await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, agora()));
    const linhas = [valida(1, '1', { acao: 'ATUALIZAR' }), valida(2, '1.1', { contaPai: '1' }), rejeitada(3, '1.2')];

    const primeira = await comoWorker(empresaId, (cli) =>
      gravarResultadoDaValidacao(cli, empresaId, criada.id, linhas, 0, agora()),
    );
    const totais = { lidas: 3, novas: 1, atualizadas: 1, rejeitadas: 1 };
    expect(primeira).toEqual({ estado: 'AGUARDANDO_CONFIRMACAO', totais, transicionou: true });

    const segunda = await comoWorker(empresaId, (cli) =>
      gravarResultadoDaValidacao(cli, empresaId, criada.id, linhas, 0, agora()),
    );
    expect(segunda).toEqual({ estado: 'AGUARDANDO_CONFIRMACAO', totais, transicionou: false });

    const { rows } = await admin.query<{ n: string }>(
      `select count(*)::text as n from app.importacao_plano_contas_linha where tentativa_id = $1`,
      [criada.id],
    );
    expect(Number(rows[0]!.n)).toBe(3);
    expect(await como((cli) => buscarTentativa(cli, empresaId, criada.id))).toMatchObject({
      estado: 'AGUARDANDO_CONFIRMACAO',
      totais,
      planoVersaoNaValidacao: 0,
      finalizadoEm: null,
    });
  });

  it('reentrega com o plano alterado entre os dois inícios não rotula staging antigo com versão nova', async () => {
    const empresaId = await novaEmpresa();
    await inserirContaComoAdmin(empresaId, '1');
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
    // Entrega 1 lê a versão 0 (e carregaria as contas nessa versão)...
    const entrega1 = await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, agora()));
    // ...outra importação é aplicada no meio do caminho (versão 1)...
    const outra = await prepararPrevia(empresaId, [valida(1, '1', { acao: 'ATUALIZAR', nome: 'Outra' })]);
    await confirmarEAplicar(empresaId, outra);
    // ...e a reentrega começa já na versão 1, sem sobrescrever o que a entrega 1 vai gravar.
    const entrega2 = await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, agora()));
    expect([entrega1.planoVersaoNaValidacao, entrega2.planoVersaoNaValidacao]).toEqual([0, 1]);

    await comoWorker(empresaId, (cli) =>
      gravarResultadoDaValidacao(
        cli,
        empresaId,
        criada.id,
        [valida(1, '1', { acao: 'ATUALIZAR', nome: 'Obsoleta' }), valida(2, '7')],
        entrega1.planoVersaoNaValidacao,
        agora(),
      ),
    );
    // A entrega 2 chega depois: já gravado, nada muda.
    expect(
      await comoWorker(empresaId, (cli) =>
        gravarResultadoDaValidacao(cli, empresaId, criada.id, [valida(1, '1')], entrega2.planoVersaoNaValidacao, agora()),
      ),
    ).toMatchObject({ transicionou: false });

    const previa = (await como((cli) => buscarTentativa(cli, empresaId, criada.id)))!;
    expect(previa.planoVersaoNaValidacao).toBe(0);
    const antes = await contasNoBanco(empresaId);

    expect(await erroDe(() => confirmarEAplicar(empresaId, previa))).toBe('CONFLITO_DE_VERSAO');
    expect(await contasNoBanco(empresaId)).toEqual(antes);
    expect(await estadoNoBanco(criada.id)).toBe('AGUARDANDO_CONFIRMACAO');
    expect(await versaoDoPlano(empresaId)).toBe(1);
  });

  it('lote com número de linha repetido é recusado antes de gravar', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
    await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, agora()));

    await expect(
      comoWorker(empresaId, (cli) =>
        gravarResultadoDaValidacao(cli, empresaId, criada.id, [valida(1, '1'), valida(2, '2'), valida(2, '3')], 0, agora()),
      ),
    ).rejects.toThrow(/número de linha repetido: 2/u);
    expect(await estadoNoBanco(criada.id)).toBe('VALIDANDO');
  });

  it('nenhuma linha válida termina REJEITADA, com término gravado', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
    await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, agora()));
    const fim = agora();

    const resultado = await comoWorker(empresaId, (cli) =>
      gravarResultadoDaValidacao(cli, empresaId, criada.id, [rejeitada(1, 'A'), rejeitada(2, null)], 0, fim),
    );

    expect(resultado).toEqual({
      estado: 'REJEITADA',
      totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 },
      transicionou: true,
    });
    expect((await como((cli) => buscarTentativa(cli, empresaId, criada.id)))?.finalizadoEm?.toISOString()).toBe(
      fim.toISOString(),
    );
  });

  it('gravar sem iniciar a validação é estado inválido', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));

    expect(
      await erroDe(() =>
        comoWorker(empresaId, (cli) => gravarResultadoDaValidacao(cli, empresaId, criada.id, [valida(1, '1')], 0, agora())),
      ),
    ).toBe('ESTADO_INVALIDO_PARA_ACAO');
  });

  it('registrarFalha leva VALIDANDO a FALHA com término; fora disso é estado inválido', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
    await comoWorker(empresaId, (cli) => iniciarValidacao(cli, empresaId, criada.id, agora()));

    expect(await comoWorker(empresaId, (cli) => registrarFalha(cli, empresaId, criada.id, agora()))).toBe('VALIDANDO');
    const lida = await como((cli) => buscarTentativa(cli, empresaId, criada.id));
    expect(lida?.estado).toBe('FALHA');
    expect(lida?.finalizadoEm).not.toBeNull();
    expect(await erroDe(() => comoWorker(empresaId, (cli) => registrarFalha(cli, empresaId, criada.id, agora()))))
      .toBe('ESTADO_INVALIDO_PARA_ACAO');
  });
});

describe('confirmação e aplicação transacional (SPEC-013 §3.6, §6.3)', () => {
  it('inclui as novas, atualiza as existentes, mantém as ausentes e sobe a versão do plano', async () => {
    const empresaId = await novaEmpresa();
    await inserirContaComoAdmin(empresaId, '1');
    await inserirContaComoAdmin(empresaId, '9');
    const previa = await prepararPrevia(empresaId, [
      valida(1, '1', { acao: 'ATUALIZAR', nome: 'Ativo renomeado' }),
      // A filha antes do pai: a ordem física não define a hierarquia.
      valida(2, '1.1.1', { contaPai: '1.1' }),
      valida(3, '1.1', { contaPai: '1' }),
      rejeitada(4, '1.2'),
    ]);
    const antes = await contasNoBanco(empresaId);

    const resultado = await confirmarEAplicar(empresaId, previa);

    expect(resultado).toEqual({ incluidas: 2, atualizadas: 1, ignoradas: [], versaoDoPlano: 1 });
    const depois = await contasNoBanco(empresaId);
    expect([...depois.keys()].sort()).toEqual(['1', '1.1', '1.1.1', '9']);
    expect(depois.get('1')).toMatchObject({ nome: 'Ativo renomeado', versao: '2' });
    expect(depois.get('9')).toEqual(antes.get('9'));
    expect(depois.has('1.2')).toBe(false);
    expect(await versaoDoPlano(empresaId)).toBe(1);
    expect(await como((cli) => buscarTentativa(cli, empresaId, previa.id))).toMatchObject({
      estado: 'CONCLUIDA',
      usuarioConfirmadorId: usuario,
    });
  });

  it('conta arquivada fica intacta, é informada e não conta como atualizada', async () => {
    const empresaId = await novaEmpresa();
    await inserirContaComoAdmin(empresaId, '1');
    await inserirContaComoAdmin(empresaId, '2', { arquivada: true });
    // Linha válida para uma conta que ficou arquivada depois da validação (defesa em profundidade).
    const previa = await prepararPrevia(empresaId, [
      valida(1, '1', { acao: 'ATUALIZAR', nome: 'Ativo' }),
      valida(2, '2', { acao: 'ATUALIZAR', nome: 'Tentou reativar' }),
      valida(3, '3', { contaPai: '1' }),
    ]);
    const antes = await contasNoBanco(empresaId);

    const resultado = await confirmarEAplicar(empresaId, previa);

    expect(resultado).toEqual({ incluidas: 1, atualizadas: 1, ignoradas: ['2'], versaoDoPlano: 1 });
    expect((await contasNoBanco(empresaId)).get('2')).toEqual(antes.get('2'));
  });

  it('atualizar com os mesmos valores conta como atualizada sem mexer na versão nem no instante da conta', async () => {
    const empresaId = await novaEmpresa();
    await inserirContaComoAdmin(empresaId, '1');
    const antes = (await contasNoBanco(empresaId)).get('1');
    const previa = await prepararPrevia(empresaId, [valida(1, '1', { acao: 'ATUALIZAR', nome: 'Conta 1' })]);

    expect(await confirmarEAplicar(empresaId, previa)).toMatchObject({ incluidas: 0, atualizadas: 1 });
    expect((await contasNoBanco(empresaId)).get('1')).toEqual(antes);
  });

  it('plano alterado entre a validação e a aplicação: CONFLITO_DE_VERSAO e nada aplicado', async () => {
    const empresaId = await novaEmpresa();
    await inserirContaComoAdmin(empresaId, '1');
    const primeira = await prepararPrevia(empresaId, [valida(1, '1', { acao: 'ATUALIZAR', nome: 'Primeira' })]);
    const obsoleta = await prepararPrevia(empresaId, [
      valida(1, '1', { acao: 'ATUALIZAR', nome: 'Obsoleta' }),
      valida(2, '5'),
    ]);
    await confirmarEAplicar(empresaId, primeira);
    const antes = await contasNoBanco(empresaId);

    let erro: unknown;
    try {
      await confirmarEAplicar(empresaId, obsoleta);
    } catch (e) {
      erro = e;
    }

    expect(erro).toBeInstanceOf(ErroDeConflito);
    expect((erro as ErroDeConflito).codigo).toBe('CONFLITO_DE_VERSAO');
    // A transação inteira reverteu: nem a confirmação ficou.
    expect(await estadoNoBanco(obsoleta.id)).toBe('AGUARDANDO_CONFIRMACAO');
    expect(await contasNoBanco(empresaId)).toEqual(antes);
    expect(await versaoDoPlano(empresaId)).toBe(1);
  });

  it('versão da prévia diferente da validada é CONFLITO_DE_VERSAO já na confirmação', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, '1')]);

    expect(
      await erroDe(() =>
        como((cli) =>
          confirmar(cli, { empresaId, tentativaId: previa.id, usuarioId: usuario, versaoDaPrevia: 7 }),
        ),
      ),
    ).toBe('CONFLITO_DE_VERSAO');
    expect(await estadoNoBanco(previa.id)).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('duas confirmações simultâneas: exatamente uma aplica, a outra recebe ESTADO_INVALIDO_PARA_ACAO', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, '1'), valida(2, '1.1', { contaPai: '1' })]);

    const tentar = (): Promise<string> =>
      como(async (cli) => {
        await confirmar(cli, { empresaId, tentativaId: previa.id, usuarioId: usuario, versaoDaPrevia: 0 });
        // Segura a linha travada: a outra transação espera e reavalia o estado depois do commit.
        await cli.query('select pg_sleep(0.3)');
        await aplicarLinhas(cli, empresaId, previa.id, agora());
        await finalizar(cli, empresaId, previa.id, 'CONCLUIDA', previa.totais!, agora());

        return 'aplicou';
      }).catch((erro: unknown) => (erro instanceof ErroDeDominio ? erro.codigo : 'outro_erro'));

    const resultados = await Promise.all([tentar(), tentar()]);

    expect([...resultados].sort()).toEqual(['ESTADO_INVALIDO_PARA_ACAO', 'aplicou']);
    expect(await versaoDoPlano(empresaId)).toBe(1);
    expect([...(await contasNoBanco(empresaId)).keys()].sort()).toEqual(['1', '1.1']);
    expect(await estadoNoBanco(previa.id)).toBe('CONCLUIDA');
  });

  it('confirmar em outra empresa é TENTATIVA_NAO_ENCONTRADA; fora de AGUARDANDO_CONFIRMACAO é estado inválido', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));

    expect(
      await erroDe(() =>
        como((cli) => confirmar(cli, { empresaId: c.empresaA1, tentativaId: criada.id, usuarioId: usuario, versaoDaPrevia: 0 })),
      ),
    ).toBe('TENTATIVA_NAO_ENCONTRADA');
    expect(
      await erroDe(() =>
        como((cli) => confirmar(cli, { empresaId, tentativaId: criada.id, usuarioId: usuario, versaoDaPrevia: 0 })),
      ),
    ).toBe('ESTADO_INVALIDO_PARA_ACAO');
  });

  it('aplicar ou finalizar sem confirmação é estado inválido', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, '1')]);

    expect(await erroDe(() => como((cli) => aplicarLinhas(cli, empresaId, previa.id, agora())))).toBe(
      'ESTADO_INVALIDO_PARA_ACAO',
    );
    expect(
      await erroDe(() => como((cli) => finalizar(cli, empresaId, previa.id, 'CONCLUIDA', previa.totais!, agora()))),
    ).toBe('ESTADO_INVALIDO_PARA_ACAO');
    expect(await contarContasValidasDe(empresaId)).toBe(0);
  });
});

const contarContasValidasDe = (empresaId: string): Promise<number> =>
  como((cli) => contarContasValidas(cli, empresaId));

describe('cancelamento (SPEC-013 §3.8)', () => {
  it('cancela a prévia com autor e término, sem tocar o plano; repetir é estado inválido', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, '1')]);
    const fim = agora();

    const cancelada = await como((cli) =>
      cancelar(cli, { empresaId, tentativaId: previa.id, usuarioId: c.usuarios.naCarteira, agora: fim }),
    );

    expect(cancelada).toMatchObject({ estado: 'CANCELADA', usuarioCanceladorId: usuario });
    expect(cancelada.finalizadoEm?.toISOString()).toBe(fim.toISOString());
    expect(await contarContasValidasDe(empresaId)).toBe(0);
    expect(
      await erroDe(() => como((cli) => cancelar(cli, { empresaId, tentativaId: previa.id, usuarioId: usuario, agora: agora() }))),
    ).toBe('ESTADO_INVALIDO_PARA_ACAO');
  });
});

describe('eventos e notificação (SPEC-013 §3.10, I-6, I-9)', () => {
  it('registrarEvento grava na trilha da tentativa; tentativa de outra empresa não é encontrada', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
    const quando = agora();

    await como((cli) =>
      registrarEvento(cli, {
        empresaId,
        tentativaId: criada.id,
        acao: 'CRIACAO',
        estadoAnterior: null,
        estadoNovo: 'RECEBIDA',
        usuarioId: usuario,
        totais: null,
        codigo: null,
        correlationId: 'teste-plano-contas',
        agora: quando,
      }),
    );

    const { rows } = await admin.query<{ acao: string; tenant_id: string; ocorrido_em: Date }>(
      `select acao, tenant_id, ocorrido_em from app.importacao_plano_contas_evento where tentativa_id = $1`,
      [criada.id],
    );
    expect(rows).toEqual([{ acao: 'CRIACAO', tenant_id: c.tenantA, ocorrido_em: quando }]);
    expect(
      await erroDe(() =>
        como((cli) =>
          registrarEvento(cli, {
            empresaId: c.empresaA1,
            tentativaId: criada.id,
            acao: 'CRIACAO',
            estadoAnterior: null,
            estadoNovo: 'RECEBIDA',
            usuarioId: usuario,
            totais: null,
            codigo: null,
            correlationId: 'teste-plano-contas',
            agora: agora(),
          }),
        ),
      ),
    ).toBe('TENTATIVA_NAO_ENCONTRADA');
  });

  it('criarNotificacao vai só ao iniciador: true na primeira vez, false na repetição', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));
    // Gravada pelo worker: o destinatário vem da tentativa, nunca de quem chama.
    const notificar = (): Promise<boolean> =>
      comoWorker(empresaId, (cli) => criarNotificacao(cli, { empresaId, tentativaId: criada.id, agora: agora() }));

    expect(await notificar()).toBe(true);
    expect(await notificar()).toBe(false);
    const { rows } = await admin.query<{ usuario_id: string }>(
      `select usuario_id from app.importacao_plano_contas_notificacao where tentativa_id = $1`,
      [criada.id],
    );
    expect(rows).toEqual([{ usuario_id: usuario }]);
  });

  it('criarNotificacao de tentativa de outra empresa é TENTATIVA_NAO_ENCONTRADA, não "já existia"', async () => {
    const empresaId = await novaEmpresa();
    const criada = await como((cli) => criarTentativa(cli, novaTentativa(empresaId)));

    expect(
      await erroDe(() =>
        como((cli) => criarNotificacao(cli, { empresaId: c.empresaA1, tentativaId: criada.id, agora: agora() })),
      ),
    ).toBe('TENTATIVA_NAO_ENCONTRADA');
  });
});

describe('consultas (SPEC-013 §3.5, §3.9)', () => {
  it('histórico: 15 por página, mais recente primeiro, no contrato compartilhado', async () => {
    const empresaId = await novaEmpresa();
    const ids: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      ids.push((await como((cli) => criarTentativa(cli, novaTentativa(empresaId)))).id);
    }
    const cancelada = await prepararPrevia(empresaId, [valida(1, '1')]);
    await como((cli) => cancelar(cli, { empresaId, tentativaId: cancelada.id, usuarioId: usuario, agora: agora() }));
    ids.push(cancelada.id);

    const pagina1 = await como((cli) => listarHistorico(cli, empresaId, 1));
    const pagina2 = await como((cli) => listarHistorico(cli, empresaId, 2));

    expect(ITENS_DO_HISTORICO).toBe(15);
    expect(HistoricoDeImportacoesSchema.parse(pagina1)).toEqual(pagina1);
    expect(HistoricoDeImportacoesSchema.parse(pagina2)).toEqual(pagina2);
    expect(pagina1).toMatchObject({ pagina: 1, itensPorPagina: 15, total: 17 });
    expect(pagina1.itens.map((t) => t.id)).toEqual([...ids].reverse().slice(0, 15));
    expect(pagina2.itens.map((t) => t.id)).toEqual([...ids].reverse().slice(15));
    expect(pagina1.itens[0]).toMatchObject({
      estado: 'CANCELADA',
      usuarioIniciador: { id: usuario, nome: 'Usuário carteira' },
      usuarioConfirmadorOuCancelador: { id: usuario, nome: 'Usuário carteira' },
      totais: { lidas: 1, novas: 1, atualizadas: 0, rejeitadas: 0 },
      reutilizadaPorIdempotencia: false,
    });
    expect(pagina1.itens[0]?.fimEm).not.toBeNull();
    expect(pagina1.itens[1]).toMatchObject({
      estado: 'RECEBIDA',
      usuarioConfirmadorOuCancelador: null,
      totais: { lidas: 0, novas: 0, atualizadas: 0, rejeitadas: 0 },
      fimEm: null,
    });
    // Outra empresa da carteira não enxerga o histórico desta.
    expect((await como((cli) => listarHistorico(cli, c.empresaA2, 1), c.usuarios.duasEmpresas)).itens).toEqual([]);
  });

  it('rejeições paginadas e relatório por cursor, em ordem de linha (≥ 2.500 linhas)', async () => {
    const empresaId = await novaEmpresa();
    const linhas: LinhaDeStaging[] = [];
    for (let n = 1; n <= 2_600; n += 1) {
      linhas.push(n % 10 === 0 ? rejeitada(n, `R${n}`) : valida(n, `C${n}`));
    }
    // Ordem embaralhada na gravação: a leitura ordena por número de linha.
    const embaralhadas = [...linhas].sort((a, b) => ((a.numeroDaLinha * 7919) % 2_609) - ((b.numeroDaLinha * 7919) % 2_609));
    const previa = await prepararPrevia(empresaId, embaralhadas);
    expect(previa.totais).toEqual({ lidas: 2_600, novas: 2_340, atualizadas: 0, rejeitadas: 260 });

    const rejeicoes = await como((cli) => listarRejeicoes(cli, empresaId, previa.id, 2, 50));
    expect(rejeicoes).toMatchObject({ pagina: 2, itensPorPagina: 50, total: 260 });
    expect(rejeicoes.itens.map((r) => r.numeroDaLinha)).toEqual(Array.from({ length: 50 }, (_, i) => (50 + i + 1) * 10));
    expect(rejeicoes.itens[0]).toEqual({
      numeroDaLinha: 510,
      codigo: 'R510',
      campo: 'tipo',
      codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
      mensagem: 'Tipo fora do domínio: use analítica ou sintética.',
    });

    const { numeros, cursoresDurante, cursoresDepois, primeira } = await como(async (cli) => {
      const lidos: number[] = [];
      let durante = -1;
      let primeiraLinha: unknown;
      for await (const linha of listarLinhasParaRelatorio(cli, empresaId, previa.id)) {
        if (lidos.length === 0) {
          primeiraLinha = linha;
          const { rows } = await cli.query<{ n: number }>(`select count(*)::int as n from pg_cursors`);
          durante = rows[0]!.n;
        }
        lidos.push(linha.numeroDaLinha);
      }
      const { rows } = await cli.query<{ n: number }>(`select count(*)::int as n from pg_cursors`);

      return { numeros: lidos, cursoresDurante: durante, cursoresDepois: rows[0]!.n, primeira: primeiraLinha };
    });

    expect(numeros).toEqual(Array.from({ length: 2_600 }, (_, i) => i + 1));
    expect(cursoresDurante).toBe(1);
    expect(cursoresDepois).toBe(0);
    expect(primeira).toEqual({
      numeroDaLinha: 1,
      codigo: 'C1',
      nome: 'Conta C1',
      tipo: 'sintetica',
      natureza: 'devedora',
      contaPai: null,
      status: 'VALIDA',
      acao: 'INCLUIR',
      codigoDeErro: null,
      campo: null,
      mensagem: null,
    });

    // Interromper a leitura fecha o cursor; outra empresa não lê as linhas desta tentativa.
    const fechadoAoInterromper = await como(async (cli) => {
      for await (const linha of listarLinhasParaRelatorio(cli, empresaId, previa.id)) {
        if (linha.numeroDaLinha === 3) break;
      }
      const { rows } = await cli.query<{ n: number }>(`select count(*)::int as n from pg_cursors`);

      return rows[0]!.n;
    });
    expect(fechadoAoInterromper).toBe(0);
    const deOutraEmpresa = await como(async (cli) => {
      let n = 0;
      for await (const linha of listarLinhasParaRelatorio(cli, c.empresaA1, previa.id)) {
        n += linha.numeroDaLinha > 0 ? 1 : 0;
      }

      return n;
    });
    expect(deOutraEmpresa).toBe(0);
  });

  it('erro do FETCH no meio do relatório chega ao chamador sem ser mascarado pelo CLOSE (25P02)', async () => {
    const empresaId = await novaEmpresa();
    // Mais de um lote (500): o segundo FETCH acontece depois que o cursor sumiu.
    const previa = await prepararPrevia(
      empresaId,
      Array.from({ length: 501 }, (_, i) => valida(i + 1, `C${i + 1}`)),
    );

    expect(
      await erroDe(() =>
        como(async (cli) => {
          for await (const linha of listarLinhasParaRelatorio(cli, empresaId, previa.id)) {
            if (linha.numeroDaLinha === 1) {
              const { rows } = await cli.query<{ name: string }>(`select name from pg_cursors`);
              await cli.query(`close ${rows[0]!.name}`);
            }
          }
        }),
      ),
    ).toBe('34000');
  });

  it('plano: paginado por código, com busca; contagem válida ignora arquivadas; contas vigentes para a validação', async () => {
    const empresaId = await novaEmpresa();
    await inserirContaComoAdmin(empresaId, '1');
    await inserirContaComoAdmin(empresaId, '1.1', { contaPai: '1', tipo: 'analitica' });
    await inserirContaComoAdmin(empresaId, '2');
    await inserirContaComoAdmin(empresaId, '3', { arquivada: true });

    const pagina = await como((cli) => listarPlano(cli, empresaId, 1, 2));
    expect(pagina).toMatchObject({ pagina: 1, itensPorPagina: 2, total: 4 });
    expect(pagina.itens.map((conta) => conta.codigo)).toEqual(['1', '1.1']);
    expect(pagina.itens[1]).toMatchObject({ contaPai: '1', tipo: 'analitica', natureza: 'devedora', arquivada: false, versao: 1 });

    const busca = await como((cli) => listarPlano(cli, empresaId, 1, 10, 'conta 3'));
    expect(busca.itens.map((conta) => ({ codigo: conta.codigo, arquivada: conta.arquivada }))).toEqual([
      { codigo: '3', arquivada: true },
    ]);
    // Curinga do LIKE é literal na busca.
    expect((await como((cli) => listarPlano(cli, empresaId, 1, 10, '%'))).total).toBe(0);

    expect(await contarContasValidasDe(empresaId)).toBe(3);
    const vigentes = await comoWorker(empresaId, (cli) => carregarContasVigentes(cli, empresaId));
    expect([...vigentes].sort((a, b) => a.codigo.localeCompare(b.codigo))).toEqual([
      { codigo: '1', tipo: 'sintetica', arquivada: false, temFilhas: true, contaPai: null },
      { codigo: '1.1', tipo: 'analitica', arquivada: false, temFilhas: false, contaPai: '1' },
      { codigo: '2', tipo: 'sintetica', arquivada: false, temFilhas: false, contaPai: null },
      { codigo: '3', tipo: 'sintetica', arquivada: true, temFilhas: false, contaPai: null },
    ]);
  });
});
