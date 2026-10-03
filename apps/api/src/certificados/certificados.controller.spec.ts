/**
 * Controllers do cofre (SPEC-011): validação de entrada, origem do tenant/autor (sempre a
 * sessão), contrato `problem+json` e as rotas internas por HTTP real (Bearer de serviço).
 */
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import type { RequisicaoAutenticada } from '../auth/sessao.guard';
import { FiltroDeProblema, statusDoErro } from '../comum/problema';
import {
  CertificadosController,
  CertificadosDaEmpresaController,
  CofreInternoController,
  HistoricoDeCertificadosController,
} from './certificados.controller';
import { CertificadosService } from './certificados.service';
import { GuardDeServicoInterno } from './servico-interno.guard';

const ID = (n: number): string => `01927b5c-8e1a-7c3d-9a1b-${String(n).padStart(12, '0')}`;
const TOKEN = 'b'.repeat(48);
const SENTINELA = 'SENHA-SENTINELA-123';

const requisicao = (): RequisicaoAutenticada =>
  ({
    header: () => 'corr-1',
    sessao: {
      tenantId: ID(1),
      usuarioId: ID(2),
      papeis: ['contador'],
      permissoes: ['certificados.cofre.consultar'],
    },
  }) as unknown as RequisicaoAutenticada;

const servicoFalso = () => ({
  consultar: vi.fn(async () => ({ itens: [] })),
  consultarEmpresa: vi.fn(async () => ({ item: {}, versoes: [] })),
  listarResponsaveis: vi.fn(async () => []),
  emitirTicket: vi.fn(async () => ({ ticket: 't' })),
  trocarResponsavel: vi.fn(async () => ({})),
  desativar: vi.fn(async () => ({})),
  consultarHistorico: vi.fn(async () => ({ eventos: [], total: 0 })),
  ativar: vi.fn(async () => ({ certificado: { id: ID(9) } })),
  recusar: vi.fn(async () => undefined),
});

const codigoDe = async (acao: () => unknown): Promise<string | undefined> => {
  try {
    await acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('CertificadosController (sessão)', () => {
  it('lista com filtro validado, padrões e usuário da sessão', async () => {
    const servico = servicoFalso();

    await new CertificadosController(servico as never).listar(requisicao(), { estado: 'VENCE_D7', busca: ' ac ' });

    expect(servico.consultar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ID(1), usuarioId: ID(2), papeis: ['contador'] }),
      { busca: 'ac', estado: 'VENCE_D7', ordem: 'EMPRESA', pagina: 1, limite: 25 },
      'corr-1',
    );
  });

  it.each([{ estado: 'INVENTADO' }, { limite: '1000' }, { pagina: '0' }, { ordem: 'X' }])(
    'filtro inválido %j é 422 e o serviço não é chamado',
    async (consulta) => {
      const servico = servicoFalso();

      expect(await codigoDe(() => new CertificadosController(servico as never).listar(requisicao(), consulta))).toBe(
        CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      );
      expect(servico.consultar).not.toHaveBeenCalled();
    },
  );
});

describe('CertificadosDaEmpresaController (sessão)', () => {
  it('ingestoes pede o ticket para o responsável escolhido, com tenant e autor da sessão e nunca do corpo', async () => {
    const servico = servicoFalso();

    await new CertificadosDaEmpresaController(servico as never).ingestoes(requisicao(), ID(3), {
      responsavelId: ID(4),
      tenantId: 'malicioso',
      usuarioId: 'malicioso',
    });

    expect(servico.emitirTicket).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ID(1), usuarioId: ID(2) }),
      ID(3),
      ID(4),
      'corr-1',
    );
  });

  it('responsável ausente ou malformado é 422', async () => {
    const servico = servicoFalso();
    const controller = new CertificadosDaEmpresaController(servico as never);

    for (const corpo of [{}, { responsavelId: 'x' }, null]) {
      expect(await codigoDe(() => controller.ingestoes(requisicao(), ID(3), corpo))).toBe(
        CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      );
      expect(await codigoDe(() => controller.trocarResponsavel(requisicao(), ID(3), corpo))).toBe(
        CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      );
    }
    expect(servico.emitirTicket).not.toHaveBeenCalled();
  });

  it('desativação sem motivo (vazio, espaços ou ausente) é bloqueada antes do caso de uso', async () => {
    const servico = servicoFalso();
    const controller = new CertificadosDaEmpresaController(servico as never);

    for (const corpo of [{}, { motivo: '' }, { motivo: '   ' }, { motivo: 'x'.repeat(501) }]) {
      expect(await codigoDe(() => controller.desativar(requisicao(), ID(3), corpo))).toBe(
        CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      );
    }
    expect(servico.desativar).not.toHaveBeenCalled();

    await controller.desativar(requisicao(), ID(3), { motivo: '  Troca  ' });
    expect(servico.desativar).toHaveBeenCalledWith(expect.anything(), ID(3), 'Troca', 'corr-1');
  });

  it('detalhe, responsáveis e troca delegam com a empresa da rota', async () => {
    const servico = servicoFalso();
    const controller = new CertificadosDaEmpresaController(servico as never);

    await controller.detalhe(requisicao(), ID(3));
    await controller.responsaveis(requisicao(), ID(3));
    await controller.trocarResponsavel(requisicao(), ID(3), { responsavelId: ID(4) });

    expect(servico.consultarEmpresa).toHaveBeenCalledWith(expect.anything(), ID(3), 'corr-1');
    expect(servico.listarResponsaveis).toHaveBeenCalledWith(expect.anything(), ID(3), 'corr-1');
    expect(servico.trocarResponsavel).toHaveBeenCalledWith(expect.anything(), ID(3), ID(4), 'corr-1');
  });

  it('não existe rota de download nem de leitura do segredo', () => {
    const nomes = [
      ...Object.getOwnPropertyNames(CertificadosDaEmpresaController.prototype),
      ...Object.getOwnPropertyNames(CertificadosController.prototype),
      ...Object.getOwnPropertyNames(CofreInternoController.prototype),
    ];

    expect(nomes.filter((nome) => /download|baixar|segredo|arquivo|senha|chave/iu.test(nome))).toEqual([]);
  });
});

