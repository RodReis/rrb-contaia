/**
 * Controller da DRE por HTTP real (SPEC-045): prova que as rotas por `:versionId` aceitam os
 * parâmetros de caminho que o NestJS entrega em `@Param()`, que incluem o `:empresaId` do
 * controller. Um schema `.strict()` reprovaria esse parâmetro (`unrecognized_keys` sem caminho
 * vira campo "corpo") e devolveria 422 CAMPO_OBRIGATORIO antes de chegar ao caso de uso — a
 * regressão que a prova E2E pegou. Sessão e carteira entram dubladas; o caso de uso é dublê.
 */
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuardDeAcao } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { FiltroDeProblema } from '../comum/problema';
import { DreGerencialController } from './dre-gerencial.controller';
import { DreGerencialService } from './dre-gerencial.service';

const ID = (n: number): string => `0198f3c2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TENANT = ID(1);
const USUARIO = ID(2);
const EMPRESA = ID(3);
const VERSAO = ID(4);
const BASE = `/empresas/${EMPRESA}/dre-gerencial`;
const LINHA = {
  code: 'REC',
  title: 'Receita operacional',
  type: 'DETAIL',
  order: 1,
  level: 0,
  parentCode: null,
  presentationSign: 1,
  accountIds: [ID(9)],
  components: [],
  verticalBasis: true,
};

const servico = {
  consultar: vi.fn(),
  listarVersoes: vi.fn(),
  obterVersao: vi.fn(),
  criarRascunho: vi.fn(),
  salvarEstrutura: vi.fn(),
  publicar: vi.fn(),
  exportar: vi.fn(),
};

const sessaoDublada = {
  canActivate: (contexto: { switchToHttp: () => { getRequest: () => RequisicaoAutenticada } }) => {
    const requisicao = contexto.switchToHttp().getRequest();

    requisicao.sessao = { tenantId: TENANT, usuarioId: USUARIO } as unknown as NonNullable<
      RequisicaoAutenticada['sessao']
    >;

    return true;
  },
};

let app: INestApplication;

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    controllers: [DreGerencialController],
    providers: [{ provide: DreGerencialService, useValue: servico }],
  })
    .overrideGuard(GuardDeSessao)
    .useValue(sessaoDublada)
    .overrideGuard(GuardDeCadastro)
    .useValue({ canActivate: () => true })
    .overrideGuard(GuardDeAcao)
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
});

describe('rotas por :versionId com o empresaId no caminho', () => {
  it('salvar chega ao caso de uso com o versionId do caminho (não com o empresaId)', async () => {
    servico.salvarEstrutura.mockResolvedValue({ version: { revision: 1 }, lines: [] });

    await request(app.getHttpServer())
      .post(`${BASE}/versoes/${VERSAO}/linhas`)
      .send({ expectedRevision: 0, lines: [LINHA] })
      .expect(201);

    expect(servico.salvarEstrutura).toHaveBeenCalledWith(
      { tenantId: TENANT, usuarioId: USUARIO },
      EMPRESA,
      VERSAO,
      0,
      [LINHA],
      expect.anything(),
    );
  });

  it('publicar chega ao caso de uso com o versionId do caminho', async () => {
    servico.publicar.mockResolvedValue({ version: { status: 'ACTIVE' } });

    await request(app.getHttpServer())
      .post(`${BASE}/versoes/${VERSAO}/publicar`)
      .send({ expectedRevision: 0, effectiveFrom: '2097-04' })
      .expect(201);

    expect(servico.publicar).toHaveBeenCalledWith(
      { tenantId: TENANT, usuarioId: USUARIO },
      EMPRESA,
      VERSAO,
      0,
      '2097-04',
      expect.anything(),
    );
  });

  it('obter chega ao caso de uso com o versionId do caminho', async () => {
    servico.obterVersao.mockResolvedValue({ version: { id: VERSAO } });

    await request(app.getHttpServer()).get(`${BASE}/versoes/${VERSAO}`).expect(200);

    expect(servico.obterVersao).toHaveBeenCalledWith({ tenantId: TENANT, usuarioId: USUARIO }, EMPRESA, VERSAO);
  });

  it('versionId fora do formato → 422 apontando o campo versionId, sem chamar o caso de uso', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`${BASE}/versoes/nao-e-uuid/linhas`)
      .send({ expectedRevision: 0, lines: [] })
      .expect(422);

    expect(resposta.body).toMatchObject({
      code: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      campos: [{ campo: 'versionId' }],
    });
    expect(servico.salvarEstrutura).not.toHaveBeenCalled();
  });
});
