/**
 * Repositório da importação de empregados (SPEC-014 §3.4–§3.11, §6.3, §6.4).
 *
 * O ciclo de vida da tentativa é o genérico da F13 (`importacao-ciclo.ts`) com o descritor de
 * empregados; aqui ficam provados o staging, a aplicação pela chave CPF + matrícula, a versão
 * otimista da base, o reuso/obsolescência, as notificações para N destinatários e as consultas.
 * Roda como `contaia_app`, dentro de `comContextoHumano` ou do contexto técnico da empresa.
 */
import { randomUUID } from 'node:crypto';

import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  contextoTecnico,
  type LinhaDeStagingDeEmpregado,
} from '@contaia/domain';
import { HistoricoDeImportacoesSchema, PaginaDeEmpregadosSchema } from '@contaia/shared';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto } from './contexto.js';
import {
  carregarEmpregadosVigentes,
  contarEmpregadosConfirmados,
  listarEmpregados,
  listarLinhasParaRelatorioDeEmpregados,
  listarRejeicoesDeEmpregados,
} from './repositorios/empregados-consultas.js';
import {
  aplicarLinhasDeEmpregados,
  criarNotificacoesDeImportacaoDeEmpregados,
  criarTentativaDeEmpregados,
  gravarResultadoDaValidacaoDeEmpregados,
  listarAdminsAutorizadosDaEmpresa,
} from './repositorios/empregados.js';
import {
  DESCRITOR_EMPREGADOS,
  buscarTentativa,
  cancelar,
  confirmar,
  finalizar,
  iniciarValidacao,
  type NovaTentativa,
  type TentativaDoCiclo,
} from './repositorios/importacao-ciclo.js';
import { listarHistorico } from './repositorios/importacao-ciclo-consultas.js';
import { listarPainel, marcarComoLida } from './repositorios/notificacoes.js';
import { dispensar, reconciliar } from './repositorios/pendencias.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';
import { comoUsuario } from './testes/suporte.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();
const D = DESCRITOR_EMPREGADOS;

let c: Cenario;
let usuario: string;

type Executar<T> = (cliente: PoolClient) => Promise<T>;

const como = <T>(executar: Executar<T>, usuarioId: string = usuario): Promise<T> =>
  comoUsuario(app, c.tenantA, usuarioId, executar);

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

const erroDe = async (executar: () => Promise<unknown>): Promise<string> => {
  try {
    await executar();

    return 'nao_lancou';
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro.codigo;
    }

    return (erro as { code?: string; message?: string }).code ?? (erro as Error).message;
  }
};

let instante = Date.parse('2026-10-11T12:00:00.000Z');
const agora = (): Date => new Date((instante += 1000));

const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

const CPF_A = '52998224725';
const CPF_B = '11144477735';
const CPF_C = '39053344705';

const MAPEAMENTO = {
  cpf: 'CPF',
  nome: 'Nome',
  matricula: 'Matricula',
  data_nascimento: 'Nascimento',
  data_admissao: 'Admissao',
};

let empresas = 0;

/** Empresa nova do tenant A, na carteira do usuário do teste: versão e base isoladas. */
const novaEmpresa = async (): Promise<string> => {
  empresas += 1;
  const cnpj = `G${String(empresas).padStart(3, '0')}${c.sufixo}`.slice(0, 14);
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao)
     values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
    [c.tenantA, cnpj, `Empresa empregados ${cnpj}`],
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
  arquivoNome: 'empregados.csv',
  arquivoTamanho: 120,
  arquivoChave: `${c.tenantA}/${empresaId}/empregados/${randomUUID()}.csv`,
  usuarioIniciadorId: usuario,
  correlationId: 'teste-empregados',
  agora: agora(),
});

const valida = (
  numeroDaLinha: number,
  cpf: string,
  matricula: string,
  opcoes: Readonly<{ acao?: 'INCLUIR' | 'ATUALIZAR'; nome?: string; nascimento?: string; admissao?: string }> = {},
): LinhaDeStagingDeEmpregado => ({
  numeroDaLinha,
  cpf,
  cpfNormalizado: cpf,
  nome: opcoes.nome ?? `Empregado ${matricula}`,
  matricula,
  dataNascimento: opcoes.nascimento ?? '1990-05-10',
  dataAdmissao: opcoes.admissao ?? '2015-03-01',
  chave: `${cpf}|${matricula}`,
  status: 'VALIDA',
  acao: opcoes.acao ?? 'INCLUIR',
  codigoDeErro: null,
  campo: null,
  mensagem: null,
});

