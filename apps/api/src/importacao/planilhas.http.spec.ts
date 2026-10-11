/**
 * Planilha por HTTP real (SPEC-015 §3.1–§3.4, §7, §10), nos dois domínios: inspeção sem estado com o
 * leitor REAL em processo filho, arquivos hostis (código estável, nunca 500, processo vivo), o limite
 * de leituras simultâneas (503 + `Retry-After`), a revalidação do envio ANTES do storage e os modelos
 * XLSX/ODS. A inspeção e as recusas do envio não tocam o banco: o pool é um dublê vazio (qualquer
 * acesso quebraria o teste). Sessão e carteira dubladas; a chave do catálogo é o `GuardDeAcao` real.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio, permissoesDosPapeisPadrao, type PapelPadrao } from '@contaia/domain';
import { lerAba } from '@contaia/planilhas';
import { cfb, entradaBomba, xlsx, xlsxCru } from '@contaia/planilhas/testes';
import { TIPO_DE_CONTEUDO_ODS, TIPO_DE_CONTEUDO_XLSX, type InspecaoDePlanilha } from '@contaia/shared';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GuardDeAcao } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import type { PoolDoBanco } from '../banco/pool.provider';
import { FiltroDeProblema, statusDoErro } from '../comum/problema';
import type { StorageService } from '../comum/storage.service';
import { EmpregadosDaEmpresaController } from '../empregados/empregados.controller';
import { EmpregadosService } from '../empregados/empregados.service';
import { PlanoContasDaEmpresaController } from '../plano-contas/plano-contas.controller';
import { PlanoContasService } from '../plano-contas/plano-contas.service';
import { LEITURA_DE_PLANILHAS_DO_PROCESSO, LimitadorDeLeituras, type LeituraDePlanilhas, type LeitorDePlanilhas } from './planilha';
import { planilhaOds, planilhaXlsx, type AbaDeTeste } from './planilhas-de-teste';

const EMPRESA = '0198f3c2-0000-7000-8000-000000000003';
const CPF = '529.982.247-25';
const NOME = 'Maria Sigilosa';

const sessaoDublada = {
  canActivate: (contexto: { switchToHttp: () => { getRequest: () => RequisicaoAutenticada } }) => {
    const requisicao = contexto.switchToHttp().getRequest();
    const papel = (requisicao.header('x-papel') ?? 'admin_escritorio') as PapelPadrao;

    requisicao.sessao = {
      tenantId: '0198f3c2-0000-7000-8000-000000000001',
      usuarioId: '0198f3c2-0000-7000-8000-000000000002',
      papeis: [papel],
      permissoes: permissoesDosPapeisPadrao([papel]),
    } as unknown as NonNullable<RequisicaoAutenticada['sessao']>;

    return true;
  },
};

const storage = { enviarComChave: vi.fn(), obter: vi.fn() };
const fila = { enfileirar: vi.fn() };
/** Inspeção e recusas não chegam ao banco: o dublê não tem `connect`, e qualquer uso estoura. */
const poolSemBanco = { instancia: {} } as PoolDoBanco;

const montarApp = async (leitura: LeituraDePlanilhas): Promise<INestApplication> => {
  const plano = new PlanoContasService(poolSemBanco, storage as unknown as StorageService, fila, undefined, leitura);
  const empregados = new EmpregadosService(poolSemBanco, storage as unknown as StorageService, fila, undefined, leitura);
  const modulo = await Test.createTestingModule({
    controllers: [PlanoContasDaEmpresaController, EmpregadosDaEmpresaController],
    providers: [
      { provide: PlanoContasService, useValue: plano },
      { provide: EmpregadosService, useValue: empregados },
      Reflector,
      GuardDeAcao,
    ],
  })
    .overrideGuard(GuardDeSessao)
    .useValue(sessaoDublada)
    .overrideGuard(GuardDeCadastro)
    .useValue({ canActivate: () => true })
    .overrideGuard(GuardDeEscopoDeEmpresa)
    .useValue({ canActivate: () => true })
    .compile();
  const app = modulo.createNestApplication();
  app.useGlobalFilters(new FiltroDeProblema());
  await app.init();
  return app;
};