describe('HistoricoDeCertificadosController', () => {
  it('valida os filtros e usa a sessão', async () => {
    const servico = servicoFalso();
    const controller = new HistoricoDeCertificadosController(servico as never);

    await controller.listar(requisicao(), { acao: 'RECUSA', empresaId: ID(3) });

    expect(servico.consultarHistorico).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: ID(2) }),
      { empresaId: ID(3), acao: 'RECUSA', resultado: null, limite: 25, deslocamento: 0 },
      'corr-1',
    );
    expect(await codigoDe(() => controller.listar(requisicao(), { acao: 'OUTRA' }))).toBe(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
    );
  });
});

describe('status HTTP dos códigos do cofre', () => {
  it.each([
    [CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO, HttpStatus.FORBIDDEN],
    [CODIGOS_DE_ERRO.CERTIFICADO_TAMANHO_EXCEDIDO, HttpStatus.PAYLOAD_TOO_LARGE],
    [CODIGOS_DE_ERRO.COFRE_INDISPONIVEL, HttpStatus.SERVICE_UNAVAILABLE],
    [CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE, HttpStatus.CONFLICT],
    [CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE, HttpStatus.CONFLICT],
    [CODIGOS_DE_ERRO.CERTIFICADO_SENHA_INCORRETA, HttpStatus.UNPROCESSABLE_ENTITY],
    [CODIGOS_DE_ERRO.CERTIFICADO_CNPJ_DIVERGENTE, HttpStatus.UNPROCESSABLE_ENTITY],
    [CODIGOS_DE_ERRO.CERTIFICADO_EXPIRADO, HttpStatus.UNPROCESSABLE_ENTITY],
    [CODIGOS_DE_ERRO.CERTIFICADO_MOTIVO_OBRIGATORIO, HttpStatus.UNPROCESSABLE_ENTITY],
  ])('%s → %i', (codigo, status) => {
    expect(statusDoErro(new ErroDeDominio(codigo, 'x'))).toBe(status);
  });
});

