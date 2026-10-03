/**
 * Cofre local de certificados A1 (SPEC-011): metadados, versões, tickets e alertas.
 *
 * Roda com a role `contaia_app`, sem BYPASSRLS — o caminho real da aplicação. O que
 * estas provas defendem, em ordem de gravidade: um tenant/empresa fora da carteira não
 * enxerga nem altera o cofre; só existe um vigente por empresa e a substituição é
 * atômica (nova + encerramento + evento se desfazem juntos); metadado é imutável e o
 * histórico é append-only; o ticket de ingestão vale uma vez, mesmo sob concorrência; a
 * reconciliação de pendências e alertas é idempotente; e nada guarda segredo.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  dataCivilEmSaoPaulo,
  diasParaVencer,
  estadoNoCofre,
  ErroDeDominio,
  CODIGOS_DE_ERRO,
} from '@contaia/domain';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, obterUrlDaAplicacao } from './client.js';
import { comContextoHumano } from './contexto.js';
import {
  ativarVersao,
  consumirTicketDeIngestao,
  desativarVigente,
  emitirTicketDeIngestao,
  listarHistoricoDeCertificados,
  listarVersoesDoCertificado,
  registrarEventoDeCertificado,
  trocarResponsavel,
  carregarVigente,
  type DadosDoCertificado,
} from './repositorios/certificados.js';
import {
  carregarItemDoCofre,
  listarCofre,
  listarResponsaveisElegiveis,
  reconciliarCofre,
  type FiltroDoCofre,
} from './repositorios/certificados-cofre.js';
import { identidadeDoUsuario } from './repositorios/identidade.js';
import { contarNaoLidas, listarPainel, marcarComoLida } from './repositorios/notificacoes.js';
import { listarCentral } from './repositorios/pendencias.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';

const admin = criarPool();
const app = new Pool({ connectionString: obterUrlDaAplicacao(), max: 8 });

let c: Cenario;
let hoje = '';
/** `naCarteira` (contador, A1) e `duasEmpresas` (admin_escritorio, A1+A2). */
let contador = '';
let administrador = '';