// Toda a saída do processo durante a suíte: nada de CPF, nome ou valor de célula em log.
const saida: string[] = [];
const capturar = (fluxo: NodeJS.WriteStream) =>
  vi.spyOn(fluxo, 'write').mockImplementation((pedaco: string | Uint8Array) => {
    saida.push(String(pedaco));
    return true;
  });

let app: INestApplication;

beforeAll(async () => {
  capturar(process.stdout);
  capturar(process.stderr);
  app = await montarApp(LEITURA_DE_PLANILHAS_DO_PROCESSO);
});

afterAll(async () => {
  await app.close();
  vi.restoreAllMocks();
  const tudo = saida.join('');
  expect(tudo).not.toContain(CPF);
  expect(tudo).not.toContain(NOME);
});

const CABECALHO = ['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao'];
const DADOS = [CPF, NOME, '00123', '15/03/1990', '01/02/2015'];

/** Título na linha 1, linha 2 vazia, cabeçalho na 3, dados na 4 e na 5 (oculta). */
const RELATORIO: AbaDeTeste = {
  nome: 'Dados',
  linhas: [
    { numero: 1, valores: ['Relatório de cadastro'] },
    { numero: 3, valores: CABECALHO },
    { numero: 4, valores: DADOS },
    { numero: 5, valores: ['111.444.777-35', 'João', '00124', '22/11/1985', '10/06/2018'], oculta: true },
  ],
};
const VAZIA: AbaDeTeste = { nome: 'Vazia', linhas: [] };
const SEGUNDA: AbaDeTeste = { nome: 'Segunda', linhas: [{ numero: 2, valores: ['x', 'y'] }, { numero: 3, valores: ['1', '2'] }] };

const DOMINIOS = [
  { dominio: 'plano de contas', rota: 'plano-contas', papel: 'contador', semPermissao: 'auxiliar', modelo: 'modelo-plano-de-contas' },
  { dominio: 'empregados', rota: 'empregados', papel: 'admin_escritorio', semPermissao: 'contador', modelo: 'modelo-empregados' },
] as const;

const binario = (resposta: request.Response, pronto: (erro: Error | null, corpo: Buffer) => void): void => {
  const partes: Buffer[] = [];
  resposta.on('data', (parte: Buffer) => partes.push(parte));
  resposta.on('end', () => pronto(null, Buffer.concat(partes)));
};

