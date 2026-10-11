/**
 * Controller de empregados por HTTP real (SPEC-014 §3.12, §6.2, §7): multipart, mapeamento JSON
 * estrito, downloads, problem+json e a chave do catálogo pelo `GuardDeAcao` de verdade. Sessão e
 * carteira entram dubladas (provas próprias e no `.integration.test.ts`); o caso de uso é dublê.
 */
import { Readable } from 'node:stream';

import { CODIGOS_DE_ERRO, permissoesDosPapeisPadrao, type PapelPadrao } from '@contaia/domain';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuardDeAcao } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { FiltroDeProblema } from '../comum/problema';
import { EmpregadosDaEmpresaController } from './empregados.controller';
import { EmpregadosService } from './empregados.service';

const ID = (n: number): string => `0198f3c2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TENANT = ID(1);
const USUARIO = ID(2);
const EMPRESA = ID(3);
const TENTATIVA = ID(4);
const BOM = String.fromCharCode(0xfeff);
const BASE = `/empresas/${EMPRESA}/empregados`;
const MAPEAMENTO = { cpf: 'cpf', nome: 'nome', matricula: 'matricula', data_nascimento: 'nasc', data_admissao: 'adm' };
const CSV = Buffer.from('cpf;nome;matricula;nasc;adm\n52998224725;Maria;1;15/03/1990;01/02/2015\n');

const servico = {
  enviar: vi.fn(),
  historico: vi.fn(),
  previa: vi.fn(),
  rejeicoes: vi.fn(),
  relatorio: vi.fn(),
  arquivoOriginal: vi.fn(),
  confirmar: vi.fn(),
  cancelar: vi.fn(),
  empregados: vi.fn(),
};

const sessaoDublada = {
  canActivate: (contexto: { switchToHttp: () => { getRequest: () => RequisicaoAutenticada } }) => {
    const requisicao = contexto.switchToHttp().getRequest();
    const papel = (requisicao.header('x-papel') ?? 'admin_escritorio') as PapelPadrao;

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
    controllers: [EmpregadosDaEmpresaController],
    providers: [{ provide: EmpregadosService, useValue: servico }, Reflector, GuardDeAcao],
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
  it('202: lê arquivo e mapeamento; tenant, autor e correlação saem da sessão e do cabeçalho', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .set('x-correlation-id', 'corr-http-emp-1')
      .attach('arquivo', CSV, { filename: 'empregados.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(202);

    expect(resposta.body).toEqual({ tentativaId: TENTATIVA, estado: 'RECEBIDA' });
    expect(servico.enviar).toHaveBeenCalledWith(
      { tenantId: TENANT, usuarioId: USUARIO, correlationId: 'corr-http-emp-1' },
      EMPRESA,
      { buffer: CSV, nome: 'empregados.csv', mimetype: 'text/csv' },
      MAPEAMENTO,
    );
  });

  it.each([
    ['JSON malformado', '{cpf:'],
    ['campo fora do contrato (cargo)', JSON.stringify({ ...MAPEAMENTO, cargo: 'cargo' })],
    ['campo do plano de contas', JSON.stringify({ ...MAPEAMENTO, codigo: 'codigo' })],
    ['valor que não é texto', JSON.stringify({ ...MAPEAMENTO, cpf: 1 })],
  ])('mapeamento inválido (%s) → 422 sem chamar o caso de uso', async (_caso, mapeamento) => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .attach('arquivo', CSV, { filename: 'empregados.csv', contentType: 'text/csv' })
      .field('mapeamento', mapeamento)
      .expect(422);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO, campos: [{ campo: 'mapeamento' }] });
    expect(servico.enviar).not.toHaveBeenCalled();
  });

  it('acima de 10 MB o multer corta e responde 413 ARQUIVO_ACIMA_DO_LIMITE', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .attach('arquivo', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'), { filename: 'grande.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(413);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, status: 413 });
    expect(servico.enviar).not.toHaveBeenCalled();
  });

  it('sem arquivo → 422 ARQUIVO_INVALIDO', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(422);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO });
  });

  it.each(['contador', 'auditor_readonly', 'auxiliar'] as const)('%s não importa (403)', async (papel) => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/importacoes`)
      .set('x-papel', papel)
      .attach('arquivo', CSV, { filename: 'empregados.csv', contentType: 'text/csv' })
      .field('mapeamento', JSON.stringify(MAPEAMENTO))
      .expect(403);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.SEM_AUTORIZACAO });
    expect(servico.enviar).not.toHaveBeenCalled();
  });
});

