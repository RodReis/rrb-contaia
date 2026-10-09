/**
 * Controller do plano de contas por HTTP real (SPEC-013 §6.2, §7): multipart, mapeamento JSON
 * estrito, cabeçalhos dos downloads, problem+json e a chave do catálogo pelo `GuardDeAcao` de verdade.
 * Sessão e carteira entram dubladas (têm provas próprias); o caso de uso é dublê.
 */
import { Readable } from 'node:stream';

import { CODIGOS_DE_ERRO, ErroDeDominio, permissoesDosPapeisPadrao, type PapelPadrao } from '@contaia/domain';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuardDeAcao } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { nomeSeguro } from '../comum/nome-seguro';
import { FiltroDeProblema } from '../comum/problema';
import { PlanoContasDaEmpresaController } from './plano-contas.controller';
import { PlanoContasService } from './plano-contas.service';

const ID = (n: number): string => `0198f3c2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TENANT = ID(1);
const USUARIO = ID(2);
const EMPRESA = ID(3);
const TENTATIVA = ID(4);
const BOM = String.fromCharCode(0xfeff);
const BASE = `/empresas/${EMPRESA}/plano-contas`;
const MAPEAMENTO = { codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' };
const CSV = Buffer.from('codigo;nome;tipo;natureza;conta_pai\n1;Ativo;sintetica;devedora;\n');

const servico = {
  enviar: vi.fn(),
  historico: vi.fn(),
  previa: vi.fn(),
  rejeicoes: vi.fn(),
  relatorio: vi.fn(),
  arquivoOriginal: vi.fn(),
  confirmar: vi.fn(),
  cancelar: vi.fn(),
  plano: vi.fn(),
};

/** Sessão dublada: o papel vem do cabeçalho de teste; tenant e usuário são sempre os da sessão. */
const sessaoDublada = {
  canActivate: (contexto: { switchToHttp: () => { getRequest: () => RequisicaoAutenticada } }) => {
    const requisicao = contexto.switchToHttp().getRequest();
    const papel = (requisicao.header('x-papel') ?? 'contador') as PapelPadrao;

    requisicao.sessao = {
      tenantId: TENANT,
      usuarioId: USUARIO,
      papeis: [papel],
      permissoes: permissoesDosPapeisPadrao([papel]),
    } as unknown as NonNullable<RequisicaoAutenticada['sessao']>;

    return true;
  },
};

let app: INestApplication;

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    controllers: [PlanoContasDaEmpresaController],
    providers: [{ provide: PlanoContasService, useValue: servico }, Reflector, GuardDeAcao],
  })
    .overrideGuard(GuardDeSessao)
    .useValue(sessaoDublada)
    .overrideGuard(GuardDeCadastro)
    .useValue({ canActivate: () => true })
    .overrideGuard(GuardDeEscopoDeEmpresa)
    .useValue({ canActivate: () => true })
    .compile();

  app = modulo.createNestApplication();
  app.useGlobalFilters(new FiltroDeProblema());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  for (const funcao of Object.values(servico)) {
    funcao.mockReset();
  }
  servico.enviar.mockResolvedValue({ tentativaId: TENTATIVA, estado: 'RECEBIDA' });
});

describe('POST importacoes (multipart)', () => {
  it('lê arquivo e mapeamento; tenant, autor e correlação saem da sessão e do cabeçalho', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .set('x-correlation-id', 'corr-http-0001')
      .attach('arquivo', CSV, { filename: 'plano.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(202);

    expect(resposta.body).toEqual({ tentativaId: TENTATIVA, estado: 'RECEBIDA' });
    expect(servico.enviar).toHaveBeenCalledWith(
      { tenantId: TENANT, usuarioId: USUARIO, correlationId: 'corr-http-0001' },
      EMPRESA,
      { buffer: CSV, nome: 'plano.csv', mimetype: 'text/csv' },
      MAPEAMENTO,
    );
  });

  it.each([
    ['JSON malformado', '{codigo:'],
    ['campo fora do contrato', JSON.stringify({ ...MAPEAMENTO, centro_de_custo: 'cc' })],
    ['valor que não é texto', JSON.stringify({ ...MAPEAMENTO, codigo: 1 })],
    ['lista no lugar de objeto', JSON.stringify(['codigo'])],
  ])('mapeamento inválido (%s) → 422 sem chamar o caso de uso', async (_caso, mapeamento) => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .attach('arquivo', CSV, { filename: 'plano.csv', contentType: 'text/csv' })
      .field('mapeamento', mapeamento)
      .expect(422);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO, campos: [{ campo: 'mapeamento' }] });
    expect(servico.enviar).not.toHaveBeenCalled();
  });

  it('campo de texto além do mapeamento (ex.: tenantId) → 422', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .attach('arquivo', CSV, { filename: 'plano.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .field('tenantId', ID(99))
      .expect(422);
    expect(servico.enviar).not.toHaveBeenCalled();
  });

  it('sem arquivo → 422 ARQUIVO_INVALIDO', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(422);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO });
    expect(servico.enviar).not.toHaveBeenCalled();
  });

  it('acima de 10 MB o multer corta e responde 413 ARQUIVO_ACIMA_DO_LIMITE', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .attach('arquivo', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'), { filename: 'grande.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(413);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, status: 413 });
    expect(servico.enviar).not.toHaveBeenCalled();
  });

  it.each(['auxiliar', 'auditor_readonly'] as const)('%s não importa (403), nem chega a ler o arquivo', async (papel) => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .set('x-papel', papel)
      .attach('arquivo', CSV, { filename: 'plano.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(403);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.SEM_AUTORIZACAO });
    expect(servico.enviar).not.toHaveBeenCalled();
  });
});

describe('downloads', () => {
  it('modelo: CSV UTF-8 com BOM, anexo e nosniff', async () => {
    const resposta = await request(app.getHttpServer()).get(`${BASE}/modelo`).set('x-papel', 'auxiliar').expect(200);

    expect(resposta.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(resposta.headers['content-disposition']).toBe('attachment; filename="modelo-plano-de-contas.csv"');
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(resposta.text.startsWith(`${BOM}codigo;nome;tipo;natureza;conta_pai`)).toBe(true);
  });

  it('relatório sai em fluxo, com nome saneado (sem aspas nem quebra de linha) e nosniff', async () => {
    servico.relatorio.mockResolvedValue({
      nomeDoArquivo: 'relatorio-pla"no\r\nX-Injetado: 1.csv',
      conteudo: Readable.from([`${BOM}linha;codigo\r\n`, `2;'=1+1\r\n`]),
    });

    const resposta = await request(app.getHttpServer())
      .get(`${BASE}/importacoes/${TENTATIVA}/relatorio`)
      .set('x-papel', 'auditor_readonly')
      .expect(200);

    expect(resposta.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(resposta.headers['content-disposition']).toBe(
      `attachment; filename="${nomeSeguro('relatorio-pla"no\r\nX-Injetado: 1.csv')}"`,
    );
    expect(resposta.headers['x-injetado']).toBeUndefined();
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    // Plano e relatório de um cliente não ficam em cache de navegador nem de proxy.
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(resposta.text).toBe(`${BOM}linha;codigo\r\n2;'=1+1\r\n`);
    expect(servico.relatorio).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), EMPRESA, TENTATIVA);
  });

  it('relatório indisponível antes do primeiro byte vira problem+json', async () => {
    servico.relatorio.mockRejectedValue(new ErroDeDominio(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA, 'Tentativa não encontrada.'));

    const resposta = await request(app.getHttpServer()).get(`${BASE}/importacoes/${TENTATIVA}/relatorio`).expect(404);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA });
  });

  it('arquivo original: anexo text/csv com o nome do envio saneado', async () => {
    servico.arquivoOriginal.mockResolvedValue({ nome: 'plano "legado".csv', conteudo: CSV });

    const resposta = await request(app.getHttpServer()).get(`${BASE}/importacoes/${TENTATIVA}/arquivo`).expect(200);

    expect(resposta.headers['content-type']).toMatch(/^text\/csv/u);
    expect(resposta.headers['content-disposition']).toBe('attachment; filename="plano _legado_.csv"');
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['cache-control']).toBe('no-store');
  });

  it('consultar sem baixar_relatorio não baixa (papel sem a chave)', async () => {
    await request(app.getHttpServer()).get(`${BASE}/modelo`).set('x-papel', 'nenhum').expect(403);
    expect(servico.relatorio).not.toHaveBeenCalled();
  });
});