describe.each(DOMINIOS)('$dominio: POST planilhas/inspecao', ({ rota, papel, semPermissao }) => {
  const inspecionar = (
    conteudo: Buffer,
    nome = 'cadastro.xlsx',
    campos: Readonly<Record<string, string>> = {},
    instancia: INestApplication = app,
  ) => {
    let pedido = request(instancia.getHttpServer())
      .post(`/empresas/${EMPRESA}/${rota}/planilhas/inspecao`)
      .set('x-papel', papel)
      .attach('arquivo', conteudo, { filename: nome, contentType: 'application/octet-stream' });
    for (const [campo, valor] of Object.entries(campos)) pedido = pedido.field(campo, valor);
    return pedido;
  };

  it('uma aba utilizável (a outra vazia) é escolhida sozinha; cabeçalho sugerido = 1ª linha preenchida', async () => {
    const resposta = await inspecionar(planilhaXlsx(RELATORIO, VAZIA)).expect(200);
    const corpo = resposta.body as InspecaoDePlanilha;

    expect(corpo).toMatchObject({
      formato: 'XLSX',
      abas: [
        { nome: 'Dados', posicao: 1, utilizavel: true },
        { nome: 'Vazia', posicao: 2, utilizavel: false },
      ],
      abaSelecionada: { nome: 'Dados', posicao: 1 },
      linhaCabecalhoSugerida: 1,
      linhaCabecalho: 1,
      colunas: [{ letra: 'A', nome: 'Relatório de cadastro', rotulo: 'Coluna A — Relatório de cadastro' }],
      linhasIgnoradasAntesDoCabecalho: 0,
      cabecalhoMesclado: false,
    });
    expect(corpo.amostra.map((linha) => [linha.numero, linha.oculta])).toEqual([
      [1, false],
      [3, false],
      [4, false],
      [5, true],
    ]);
    // A amostra é do próprio solicitante (é para escolher o cabeçalho): valores exibidos como na planilha.
    expect(corpo.amostra[2]?.celulas).toEqual({ A: CPF, B: NOME, C: '00123', D: '15/03/1990', E: '01/02/2015' });
  });

  it('cabeçalho escolhido: colunas por letra, linhas ignoradas antes dele, ocultas e diagnósticos', async () => {
    const resposta = await inspecionar(planilhaXlsx(RELATORIO), 'cadastro.xlsx', { linhaCabecalho: '3' }).expect(200);
    const corpo = resposta.body as InspecaoDePlanilha;

    expect(corpo.linhaCabecalhoSugerida).toBe(1);
    expect(corpo.linhaCabecalho).toBe(3);
    expect(corpo.colunas.map((coluna) => coluna.rotulo)).toEqual(CABECALHO.map((nome, i) => `Coluna ${'ABCDE'[i]} — ${nome}`));
    expect(corpo.linhasIgnoradasAntesDoCabecalho).toBe(1);
    expect(corpo.linhasOcultas).toBe(1);
    expect(corpo.diagnosticos.map((d) => [d.codigo, d.quantidade])).toEqual([
      ['LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS', 1],
      ['LINHAS_OCULTAS_PROCESSADAS', 1],
    ]);
  });

  it('várias abas utilizáveis sem escolha: lista as abas e espera a seleção; com `aba`, lê a escolhida', async () => {
    const semEscolha = (await inspecionar(planilhaXlsx(RELATORIO, SEGUNDA)).expect(200)).body as InspecaoDePlanilha;

    expect(semEscolha.abas.map((aba) => aba.nome)).toEqual(['Dados', 'Segunda']);
    expect(semEscolha).toMatchObject({ abaSelecionada: null, linhaCabecalho: null, colunas: [], amostra: [] });

    const escolhida = (await inspecionar(planilhaXlsx(RELATORIO, SEGUNDA), 'c.xlsx', { aba: '2' }).expect(200)).body as InspecaoDePlanilha;

    expect(escolhida).toMatchObject({ abaSelecionada: { nome: 'Segunda', posicao: 2 }, linhaCabecalhoSugerida: 2 });
    expect(escolhida.colunas.map((coluna) => coluna.letra)).toEqual(['A', 'B']);
  });

  it.each([
    ['aba inexistente', CODIGOS_DE_ERRO.ABA_INEXISTENTE, planilhaXlsx(RELATORIO), { aba: '9' }],
    ['aba vazia escolhida', CODIGOS_DE_ERRO.ABA_SEM_DADOS, planilhaXlsx(RELATORIO, VAZIA), { aba: '2' }],
    ['nenhuma aba utilizável', CODIGOS_DE_ERRO.PLANILHA_SEM_ABA_UTILIZAVEL, planilhaXlsx(VAZIA), {}],
    ['cabeçalho numa linha em branco', CODIGOS_DE_ERRO.CABECALHO_INVALIDO, planilhaXlsx(RELATORIO), { linhaCabecalho: '2' }],
  ])('%s → 422 %s', async (_caso, codigo, conteudo, campos) => {
    const resposta = await inspecionar(conteudo, 'cadastro.xlsx', campos).expect(422);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ code: codigo, status: 422 });
  });

  it('cabeçalho mesclado aparece na inspeção (bloqueia o mapeamento na tela e no envio)', async () => {
    const mesclada: AbaDeTeste = { ...RELATORIO, mesclas: ['A3:B3'] };
    const corpo = (await inspecionar(planilhaXlsx(mesclada), 'c.xlsx', { linhaCabecalho: '3' }).expect(200)).body as InspecaoDePlanilha;

    expect(corpo.cabecalhoMesclado).toBe(true);
  });

  it('ODS: mesma inspeção, com a linha oculta contada', async () => {
    const corpo = (await inspecionar(planilhaOds(RELATORIO), 'cadastro.ods', { linhaCabecalho: '3' }).expect(200)).body as InspecaoDePlanilha;

    expect(corpo).toMatchObject({ formato: 'ODS', abaSelecionada: { nome: 'Dados', posicao: 1 }, linhasOcultas: 1 });
    expect(corpo.amostra.find((linha) => linha.numero === 4)?.celulas).toMatchObject({ A: CPF, C: '00123' });
  });

  it('CSV não passa pela inspeção (o mapeamento do CSV lê o cabeçalho na tela): 422 ARQUIVO_INVALIDO', async () => {
    const resposta = await inspecionar(Buffer.from('cpf;nome\r\n1;2\r\n'), 'cadastro.csv').expect(422);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO });
  });

  it.each([
    ['aba que não é número', { aba: 'abc' }, 'aba'],
    ['linha zero', { linhaCabecalho: '0' }, 'linhaCabecalho'],
    ['campo fora do contrato (o zod aponta o corpo)', { tenantId: 'x' }, 'corpo'],
  ])('%s → 422 sem ler o arquivo', async (_caso, campos, campo) => {
    const resposta = await inspecionar(planilhaXlsx(RELATORIO), 'c.xlsx', campos).expect(422);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
    expect(JSON.stringify(resposta.body.campos)).toContain(campo);
  });

  it(`sem a permissão de importar (${semPermissao}) → 403, antes do upload`, async () => {
    await request(app.getHttpServer())
      .post(`/empresas/${EMPRESA}/${rota}/planilhas/inspecao`)
      .set('x-papel', semPermissao)
      .attach('arquivo', planilhaXlsx(RELATORIO), { filename: 'c.xlsx' })
      .expect(403);
  });
});