const rejeitada = (numeroDaLinha: number, matricula: string | null): LinhaDeStagingDeEmpregado => ({
  numeroDaLinha,
  cpf: '529.982.247-25',
  cpfNormalizado: CPF_A,
  nome: 'Rejeitado',
  matricula,
  dataNascimento: '31/02/1990',
  dataAdmissao: '2015-03-01',
  chave: matricula === null ? null : `${CPF_A}|${matricula}`,
  status: 'REJEITADA',
  acao: null,
  codigoDeErro: 'DATA_NASCIMENTO_INVALIDA',
  campo: 'data_nascimento',
  mensagem: 'Data de nascimento inválida: use dd/mm/aaaa ou aaaa-mm-dd.',
});

/** Upload → validação no worker → prévia (AGUARDANDO_CONFIRMACAO ou REJEITADA). */
const prepararPrevia = async (
  empresaId: string,
  linhas: readonly LinhaDeStagingDeEmpregado[],
  hash: string = hex64(),
): Promise<TentativaDoCiclo> => {
  const criada = await como((cli) => criarTentativaDeEmpregados(cli, novaTentativa(empresaId, { hash })));
  const inicio = await comoWorker(empresaId, (cli) => iniciarValidacao(cli, D, empresaId, criada.id, agora()));
  await comoWorker(empresaId, (cli) =>
    gravarResultadoDaValidacaoDeEmpregados(cli, empresaId, criada.id, linhas, inicio.versaoNaValidacao, agora()),
  );

  return (await como((cli) => buscarTentativa(cli, D, empresaId, criada.id)))!;
};

/** O caso de uso da confirmação numa transação: confirmar → aplicar → finalizar. */
const confirmarEAplicar = (empresaId: string, tentativa: TentativaDoCiclo) =>
  como(async (cli) => {
    await confirmar(cli, D, {
      empresaId,
      tentativaId: tentativa.id,
      usuarioId: usuario,
      versaoDaPrevia: tentativa.versaoNaValidacao!,
    });
    const resultado = await aplicarLinhasDeEmpregados(cli, { empresaId, tentativaId: tentativa.id, agora: agora() });
    await finalizar(cli, D, empresaId, tentativa.id, 'CONCLUIDA', tentativa.totais!, agora());

    return resultado;
  });

type EmpregadoNoBanco = Readonly<{
  cpf: string;
  matricula: string;
  nome: string;
  data_nascimento: string;
  data_admissao: string;
  arquivado: boolean;
}>;

const baseDe = async (empresaId: string): Promise<EmpregadoNoBanco[]> => {
  const { rows } = await admin.query<EmpregadoNoBanco>(
    `select cpf, matricula, nome, data_nascimento::text, data_admissao::text, arquivado
       from app.empregado where empresa_id = $1 order by cpf, matricula`,
    [empresaId],
  );

  return rows;
};

const versaoDaBase = async (empresaId: string): Promise<number | null> => {
  const { rows } = await admin.query<{ versao: string }>(
    `select versao::text from app.empresa_empregados_versao where empresa_id = $1`,
    [empresaId],
  );

  return rows[0] === undefined ? null : Number(rows[0].versao);
};

const empregadoComoAdmin = async (
  empresaId: string,
  cpf: string,
  matricula: string,
  opcoes: Readonly<{ arquivado?: boolean; nome?: string }> = {},
): Promise<void> => {
  await admin.query(
    `insert into app.empregado
       (tenant_id, empresa_id, cpf, nome, matricula, data_nascimento, data_admissao, arquivado, arquivado_em)
     values ($1, $2, $3, $4, $5, '1980-01-01', '2000-01-01', $6, case when $6 then now() end)`,
    [c.tenantA, empresaId, cpf, opcoes.nome ?? `Vigente ${matricula}`, matricula, opcoes.arquivado ?? false],
  );
};

beforeAll(async () => {
  c = await montarCenario(admin);
  usuario = c.usuarios.naCarteira;
}, 60_000);