describe('demais rotas', () => {
  it('id malformado responde 404 sem chegar ao caso de uso', async () => {
    const resposta = await request(app.getHttpServer()).get(`${BASE}/importacoes/nao-e-uuid`).expect(404);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA });
    expect(servico.previa).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ versaoDaPrevia: '1' }],
    [{ versaoDaPrevia: -1 }],
    [{ versaoDaPrevia: 1, usuarioId: ID(9) }],
  ])('confirmação com corpo inválido %j → 422', async (corpo) => {
    await request(app.getHttpServer()).post(`${BASE}/importacoes/${TENTATIVA}/confirmar`).send(corpo).expect(422);
    expect(servico.confirmar).not.toHaveBeenCalled();
  });

  it('confirmação e cancelamento respondem 200 e delegam com a versão da prévia', async () => {
    servico.confirmar.mockResolvedValue({ estado: 'CONCLUIDA' });
    servico.cancelar.mockResolvedValue({ estado: 'CANCELADA' });

    await request(app.getHttpServer()).post(`${BASE}/importacoes/${TENTATIVA}/confirmar`).send({ versaoDaPrevia: 3 }).expect(200);
    await request(app.getHttpServer()).post(`${BASE}/importacoes/${TENTATIVA}/cancelar`).expect(200);

    expect(servico.confirmar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: USUARIO }), EMPRESA, TENTATIVA, 3);
    expect(servico.cancelar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: USUARIO }), EMPRESA, TENTATIVA);
  });

  it('auxiliar não confirma nem cancela (403)', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/importacoes/${TENTATIVA}/confirmar`)
      .set('x-papel', 'auxiliar')
      .send({ versaoDaPrevia: 0 })
      .expect(403);
    await request(app.getHttpServer()).post(`${BASE}/importacoes/${TENTATIVA}/cancelar`).set('x-papel', 'auxiliar').expect(403);
    expect(servico.confirmar).not.toHaveBeenCalled();
    expect(servico.cancelar).not.toHaveBeenCalled();
  });

  it('histórico, rejeições e contas validam a paginação e repassam a busca aparada', async () => {
    servico.historico.mockResolvedValue({ itens: [] });
    servico.rejeicoes.mockResolvedValue({ itens: [] });
    servico.plano.mockResolvedValue({ itens: [] });

    await request(app.getHttpServer()).get(`${BASE}/importacoes?pagina=2`).set('x-papel', 'auxiliar').expect(200);
    await request(app.getHttpServer()).get(`${BASE}/importacoes/${TENTATIVA}/rejeicoes`).expect(200);
    await request(app.getHttpServer()).get(`${BASE}/contas?pagina=3&busca=%20caixa%20`).expect(200);
    await request(app.getHttpServer()).get(`${BASE}/importacoes?pagina=0`).expect(422);

    expect(servico.historico).toHaveBeenCalledWith(expect.anything(), EMPRESA, 2);
    expect(servico.rejeicoes).toHaveBeenCalledWith(expect.anything(), EMPRESA, TENTATIVA, 1);
    expect(servico.plano).toHaveBeenCalledWith(expect.anything(), EMPRESA, 3, 'caixa');
  });
});

describe('nomeSeguro', () => {
  it('troca aspas, quebras e controle por _ e limita a 120 caracteres', () => {
    expect(nomeSeguro('a"b\r\nc;d.csv')).toBe('a_b_c_d.csv');
    expect(nomeSeguro('x'.repeat(300))).toHaveLength(120);
    expect(nomeSeguro('"""', 'plano.csv')).toBe('_');
    expect(nomeSeguro('', 'plano.csv')).toBe('plano.csv');
  });
});