describe('arquivos hostis por HTTP: código estável, nunca 500, processo vivo', () => {
  const ODS_BOM = planilhaOds(RELATORIO);
  const CASOS: ReadonlyArray<readonly [string, number, string, Buffer, string]> = [
    ['bomba de ZIP (200 MiB declarados)', 422, CODIGOS_DE_ERRO.LIMITE_DE_PROCESSAMENTO_EXCEDIDO, Buffer.from(xlsxCru([entradaBomba('xl/sharedStrings.xml', 200)])), 'bomba.xlsx'],
    ['bomba de ZIP com tamanho mentiroso', 422, CODIGOS_DE_ERRO.LIMITE_DE_PROCESSAMENTO_EXCEDIDO, Buffer.from(xlsxCru([entradaBomba('xl/sharedStrings.xml', 200, 4096)])), 'b.xlsx'],
    ['.xls', 422, CODIGOS_DE_ERRO.FORMATO_XLS_NAO_SUPORTADO, Buffer.from(cfb('Workbook')), 'antigo.xls'],
    ['.xls renomeado .xlsx', 422, CODIGOS_DE_ERRO.FORMATO_XLS_NAO_SUPORTADO, Buffer.from(cfb('Workbook')), 'antigo.xlsx'],
    ['.xlsm', 422, CODIGOS_DE_ERRO.FORMATO_XLSM_NAO_SUPORTADO, Buffer.from(xlsx({ macro: true })), 'macro.xlsm'],
    ['.xlsm renomeado .xlsx', 422, CODIGOS_DE_ERRO.FORMATO_XLSM_NAO_SUPORTADO, Buffer.from(xlsx({ macro: true })), 'macro.xlsx'],
    ['cifrado', 422, CODIGOS_DE_ERRO.ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO, Buffer.from(cfb('EncryptionInfo', 'EncryptedPackage')), 'senha.xlsx'],
    ['CSV renomeado .xlsx', 422, CODIGOS_DE_ERRO.EXTENSAO_DIFERENTE_DO_CONTEUDO, Buffer.from(`cpf;nome\r\n${CPF};${NOME}\r\n`), 'texto.xlsx'],
    ['ODS renomeado .xlsx', 422, CODIGOS_DE_ERRO.EXTENSAO_DIFERENTE_DO_CONTEUDO, ODS_BOM, 'troca.xlsx'],
    ['corrompido (ZIP truncado)', 422, CODIGOS_DE_ERRO.ARQUIVO_CORROMPIDO, planilhaXlsx(RELATORIO).subarray(0, 200), 'quebrado.xlsx'],
  ];

  it.each(CASOS)('%s → %i %s', async (_caso, status, codigo, conteudo, nome) => {
    const resposta = await request(app.getHttpServer())
      .post(`/empresas/${EMPRESA}/plano-contas/planilhas/inspecao`)
      .set('x-papel', 'contador')
      .attach('arquivo', conteudo, { filename: nome })
      .expect(status);

    expect(resposta.body).toMatchObject({ code: codigo, status });
    expect(typeof resposta.body.correlationId).toBe('string');
    expect(JSON.stringify(resposta.body)).not.toMatch(/ZIP_BOMBA|DTD|CFB|detalhe/u);
  });

  it('depois dos hostis, uma planilha boa continua sendo lida', async () => {
    await request(app.getHttpServer())
      .post(`/empresas/${EMPRESA}/plano-contas/planilhas/inspecao`)
      .set('x-papel', 'contador')
      .attach('arquivo', planilhaXlsx(RELATORIO), { filename: 'ok.xlsx' })
      .expect(200);
  });
});

