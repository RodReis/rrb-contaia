import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import {
  CHECKLIST_PADRAO,
  ESTADOS_DO_DOCUMENTO,
  aprovarVersao,
  dispensarExigencia,
  ehEstadoDoDocumento,
  estadoComVencimento,
  exigenciasDaAplicabilidade,
  rejeitarVersao,
  registrarEnvio,
  validarNomeDaExigencia,
  validarValidade,
} from './documentos.js';

const HOJE = new Date('2026-09-20T12:00:00Z');

describe('checklist padrão', () => {
  it('traz as sete exigências aprovadas pelo PI, na ordem da SPEC', () => {
    expect(CHECKLIST_PADRAO.map((exigencia) => exigencia.codigo)).toEqual([
      'CONTRATO_SOCIAL',
      'CARTAO_CNPJ',
      'INSCRICAO_ESTADUAL',
      'INSCRICAO_MUNICIPAL',
      'ALVARA_DE_FUNCIONAMENTO',
      'DOCUMENTO_DO_RESPONSAVEL',
      'COMPROVANTE_DE_ENDERECO',
    ]);
  });

  it('marca como condicionais apenas as exigências que dependem do cadastro', () => {
    const condicionais = CHECKLIST_PADRAO.filter((exigencia) => exigencia.condicional).map(
      (exigencia) => exigencia.codigo,
    );

    expect(condicionais).toEqual([
      'INSCRICAO_ESTADUAL',
      'INSCRICAO_MUNICIPAL',
      'ALVARA_DE_FUNCIONAMENTO',
    ]);
  });
});

describe('aplicabilidade das inscrições', () => {
  it('não torna a exigência aplicável quando a inscrição não se aplica', () => {
    const exigencias = exigenciasDaAplicabilidade({
      inscricaoEstadual: 'NAO_SE_APLICA',
      inscricaoMunicipal: 'NAO_SE_APLICA',
    });

    const estadual = exigencias.find((exigencia) => exigencia.codigo === 'INSCRICAO_ESTADUAL');
    const municipal = exigencias.find((exigencia) => exigencia.codigo === 'INSCRICAO_MUNICIPAL');

    expect(estadual?.aplicavel).toBe(false);
    expect(estadual?.motivo).toBeNull();
    expect(municipal?.aplicavel).toBe(false);
  });

  it('mantém a exigência na lista mesmo inaplicável: a F3 reconcilia sem apagar histórico', () => {
    const exigencias = exigenciasDaAplicabilidade({
      inscricaoEstadual: 'NAO_SE_APLICA',
      inscricaoMunicipal: 'NAO_SE_APLICA',
    });

    expect(exigencias).toHaveLength(CHECKLIST_PADRAO.length);
  });

  it('exige comprovante de isenção quando a empresa é isenta', () => {
    const exigencias = exigenciasDaAplicabilidade({
      inscricaoEstadual: 'ISENTO',
      inscricaoMunicipal: 'NAO_SE_APLICA',
    });

    const estadual = exigencias.find((exigencia) => exigencia.codigo === 'INSCRICAO_ESTADUAL');

    expect(estadual?.aplicavel).toBe(true);
    expect(estadual?.motivo).toBe('ISENTO');
  });

  it('exige comprovante da inscrição quando a empresa possui', () => {
    const exigencias = exigenciasDaAplicabilidade({
      inscricaoEstadual: 'POSSUI',
      inscricaoMunicipal: 'POSSUI',
    });

    const municipal = exigencias.find((exigencia) => exigencia.codigo === 'INSCRICAO_MUNICIPAL');

    expect(municipal?.aplicavel).toBe(true);
    expect(municipal?.motivo).toBe('POSSUI');
  });
});

describe('estados do documento', () => {
  it('reconhece os seis estados aprovados e recusa os demais', () => {
    expect(ESTADOS_DO_DOCUMENTO).toEqual([
      'PENDENTE',
      'ENVIADO',
      'APROVADO',
      'REJEITADO',
      'DISPENSADO',
      'VENCIDO',
    ]);
    expect(ehEstadoDoDocumento('APROVADO')).toBe(true);
    expect(ehEstadoDoDocumento('ARQUIVADO')).toBe(false);
  });
});

