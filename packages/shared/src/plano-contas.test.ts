import { CODIGOS_DE_ERRO_DA_LINHA as CODIGOS_DO_DOMINIO, type CodigoDeErroDaLinha as CodigoDoDominio } from '@contaia/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CODIGOS_DE_ERRO_DA_LINHA,
  ComandoValidarImportacaoSchema,
  FILA_DE_VALIDACAO_PLANO_CONTAS,
  FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA,
  NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
  PaginaDeRejeicoesDaImportacaoSchema,
  PaginaDoPlanoDeContasSchema,
  PreviaDaImportacaoSchema,
  idDoJobDeValidacao,
  type CodigoDeErroDaLinha,
} from './plano-contas.js';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const TENTATIVA = '0198f3c2-0000-7000-8000-000000000003';

describe('fila de validação do plano de contas (SPEC-013 §6.4)', () => {
  it('nomes de fila e id de job não usam ":" (o BullMQ 6 recusa)', () => {
    expect(FILA_DE_VALIDACAO_PLANO_CONTAS).not.toContain(':');
    expect(FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA).not.toContain(':');
    expect(NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS.length).toBeGreaterThan(0);
    expect(idDoJobDeValidacao(TENTATIVA)).not.toContain(':');
  });

  it('o id do job é determinístico pela tentativa: reenfileirar não duplica', () => {
    expect(idDoJobDeValidacao(TENTATIVA)).toBe(idDoJobDeValidacao(TENTATIVA));
    expect(idDoJobDeValidacao(TENTATIVA)).not.toBe(idDoJobDeValidacao(EMPRESA));
    expect(idDoJobDeValidacao(TENTATIVA)).toBe(`validacao-${TENTATIVA}`);
  });

  it('o comando leva só tenant, empresa, tentativa e correlationId; campo extra é recusado', () => {
    const comando = { tenantId: TENANT, empresaId: EMPRESA, tentativaId: TENTATIVA, correlationId: 'corr-0001-abc' };

    expect(ComandoValidarImportacaoSchema.parse(comando)).toEqual(comando);
    expect(ComandoValidarImportacaoSchema.safeParse({ ...comando, mapeamento: {} }).success).toBe(false);
    expect(ComandoValidarImportacaoSchema.safeParse({ ...comando, tentativaId: 'x' }).success).toBe(false);
  });
});

describe('visão da tentativa (prévia) devolvida pela API', () => {
  const visao = {
    tentativaId: TENTATIVA,
    estado: 'AGUARDANDO_CONFIRMACAO',
    arquivo: { nome: 'plano.csv', tamanho: 120, hash: 'a'.repeat(64) },
    mapeamento: { codigo: 'Código', nome: 'Nome', tipo: 'Tipo', natureza: 'Natureza', conta_pai: 'Pai' },
    totais: { lidas: 3, novas: 2, atualizadas: 0, rejeitadas: 1 },
    amostraRejeicoes: [
      {
        numeroDaLinha: 4,
        codigo: '9',
        campo: 'conta_pai',
        codigoDeErro: 'CONTA_PAI_INEXISTENTE',
        mensagem: 'A conta-pai não existe.',
      },
    ],
    criadoEm: '2026-10-08T12:00:00.000Z',
    finalizadoEm: null,
    correlationId: 'corr-0001-abc',
    versaoDaPrevia: 0,
    reutilizadaPorIdempotencia: false,
    podeConfirmar: true,
    podeCancelar: true,
    relatorioDisponivel: true,
  };

  it('aceita a visão completa', () => {
    expect(PreviaDaImportacaoSchema.parse(visao)).toEqual(visao);
  });

  it('antes da validação os totais e a versão são nulos', () => {
    expect(
      PreviaDaImportacaoSchema.safeParse({
        ...visao,
        estado: 'RECEBIDA',
        totais: null,
        versaoDaPrevia: null,
        amostraRejeicoes: [],
        podeConfirmar: false,
        podeCancelar: false,
        relatorioDisponivel: false,
      }).success,
    ).toBe(true);
  });

  it('recusa campo extra', () => {
    expect(PreviaDaImportacaoSchema.safeParse({ ...visao, tenantId: TENANT }).success).toBe(false);
  });

  it('diagnóstico (aditivo): ausente, nulo ou código estável + mensagem; nunca formato livre', () => {
    const falha = { ...visao, estado: 'FALHA', totais: null, versaoDaPrevia: null, amostraRejeicoes: [] };
    const diagnostico = { codigo: 'ARMAZENAMENTO_INDISPONIVEL', mensagem: 'O arquivo não pôde ser lido agora.' };

    expect(PreviaDaImportacaoSchema.safeParse(falha).success).toBe(true);
    expect(PreviaDaImportacaoSchema.safeParse({ ...falha, diagnostico: null }).success).toBe(true);
    expect(PreviaDaImportacaoSchema.parse({ ...falha, diagnostico }).diagnostico).toEqual(diagnostico);
    expect(PreviaDaImportacaoSchema.safeParse({ ...falha, diagnostico: { ...diagnostico, codigo: 'texto livre' } }).success).toBe(false);
    expect(PreviaDaImportacaoSchema.safeParse({ ...falha, diagnostico: { ...diagnostico, pilha: 'x' } }).success).toBe(false);
  });

  it('páginas de rejeições e do plano têm contrato próprio', () => {
    expect(
      PaginaDeRejeicoesDaImportacaoSchema.safeParse({
        pagina: 1,
        itensPorPagina: 20,
        total: 1,
        itens: visao.amostraRejeicoes,
      }).success,
    ).toBe(true);
    expect(
      PaginaDoPlanoDeContasSchema.safeParse({
        pagina: 1,
        itensPorPagina: 50,
        total: 1,
        itens: [
          {
            id: TENTATIVA,
            codigo: '1',
            nome: 'Ativo',
            tipo: 'sintetica',
            natureza: 'devedora',
            contaPai: null,
            arquivada: false,
            atualizadoEm: '2026-10-08T12:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('códigos de erro da linha: contrato × domínio (SPEC-013 §3.4)', () => {
  // O web lê a prévia com parse estrito: um código que só o domínio conhece quebraria a tela.
  it('a lista do contrato é exatamente a do domínio', () => {
    expect([...CODIGOS_DE_ERRO_DA_LINHA].sort()).toEqual([...CODIGOS_DO_DOMINIO].sort());
    expectTypeOf<CodigoDeErroDaLinha>().toEqualTypeOf<CodigoDoDominio>();
  });
});