describe('envio de planilha: tudo revalidado ANTES do storage (nada é gravado)', () => {
  const MAPA_DE_EMPREGADOS = { cpf: 'A', nome: 'B', matricula: 'C', data_nascimento: 'D', data_admissao: 'E' };
  const enviar = (conteudo: Buffer, campos: Readonly<Record<string, string>>, nome = 'folha.xlsx', mapeamento: object = MAPA_DE_EMPREGADOS) => {
    let pedido = request(app.getHttpServer())
      .post(`/empresas/${EMPRESA}/empregados/importacoes`)
      .set('x-papel', 'admin_escritorio')
      .attach('arquivo', conteudo, { filename: nome })
      .field('mapeamento', JSON.stringify(mapeamento));
    for (const [campo, valor] of Object.entries(campos)) pedido = pedido.field(campo, valor);
    return pedido;
  };

  it.each([
    ['sem aba nem cabeçalho', 400, CODIGOS_DE_ERRO.CONFIGURACAO_DE_PLANILHA_INCOMPLETA, {}],
    ['sem cabeçalho', 400, CODIGOS_DE_ERRO.CONFIGURACAO_DE_PLANILHA_INCOMPLETA, { aba: '1' }],
    ['aba inexistente', 422, CODIGOS_DE_ERRO.ABA_INEXISTENTE, { aba: '7', linhaCabecalho: '3' }],
    ['cabeçalho em branco', 422, CODIGOS_DE_ERRO.CABECALHO_INVALIDO, { aba: '1', linhaCabecalho: '2' }],
    ['cabeçalho só com o título (coluna B não existe)', 422, CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO, { aba: '1', linhaCabecalho: '1' }],
  ])('%s → %i %s', async (_caso, status, codigo, campos) => {
    storage.enviarComChave.mockClear();
    const resposta = await enviar(planilhaXlsx(RELATORIO), campos).expect(status);

    expect(resposta.body).toMatchObject({ code: codigo });
    expect(storage.enviarComChave).not.toHaveBeenCalled();
    expect(fila.enfileirar).not.toHaveBeenCalled();
  });

  it('aba vazia escolhida → 422 ABA_SEM_DADOS', async () => {
    await enviar(planilhaXlsx(RELATORIO, VAZIA), { aba: '2', linhaCabecalho: '1' })
      .expect(422)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.ABA_SEM_DADOS }));
  });

  it('cabeçalho mesclado → 422 CABECALHO_MESCLADO', async () => {
    await enviar(planilhaXlsx({ ...RELATORIO, mesclas: ['A3:B3'] }), { aba: '1', linhaCabecalho: '3' })
      .expect(422)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.CABECALHO_MESCLADO }));
  });

  it.each([
    ['letra fora do cabeçalho', { ...MAPA_DE_EMPREGADOS, data_admissao: 'F' }],
    ['a mesma letra em dois campos', { ...MAPA_DE_EMPREGADOS, nome: 'A' }],
    ['nome do cabeçalho no lugar da letra', { ...MAPA_DE_EMPREGADOS, cpf: 'cpf' }],
    ['letra minúscula', { ...MAPA_DE_EMPREGADOS, cpf: 'a' }],
  ])('mapeamento por letra: %s → 422 MAPEAMENTO_INCOMPLETO', async (_caso, mapeamento) => {
    await enviar(planilhaXlsx(RELATORIO), { aba: '1', linhaCabecalho: '3' }, 'folha.xlsx', mapeamento)
      .expect(422)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO }));
    expect(storage.enviarComChave).not.toHaveBeenCalled();
  });

  it('arquivo hostil no envio → o mesmo código da inspeção', async () => {
    await enviar(Buffer.from(cfb('EncryptionInfo', 'EncryptedPackage')), { aba: '1', linhaCabecalho: '1' })
      .expect(422)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO }));
  });

  it('CSV ignora aba/linhaCabecalho: o envio CSV continua o das F13/F14 (aqui recusa pelo mapeamento)', async () => {
    await enviar(Buffer.from('cpf;nome\r\n1;2\r\n'), { aba: '1', linhaCabecalho: '1' }, 'folha.csv')
      .expect(422)
      .expect((r) => expect(r.body).toMatchObject({ code: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO }));
  });
});