afterAll(async () => {
  await limparCenario(admin, c);
  await Promise.all([admin.end(), app.end()]);
});

describe('tentativa: idempotência e obsolescência (SPEC-014 §3.7)', () => {
  it('nasce RECEBIDA; mesmo hash e mapeamento reutiliza; mapeamento diferente é nova', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const primeira = await como((cli) => criarTentativaDeEmpregados(cli, novaTentativa(empresaId, { hash })));
    const segunda = await como((cli) => criarTentativaDeEmpregados(cli, novaTentativa(empresaId, { hash })));
    const outra = await como((cli) =>
      criarTentativaDeEmpregados(cli, novaTentativa(empresaId, { hash, mapeamento: { ...MAPEAMENTO, nome: 'Nome2' } })),
    );

    expect(primeira).toMatchObject({ estado: 'RECEBIDA', reutilizada: false, versaoNaValidacao: null, totais: null });
    expect(segunda).toMatchObject({ id: primeira.id, reutilizada: true });
    expect(outra.id).not.toBe(primeira.id);
  });

  it('resultado terminal é reaproveitado só enquanto a base não muda; depois, tentativa nova', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const concluida = await prepararPrevia(empresaId, [valida(1, CPF_A, '1')], hash);
    await confirmarEAplicar(empresaId, concluida);

    // Base igual à do fim da aplicação (versão da validação + 1): reaproveita.
    const reuso = await como((cli) => criarTentativaDeEmpregados(cli, novaTentativa(empresaId, { hash })));
    expect(reuso).toMatchObject({ id: concluida.id, reutilizada: true, estado: 'CONCLUIDA' });

    // Outra importação muda a base: o mesmo arquivo e mapeamento valida de novo.
    await confirmarEAplicar(empresaId, await prepararPrevia(empresaId, [valida(1, CPF_B, '2')]));
    const nova = await como((cli) => criarTentativaDeEmpregados(cli, novaTentativa(empresaId, { hash })));

    expect(nova).toMatchObject({ reutilizada: false, estado: 'RECEBIDA' });
    expect(nova.id).not.toBe(concluida.id);
    const antiga = await como((cli) => buscarTentativa(cli, D, empresaId, concluida.id));
    expect(antiga).toMatchObject({ estado: 'CONCLUIDA', reutilizadaPorIdempotencia: true });
  });

  it('REJEITADA é reaproveitada com a base igual e revalidada depois que ela muda', async () => {
    const empresaId = await novaEmpresa();
    const hash = hex64();
    const rejeitadaTentativa = await prepararPrevia(empresaId, [rejeitada(1, '9')], hash);
    expect(rejeitadaTentativa.estado).toBe('REJEITADA');

    const reuso = await como((cli) => criarTentativaDeEmpregados(cli, novaTentativa(empresaId, { hash })));
    expect(reuso).toMatchObject({ id: rejeitadaTentativa.id, reutilizada: true });

    await confirmarEAplicar(empresaId, await prepararPrevia(empresaId, [valida(1, CPF_C, '3')]));
    const nova = await como((cli) => criarTentativaDeEmpregados(cli, novaTentativa(empresaId, { hash })));
    expect(nova.id).not.toBe(rejeitadaTentativa.id);
  });
});