const dias = (n: number): string => {
  const base = new Date(`${hoje}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + n);

  return base.toISOString().slice(0, 10);
};

const como = <T>(
  usuarioId: string,
  executar: (cliente: PoolClient) => Promise<T>,
  tenantId: string = c.tenantA,
): Promise<T> =>
  comContextoHumano(
    app,
    { tenantId, usuarioId, finalidade: 'COMUM', correlationId: 'teste-cofre' },
    executar,
  );

let sequencia = 0;
let numeroDaEmpresa = 0;
const dadosDe = (validoAte: string, extra: Partial<DadosDoCertificado> = {}): DadosDoCertificado => {
  sequencia += 1;

  return {
    titular: `EMPRESA DE TESTE ${sequencia}`,
    cnpjTitular: '11222333000181',
    autoridadeCertificadora: 'AC de Teste ContaIA',
    cadeia: ['EMPRESA DE TESTE', 'AC de Teste ContaIA', 'AC Raiz de Teste'],
    numeroSerie: `serie-${sequencia}`,
    impressaoDigital: `IMPRESSAO${sequencia}`.padEnd(64, 'A'),
    validoDe: dias(-300),
    validoAte,
    referenciaSegredo: randomUUID(),
    ...extra,
  };
};

const cadastrar = (
  empresaId: string,
  autorId: string,
  responsavelId: string,
  validoAte = dias(200),
  operacao: 'CADASTRO' | 'SUBSTITUICAO' = 'CADASTRO',
) =>
  como(autorId, (cliente) =>
    ativarVersao(cliente, {
      tenantId: c.tenantA,
      empresaId,
      operacao,
      dados: dadosDe(validoAte),
      responsavelId,
      autorId,
    }),
  );

/** Empresa ATIVA do tenant A com vínculo para quem precisar, criada pelo semeador. */
const novaEmpresa = async (rotulo: string, ...usuarios: string[]): Promise<string> => {
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao)
     values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
    [
      c.tenantA,
      `Z${String((numeroDaEmpresa += 1)).padStart(3, '0')}${c.sufixo}`.slice(0, 14),
      `Empresa ${rotulo} ${c.sufixo}`,
    ],
  );
  const id = rows[0]?.id ?? '';

  for (const usuarioId of usuarios) {
    await admin.query(
      `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`,
      [c.tenantA, usuarioId, id],
    );
  }

  return id;
};

const FILTRO: FiltroDoCofre = {
  carteiraDoUsuarioId: '',
  busca: null,
  estado: null,
  ordem: 'EMPRESA',
  limite: 500,
  deslocamento: 0,
};

const pendenciasAbertas = async (empresaId: string): Promise<string[]> => {
  const { rows } = await admin.query<{ chave: string }>(
    `select chave from app.empresa_pendencia
      where empresa_id = $1 and origem = 'CERTIFICADO' and estado = 'ABERTA' order by chave`,
    [empresaId],
  );

  return rows.map((linha) => linha.chave);
};

const reconciliar = (empresaIds: readonly string[] | null, usuarioId = administrador) =>
  como(usuarioId, (cliente) =>
    reconciliarCofre(cliente, {
      tenantId: c.tenantA,
      usuarioId,
      correlationId: 'teste-cofre',
      hoje,
      empresaIds,
    }),
  );

const codigoDe = async (acao: () => Promise<unknown>): Promise<string> => {
  try {
    await acao();
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro.codigo;
    }
    throw erro;
  }

  return 'nao_lancou';
};

const codigoPg = async (acao: () => Promise<unknown>): Promise<string> => {
  try {
    await acao();
  } catch (erro) {
    return String((erro as { code?: unknown }).code);
  }

  return 'nao_lancou';
};

beforeAll(async () => {
  c = await montarCenario(admin);
  hoje = dataCivilEmSaoPaulo(new Date());
  contador = c.usuarios.naCarteira;
  administrador = c.usuarios.duasEmpresas;

  await admin.query(
    `insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'contador'), ($1, $3, 'admin_escritorio')`,
    [c.tenantA, contador, administrador],
  );
}, 60_000);

afterAll(async () => {
  await limparCenario(admin, c);
  await Promise.all([admin.end(), app.end()]);
});

describe('um vigente por empresa e substituição atômica', () => {
  it('o primeiro cadastro cria a versão 1 vigente', async () => {
    const empresa = await novaEmpresa('Cad1', contador);
    const { nova, anteriorId } = await cadastrar(empresa, contador, contador);

    expect(nova).toMatchObject({ versao: 1, estado: 'VIGENTE', responsavelId: contador });
    expect(anteriorId).toBeNull();
  });

  it('cadastrar com vigente é recusado pelo domínio e nada muda', async () => {
    const empresa = await novaEmpresa('Cad2', contador);
    await cadastrar(empresa, contador, contador);

    expect(await codigoDe(() => cadastrar(empresa, contador, contador))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE,
    );
    expect(await como(contador, (cliente) => listarVersoesDoCertificado(cliente, c.tenantA, empresa))).toHaveLength(1);
  });

  it('o índice único impede dois vigentes mesmo sem passar pelo domínio', async () => {
    const empresa = await novaEmpresa('Cad3', contador);
    await cadastrar(empresa, contador, contador);
    const inserir = (versao: number): Promise<unknown> =>
      como(contador, (cliente) =>
        cliente.query(
          `insert into app.empresa_certificado
             (tenant_id, empresa_id, versao, titular, cnpj_titular, autoridade_certificadora, cadeia,
              numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id,
              referencia_segredo, cadastrado_por)
           values ($1, $2, $3, 'T', '1', 'AC', array['AC'], 's', 'i', $4, $5, $6, $7, $6)`,
          [c.tenantA, empresa, versao, dias(-10), dias(100), contador, randomUUID()],
        ),
      );

    expect(await codigoPg(() => inserir(2))).toBe('23505');
  });

  it('substituir encerra a anterior apontando para a nova e preserva o histórico', async () => {
    const empresa = await novaEmpresa('Sub1', contador);
    const primeira = (await cadastrar(empresa, contador, contador)).nova;
    const segunda = (await cadastrar(empresa, contador, contador, dias(300), 'SUBSTITUICAO')).nova;
    const versoes = await como(contador, (cliente) => listarVersoesDoCertificado(cliente, c.tenantA, empresa));

    expect(versoes.map((v) => [v.versao, v.estado])).toEqual([
      [2, 'VIGENTE'],
      [1, 'SUBSTITUIDO'],
    ]);
    expect(versoes[1]).toMatchObject({
      id: primeira.id,
      substituidoPorId: segunda.id,
      motivoDoEncerramento: 'SUBSTITUICAO',
      encerradoPorId: contador,
      impressaoDigital: primeira.impressaoDigital,
    });
    expect(versoes[1]?.encerradoEm).not.toBeNull();
  });

  it('substituir sem vigente é recusado', async () => {
    const empresa = await novaEmpresa('Sub2', contador);

    expect(await codigoDe(() => cadastrar(empresa, contador, contador, dias(10), 'SUBSTITUICAO'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
    );
  });

  it('falha depois de ativar desfaz tudo: o anterior continua vigente e utilizável', async () => {
    const empresa = await novaEmpresa('Atom', contador);
    const anterior = (await cadastrar(empresa, contador, contador)).nova;

    // O evento fora do domínio viola o CHECK depois de a nova versão e o encerramento já
    // terem sido gravados na MESMA transação: nada disso pode sobrar.
    const falha = como(contador, async (cliente) => {
      await ativarVersao(cliente, {
        tenantId: c.tenantA,
        empresaId: empresa,
        operacao: 'SUBSTITUICAO',
        dados: dadosDe(dias(400)),
        responsavelId: contador,
        autorId: contador,
      });
      await registrarEventoDeCertificado(cliente, {
        tenantId: c.tenantA,
        empresaId: empresa,
        certificadoId: null,
        acao: 'ACAO_INEXISTENTE' as never,
        usuarioId: contador,
        correlationId: 'teste-cofre',
      });
    });

    expect(await codigoPg(() => falha)).toBe('23514');

    const versoes = await como(contador, (cliente) => listarVersoesDoCertificado(cliente, c.tenantA, empresa));
    expect(versoes).toHaveLength(1);
    expect(versoes[0]).toMatchObject({ id: anterior.id, estado: 'VIGENTE', encerradoEm: null });
  });

  it('duas ativações simultâneas na mesma empresa se serializam: uma vence, a outra é recusada', async () => {
    const empresa = await novaEmpresa('Conc', contador, administrador);
    const tentativa = (autor: string) =>
      cadastrar(empresa, autor, contador).then(
        () => 'ok',
        (erro: unknown) => (erro instanceof ErroDeDominio ? erro.codigo : String(erro)),
      );

    const resultados = await Promise.all([tentativa(contador), tentativa(administrador)]);

    expect(resultados.filter((r) => r === 'ok')).toHaveLength(1);
    expect(resultados).toContain(CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE);
    expect(await como(contador, (cliente) => listarVersoesDoCertificado(cliente, c.tenantA, empresa))).toHaveLength(1);
  });
});

describe('desativação', () => {
  it('exige motivo, não apaga nada e deixa a empresa sem vigente', async () => {
    const empresa = await novaEmpresa('Des1', contador);
    const vigente = (await cadastrar(empresa, contador, contador)).nova;
    const desativar = (motivo: string) =>
      como(contador, (cliente) =>
        desativarVigente(cliente, { tenantId: c.tenantA, empresaId: empresa, motivo, autorId: contador }),
      );

    expect(await codigoDe(() => desativar('   '))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_MOTIVO_OBRIGATORIO);
    expect(
      (await como(contador, (cliente) => carregarVigente(cliente, c.tenantA, empresa)))?.id,
    ).toBe(vigente.id);

    const desativada = await desativar('  Troca de titularidade  ');

    expect(desativada).toMatchObject({
      id: vigente.id,
      estado: 'DESATIVADO',
      motivoDoEncerramento: 'DESATIVACAO',
      justificativa: 'Troca de titularidade',
      encerradoPorId: contador,
    });
    expect(await como(contador, (cliente) => carregarVigente(cliente, c.tenantA, empresa))).toBeNull();
    expect(await como(contador, (cliente) => listarVersoesDoCertificado(cliente, c.tenantA, empresa))).toHaveLength(1);
    expect(await codigoDe(() => desativar('de novo'))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE);
  });

  it('depois de desativar, novo cadastro continua a contagem de versões', async () => {
    const empresa = await novaEmpresa('Des2', contador);
    await cadastrar(empresa, contador, contador);
    await como(contador, (cliente) =>
      desativarVigente(cliente, { tenantId: c.tenantA, empresaId: empresa, motivo: 'm', autorId: contador }),
    );

    expect((await cadastrar(empresa, contador, contador)).nova.versao).toBe(2);
  });
});

describe('troca de responsável', () => {
  it('troca por elegível e é idempotente para o mesmo responsável', async () => {
    const empresa = await novaEmpresa('Resp', contador, administrador);
    await cadastrar(empresa, contador, contador);
    const trocar = (novo: string, elegivel = true) =>
      como(contador, (cliente) =>
        trocarResponsavel(cliente, {
          tenantId: c.tenantA,
          empresaId: empresa,
          novoResponsavelId: novo,
          novoElegivel: elegivel,
        }),
      );

    expect(await trocar(administrador)).toMatchObject({
      mudou: true,
      responsavelAnteriorId: contador,
      versao: { responsavelId: administrador },
    });
    expect((await trocar(administrador)).mudou).toBe(false);
    expect(await codigoDe(() => trocar(contador, false))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO,
    );
  });

  it('responsáveis elegíveis: admin e contador ATIVOS com a empresa na carteira', async () => {
    const empresa = await novaEmpresa('Eleg', contador, administrador, c.usuarios.suspenso, c.usuarios.fora);
    await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'contador')`, [
      c.tenantA,
      c.usuarios.suspenso,
    ]);
    await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'auxiliar')`, [
      c.tenantA,
      c.usuarios.fora,
    ]);

    const elegiveis = await como(contador, (cliente) => listarResponsaveisElegiveis(cliente, c.tenantA, empresa));

    expect(elegiveis.map((e) => e.id).sort()).toEqual([administrador, contador].sort());
    expect(elegiveis.find((e) => e.id === administrador)?.papel).toBe('admin_escritorio');
    expect(elegiveis.find((e) => e.id === contador)?.papel).toBe('contador');
  });
});

describe('isolamento por tenant, carteira e RLS', () => {
  it('quem não tem a empresa na carteira não vê nada do cofre dela', async () => {
    const empresa = await novaEmpresa('Iso', contador);
    await cadastrar(empresa, contador, contador);

    expect(await como(c.usuarios.fora, (cliente) => listarVersoesDoCertificado(cliente, c.tenantA, empresa))).toEqual([]);
    expect(await como(c.usuarios.fora, (cliente) => carregarVigente(cliente, c.tenantA, empresa))).toBeNull();
    expect(await como(c.usuarios.fora, (cliente) => carregarItemDoCofre(cliente, c.tenantA, empresa, hoje))).toBeNull();
    expect(
      await como(c.usuarios.deB, (cliente) => listarVersoesDoCertificado(cliente, c.tenantA, empresa), c.tenantB),
    ).toEqual([]);
  });

  it('usuário suspenso, mesmo com vínculo preservado, não grava no cofre', async () => {
    const empresa = await novaEmpresa('Susp', c.usuarios.suspenso, contador);

    expect(await codigoPg(() => cadastrar(empresa, c.usuarios.suspenso, contador))).toBe('42501');
  });

  it('outro tenant não grava versão na empresa alheia', async () => {
    const empresa = await novaEmpresa('Alheia', contador);
    const tentativa = como(
      c.usuarios.deB,
      (cliente) =>
        ativarVersao(cliente, {
          tenantId: c.tenantB,
          empresaId: empresa,
          operacao: 'CADASTRO',
          dados: dadosDe(dias(100)),
          responsavelId: c.usuarios.deB,
          autorId: c.usuarios.deB,
        }),
      c.tenantB,
    );

    // A FK composta (empresa_id, tenant_id) e a RLS impedem a linha cruzada.
    expect(['23503', '42501']).toContain(await codigoPg(() => tentativa));
  });

  it('a lista do cofre só traz as empresas da carteira de quem pergunta', async () => {
    const minha = await novaEmpresa('ListaMinha', contador);
    const alheia = await novaEmpresa('ListaAlheia', administrador);
    const pagina = await como(contador, (cliente) =>
      listarCofre(cliente, c.tenantA, { ...FILTRO, carteiraDoUsuarioId: contador }, hoje),
    );
    const ids = pagina.itens.map((item) => item.empresaId);

    expect(ids).toContain(minha);
    expect(ids).not.toContain(alheia);
    expect(pagina.itens.every((item) => !item.empresaArquivada)).toBe(true);
  });
});

describe('imutabilidade, append-only e ausência de DELETE', () => {
  it('metadado do certificado não muda (privilégio por coluna e trigger)', async () => {
    const empresa = await novaEmpresa('Imut', contador);
    const { nova } = await cadastrar(empresa, contador, contador);

    expect(
      await codigoPg(() =>
        como(contador, (cliente) =>
          cliente.query(`update app.empresa_certificado set titular = 'X' where id = $1`, [nova.id]),
        ),
      ),
    ).toBe('42501');
    // Mesmo o dono da tabela (que contorna o privilégio) esbarra na trigger.
    expect(
      await codigoPg(() => admin.query(`update app.empresa_certificado set titular = 'X' where id = $1`, [nova.id])),
    ).toBe('23001');
  });

  it('versão encerrada não volta a mudar, nem o responsável', async () => {
    const empresa = await novaEmpresa('Imut2', contador, administrador);
    const primeira = (await cadastrar(empresa, contador, contador)).nova;
    await cadastrar(empresa, contador, contador, dias(300), 'SUBSTITUICAO');

    expect(
      await codigoPg(() =>
        admin.query(`update app.empresa_certificado set responsavel_id = $2 where id = $1`, [primeira.id, administrador]),
      ),
    ).toBe('23001');
    expect(
      await codigoPg(() =>
        como(contador, (cliente) =>
          cliente.query(`update app.empresa_certificado set estado = 'VIGENTE' where id = $1`, [primeira.id]),
        ),
      ),
    ).toMatch(/^23/u);
  });

  it('ninguém apaga versão, evento, ticket nem alerta', async () => {
    const empresa = await novaEmpresa('Del', contador);
    const { nova } = await cadastrar(empresa, contador, contador);

    for (const tabela of [
      'empresa_certificado',
      'empresa_certificado_evento',
      'empresa_certificado_ingestao',
      'empresa_certificado_notificacao',
    ]) {
      expect(
        await codigoPg(() => como(contador, (cliente) => cliente.query(`delete from app.${tabela} where empresa_id = $1`, [empresa]))),
      ).toBe('42501');
    }
    expect(nova.id).not.toBe('');
  });

  it('o evento é append-only: nem a aplicação nem o dono alteram ou apagam', async () => {
    const empresa = await novaEmpresa('Hist', contador);
    await como(contador, (cliente) =>
      registrarEventoDeCertificado(cliente, {
        tenantId: c.tenantA,
        empresaId: empresa,
        certificadoId: null,
        acao: 'RECUSA',
        codigo: 'CERTIFICADO_SENHA_INCORRETA',
        usuarioId: contador,
        identidadeTecnica: 'cofre',
        correlationId: 'corr-1',
      }),
    );

    expect(
      await codigoPg(() => como(contador, (cliente) => cliente.query(`update app.empresa_certificado_evento set motivo = 'x' where empresa_id = $1`, [empresa]))),
    ).toBe('42501');
    expect(
      await codigoPg(() => admin.query(`update app.empresa_certificado_evento set motivo = 'x' where empresa_id = $1`, [empresa])),
    ).toBe('23001');
    expect(
      await codigoPg(() => admin.query(`delete from app.empresa_certificado_evento where empresa_id = $1`, [empresa])),
    ).toBe('23001');
  });

  it('o evento exige autor ou identidade técnica e resultado coerente com a ação', async () => {
    const empresa = await novaEmpresa('Hist2', contador);
    const inserir = (acao: string, resultado: string, usuario: string | null) =>
      admin.query(
        `insert into app.empresa_certificado_evento (tenant_id, empresa_id, acao, resultado, usuario_id, correlation_id)
         values ($1, $2, $3, $4, $5, 'c')`,
        [c.tenantA, empresa, acao, resultado, usuario],
      );

    expect(await codigoPg(() => inserir('RECUSA', 'RECUSADO', null))).toBe('23514');
    expect(await codigoPg(() => inserir('CADASTRO', 'RECUSADO', contador))).toBe('23514');
    expect(await codigoPg(() => inserir('RECUSA', 'SUCESSO', contador))).toBe('23514');
  });
});

describe('ticket de ingestão (uso único)', () => {
  const emitir = (empresa: string, usuario = contador) =>
    como(usuario, (cliente) =>
      emitirTicketDeIngestao(cliente, {
        tenantId: c.tenantA,
        empresaId: empresa,
        usuarioId: usuario,
        operacao: 'CADASTRO',
        responsavelId: usuario,
        correlationId: 'corr',
        validadeEmSegundos: 300,
      }),
    );
  const consumir = (id: string, empresa: string, destino: 'CONSUMIDO' | 'RECUSADO' = 'CONSUMIDO', usuario = contador) =>
    como(usuario, (cliente) =>
      consumirTicketDeIngestao(
        cliente,
        {
          id,
          tenantId: c.tenantA,
          empresaId: empresa,
          usuarioId: usuario,
          operacao: 'CADASTRO',
          responsavelId: usuario,
        },
        destino,
      ),
    );

  it('só a primeira tentativa consome; a segunda falha', async () => {
    const empresa = await novaEmpresa('Tk1', contador);
    const ticket = await emitir(empresa);

    expect(await consumir(ticket.id, empresa)).toBe(true);
    expect(await consumir(ticket.id, empresa)).toBe(false);
    expect(await consumir(ticket.id, empresa, 'RECUSADO')).toBe(false);
  });

  it('tentativas simultâneas: exatamente uma vence (conexões e transações independentes)', async () => {
    const empresa = await novaEmpresa('Tk2', contador);
    const ticket = await emitir(empresa);

    const resultados = await Promise.all(Array.from({ length: 6 }, () => consumir(ticket.id, empresa)));

    expect(resultados.filter(Boolean)).toHaveLength(1);
  });

  it('a linha precisa coincidir com a carga: outro usuário ou outra empresa não consome', async () => {
    const empresa = await novaEmpresa('Tk3', contador, administrador);
    const outra = await novaEmpresa('Tk3b', contador);
    const ticket = await emitir(empresa);

    expect(await consumir(ticket.id, outra)).toBe(false);
    expect(await consumir(ticket.id, empresa, 'CONSUMIDO', administrador)).toBe(false);
    expect(await consumir(ticket.id, empresa)).toBe(true);
  });

  it('ticket vencido não ativa; a recusa ainda é registrável e o vencido vira EXPIRADO', async () => {
    const empresa = await novaEmpresa('Tk4', contador);
    const vencido = await admin.query<{ id: string }>(
      `insert into app.empresa_certificado_ingestao
         (tenant_id, empresa_id, usuario_id, operacao, responsavel_id, correlation_id, emitido_em, expira_em)
       values ($1, $2, $3, 'CADASTRO', $3, 'c', now() - interval '10 minutes', now() - interval '5 minutes'),
              ($1, $2, $3, 'CADASTRO', $3, 'c', now() - interval '10 minutes', now() - interval '5 minutes')
       returning id`,
      [c.tenantA, empresa, contador],
    );
    const [ativacao, recusa] = vencido.rows.map((linha) => linha.id);

    expect(await consumir(ativacao ?? '', empresa)).toBe(false);
    expect(await consumir(recusa ?? '', empresa, 'RECUSADO')).toBe(true);

    const { rows } = await admin.query<{ id: string; estado: string }>(
      `select id, estado from app.empresa_certificado_ingestao where id = any($1)`,
      [[ativacao, recusa]],
    );
    expect(rows.find((linha) => linha.id === ativacao)?.estado).toBe('EXPIRADO');
    expect(rows.find((linha) => linha.id === recusa)?.estado).toBe('RECUSADO');
  });

  it('ticket consumido não volta a EMITIDO (trigger)', async () => {
    const empresa = await novaEmpresa('Tk5', contador);
    const ticket = await emitir(empresa);
    await consumir(ticket.id, empresa);

    expect(
      await codigoPg(() =>
        admin.query(`update app.empresa_certificado_ingestao set estado = 'EMITIDO', consumido_em = null where id = $1`, [ticket.id]),
      ),
    ).toBe('23001');
  });
});

describe('lista do cofre: estado, filtros e ordem no SQL', () => {
  it('o estado calculado no SQL coincide com o do domínio em todas as bordas', async () => {
    const bordas = [-1, 0, 7, 8, 15, 16, 30, 31, 400];
    const empresas = new Map<number, string>();

    for (const borda of bordas) {
      const empresa = await novaEmpresa(`Es${borda + 5}`, contador);
      await cadastrar(empresa, contador, contador, dias(borda));
      empresas.set(borda, empresa);
    }

    const pagina = await como(contador, (cliente) =>
      listarCofre(cliente, c.tenantA, { ...FILTRO, carteiraDoUsuarioId: contador }, hoje),
    );

    for (const [borda, empresa] of empresas) {
      const item = pagina.itens.find((i) => i.empresaId === empresa);

      expect(item?.estado, `borda ${borda}`).toBe(
        estadoNoCofre({ vigente: { validoAte: dias(borda) }, temHistorico: true }, hoje),
      );
      expect(item?.diasParaVencer, `borda ${borda}`).toBe(diasParaVencer(dias(borda), hoje));
    }
  });

  it('empresa sem certificado e desativada têm estados próprios', async () => {
    const sem = await novaEmpresa('Sem', contador);
    const des = await novaEmpresa('Des', contador);
    await cadastrar(des, contador, contador);
    await como(contador, (cliente) =>
      desativarVigente(cliente, { tenantId: c.tenantA, empresaId: des, motivo: 'm', autorId: contador }),
    );

    const itemSem = await como(contador, (cliente) => carregarItemDoCofre(cliente, c.tenantA, sem, hoje));
    const itemDes = await como(contador, (cliente) => carregarItemDoCofre(cliente, c.tenantA, des, hoje));

    expect(itemSem).toMatchObject({ estado: 'SEM_CERTIFICADO', certificado: null, diasParaVencer: null });
    expect(itemDes).toMatchObject({ estado: 'DESATIVADO', diasParaVencer: null });
    expect(itemDes?.certificado?.estado).toBe('DESATIVADO');
  });

  it('filtra por estado, busca por nome/CNPJ, ordena e pagina', async () => {
    const a = await novaEmpresa('ZzAaa', contador);
    const b = await novaEmpresa('ZzBbb', contador);
    await cadastrar(a, contador, contador, dias(5));
    await cadastrar(b, contador, contador, dias(500));
    const listar = (parcial: Partial<FiltroDoCofre>) =>
      como(contador, (cliente) =>
        listarCofre(cliente, c.tenantA, { ...FILTRO, carteiraDoUsuarioId: contador, ...parcial }, hoje),
      );

    const vencendo = await listar({ estado: 'VENCE_D7' });
    expect(vencendo.itens.map((i) => i.empresaId)).toContain(a);
    expect(vencendo.itens.map((i) => i.empresaId)).not.toContain(b);

    const porNome = await listar({ busca: 'zzbbb' });
    expect(porNome.itens.map((i) => i.empresaId)).toEqual([b]);

    const curinga = await listar({ busca: '%' });
    expect(curinga.itens).toEqual([]);

    const ordenada = await listar({ ordem: 'VENCIMENTO' });
    const posicao = (id: string): number => ordenada.itens.findIndex((i) => i.empresaId === id);
    expect(posicao(a)).toBeLessThan(posicao(b));

    const pagina = await listar({ limite: 2, deslocamento: 0 });
    expect(pagina.itens).toHaveLength(2);
    expect(pagina.total).toBeGreaterThan(2);
    expect(pagina.resumo.total).toBe(pagina.total);
  });
});

describe('reconciliação de pendências e alertas', () => {
  it('empresa ativa sem certificado abre "ausente" uma vez; cadastrar resolve', async () => {
    const empresa = await novaEmpresa('Rec1', contador);

    expect((await reconciliar([empresa], contador)).pendenciasAbertas).toBe(1);
    expect((await reconciliar([empresa], contador)).pendenciasAbertas).toBe(0);
    expect(await pendenciasAbertas(empresa)).toEqual(['certificado:ausente']);

    await cadastrar(empresa, contador, contador);
    const resultado = await reconciliar([empresa], contador);

    expect(resultado.pendenciasResolvidas).toBe(1);
    expect(await pendenciasAbertas(empresa)).toEqual([]);
  });

  it('desativar reabre a pendência de ausente; a anterior continua no histórico resolvida', async () => {
    const empresa = await novaEmpresa('Rec2', contador);
    await reconciliar([empresa], contador);
    await cadastrar(empresa, contador, contador);
    await reconciliar([empresa], contador);
    await como(contador, (cliente) =>
      desativarVigente(cliente, { tenantId: c.tenantA, empresaId: empresa, motivo: 'm', autorId: contador }),
    );
    await reconciliar([empresa], contador);

    expect(await pendenciasAbertas(empresa)).toEqual(['certificado:ausente']);
    const { rows } = await admin.query<{ estado: string }>(
      `select estado from app.empresa_pendencia where empresa_id = $1 and chave = 'certificado:ausente' order by criado_em`,
      [empresa],
    );
    expect(rows.map((linha) => linha.estado)).toEqual(['RESOLVIDA', 'ABERTA']);
  });

  it('certificado vencido vira pendência com data limite no fim da validade', async () => {
    const empresa = await novaEmpresa('Rec3', contador);
    await cadastrar(empresa, contador, contador, dias(-3));
    await reconciliar([empresa], contador);

    const central = await como(contador, (cliente) =>
      listarCentral(
        cliente,
        {
          carteiraDoUsuarioId: contador,
          empresaId: empresa,
          origem: null,
          tipo: null,
          estado: 'ABERTA',
          vencimento: null,
          limite: 10,
          deslocamento: 0,
        },
        hoje,
      ),
    );

    expect(await pendenciasAbertas(empresa)).toEqual(['certificado:vencido']);
    expect(central.pendencias[0]).toMatchObject({ tipo: 'CERTIFICADO_VENCIDO', origem: 'CERTIFICADO' });
  });

  it('o último dia de validade ainda vale: sem pendência de vencido', async () => {
    const empresa = await novaEmpresa('Rec4', contador);
    await cadastrar(empresa, contador, contador, dias(0));
    await reconciliar([empresa], contador);

    expect(await pendenciasAbertas(empresa)).toEqual([]);
  });

  it('só reconcilia empresas da carteira de quem dispara', async () => {
    const alheia = await novaEmpresa('Rec5', administrador);
    await reconciliar(null, contador);

    expect(await pendenciasAbertas(alheia)).toEqual([]);
  });

  it('empresa em cadastro ou arquivada não recebe pendência de certificado', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao)
       values ($1, $2, 'Em cadastro', 'CADASTRO_INCOMPLETO', 'ativo') returning id`,
      [c.tenantA, `Y${c.sufixo}`.padEnd(14, '1').slice(0, 14)],
    );
    const incompleta = rows[0]?.id ?? '';
    await admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
      c.tenantA,
      contador,
      incompleta,
    ]);
    await reconciliar([incompleta], contador);

    expect(await pendenciasAbertas(incompleta)).toEqual([]);
  });

  it('responsável suspenso: pendência, perda registrada e alerta aos administradores, uma vez', async () => {
    const sai = await admin.query<{ id: string }>(
      `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
       values ($1, $2, $3, 'Contador que sai', 'ATIVO') returning id`,
      [c.tenantA, `sub-sai-${c.sufixo}`, `sai.${c.sufixo}@cofre.local`],
    );
    const responsavel = sai.rows[0]?.id ?? '';
    await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'contador')`, [
      c.tenantA,
      responsavel,
    ]);
    const empresa = await novaEmpresa('Rec6', responsavel, administrador, contador);
    await cadastrar(empresa, administrador, responsavel);
    await reconciliar([empresa], administrador);
    expect(await pendenciasAbertas(empresa)).toEqual([]);

    await admin.query(`update app.usuario set estado = 'SUSPENSO' where id = $1`, [responsavel]);
    const primeira = await reconciliar([empresa], administrador);
    const segunda = await reconciliar([empresa], administrador);

    expect(primeira.responsaveisPerdidos).toBe(1);
    expect(segunda.responsaveisPerdidos).toBe(0);
    expect(await pendenciasAbertas(empresa)).toEqual(['certificado:responsavel']);

    const alertas = await admin.query<{ usuario_id: string; marco: string }>(
      `select usuario_id, marco from app.empresa_certificado_notificacao where empresa_id = $1`,
      [empresa],
    );
    // Só o administrador com a empresa na carteira (o contador não é administrador).
    expect(alertas.rows).toEqual([{ usuario_id: administrador, marco: 'RESPONSAVEL_INCONSISTENTE' }]);

    const perdas = await admin.query(
      `select 1 from app.empresa_certificado_evento where empresa_id = $1 and acao = 'RESPONSAVEL_PERDIDO'`,
      [empresa],
    );
    expect(perdas.rowCount).toBe(1);

    // O certificado continua vigente: a inconsistência não o derruba.
    expect((await como(administrador, (cliente) => carregarVigente(cliente, c.tenantA, empresa)))?.estado).toBe('VIGENTE');

    // Escolher outro responsável elegível encerra a pendência.
    await como(administrador, (cliente) =>
      trocarResponsavel(cliente, {
        tenantId: c.tenantA,
        empresaId: empresa,
        novoResponsavelId: administrador,
        novoElegivel: true,
      }),
    );
    await reconciliar([empresa], administrador);
    expect(await pendenciasAbertas(empresa)).toEqual([]);
  });

  it('perder a carteira também deixa o responsável inconsistente', async () => {
    const empresa = await novaEmpresa('Rec7', contador, administrador);
    await cadastrar(empresa, administrador, contador);
    await admin.query(
      `update app.carteira_vinculo set encerrado_em = now(), encerrado_motivo = 'REMOCAO'
        where empresa_id = $1 and usuario_id = $2`,
      [empresa, contador],
    );
    await reconciliar([empresa], administrador);

    expect(await pendenciasAbertas(empresa)).toEqual(['certificado:responsavel']);
  });

  it('alerta de vencimento: só o marco atual, ao responsável, uma vez por marco', async () => {
    const empresa = await novaEmpresa('Alr1', contador);
    const { nova } = await cadastrar(empresa, contador, contador, dias(6));
    const primeira = await reconciliar([empresa], contador);
    const segunda = await reconciliar([empresa], contador);

    expect(primeira.alertasEmitidos).toBe(1);
    expect(segunda.alertasEmitidos).toBe(0);

    const { rows } = await admin.query<{ marco: string; usuario_id: string }>(
      `select marco, usuario_id from app.empresa_certificado_notificacao where certificado_id = $1`,
      [nova.id],
    );
    expect(rows).toEqual([{ marco: 'D7', usuario_id: contador }]);

    const eventos = await admin.query<{ codigo: string; identidade_tecnica: string }>(
      `select codigo, identidade_tecnica from app.empresa_certificado_evento
        where certificado_id = $1 and acao = 'ALERTA_EMITIDO'`,
      [nova.id],
    );
    expect(eventos.rows).toEqual([{ codigo: 'D7', identidade_tecnica: 'alertas-de-vencimento' }]);
  });

  it.each([
    [29, 'D30'],
    [14, 'D15'],
    [-2, 'VENCIDO'],
  ])('certificado a %i dia(s) do fim gera o marco %s', async (offset, marco) => {
    const empresa = await novaEmpresa(`Alr${offset + 5}`, contador);
    const { nova } = await cadastrar(empresa, contador, contador, dias(offset));
    await reconciliar([empresa], contador);

    const { rows } = await admin.query<{ marco: string }>(
      `select marco from app.empresa_certificado_notificacao where certificado_id = $1`,
      [nova.id],
    );
    expect(rows.map((linha) => linha.marco)).toEqual([marco]);
  });

  it('sem marco (longe do vencimento) não há alerta', async () => {
    const empresa = await novaEmpresa('Alr2', contador);
    const { nova } = await cadastrar(empresa, contador, contador, dias(200));

    expect((await reconciliar([empresa], contador)).alertasEmitidos).toBe(0);
    const { rowCount } = await admin.query(
      `select 1 from app.empresa_certificado_notificacao where certificado_id = $1`,
      [nova.id],
    );
    expect(rowCount).toBe(0);
  });

  it('o alerta entra no sino do responsável, abre a empresa e o marcar como lida vale só para ele', async () => {
    const empresa = await novaEmpresa('Sino', contador, administrador);
    await cadastrar(empresa, administrador, contador, dias(3));
    await reconciliar([empresa], contador);

    const painel = await como(contador, (cliente) => listarPainel(cliente, c.tenantA, contador));
    const alerta = painel.find((n) => n.empresaId === empresa);

    expect(alerta).toMatchObject({ tipo: 'CERTIFICADO_D7', lida: false });
    expect(alerta?.chave).toMatch(/^certificado:.+:D7$/u);
    expect(await como(administrador, (cliente) => listarPainel(cliente, c.tenantA, administrador))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tipo: 'CERTIFICADO_D7', empresaId: empresa })]),
    );

    const antes = await como(contador, (cliente) => contarNaoLidas(cliente, c.tenantA, contador));
    const marcada = await como(contador, (cliente) => marcarComoLida(cliente, c.tenantA, alerta?.id ?? '', contador));
    expect(marcada?.lida).toBe(true);
    expect(await como(contador, (cliente) => contarNaoLidas(cliente, c.tenantA, contador))).toBe(antes - 1);
    // Marcar a notificação alheia responde como inexistente.
    expect(await como(administrador, (cliente) => marcarComoLida(cliente, c.tenantA, alerta?.id ?? '', administrador))).toBeNull();
  });
});

describe('histórico de certificados (aba do Histórico de Informações)', () => {
  it('lista sucessos e recusas da carteira, do mais recente ao mais antigo, com filtros', async () => {
    const empresa = await novaEmpresa('Hst', contador);
    const { nova } = await cadastrar(empresa, contador, contador);
    await como(contador, async (cliente) => {
      await registrarEventoDeCertificado(cliente, {
        tenantId: c.tenantA,
        empresaId: empresa,
        certificadoId: nova.id,
        acao: 'CADASTRO',
        usuarioId: contador,
        identidadeTecnica: 'cofre',
        correlationId: 'corr-a',
      });
      await registrarEventoDeCertificado(cliente, {
        tenantId: c.tenantA,
        empresaId: empresa,
        certificadoId: null,
        acao: 'RECUSA',
        codigo: 'CERTIFICADO_CNPJ_DIVERGENTE',
        usuarioId: contador,
        identidadeTecnica: 'cofre',
        correlationId: 'corr-b',
      });
    });
    const listar = (parcial: object = {}, usuario = contador) =>
      como(usuario, (cliente) =>
        listarHistoricoDeCertificados(cliente, c.tenantA, {
          carteiraDoUsuarioId: usuario,
          empresaId: empresa,
          acao: null,
          resultado: null,
          limite: 20,
          deslocamento: 0,
          ...parcial,
        }),
      );

    const todos = await listar();
    expect(todos.eventos.map((e) => e.acao)).toEqual(['RECUSA', 'CADASTRO']);
    expect(todos.eventos[0]).toMatchObject({
      resultado: 'RECUSADO',
      codigo: 'CERTIFICADO_CNPJ_DIVERGENTE',
      identidadeTecnica: 'cofre',
      correlationId: 'corr-b',
      usuarioNome: expect.any(String),
    });
    expect((await listar({ resultado: 'SUCESSO' })).eventos.map((e) => e.acao)).toEqual(['CADASTRO']);
    expect((await listar({ acao: 'RECUSA' })).total).toBe(1);
    // Fora da carteira: nada.
    expect((await listar({}, c.usuarios.fora)).eventos).toEqual([]);
  });
});

describe('identidade de quem age em nome do ticket', () => {
  it('papéis e permissão vigentes de um usuário ativo; nulo para suspenso ou de outro tenant', async () => {
    const ativo = await como(contador, (cliente) => identidadeDoUsuario(cliente, c.tenantA, contador));
    const suspenso = await como(contador, (cliente) => identidadeDoUsuario(cliente, c.tenantA, c.usuarios.suspenso));
    const deOutro = await como(contador, (cliente) => identidadeDoUsuario(cliente, c.tenantA, c.usuarios.deB));

    expect(ativo).toMatchObject({ usuarioId: contador, tenantId: c.tenantA, papeis: ['contador'] });
    expect(suspenso).toBeNull();
    expect(deOutro).toBeNull();
  });
});

describe('backfill da migração e CHECKs da pendência', () => {
  it('abre "ausente" para empresa ativa sem certificado e é idempotente', async () => {
    const sql = await readFile(new URL('../migrations/0013_cofre_certificados.sql', import.meta.url), 'utf8');
    const backfill = /WITH novas AS \([\s\S]*?FROM novas;/u.exec(sql)?.[0];
    expect(backfill).toBeDefined();

    const sem = await novaEmpresa('Bf1', contador);
    const com = await novaEmpresa('Bf2', contador);
    await cadastrar(com, contador, contador);

    await admin.query(backfill ?? '');
    expect(await pendenciasAbertas(sem)).toEqual(['certificado:ausente']);
    expect(await pendenciasAbertas(com)).toEqual([]);

    await admin.query(backfill ?? '');
    expect(await pendenciasAbertas(sem)).toEqual(['certificado:ausente']);
    const eventos = await admin.query(
      `select 1 from app.empresa_evento_de_pendencia e join app.empresa_pendencia p on p.id = e.pendencia_id
        where p.empresa_id = $1 and p.chave = 'certificado:ausente'`,
      [sem],
    );
    expect(eventos.rowCount).toBe(1);
  });

  it('a pendência aceita a nova origem e recusa tipo inventado', async () => {
    const empresa = await novaEmpresa('Chk', contador);
    const inserir = (origem: string, tipo: string) =>
      admin.query(
        `insert into app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave) values ($1, $2, $3, $4, $5)`,
        [c.tenantA, empresa, origem, tipo, `chk:${tipo}`],
      );

    expect(await codigoPg(() => inserir('CERTIFICADO', 'CERTIFICADO_AUSENTE'))).toBe('nao_lancou');
    expect(await codigoPg(() => inserir('CERTIFICADO', 'CERTIFICADO_INVENTADO'))).toBe('23514');
    expect(await codigoPg(() => inserir('OUTRA', 'CERTIFICADO_AUSENTE'))).toBe('23514');
  });
});

describe('nenhuma coluna guarda segredo', () => {
  it('as tabelas do cofre não têm coluna de arquivo, senha, chave ou token', async () => {
    const { rows } = await admin.query<{ coluna: string }>(
      `select column_name as coluna from information_schema.columns
        where table_schema = 'app' and table_name like 'empresa_certificado%'`,
    );

    for (const { coluna } of rows) {
      expect(coluna).not.toMatch(/senha|password|pkcs|pfx|chave_privada|token|segredo_conteudo|arquivo/iu);
    }
  });
});
