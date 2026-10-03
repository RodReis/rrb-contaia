/**
 * Chaves de leitura granular (SPEC-008 §3.2, pré-requisito da F9): quando a
 * carteira libera empresas a outros papéis, a resposta do servidor passa a
 * depender de `documentos.arquivos.consultar`, `documentos.analise.consultar` e
 * `pendencias.pendencias.abrir_origem` — esconder na tela não basta.
 */
import { describe, expect, it } from 'vitest';

import type { ChaveDePermissao } from '@contaia/domain';

import type { VisaoDosDocumentos } from '../empresa/documentos.service';
import type { EventoDocumentalNaLista } from '@contaia/db';

import { restringirDocumentos, restringirHistoricoDocumental, restringirPendencia } from './restricao-por-chave';

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

    // Aprovado, rejeitado e vencido (que só nasce de aprovado) colapsam em "enviado": o arquivo chegou, o veredito não é revelado.
    expect(restrita.exigencias.map((e) => e.estado)).toEqual([
      'ENVIADO',
      'ENVIADO',
      'PENDENTE',
      'ENVIADO',
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

describe('VENCIDO não revela a aprovação', () => {
  it('sem analise.consultar o documento vencido aparece como enviado', () => {
    const restrita = restringirDocumentos(SO_EXIGENCIAS, visao(exigencia('VENCIDO')));

    expect(restrita.exigencias[0]?.estado).toBe('ENVIADO');
  });
});

describe('restringirPendencia: tipo que revela o veredito', () => {
  const rejeitada = { id: 'p1', origem: 'DOCUMENTAL', tipo: 'DOCUMENTO_REJEITADO', chave: 'exigencia:abc' };

  it('sem analise.consultar vira nova pendência; com a chave, passa', () => {
    expect(restringirPendencia(['pendencias.pendencias.abrir_origem'], rejeitada).tipo).toBe('NOVA_PENDENCIA');
    expect(
      restringirPendencia(
        ['pendencias.pendencias.abrir_origem', 'documentos.analise.consultar'],
        rejeitada,
      ),
    ).toEqual(rejeitada);
  });

  it('o aviso consolidado de carteira passa intacto, sem origem nem análise', () => {
    const aviso = { id: 'c1', tipo: 'CARTEIRA_ALTERADA', chave: 'evento-1' };

    expect(restringirPendencia([], aviso)).toEqual(aviso);
  });

  it('tipo que não é veredito não muda, mesmo sem a chave', () => {
    const nova = { id: 'p2', tipo: 'NOVA_EXIGENCIA', chave: 'exigencia:x' };

    expect(restringirPendencia(['pendencias.pendencias.abrir_origem'], nova)).toEqual(nova);
  });
});

describe('restringirHistoricoDocumental', () => {
  const evento = (acao: EventoDocumentalNaLista['acao'], sobre: Partial<EventoDocumentalNaLista> = {}) =>
    ({
      id: acao,
      exigenciaId: 'ex',
      exigenciaNome: 'Contrato',
      versaoNumero: 2,
      acao,
      estadoAnterior: null,
      estadoNovo: null,
      justificativa: null,
      usuarioNome: 'Ana',
      ocorridoEm: '2026-10-01T00:00:00.000Z',
      ...sobre,
    }) as EventoDocumentalNaLista;

  const pagina = {
    eventos: [
      evento('ENVIO', { estadoNovo: 'ENVIADO' }),
      evento('REJEICAO', { estadoAnterior: 'ENVIADO', estadoNovo: 'REJEITADO', justificativa: 'Ilegível.' }),
      evento('APROVACAO', { estadoNovo: 'APROVADO' }),
      evento('VENCIMENTO', { estadoNovo: 'VENCIDO' }),
      evento('DOWNLOAD'),
      evento('DISPENSA', { estadoNovo: 'DISPENSADO', justificativa: 'Não se aplica.' }),
    ],
    total: 6,
  };

  it('com todas as chaves devolve tudo', () => {
    expect(restringirHistoricoDocumental(TUDO, pagina)).toEqual(pagina);
  });

  it('sem analise.consultar somem aprovação, rejeição e vencimento, e nenhum motivo de rejeição sai', () => {
    const restrita = restringirHistoricoDocumental(
      ['documentos.historico.consultar', 'documentos.arquivos.consultar'],
      pagina,
    );

    expect(restrita.eventos.map((e) => e.acao)).toEqual(['ENVIO', 'DOWNLOAD', 'DISPENSA']);
    expect(JSON.stringify(restrita)).not.toContain('Ilegível');
    expect(JSON.stringify(restrita)).not.toMatch(/APROVADO|REJEITADO|VENCIDO/);
    // O motivo da dispensa pertence à exigência e permanece.
    expect(restrita.eventos.at(-1)?.justificativa).toBe('Não se aplica.');
    expect(restrita.total).toBe(3);
  });

  it('sem arquivos.consultar somem visualização e download e o número da versão', () => {
    const restrita = restringirHistoricoDocumental(
      ['documentos.historico.consultar', 'documentos.analise.consultar'],
      pagina,
    );

    expect(restrita.eventos.map((e) => e.acao)).not.toContain('DOWNLOAD');
    expect(restrita.eventos.every((e) => e.versaoNumero === null)).toBe(true);
  });
});