describe('validação: staging (SPEC-014 §3.4, §6.4)', () => {
  it('grava staging e totais; reentrega não duplica; nenhuma válida termina REJEITADA', async () => {
    const empresaId = await novaEmpresa();
    await empregadoComoAdmin(empresaId, CPF_B, '7');
    const criada = await como((cli) => criarTentativaDeEmpregados(cli, novaTentativa(empresaId)));
    const inicio = await comoWorker(empresaId, (cli) => iniciarValidacao(cli, D, empresaId, criada.id, agora()));
    expect(inicio).toEqual({ transicionou: true, versaoNaValidacao: 0 });

    const linhas = [valida(1, CPF_A, '1'), valida(2, CPF_B, '7', { acao: 'ATUALIZAR' }), rejeitada(3, '1')];
    const gravar = () =>
      comoWorker(empresaId, (cli) =>
        gravarResultadoDaValidacaoDeEmpregados(cli, empresaId, criada.id, linhas, inicio.versaoNaValidacao, agora()),
      );

    expect(await gravar()).toEqual({
      estado: 'AGUARDANDO_CONFIRMACAO',
      totais: { lidas: 3, novas: 1, atualizadas: 1, rejeitadas: 1 },
      transicionou: true,
    });
    expect(await gravar()).toMatchObject({ transicionou: false, totais: { lidas: 3 } });

    const soRejeitadas = await prepararPrevia(empresaId, [rejeitada(1, '1'), rejeitada(2, null)]);
    expect(soRejeitadas).toMatchObject({ estado: 'REJEITADA', totais: { lidas: 2, rejeitadas: 2 } });
    expect(soRejeitadas.finalizadoEm).not.toBeNull();
  });

  it('vigentes no formato da validação: chave CPF|matrícula e marca de arquivado', async () => {
    const empresaId = await novaEmpresa();
    await empregadoComoAdmin(empresaId, CPF_A, '00123');
    await empregadoComoAdmin(empresaId, CPF_A, '123', { arquivado: true });

    const vigentes = await comoWorker(empresaId, (cli) => carregarEmpregadosVigentes(cli, empresaId));

    expect([...vigentes.entries()].sort()).toEqual([
      [`${CPF_A}|00123`, { arquivado: false }],
      [`${CPF_A}|123`, { arquivado: true }],
    ]);
  });
});

