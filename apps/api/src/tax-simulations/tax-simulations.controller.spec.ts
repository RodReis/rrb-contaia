/**
 * Simulação manual por HTTP real (SPEC-016 §3.5, §6.2): o guard do catálogo de verdade, corpo
 * estrito sem regra, alíquota ou fórmula vindas do navegador, e problem+json estável. Sessão e caso
 * de uso entram dublados; cada um tem prova própria.
 */
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio, permissoesDosPapeisPadrao, type PapelPadrao } from '@contaia/domain';

import { GuardDoCatalogoTributario } from '../auth/catalogo-tributario.guard';
import { SessaoService, type SessaoDoCatalogo } from '../auth/sessao.service';
import { FiltroDeProblema } from '../comum/problema';
import { TaxSimulationsController } from './tax-simulations.controller';
import { TaxSimulationsService } from './tax-simulations.service';

const ID = (n: number): string => `0198f3c2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SUPER_ADMIN = ID(1);
const USUARIO = ID(2);
const CORRELACAO = 'corr-sim-0001';

const entrada = {
  factDate: '2026-06-15',
  regime: 'LUCRO_PRESUMIDO',
  taxType: 'ICMS',
  operationType: 'VENDA_MERCADORIA',
  baseCents: 10_000,
};

const resultado = { rule: { id: ID(3), versionNumber: 1 }, memory: { resultCents: 1_800, rounding: 'HALF_UP' } };

const servico = { simulateManual: vi.fn(), simulateNfe: vi.fn() };

const escritorio = (papel: PapelPadrao): SessaoDoCatalogo => ({
  tipo: 'ESCRITORIO',
  sessao: {
    usuarioId: USUARIO,
    tenantId: ID(9),
    statusDoTenant: 'ATIVO',
    papeis: [papel],
    permissoes: permissoesDosPapeisPadrao([papel]),
  } as unknown as Extract<SessaoDoCatalogo, { tipo: 'ESCRITORIO' }>['sessao'],
});

const sessaoService = {
  resolverParaCatalogo: async (token: string): Promise<SessaoDoCatalogo> => {
    if (token === 'super') {
      return { tipo: 'PLATAFORMA', sub: SUPER_ADMIN, email: 'super@plataforma.local' };
    }
    if (['admin_escritorio', 'contador', 'auxiliar', 'auditor_readonly'].includes(token)) {
      return escritorio(token as PapelPadrao);
    }
    throw new UnauthorizedException('Sessão inválida ou expirada.');
  },
};

let app: INestApplication;

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    controllers: [TaxSimulationsController],
    providers: [
      { provide: TaxSimulationsService, useValue: servico },
      { provide: SessaoService, useValue: sessaoService },
      Reflector,
      GuardDoCatalogoTributario,
    ],
  }).compile();

  app = modulo.createNestApplication();
  app.useGlobalFilters(new FiltroDeProblema());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const respostaDaNfe = { extraction: { issueDate: '2026-06-15' }, complementsRequired: [], result: null };

beforeEach(() => {
  servico.simulateManual.mockReset();
  servico.simulateManual.mockResolvedValue(resultado);
  servico.simulateNfe.mockReset();
  servico.simulateNfe.mockResolvedValue(respostaDaNfe);
});

const como = (papel: string) => ({ authorization: `Bearer ${papel}`, 'x-correlation-id': CORRELACAO });
const simular = (papel: string, corpo: unknown) =>
  request(app.getHttpServer()).post('/tax-simulations/manual').set(como(papel)).send(corpo as object);

describe('POST /tax-simulations/manual', () => {
  it.each(['admin_escritorio', 'contador', 'auditor_readonly'])('%s simula, com o ator da sessão e a correlação do cabeçalho', async (papel) => {
    const resposta = await simular(papel, entrada).expect(200);

    expect(resposta.body).toEqual(resultado);
    expect(servico.simulateManual).toHaveBeenCalledWith({ id: USUARIO, tipo: 'ESCRITORIO' }, entrada, CORRELACAO);
  });

  it('o super_admin também simula', async () => {
    await simular('super', entrada).expect(200);

    expect(servico.simulateManual).toHaveBeenCalledWith({ id: SUPER_ADMIN, tipo: 'SUPER_ADMIN' }, entrada, CORRELACAO);
  });

  it('o auxiliar não tem acesso por padrão (403 SEM_AUTORIZACAO)', async () => {
    const resposta = await simular('auxiliar', entrada).expect(403);

    expect(resposta.body).toMatchObject({ status: 403, code: CODIGOS_DE_ERRO.SEM_AUTORIZACAO, correlationId: CORRELACAO });
    expect(servico.simulateManual).not.toHaveBeenCalled();
  });

  it('sem token responde 401 em problem+json', async () => {
    const resposta = await request(app.getHttpServer()).post('/tax-simulations/manual').send(entrada).expect(401);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(servico.simulateManual).not.toHaveBeenCalled();
  });

  it.each([
    ['base fracionária', { baseCents: 10.5 }],
    ['base negativa', { baseCents: -1 }],
    ['base em texto', { baseCents: '10000' }],
    ['data inexistente', { factDate: '2026-02-30' }],
    ['regime inválido', { regime: 'MEI' }],
    ['operação fora do catálogo', { operationType: 'OPERACAO_LIVRE' }],
    ['alíquota enviada pelo navegador', { rateBasisPoints: 1_800 }],
    ['fórmula enviada pelo navegador', { formula: 'base * 0.18' }],
    ['regra escolhida pelo navegador', { ruleId: ID(3) }],
  ])('entrada inválida (%s) → 422 sem chamar o caso de uso', async (_nome, extra) => {
    const resposta = await simular('contador', { ...entrada, ...extra }).expect(422);

    expect(resposta.body).toMatchObject({ status: 422, correlationId: CORRELACAO });
    expect(servico.simulateManual).not.toHaveBeenCalled();
  });

  it('corpo ausente → 422', async () => {
    await request(app.getHttpServer()).post('/tax-simulations/manual').set(como('contador')).expect(422);
  });

  it.each([
    [CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE, 422],
    [CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT, 422],
    [CODIGOS_DE_ERRO.TAX_RULE_AMBIGUOUS, 500],
  ])('%s → %i em problem+json com código estável', async (codigo, status) => {
    servico.simulateManual.mockRejectedValue(new ErroDeDominio(codigo, 'falha'));

    const resposta = await simular('contador', entrada).expect(status);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ status, code: codigo, correlationId: CORRELACAO });
  });
});

describe('POST /tax-simulations/nfe (multipart, em memória)', () => {
  const XML = Buffer.from('<NFe xmlns="http://www.portalfiscal.inf.br/nfe"/>');
  const COMPLEMENTO = { operationType: 'VENDA_MERCADORIA', regime: 'LUCRO_REAL', itemBases: { '1': 25_000 } };
  const enviar = (papel: string) => request(app.getHttpServer()).post('/tax-simulations/nfe').set(como(papel));

  it('lê o arquivo e o complemento; ator e correlação saem da sessão e do cabeçalho', async () => {
    const resposta = await enviar('contador')
      .attach('arquivo', XML, { filename: 'nfe.xml', contentType: 'application/xml' })
      .field('complemento', JSON.stringify(COMPLEMENTO))
      .expect(200);

    expect(resposta.body).toEqual(respostaDaNfe);
    expect(servico.simulateNfe).toHaveBeenCalledWith({ id: USUARIO, tipo: 'ESCRITORIO' }, XML, COMPLEMENTO, CORRELACAO);
  });

  it('sem complemento é só análise: o caso de uso recebe complemento nulo', async () => {
    await enviar('auditor_readonly').attach('arquivo', XML, { filename: 'nfe.xml', contentType: 'application/xml' }).expect(200);

    expect(servico.simulateNfe).toHaveBeenCalledWith({ id: USUARIO, tipo: 'ESCRITORIO' }, XML, null, CORRELACAO);
  });

  it('o super_admin também simula', async () => {
    await enviar('super').attach('arquivo', XML, { filename: 'nfe.xml' }).expect(200);

    expect(servico.simulateNfe).toHaveBeenCalledWith({ id: SUPER_ADMIN, tipo: 'SUPER_ADMIN' }, XML, null, CORRELACAO);
  });

  it('o auxiliar não tem acesso e o arquivo nem chega ao caso de uso', async () => {
    const resposta = await enviar('auxiliar').attach('arquivo', XML, { filename: 'nfe.xml' }).expect(403);

    expect(resposta.body.code).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(servico.simulateNfe).not.toHaveBeenCalled();
  });

  it('sem token responde 401 sem processar o upload', async () => {
    await request(app.getHttpServer()).post('/tax-simulations/nfe').attach('arquivo', XML, { filename: 'nfe.xml' }).expect(401);

    expect(servico.simulateNfe).not.toHaveBeenCalled();
  });

  it('sem arquivo → 422 NFE_XML_INVALID', async () => {
    const resposta = await enviar('contador').field('complemento', JSON.stringify(COMPLEMENTO)).expect(422);

    expect(resposta.body).toMatchObject({ status: 422, code: CODIGOS_DE_ERRO.NFE_XML_INVALID, correlationId: CORRELACAO });
    expect(servico.simulateNfe).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON malformado', '{operationType:'],
    ['lista no lugar de objeto', JSON.stringify(['VENDA_MERCADORIA'])],
    ['campo fora do contrato', JSON.stringify({ ...COMPLEMENTO, rateBasisPoints: 1 })],
    ['operação fora do catálogo', JSON.stringify({ operationType: 'LIVRE' })],
    ['base fracionária', JSON.stringify({ ...COMPLEMENTO, itemBases: { '1': 1.5 } })],
  ])('complemento inválido (%s) → 422 sem chamar o caso de uso', async (_nome, complemento) => {
    await enviar('contador').attach('arquivo', XML, { filename: 'nfe.xml' }).field('complemento', complemento).expect(422);

    expect(servico.simulateNfe).not.toHaveBeenCalled();
  });

  it('arquivo acima do limite → 413, cortado antes de carregar o excedente', async () => {
    const grande = Buffer.alloc(2 * 1024 * 1024 + 1, 0x20);
    const resposta = await enviar('contador').attach('arquivo', grande, { filename: 'nfe.xml' }).expect(413);

    expect(resposta.body).toMatchObject({ status: 413, code: CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE });
    expect(servico.simulateNfe).not.toHaveBeenCalled();
  });

  it.each([
    [CODIGOS_DE_ERRO.NFE_XML_INVALID, 422],
    [CODIGOS_DE_ERRO.NFE_LAYOUT_UNSUPPORTED, 422],
    [CODIGOS_DE_ERRO.NFE_REQUIRED_DATA_MISSING, 422],
    [CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE, 422],
  ])('%s → %i em problem+json, nunca 500', async (codigo, status) => {
    servico.simulateNfe.mockRejectedValue(new ErroDeDominio(codigo, 'falha'));

    const resposta = await enviar('contador').attach('arquivo', XML, { filename: 'nfe.xml' }).expect(status);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ status, code: codigo, correlationId: CORRELACAO });
  });
});
