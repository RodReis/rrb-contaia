/**
 * Chaves de leitura granular (SPEC-008 §3.2, pré-requisito da F9): quando a
 * carteira libera empresas a outros papéis, a resposta do servidor passa a
 * depender de `documentos.arquivos.consultar`, `documentos.analise.consultar` e
 * `pendencias.pendencias.abrir_origem` — esconder na tela não basta.
 */
import { describe, expect, it } from 'vitest';

import type { ChaveDePermissao } from '@contaia/domain';

import type { VisaoDosDocumentos } from '../empresa/documentos.service';
import { restringirDocumentos, restringirPendencia } from './restricao-por-chave';

const versao = {
  id: 'v1',
  numero: 1,
  nomeOriginal: 'contrato.pdf',
  tipoConteudo: 'application/pdf',
  tamanhoBytes: 10,
  validade: null,
  vigente: true,
  criadoEm: '2026-10-01T00:00:00.000Z',
};

const exigencia = (estado: string, sobre: Record<string, unknown> = {}) => ({
  id: `ex-${estado}`,
  codigo: null,
  nome: 'Contrato social',
  descricao: null,
  dataLimite: null,
  estado,
  justificativa: null,
  aplicavel: true,
  versao: 1,
  versoes: [versao],
  ...sobre,
});

const visao = (...exigencias: ReturnType<typeof exigencia>[]): VisaoDosDocumentos =>
  ({ empresaId: 'e-1', exigencias }) as unknown as VisaoDosDocumentos;

const TUDO: readonly ChaveDePermissao[] = [
  'documentos.exigencias.consultar',
  'documentos.arquivos.consultar',
  'documentos.analise.consultar',
];
const SO_EXIGENCIAS: readonly ChaveDePermissao[] = ['documentos.exigencias.consultar'];

describe('restringirDocumentos', () => {
  it('com todas as chaves devolve a visão completa', () => {
    const completa = visao(exigencia('APROVADO'));

    expect(restringirDocumentos(TUDO, completa)).toEqual(completa);
  });

  it('sem documentos.arquivos.consultar esconde as versões de arquivo', () => {
    const restrita = restringirDocumentos(
      ['documentos.exigencias.consultar', 'documentos.analise.consultar'],
      visao(exigencia('ENVIADO')),
    );

    expect(restrita.exigencias[0]?.versoes).toEqual([]);
    expect(restrita.exigencias[0]?.estado).toBe('ENVIADO');
  });

  it('sem documentos.analise.consultar o resultado da análise não aparece', () => {
    const restrita = restringirDocumentos(
      ['documentos.exigencias.consultar', 'documentos.arquivos.consultar'],
      visao(
        exigencia('APROVADO'),
        exigencia('REJEITADO', { justificativa: 'Ilegível.' }),
        exigencia('PENDENTE'),
        exigencia('VENCIDO'),
        exigencia('DISPENSADO', { justificativa: 'Não se aplica.' }),
      ),
    );

    // Aprovado e rejeitado colapsam em "enviado": o arquivo chegou, o veredito não é revelado.
    expect(restrita.exigencias.map((e) => e.estado)).toEqual([
      'ENVIADO',
      'ENVIADO',
      'PENDENTE',
      'VENCIDO',
      'DISPENSADO',
    ]);
    // O motivo da rejeição é parte da análise; o da dispensa pertence à exigência.
    expect(restrita.exigencias[1]?.justificativa).toBeNull();
    expect(restrita.exigencias[4]?.justificativa).toBe('Não se aplica.');
    expect(restrita.exigencias[0]?.versoes).toHaveLength(1);
  });

  it('só com a consulta de exigências, nem arquivos nem análise saem', () => {
    const restrita = restringirDocumentos(SO_EXIGENCIAS, visao(exigencia('REJEITADO', { justificativa: 'x' })));

    expect(restrita.exigencias[0]).toMatchObject({
      estado: 'ENVIADO',
      justificativa: null,
      versoes: [],
    });
  });

  it('não muda a entrada: devolve cópia', () => {
    const original = visao(exigencia('APROVADO'));

    restringirDocumentos(SO_EXIGENCIAS, original);

    expect(original.exigencias[0]?.estado).toBe('APROVADO');
    expect(original.exigencias[0]?.versoes).toHaveLength(1);
  });
});

describe('restringirPendencia', () => {
  const pendencia = { id: 'p1', origem: 'DOCUMENTAL', chave: 'exigencia:abc' };

  it('com pendencias.pendencias.abrir_origem mantém a referência da origem', () => {
    expect(restringirPendencia(['pendencias.pendencias.abrir_origem'], pendencia)).toEqual(pendencia);
  });

  it('sem a chave a referência da origem não sai do servidor', () => {
    expect(restringirPendencia(['pendencias.pendencias.consultar'], pendencia)).toEqual({
      ...pendencia,
      chave: '',
    });
  });
});