describe('confirmação e aplicação transacional (SPEC-014 §3.6, §6.3)', () => {
  it('inclui novos ativos, atualiza os existentes, mantém ausentes e arquivados, sobe a versão', async () => {
    const empresaId = await novaEmpresa();
    await empregadoComoAdmin(empresaId, CPF_A, '1', { nome: 'Nome antigo' });
    await empregadoComoAdmin(empresaId, CPF_B, 'ausente');
    await empregadoComoAdmin(empresaId, CPF_C, 'arq', { arquivado: true, nome: 'Arquivado' });

    const previa = await prepararPrevia(empresaId, [
      valida(1, CPF_A, '1', { acao: 'ATUALIZAR', nome: 'Nome novo', admissao: '2016-04-01' }),
      valida(2, CPF_A, '2'),
      valida(3, CPF_C, 'arq', { acao: 'ATUALIZAR', nome: 'Tentou reativar' }),
      rejeitada(4, '9'),
    ]);
    const resultado = await confirmarEAplicar(empresaId, previa);

    expect(resultado).toEqual({ incluidas: 1, atualizadas: 1, ignoradas: 1, versaoDaBase: 1 });
    expect(await baseDe(empresaId)).toEqual([
      { cpf: CPF_C, matricula: 'arq', nome: 'Arquivado', data_nascimento: '1980-01-01', data_admissao: '2000-01-01', arquivado: true },
      { cpf: CPF_B, matricula: 'ausente', nome: 'Vigente ausente', data_nascimento: '1980-01-01', data_admissao: '2000-01-01', arquivado: false },
      { cpf: CPF_A, matricula: '1', nome: 'Nome novo', data_nascimento: '1990-05-10', data_admissao: '2016-04-01', arquivado: false },
      { cpf: CPF_A, matricula: '2', nome: 'Empregado 2', data_nascimento: '1990-05-10', data_admissao: '2015-03-01', arquivado: false },
    ].sort((a, b) => `${a.cpf}${a.matricula}`.localeCompare(`${b.cpf}${b.matricula}`)));
    expect(await versaoDaBase(empresaId)).toBe(1);
    expect(await como((cli) => buscarTentativa(cli, D, empresaId, previa.id))).toMatchObject({ estado: 'CONCLUIDA' });
  });

  it('confirmar a mesma prévia de novo não cria outro empregado nem reaplica', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, CPF_A, '1')]);
    await confirmarEAplicar(empresaId, previa);

    expect(await erroDe(() => confirmarEAplicar(empresaId, previa))).toBe(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO);
    expect(await baseDe(empresaId)).toHaveLength(1);
  });

  it('base alterada entre a validação e a confirmação: CONFLITO_DE_VERSAO (409) e nada aplicado', async () => {
    const empresaId = await novaEmpresa();
    const obsoleta = await prepararPrevia(empresaId, [valida(1, CPF_A, '1')]);
    await confirmarEAplicar(empresaId, await prepararPrevia(empresaId, [valida(1, CPF_B, '2')]));

    let erro: unknown;
    try {
      await confirmarEAplicar(empresaId, obsoleta);
    } catch (falha) {
      erro = falha;
    }

    expect(erro).toBeInstanceOf(ErroDeConflito);
    expect((erro as ErroDeConflito).codigo).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
    expect((await baseDe(empresaId)).map((e) => e.cpf)).toEqual([CPF_B]);
    expect(await versaoDaBase(empresaId)).toBe(1);
  });

  it('versão alterada depois da confirmação, antes de aplicar: CONFLITO_DE_VERSAO na aplicação', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, CPF_A, '1')]);

    const codigo = await erroDe(() =>
      como(async (cli) => {
        await confirmar(cli, D, { empresaId, tentativaId: previa.id, usuarioId: usuario, versaoDaPrevia: 0 });
        await admin.query(`update app.empresa_empregados_versao set versao = versao + 1 where empresa_id = $1`, [
          empresaId,
        ]);
        await aplicarLinhasDeEmpregados(cli, { empresaId, tentativaId: previa.id, agora: agora() });
      }),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
    expect(await baseDe(empresaId)).toEqual([]);
  });

  it('falha injetada depois de aplicar reverte tudo: base, versão e estado da tentativa', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, CPF_A, '1'), valida(2, CPF_B, '2')]);

    const codigo = await erroDe(() =>
      como(async (cli) => {
        await confirmar(cli, D, { empresaId, tentativaId: previa.id, usuarioId: usuario, versaoDaPrevia: 0 });
        const resultado = await aplicarLinhasDeEmpregados(cli, { empresaId, tentativaId: previa.id, agora: agora() });
        expect(resultado.incluidas).toBe(2);
        throw new Error('falha injetada');
      }),
    );

    expect(codigo).toBe('falha injetada');
    expect(await baseDe(empresaId)).toEqual([]);
    expect(await versaoDaBase(empresaId)).toBe(0);
    expect(await como((cli) => buscarTentativa(cli, D, empresaId, previa.id))).toMatchObject({
      estado: 'AGUARDANDO_CONFIRMACAO',
      usuarioConfirmadorId: null,
    });
  });

  it('duas confirmações simultâneas: uma aplica, a outra recebe ESTADO_INVALIDO_PARA_ACAO', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, CPF_A, '1')]);

    const resultados = await Promise.all([
      erroDe(() => confirmarEAplicar(empresaId, previa)),
      erroDe(() => confirmarEAplicar(empresaId, previa)),
    ]);

    expect(resultados.sort()).toEqual([CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'nao_lancou'].sort());
    expect(await baseDe(empresaId)).toHaveLength(1);
    expect(await versaoDaBase(empresaId)).toBe(1);
  });

  it('cancelar não toca a base e fecha a prévia', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [valida(1, CPF_A, '1')]);
    const cancelada = await como((cli) =>
      cancelar(cli, D, { empresaId, tentativaId: previa.id, usuarioId: usuario, agora: agora() }),
    );

    expect(cancelada).toMatchObject({ estado: 'CANCELADA', usuarioCanceladorId: usuario });
    expect(await baseDe(empresaId)).toEqual([]);
  });
});