describe('downloads', () => {
  it('modelo: CSV UTF-8 com BOM, anexo, nosniff e no-store (contador baixa)', async () => {
    const resposta = await request(app.getHttpServer()).get(`${BASE}/modelo`).set('x-papel', 'contador').expect(200);

    expect(resposta.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(resposta.headers['content-disposition']).toBe('attachment; filename="modelo-empregados.csv"');
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(resposta.text.startsWith(`${BOM}cpf;nome;matricula;data_nascimento;data_admissao`)).toBe(true);
  });

  it('relatório em fluxo para o auditor', async () => {
    servico.relatorio.mockResolvedValue({ nomeDoArquivo: 'relatorio-empregados.csv', conteudo: Readable.from([`${BOM}linha;cpf\r\n`]) });

    const resposta = await request(app.getHttpServer())
      .get(`${BASE}/importacoes/${TENTATIVA}/relatorio`)
      .set('x-papel', 'auditor_readonly')
      .expect(200);

    expect(resposta.headers['content-disposition']).toBe('attachment; filename="relatorio-empregados.csv"');
    expect(resposta.text).toBe(`${BOM}linha;cpf\r\n`);
  });

  it('arquivo original: anexo text/csv com nome saneado', async () => {
    servico.arquivoOriginal.mockResolvedValue({ nome: 'folha "legada".csv', conteudo: CSV });

    const resposta = await request(app.getHttpServer()).get(`${BASE}/importacoes/${TENTATIVA}/arquivo`).expect(200);

    expect(resposta.headers['content-disposition']).toBe('attachment; filename="folha _legada_.csv"');
    expect(resposta.headers['cache-control']).toBe('no-store');
  });

  it('auxiliar (sem chave de empregados) não baixa nem consulta', async () => {
    await request(app.getHttpServer()).get(`${BASE}/modelo`).set('x-papel', 'auxiliar').expect(403);
    await request(app.getHttpServer()).get(`${BASE}`).set('x-papel', 'auxiliar').expect(403);
    await request(app.getHttpServer()).get(`${BASE}/importacoes`).set('x-papel', 'auxiliar').expect(403);
  });
});

describe('demais rotas', () => {
  it('id malformado → 404 sem chegar ao caso de uso', async () => {
    const resposta = await request(app.getHttpServer()).get(`${BASE}/importacoes/nao-e-uuid`).expect(404);

    expect(resposta.body).toMatchObject({ code: CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA });
    expect(servico.previa).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ versaoDaPrevia: '1' }], [{ versaoDaPrevia: 1, usuarioId: ID(9) }]])(
    'confirmação com corpo inválido %j → 422',
    async (corpo) => {
      await request(app.getHttpServer()).post(`${BASE}/importacoes/${TENTATIVA}/confirmar`).send(corpo).expect(422);
      expect(servico.confirmar).not.toHaveBeenCalled();
    },
  );

  it('admin confirma e cancela (200); contador e auditor não (403)', async () => {
    servico.confirmar.mockResolvedValue({ estado: 'CONCLUIDA' });
    servico.cancelar.mockResolvedValue({ estado: 'CANCELADA' });

    await request(app.getHttpServer()).post(`${BASE}/importacoes/${TENTATIVA}/confirmar`).send({ versaoDaPrevia: 3 }).expect(200);
    await request(app.getHttpServer()).post(`${BASE}/importacoes/${TENTATIVA}/cancelar`).expect(200);
    for (const papel of ['contador', 'auditor_readonly']) {
      await request(app.getHttpServer())
        .post(`${BASE}/importacoes/${TENTATIVA}/confirmar`)
        .set('x-papel', papel)
        .send({ versaoDaPrevia: 3 })
        .expect(403);
      await request(app.getHttpServer()).post(`${BASE}/importacoes/${TENTATIVA}/cancelar`).set('x-papel', papel).expect(403);
    }

    expect(servico.confirmar).toHaveBeenCalledTimes(1);
    expect(servico.confirmar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: USUARIO }), EMPRESA, TENTATIVA, 3);
    expect(servico.cancelar).toHaveBeenCalledTimes(1);
  });

  it('contador consulta histórico, prévia, rejeições e a base paginada com busca aparada', async () => {
    servico.historico.mockResolvedValue({ itens: [] });
    servico.previa.mockResolvedValue({ estado: 'RECEBIDA' });
    servico.rejeicoes.mockResolvedValue({ itens: [] });
    servico.empregados.mockResolvedValue({ itens: [] });

    await request(app.getHttpServer()).get(`${BASE}/importacoes?pagina=2`).set('x-papel', 'contador').expect(200);
    await request(app.getHttpServer()).get(`${BASE}/importacoes/${TENTATIVA}`).set('x-papel', 'contador').expect(200);
    await request(app.getHttpServer()).get(`${BASE}/importacoes/${TENTATIVA}/rejeicoes?pagina=3`).set('x-papel', 'contador').expect(200);
    await request(app.getHttpServer()).get(`${BASE}?pagina=4&busca=%20maria%20`).set('x-papel', 'contador').expect(200);
    await request(app.getHttpServer()).get(`${BASE}?pagina=0`).expect(422);

    expect(servico.historico).toHaveBeenCalledWith(expect.anything(), EMPRESA, 2);
    expect(servico.rejeicoes).toHaveBeenCalledWith(expect.anything(), EMPRESA, TENTATIVA, 3);
    expect(servico.empregados).toHaveBeenCalledWith(expect.anything(), EMPRESA, 4, 'maria');
  });
});