describe('limite de leituras simultâneas: um só para inspeção e envio dos dois domínios', () => {
  let liberar: () => void = () => undefined;
  const bloqueio = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  const chamadas = { inspecionar: 0 };
  const lento: LeitorDePlanilhas = {
    inspecionar: async () => {
      chamadas.inspecionar += 1;
      await bloqueio;
      return { formato: 'XLSX', abas: [{ nome: 'Dados', posicao: 1, utilizavel: true }] };
    },
    lerAba: () => Promise.resolve(lerAba(planilhaXlsx(RELATORIO), 1)),
  };
  let limitado: INestApplication;

  beforeAll(async () => {
    limitado = await montarApp({ leitor: lento, limitador: new LimitadorDeLeituras(2) });
  });

  afterAll(async () => {
    await limitado.close();
  });

  it('com 2 leituras em curso (plano + empregados), a 3ª é 503 SERVICO_OCUPADO com Retry-After; liberadas, terminam bem', async () => {
    const inspecao = (rota: string, papel: string) =>
      request(limitado.getHttpServer())
        .post(`/empresas/${EMPRESA}/${rota}/planilhas/inspecao`)
        .set('x-papel', papel)
        .attach('arquivo', planilhaXlsx(RELATORIO), { filename: 'c.xlsx' })
        .then((resposta) => resposta);
    const primeira = inspecao('plano-contas', 'contador');
    const segunda = inspecao('empregados', 'admin_escritorio');
    await vi.waitFor(() => expect(chamadas.inspecionar).toBe(2));

    const terceira = await inspecao('plano-contas', 'contador');
    expect(terceira.status).toBe(503);
    expect(terceira.headers['retry-after']).toBe('5');
    expect(terceira.body).toMatchObject({ code: CODIGOS_DE_ERRO.SERVICO_OCUPADO, status: 503 });

    // O envio disputa as mesmas vagas.
    const envio = await request(limitado.getHttpServer())
      .post(`/empresas/${EMPRESA}/empregados/importacoes`)
      .set('x-papel', 'admin_escritorio')
      .attach('arquivo', planilhaXlsx(RELATORIO), { filename: 'f.xlsx' })
      .field('mapeamento', JSON.stringify({ cpf: 'A', nome: 'B', matricula: 'C', data_nascimento: 'D', data_admissao: 'E' }))
      .field('aba', '1')
      .field('linhaCabecalho', '3');
    expect(envio.status).toBe(503);
    expect(chamadas.inspecionar).toBe(2);

    liberar();
    expect((await primeira).status).toBe(200);
    expect((await segunda).status).toBe(200);
  });
});