describe('envio de arquivo', () => {
  it('entra como ENVIADO e nunca aprova sozinho, mesmo vindo do administrador', () => {
    expect(registrarEnvio('PENDENTE')).toBe('ENVIADO');
    expect(registrarEnvio('REJEITADO')).toBe('ENVIADO');
    expect(registrarEnvio('VENCIDO')).toBe('ENVIADO');
    // Substituição de documento já aprovado também volta para análise.
    expect(registrarEnvio('APROVADO')).toBe('ENVIADO');
  });

  it('recusa envio em exigência dispensada: a dispensa precisa ser revertida antes', () => {
    expect(() => registrarEnvio('DISPENSADO')).toThrow(ErroDeDominio);

    try {
      registrarEnvio('DISPENSADO');
    } catch (erro) {
      expect((erro as ErroDeDominio).codigo).toBe(
        CODIGOS_DE_ERRO.TRANSICAO_DOCUMENTAL_INVALIDA,
      );
    }
  });
});

describe('análise do envio', () => {
  it('aprova apenas o que está aguardando análise', () => {
    expect(aprovarVersao('ENVIADO')).toBe('APROVADO');

    for (const estado of ['PENDENTE', 'APROVADO', 'REJEITADO', 'DISPENSADO', 'VENCIDO'] as const) {
      expect(() => aprovarVersao(estado)).toThrow(ErroDeDominio);
    }
  });

  it('rejeita apenas o que está aguardando análise e exige justificativa', () => {
    expect(rejeitarVersao('ENVIADO', 'Documento ilegível.')).toBe('REJEITADO');

    expect(() => rejeitarVersao('ENVIADO', '   ')).toThrow(ErroDeDominio);
    expect(() => rejeitarVersao('ENVIADO', null)).toThrow(ErroDeDominio);
    expect(() => rejeitarVersao('APROVADO', 'Motivo.')).toThrow(ErroDeDominio);
  });

  it('rejeição mantém a exigência pendente de nova versão, não a dispensa', () => {
    expect(rejeitarVersao('ENVIADO', 'Fora de validade.')).toBe('REJEITADO');
  });
});

describe('dispensa', () => {
  it('exige justificativa', () => {
    expect(dispensarExigencia('PENDENTE', 'Empresa isenta por decisão do escritório.')).toBe(
      'DISPENSADO',
    );

    try {
      dispensarExigencia('PENDENTE', ' ');
    } catch (erro) {
      expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA);
    }
  });

  it('não dispensa o que já está dispensado', () => {
    expect(() => dispensarExigencia('DISPENSADO', 'Motivo.')).toThrow(ErroDeDominio);
  });
});

describe('validade', () => {
  it('aceita ausência de validade: a data é opcional', () => {
    expect(validarValidade(null)).toEqual([]);
  });

  it('recusa data fora do formato de data civil', () => {
    expect(validarValidade('20/09/2026')).toEqual([
      { campo: 'validade', codigo: CODIGOS_DE_ERRO.VALIDADE_INVALIDA },
    ]);
  });

  it('aceita validade futura: o documento vence depois, não agora', () => {
    expect(validarValidade('2027-01-31')).toEqual([]);
  });

  it('vira VENCIDO quando a validade do aprovado já passou em São Paulo', () => {
    expect(estadoComVencimento('APROVADO', '2026-09-19', HOJE)).toBe('VENCIDO');
    expect(estadoComVencimento('APROVADO', '2026-09-20', HOJE)).toBe('APROVADO');
    expect(estadoComVencimento('APROVADO', null, HOJE)).toBe('APROVADO');
  });

  it('só o aprovado vence: enviado aguarda análise e dispensado não tem arquivo', () => {
    expect(estadoComVencimento('ENVIADO', '2026-01-01', HOJE)).toBe('ENVIADO');
    expect(estadoComVencimento('DISPENSADO', '2026-01-01', HOJE)).toBe('DISPENSADO');
    expect(estadoComVencimento('REJEITADO', '2026-01-01', HOJE)).toBe('REJEITADO');
  });
});

describe('exigência específica', () => {
  it('exige nome', () => {
    expect(validarNomeDaExigencia('Termo de adesão')).toEqual([]);
    expect(validarNomeDaExigencia('  ')).toEqual([
      { campo: 'nome', codigo: CODIGOS_DE_ERRO.NOME_DA_EXIGENCIA_OBRIGATORIO },
    ]);
  });
});