describe('notificações para N destinatários (SPEC-014 §3.10)', () => {
  it('administradores autorizados: admin_escritorio ATIVO com a empresa na carteira, também pelo worker', async () => {
    const empresaId = await novaEmpresa();
    const suspenso = c.usuarios.suspenso;
    await admin.query(
      `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3), ($1, $4, $3)`,
      [c.tenantA, c.usuarios.admin, empresaId, suspenso],
    );
    await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'admin_escritorio')`, [
      c.tenantA,
      suspenso,
    ]);

    // O usuário da carteira (não admin) e o admin suspenso também têm vínculo: nenhum é destinatário.
    expect(await como((cli) => listarAdminsAutorizadosDaEmpresa(cli, empresaId))).toEqual([c.usuarios.admin]);
    expect(await comoWorker(empresaId, (cli) => listarAdminsAutorizadosDaEmpresa(cli, empresaId))).toEqual([
      c.usuarios.admin,
    ]);
    // Empresa fora do alcance da sessão: nada (nem a existência de administradores vaza).
    expect(await comoWorker(c.empresaA2, (cli) => listarAdminsAutorizadosDaEmpresa(cli, empresaId))).toEqual([]);
    expect(await como((cli) => listarAdminsAutorizadosDaEmpresa(cli, empresaId), c.usuarios.fora)).toEqual([]);
    // A1: o admin ativo não tem vínculo e o suspenso tem, mas está suspenso.
    expect(await como((cli) => listarAdminsAutorizadosDaEmpresa(cli, c.empresaA1))).toEqual([]);
  });

  it('cria um aviso por destinatário, idempotente; cada um vê o seu no sino e o marca como lido', async () => {
    const empresaId = await novaEmpresa();
    await admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
      c.tenantA,
      c.usuarios.admin,
      empresaId,
    ]);
    const previa = await prepararPrevia(empresaId, [valida(1, CPF_A, '1'), rejeitada(2, '2')]);
    await confirmarEAplicar(empresaId, previa);
    const destinatarios = [usuario, c.usuarios.admin, usuario];
    const notificar = () =>
      comoWorker(empresaId, (cli) =>
        criarNotificacoesDeImportacaoDeEmpregados(cli, { empresaId, tentativaId: previa.id, destinatarios, agora: agora() }),
      );

    expect(await notificar()).toBe(2);
    expect(await notificar()).toBe(0);

    const doSino = async (usuarioId: string) =>
      (await como((cli) => listarPainel(cli, c.tenantA, usuarioId), usuarioId)).filter(
        (n) => n.tipo === 'IMPORTACAO_EMPREGADOS_CONCLUIDA',
      );
    const doIniciador = await doSino(usuario);

    expect(doIniciador).toHaveLength(1);
    expect(doIniciador[0]).toMatchObject({
      empresaId,
      chave: `importacao-empregados:${previa.id}`,
      lida: false,
      importacao: { tentativaId: previa.id, estado: 'CONCLUIDA', totais: { lidas: 2, novas: 1, rejeitadas: 1 } },
    });
    expect(await doSino(c.usuarios.admin)).toHaveLength(1);
    expect(await doSino(c.usuarios.duasEmpresas)).toEqual([]);

    const lida = await como((cli) => marcarComoLida(cli, c.tenantA, doIniciador[0]!.id, usuario));
    expect(lida).toMatchObject({ lida: true });
    expect(await como((cli) => marcarComoLida(cli, c.tenantA, doIniciador[0]!.id, c.usuarios.admin), c.usuarios.admin)).toBeNull();
  });

  it('tentativa de outra empresa é TENTATIVA_NAO_ENCONTRADA', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [rejeitada(1, '1')]);

    expect(
      await erroDe(() =>
        como((cli) =>
          criarNotificacoesDeImportacaoDeEmpregados(cli, {
            empresaId: c.empresaA1,
            tentativaId: previa.id,
            destinatarios: [usuario],
            agora: agora(),
          }),
        ),
      ),
    ).toBe(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA);
  });
});

describe('consultas (SPEC-014 §3.5, §3.9)', () => {
  it('base paginada no contrato compartilhado, com busca literal por nome, matrícula ou CPF', async () => {
    const empresaId = await novaEmpresa();
    await empregadoComoAdmin(empresaId, CPF_A, '1', { nome: 'Ana 100%' });
    await empregadoComoAdmin(empresaId, CPF_B, '2', { nome: 'Bruno' });
    await empregadoComoAdmin(empresaId, CPF_C, 'X_9', { nome: 'Carla', arquivado: true });

    const pagina = await como((cli) => listarEmpregados(cli, empresaId, 1, 2));
    expect(PaginaDeEmpregadosSchema.parse(pagina)).toEqual(pagina);
    expect(pagina).toMatchObject({ pagina: 1, itensPorPagina: 2, total: 3 });
    expect(pagina.itens.map((e) => e.nome)).toEqual(['Ana 100%', 'Bruno']);
    expect(pagina.itens[0]).toMatchObject({ cpf: CPF_A, dataNascimento: '1980-01-01', dataAdmissao: '2000-01-01', arquivado: false });

    const nomes = async (busca: string) =>
      (await como((cli) => listarEmpregados(cli, empresaId, 1, 10, busca))).itens.map((e) => e.nome);
    expect(await nomes('100%')).toEqual(['Ana 100%']);
    expect(await nomes('%')).toEqual(['Ana 100%']);
    expect(await nomes('X_')).toEqual(['Carla']);
    expect(await nomes('111.444')).toEqual(['Bruno']);
    expect(await como((cli) => contarEmpregadosConfirmados(cli, empresaId))).toBe(2);
    expect((await como((cli) => listarEmpregados(cli, empresaId, 1, 10), c.usuarios.fora)).total).toBe(0);
  });

  it('a busca só casa o CPF quando o termo tem forma de CPF (dígitos, ponto e traço)', async () => {
    const empresaId = await novaEmpresa();
    await empregadoComoAdmin(empresaId, CPF_A, '1', { nome: 'Ana' });
    await empregadoComoAdmin(empresaId, CPF_C, 'X_9', { nome: 'Carla' });

    const nomes = async (busca: string) =>
      (await como((cli) => listarEmpregados(cli, empresaId, 1, 10, busca))).itens.map((e) => e.nome);
    // "X_9" tem um dígito que aparece no CPF da Ana: não é termo de CPF, então só a matrícula casa.
    expect(CPF_A).toContain('9');
    expect(await nomes('X_9')).toEqual(['Carla']);
    expect(await nomes('Ana 9')).toEqual([]);
    expect(await nomes(`${CPF_A.slice(0, 3)}.${CPF_A.slice(3, 6)}`)).toEqual(['Ana']);
    expect(await nomes(CPF_A.slice(-4))).toEqual(['Ana']);
  });

  it('rejeições paginadas, relatório completo em ordem de linha e histórico no contrato', async () => {
    const empresaId = await novaEmpresa();
    const previa = await prepararPrevia(empresaId, [rejeitada(3, '3'), valida(1, CPF_A, '1'), rejeitada(2, null)]);

    const rejeicoes = await como((cli) => listarRejeicoesDeEmpregados(cli, empresaId, previa.id, 1, 1));
    expect(rejeicoes).toEqual({
      pagina: 1,
      itensPorPagina: 1,
      total: 2,
      itens: [
        {
          numeroDaLinha: 2,
          cpf: '529.982.247-25',
          matricula: null,
          campo: 'data_nascimento',
          codigoDeErro: 'DATA_NASCIMENTO_INVALIDA',
          mensagem: 'Data de nascimento inválida: use dd/mm/aaaa ou aaaa-mm-dd.',
        },
      ],
    });

    const relatorio = await como(async (cli) => {
      const linhas = [];
      for await (const linha of listarLinhasParaRelatorioDeEmpregados(cli, empresaId, previa.id)) {
        linhas.push(linha);
      }
      return linhas;
    });
    expect(relatorio.map((l) => [l.numeroDaLinha, l.status, l.dataNascimento])).toEqual([
      [1, 'VALIDA', '1990-05-10'],
      [2, 'REJEITADA', '31/02/1990'],
      [3, 'REJEITADA', '31/02/1990'],
    ]);
    expect(relatorio[0]).toMatchObject({ cpf: CPF_A, nome: 'Empregado 1', matricula: '1', acao: 'INCLUIR' });

    const historico = await como((cli) => listarHistorico(cli, D, empresaId, 1));
    expect(HistoricoDeImportacoesSchema.parse(historico)).toEqual(historico);
    expect(historico.itens.map((t) => t.id)).toEqual([previa.id]);
  });
});

describe('pendência de empregados não é dispensável (SPEC-014 §3.10)', () => {
  it('dispensar a pendência EMPREGADOS é recusado', async () => {
    const empresaId = await novaEmpresa();
    await como((cli) =>
      reconciliar(
        cli,
        c.tenantA,
        empresaId,
        [{ origem: 'EMPREGADOS', tipo: 'EMPREGADOS_NAO_IMPORTADOS', chave: 'empregados:nao-importados', dataLimite: null }],
        [],
        null,
      ),
    );
    const { rows } = await admin.query<{ id: string }>(
      `select id from app.empresa_pendencia where empresa_id = $1 and origem = 'EMPREGADOS' and estado = 'ABERTA'`,
      [empresaId],
    );

    expect(
      await erroDe(() => como((cli) => dispensar(cli, c.tenantA, empresaId, rows[0]!.id, usuario, 'esconder'))),
    ).toBe(CODIGOS_DE_ERRO.PENDENCIA_NAO_DISPENSAVEL);
  });
});