describe.each(DOMINIOS)('$dominio: GET modelo?formato=', ({ rota, modelo }) => {
  it.each([
    ['xlsx', TIPO_DE_CONTEUDO_XLSX],
    ['ods', TIPO_DE_CONTEUDO_ODS],
  ])('%s: anexo com tipo próprio, nosniff, no-store e legível pelo leitor', async (formato, tipo) => {
    const resposta = await request(app.getHttpServer())
      .get(`/empresas/${EMPRESA}/${rota}/modelo?formato=${formato}`)
      .set('x-papel', 'auditor_readonly')
      .buffer(true)
      .parse(binario)
      .expect(200);

    expect(resposta.headers['content-type']).toBe(tipo);
    expect(resposta.headers['content-disposition']).toBe(`attachment; filename="${modelo}.${formato}"`);
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(lerAba(resposta.body as Buffer, 1).linhas.length).toBe(2);
  });

  it('formato desconhecido → 422', async () => {
    await request(app.getHttpServer()).get(`/empresas/${EMPRESA}/${rota}/modelo?formato=pdf`).set('x-papel', 'admin_escritorio').expect(422);
  });
});

describe('status HTTP dos códigos da planilha (comum/problema.ts)', () => {
  it.each([
    [CODIGOS_DE_ERRO.CONFIGURACAO_DE_PLANILHA_INCOMPLETA, 400],
    [CODIGOS_DE_ERRO.SERVICO_OCUPADO, 503],
    [CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, 413],
    [CODIGOS_DE_ERRO.ABA_INEXISTENTE, 422],
    [CODIGOS_DE_ERRO.ABA_SEM_DADOS, 422],
    [CODIGOS_DE_ERRO.PLANILHA_SEM_ABA_UTILIZAVEL, 422],
    [CODIGOS_DE_ERRO.CABECALHO_MESCLADO, 422],
    [CODIGOS_DE_ERRO.FORMATO_XLS_NAO_SUPORTADO, 422],
    [CODIGOS_DE_ERRO.FORMATO_XLSM_NAO_SUPORTADO, 422],
    [CODIGOS_DE_ERRO.ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO, 422],
    [CODIGOS_DE_ERRO.ARQUIVO_CORROMPIDO, 422],
    [CODIGOS_DE_ERRO.EXTENSAO_DIFERENTE_DO_CONTEUDO, 422],
    [CODIGOS_DE_ERRO.LIMITE_DE_PROCESSAMENTO_EXCEDIDO, 422],
  ])('%s → %i', (codigo, status) => {
    expect(statusDoErro(new ErroDeDominio(codigo, 'x'))).toBe(status);
  });
});
