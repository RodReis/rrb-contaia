/**
 * Catálogo tributário por HTTP real (SPEC-016 §6.2, §6.3, §7): autorização pelo guard de verdade,
 * validação estrita do corpo, versão otimista, problem+json com código estável e correlationId.
 * A sessão e o caso de uso entram dublados; cada um tem prova própria.
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
import { TaxRulesController } from './tax-rules.controller';
import { TaxRulesService } from './tax-rules.service';

const ID = (n: number): string => `0198f3c2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SUPER_ADMIN = ID(1);
const USUARIO = ID(2);
const REGRA = ID(3);
const CORRELACAO = 'corr-http-0001';

const regra = {
  taxType: 'ICMS',
  regime: 'LUCRO_PRESUMIDO',
  operationType: 'VENDA_MERCADORIA',
  validFrom: '2026-01-01',
  validUntil: null,
  baseReductionBasisPoints: null,
  rateBasisPoints: 1_800,
  source: 'Fixture de teste não oficial',
  fixtureNote: 'Dado de teste não oficial',
};
const { taxType, regime, operationType, ...edicao } = regra;
void taxType;
void regime;
void operationType;

const versao = { id: REGRA, versionNumber: 1, lockVersion: 1, status: 'DRAFT', ...regra };

const servico = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  archive: vi.fn(),
};

const SESSOES: Readonly<Record<string, () => Promise<SessaoDoCatalogo>>> = {
  super: async () => ({ tipo: 'PLATAFORMA', sub: SUPER_ADMIN, email: 'super@plataforma.local' }),
  expirado: async () => Promise.reject(new UnauthorizedException('Sessão inválida ou expirada.')),
  incompleto: async () => escritorio('contador', 'CADASTRO_INCOMPLETO'),
  ...Object.fromEntries(
    (['admin_escritorio', 'contador', 'auxiliar', 'auditor_readonly'] as const).map((papel) => [
      papel,
      async () => escritorio(papel),
    ]),
  ),
};

function escritorio(papel: PapelPadrao, statusDoTenant: 'ATIVO' | 'CADASTRO_INCOMPLETO' = 'ATIVO'): SessaoDoCatalogo {
  return {
    tipo: 'ESCRITORIO',
    sessao: {
      usuarioId: USUARIO,
      tenantId: ID(9),
      statusDoTenant,
      papeis: [papel],
      permissoes: permissoesDosPapeisPadrao([papel]),
    } as unknown as Extract<SessaoDoCatalogo, { tipo: 'ESCRITORIO' }>['sessao'],
  };
}

const sessaoService = {
  resolverParaCatalogo: (token: string): Promise<SessaoDoCatalogo> => {
    const resolver = SESSOES[token];
    return resolver === undefined ? Promise.reject(new UnauthorizedException('Sessão inválida ou expirada.')) : resolver();
  },
};

let app: INestApplication;

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    controllers: [TaxRulesController],
    providers: [
      { provide: TaxRulesService, useValue: servico },
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

beforeEach(() => {
  for (const funcao of Object.values(servico)) {
    funcao.mockReset();
  }
  servico.list.mockResolvedValue({ items: [versao], total: 1, page: 1, pageSize: 25 });
  servico.get.mockResolvedValue(versao);
  servico.create.mockResolvedValue(versao);
  servico.update.mockResolvedValue({ ...versao, lockVersion: 2 });
  servico.publish.mockResolvedValue({ ...versao, status: 'PUBLISHED', lockVersion: 2 });
  servico.archive.mockResolvedValue({ ...versao, status: 'ARCHIVED', lockVersion: 3 });
});

const como = (papel: string) => ({ authorization: `Bearer ${papel}`, 'x-correlation-id': CORRELACAO });
const http = () => request(app.getHttpServer());

describe('autorização', () => {
  it('sem token responde 401 em problem+json, sem chegar ao caso de uso', async () => {
    const resposta = await http().get('/tax-rules').expect(401);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ status: 401, code: 'HTTP_401' });
    expect(servico.list).not.toHaveBeenCalled();
  });

  it('token expirado responde 401', async () => {
    await http().get('/tax-rules').set(como('expirado')).expect(401);
  });

  it.each(['admin_escritorio', 'contador', 'auditor_readonly'])('%s consulta o catálogo', async (papel) => {
    await http().get('/tax-rules').set(como(papel)).expect(200);
    await http().get(`/tax-rules/${REGRA}`).set(como(papel)).expect(200);
  });

  it('o auxiliar não tem acesso por padrão (403 SEM_AUTORIZACAO)', async () => {
    const resposta = await http().get('/tax-rules').set(como('auxiliar')).expect(403);

    expect(resposta.body).toMatchObject({ status: 403, code: CODIGOS_DE_ERRO.SEM_AUTORIZACAO, correlationId: CORRELACAO });
    expect(servico.list).not.toHaveBeenCalled();
  });

  it('escritório com cadastro incompleto não acessa', async () => {
    const resposta = await http().get('/tax-rules').set(como('incompleto')).expect(403);

    expect(resposta.body.code).toBe(CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO);
  });

  it.each([
    ['POST', '/tax-rules', regra],
    ['PUT', `/tax-rules/${REGRA}`, { ...edicao, expectedVersion: 1 }],
    ['POST', `/tax-rules/${REGRA}/publish`, { expectedVersion: 1 }],
    ['POST', `/tax-rules/${REGRA}/archive`, { expectedVersion: 1 }],
  ] as const)('papel de escritório não altera o catálogo: %s %s → 403 PLATFORM_ADMIN_REQUIRED', async (metodo, caminho, corpo) => {
    for (const papel of ['admin_escritorio', 'contador', 'auditor_readonly', 'auxiliar']) {
      const resposta = await http()[metodo.toLowerCase() as 'post' | 'put'](caminho).set(como(papel)).send(corpo).expect(403);

      expect(resposta.body).toMatchObject({
        type: expect.stringContaining('/erros/') as unknown,
        title: expect.any(String) as unknown,
        status: 403,
        code: CODIGOS_DE_ERRO.PLATFORM_ADMIN_REQUIRED,
        correlationId: CORRELACAO,
      });
    }
    expect(servico.create).not.toHaveBeenCalled();
    expect(servico.update).not.toHaveBeenCalled();
    expect(servico.publish).not.toHaveBeenCalled();
    expect(servico.archive).not.toHaveBeenCalled();
  });
});

describe('GET /tax-rules', () => {
  it('delega com o ator da sessão, filtros convertidos, paginação padrão e a correlação do cabeçalho', async () => {
    const resposta = await http()
      .get('/tax-rules?taxType=ICMS&status=PUBLISHED&validOn=2026-06-01&page=2&pageSize=10')
      .set(como('contador'))
      .expect(200);

    expect(resposta.body).toEqual({ items: [versao], total: 1, page: 1, pageSize: 25 });
    expect(servico.list).toHaveBeenCalledWith(
      { id: USUARIO, tipo: 'ESCRITORIO' },
      { taxType: 'ICMS', status: 'PUBLISHED', validOn: '2026-06-01', page: 2, pageSize: 10 },
      CORRELACAO,
    );
  });

  it('o super_admin lista com o ator de plataforma', async () => {
    await http().get('/tax-rules').set(como('super')).expect(200);

    expect(servico.list).toHaveBeenCalledWith({ id: SUPER_ADMIN, tipo: 'SUPER_ADMIN' }, { page: 1, pageSize: 25 }, CORRELACAO);
  });

  it.each(['taxType=ISS', 'status=DELETED', 'page=0', 'pageSize=101', 'validOn=2026-02-30', 'ordenar=x'])(
    'filtro inválido (%s) → 422 sem chamar o caso de uso',
    async (consulta) => {
      const resposta = await http().get(`/tax-rules?${consulta}`).set(como('contador')).expect(422);

      expect(resposta.body).toMatchObject({ status: 422, code: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
      expect(servico.list).not.toHaveBeenCalled();
    },
  );
});

describe('GET /tax-rules/:id', () => {
  it('devolve a versão pela rota', async () => {
    const resposta = await http().get(`/tax-rules/${REGRA}`).set(como('contador')).expect(200);

    expect(resposta.body).toEqual(versao);
    expect(servico.get).toHaveBeenCalledWith({ id: USUARIO, tipo: 'ESCRITORIO' }, REGRA, CORRELACAO);
  });

  it('aceita o id que app.uuid_v7() gera, com variante fora de 8/9/a/b (~3/4 dos ids do sistema)', async () => {
    const idDoBanco = '01a1350b-039e-769f-f683-e599c8b7667f';

    await http().get(`/tax-rules/${idDoBanco}`).set(como('contador')).expect(200);
    await http().post(`/tax-rules/${idDoBanco}/publish`).set(como('super')).send({ expectedVersion: 1 }).expect(200);
    await http().post(`/tax-rules/${idDoBanco}/archive`).set(como('super')).send({ expectedVersion: 2 }).expect(200);
    await http().put(`/tax-rules/${idDoBanco}`).set(como('super')).send({ expectedVersion: 1, ...edicao }).expect(200);

    expect(servico.get).toHaveBeenCalledWith({ id: USUARIO, tipo: 'ESCRITORIO' }, idDoBanco, CORRELACAO);
  });

  it('identificador malformado → 422 sem chamar o caso de uso', async () => {
    await http().get('/tax-rules/nao-e-uuid').set(como('contador')).expect(422);

    expect(servico.get).not.toHaveBeenCalled();
  });

  it('TAX_RULE_NOT_FOUND → 404', async () => {
    servico.get.mockRejectedValue(new ErroDeDominio(CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND, 'Versão de regra tributária não encontrada.'));

    const resposta = await http().get(`/tax-rules/${REGRA}`).set(como('contador')).expect(404);

    expect(resposta.body).toMatchObject({ status: 404, code: 'TAX_RULE_NOT_FOUND', correlationId: CORRELACAO });
  });
});

describe('POST /tax-rules', () => {
  it('cria o rascunho com o ator do super_admin e responde 201', async () => {
    const resposta = await http().post('/tax-rules').set(como('super')).send(regra).expect(201);

    expect(resposta.body).toEqual(versao);
    expect(servico.create).toHaveBeenCalledWith({ id: SUPER_ADMIN, tipo: 'SUPER_ADMIN' }, regra, CORRELACAO);
  });

  it.each([
    ['estado enviado pelo cliente', { status: 'PUBLISHED' }],
    ['autor enviado pelo cliente', { createdBy: ID(7) }],
    ['total calculado enviado pelo cliente', { resultCents: 1 }],
    ['expressão livre', { formula: 'base * 0.18' }],
    ['alíquota acima de 100%', { rateBasisPoints: 10_001 }],
    ['vigência final anterior à inicial', { validFrom: '2026-06-30', validUntil: '2026-01-01' }],
    ['operação fora do catálogo tipado', { operationType: 'OPERACAO_LIVRE' }],
  ])('corpo inválido (%s) → 422 sem chamar o caso de uso', async (_nome, extra) => {
    const resposta = await http().post('/tax-rules').set(como('super')).send({ ...regra, ...extra }).expect(422);

    expect(resposta.body).toMatchObject({ status: 422, correlationId: CORRELACAO });
    expect(servico.create).not.toHaveBeenCalled();
  });
});

describe('PUT /tax-rules/:id', () => {
  it('edita o rascunho enviando a versão esperada', async () => {
    const resposta = await http().put(`/tax-rules/${REGRA}`).set(como('super')).send({ ...edicao, expectedVersion: 1 }).expect(200);

    expect(resposta.body).toMatchObject({ lockVersion: 2 });
    expect(servico.update).toHaveBeenCalledWith({ id: SUPER_ADMIN, tipo: 'SUPER_ADMIN' }, REGRA, { ...edicao, expectedVersion: 1 }, CORRELACAO);
  });

  it('sem versão esperada ou tentando mudar a identidade → 422', async () => {
    await http().put(`/tax-rules/${REGRA}`).set(como('super')).send(edicao).expect(422);
    await http().put(`/tax-rules/${REGRA}`).set(como('super')).send({ ...edicao, expectedVersion: 1, taxType: 'PIS' }).expect(422);

    expect(servico.update).not.toHaveBeenCalled();
  });

  it.each([
    [CODIGOS_DE_ERRO.TAX_RULE_VERSION_CONFLICT, 409],
    [CODIGOS_DE_ERRO.TAX_RULE_IMMUTABLE, 409],
    [CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND, 404],
  ])('%s → %i em problem+json com código estável', async (codigo, status) => {
    servico.update.mockRejectedValue(new ErroDeDominio(codigo, 'falha'));

    const resposta = await http().put(`/tax-rules/${REGRA}`).set(como('super')).send({ ...edicao, expectedVersion: 1 }).expect(status);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ status, code: codigo, correlationId: CORRELACAO });
  });
});

describe('POST /tax-rules/:id/publish e /archive', () => {
  it('publicar e arquivar são comandos explícitos com a versão esperada e respondem 200', async () => {
    const publicada = await http().post(`/tax-rules/${REGRA}/publish`).set(como('super')).send({ expectedVersion: 1 }).expect(200);
    const arquivada = await http().post(`/tax-rules/${REGRA}/archive`).set(como('super')).send({ expectedVersion: 2 }).expect(200);

    expect(publicada.body).toMatchObject({ status: 'PUBLISHED' });
    expect(arquivada.body).toMatchObject({ status: 'ARCHIVED' });
    expect(servico.publish).toHaveBeenCalledWith({ id: SUPER_ADMIN, tipo: 'SUPER_ADMIN' }, REGRA, { expectedVersion: 1 }, CORRELACAO);
    expect(servico.archive).toHaveBeenCalledWith({ id: SUPER_ADMIN, tipo: 'SUPER_ADMIN' }, REGRA, { expectedVersion: 2 }, CORRELACAO);
  });

  it('vigência sobreposta → 409 TAX_RULE_OVERLAPPING_VALIDITY', async () => {
    servico.publish.mockRejectedValue(new ErroDeDominio(CODIGOS_DE_ERRO.TAX_RULE_OVERLAPPING_VALIDITY, 'sobreposta'));

    const resposta = await http().post(`/tax-rules/${REGRA}/publish`).set(como('super')).send({ expectedVersion: 1 }).expect(409);

    expect(resposta.body).toMatchObject({ status: 409, code: 'TAX_RULE_OVERLAPPING_VALIDITY' });
  });

  it.each(['publish', 'archive'])('%s sem versão esperada ou com campo extra → 422', async (comando) => {
    await http().post(`/tax-rules/${REGRA}/${comando}`).set(como('super')).send({}).expect(422);
    await http().post(`/tax-rules/${REGRA}/${comando}`).set(como('super')).send({ expectedVersion: 1, status: 'ARCHIVED' }).expect(422);

    expect(servico.publish).not.toHaveBeenCalled();
    expect(servico.archive).not.toHaveBeenCalled();
  });
});