describe('rotas internas do cofre por HTTP', () => {
  let app: INestApplication;
  const servico = servicoFalso();
  const ambiente = process.env['COFRE_SERVICE_TOKEN'];

  beforeAll(async () => {
    process.env['COFRE_SERVICE_TOKEN'] = TOKEN;
    const modulo = await Test.createTestingModule({
      controllers: [CofreInternoController],
      providers: [{ provide: CertificadosService, useValue: servico }, GuardDeServicoInterno],
    }).compile();

    app = modulo.createNestApplication();
    app.useGlobalFilters(new FiltroDeProblema());
    await app.init();
  });

  afterAll(async () => {
    await app.close();

    if (ambiente === undefined) {
      delete process.env['COFRE_SERVICE_TOKEN'];
    } else {
      process.env['COFRE_SERVICE_TOKEN'] = ambiente;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    servico.ativar.mockResolvedValue({ certificado: { id: ID(9) } });
    servico.recusar.mockResolvedValue(undefined);
  });

  const pedido = {
    ticket: 'abc.def',
    referenciaDoSegredo: ID(8),
    metadados: {
      titular: 'EMPRESA',
      cnpjTitular: '11222333000181',
      autoridadeCertificadora: 'AC',
      cadeia: ['EMPRESA', 'AC'],
      numeroSerie: '01',
      impressaoDigital: 'AB'.repeat(32),
      naoAntes: '2026-01-01T03:00:00.000Z',
      naoDepois: '2027-01-01T02:59:59.000Z',
    },
  };

  it('sem Bearer de serviço: 401 problem+json, e o caso de uso não roda', async () => {
    const resposta = await request(app.getHttpServer()).post('/interno/cofre/ativacao').send(pedido).expect(401);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ status: 401, code: 'HTTP_401' });
    expect(servico.ativar).not.toHaveBeenCalled();
  });

  it('Bearer errado também é 401', async () => {
    await request(app.getHttpServer())
      .post('/interno/cofre/recusa')
      .set('authorization', `Bearer ${'z'.repeat(48)}`)
      .send({ ticket: 'a.b', codigo: 'CERTIFICADO_ARQUIVO_VAZIO' })
      .expect(401);
    expect(servico.recusar).not.toHaveBeenCalled();
  });

  it('ativação válida: 200 com os metadados, o correlationId repassado e só os campos do contrato', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/interno/cofre/ativacao')
      .set('authorization', `Bearer ${TOKEN}`)
      .set('x-correlation-id', 'corr-http')
      .send({ ...pedido, senha: SENTINELA, pkcs12_base64: SENTINELA })
      .expect(200);

    expect(resposta.body).toEqual({ certificado: { id: ID(9) } });
    expect(JSON.stringify(resposta.body)).not.toContain(SENTINELA);

    const [recebido, correlationId] = servico.ativar.mock.calls[0] as unknown as [object, string];
    expect(correlationId).toBe('corr-http');
    // Campos fora do contrato (senha, arquivo) são descartados na borda: o caso de uso nunca os vê.
    expect(JSON.stringify(recebido)).not.toContain(SENTINELA);
    expect(Object.keys(recebido).sort()).toEqual(['metadados', 'referenciaDoSegredo', 'ticket']);
  });

  it.each([
    ['sem metadados', { ticket: 'a.b', referenciaDoSegredo: ID(8) }],
    ['referência que não é id', { ...pedido, referenciaDoSegredo: '../../kv/data/segredo' }],
    ['data inválida', { ...pedido, metadados: { ...pedido.metadados, naoDepois: 'ontem' } }],
    ['cadeia vazia', { ...pedido, metadados: { ...pedido.metadados, cadeia: [] } }],
  ])('corpo inválido (%s): 422 problem+json com o campo, sem chamar o caso de uso', async (_nome, corpo) => {
    const resposta = await request(app.getHttpServer())
      .post('/interno/cofre/ativacao')
      .set('authorization', `Bearer ${TOKEN}`)
      .send(corpo)
      .expect(422);

    expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/u);
    expect(resposta.body).toMatchObject({ status: 422, code: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
    expect(servico.ativar).not.toHaveBeenCalled();
  });

  it('recusa de negócio vira problem+json com código estável, título e correlationId, sem material sensível', async () => {
    servico.ativar.mockRejectedValue(
      new ErroDeDominio(CODIGOS_DE_ERRO.CERTIFICADO_CNPJ_DIVERGENTE, 'O CNPJ do certificado não é o CNPJ desta empresa.'),
    );

    const resposta = await request(app.getHttpServer())
      .post('/interno/cofre/ativacao')
      .set('authorization', `Bearer ${TOKEN}`)
      .set('x-correlation-id', 'corr-422')
      .send({ ...pedido, senha: SENTINELA })
      .expect(422);

    expect(resposta.body).toMatchObject({
      type: expect.stringContaining('certificado-cnpj-divergente'),
      title: 'O CNPJ do certificado não é o CNPJ desta empresa.',
      status: 422,
      code: 'CERTIFICADO_CNPJ_DIVERGENTE',
      correlationId: 'corr-422',
    });
    expect(JSON.stringify(resposta.body)).not.toContain(SENTINELA);
  });

  it('ticket inválido é 403 e falha de infraestrutura é 500 genérico, sem o detalhe', async () => {
    servico.ativar.mockRejectedValueOnce(
      new ErroDeDominio(CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO, 'ticket'),
    );
    await request(app.getHttpServer())
      .post('/interno/cofre/ativacao')
      .set('authorization', `Bearer ${TOKEN}`)
      .send(pedido)
      .expect(403);

    servico.ativar.mockRejectedValueOnce(new Error('detalhe interno da falha'));
    const resposta = await request(app.getHttpServer())
      .post('/interno/cofre/ativacao')
      .set('authorization', `Bearer ${TOKEN}`)
      .send(pedido)
      .expect(500);

    expect(resposta.body.code).toBe('ERRO_INTERNO');
    expect(JSON.stringify(resposta.body)).not.toContain('detalhe interno');
  });

  it('recusa registrada: 200 {registrado:true}; código fora da lista estável é 422', async () => {
    const ok = await request(app.getHttpServer())
      .post('/interno/cofre/recusa')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ ticket: 'a.b', codigo: 'CERTIFICADO_SENHA_INCORRETA' })
      .expect(200);

    expect(ok.body).toEqual({ registrado: true });
    expect(servico.recusar).toHaveBeenCalledWith(
      { ticket: 'a.b', codigo: 'CERTIFICADO_SENHA_INCORRETA' },
      expect.any(String),
    );

    await request(app.getHttpServer())
      .post('/interno/cofre/recusa')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ ticket: 'a.b', codigo: 'QUALQUER_COISA' })
      .expect(422);
  });
});
