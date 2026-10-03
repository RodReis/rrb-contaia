import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import { CODIGOS_DE_RECUSA_DA_INGESTAO } from './avaliacao.js';
import {
  avaliarMetadadosDoCertificado,
  planejarAtivacao,
  planejarCadastro,
  planejarDesativacao,
  planejarSubstituicao,
  planejarTrocaDeResponsavel,
} from './transicoes.js';

const VIGENTE = { id: 'cert-2', versao: 2, responsavelId: 'resp-1' };

const codigoDe = (acao: () => unknown): string => {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro.codigo;
    }
    throw erro;
  }

  return 'nao_lancou';
};

describe('códigos de erro do cofre', () => {
  it('todo código de recusa da ingestão existe em CODIGOS_DE_ERRO', () => {
    const codigos = Object.values(CODIGOS_DE_ERRO) as string[];

    for (const codigo of CODIGOS_DE_RECUSA_DA_INGESTAO) {
      expect(codigos).toContain(codigo);
    }
  });
});

describe('planejarCadastro', () => {
  it('primeiro cadastro cria a versão 1 sem encerrar nada', () => {
    expect(planejarCadastro(null, 0)).toEqual({ acao: 'CADASTRO', versao: 1, encerrarId: null });
  });

  it('depois de desativação, a versão continua a contagem', () => {
    expect(planejarCadastro(null, 3).versao).toBe(4);
  });

  it('com vigente, cadastrar é recusado: um vigente por empresa', () => {
    expect(codigoDe(() => planejarCadastro(VIGENTE, 2))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE);
  });
});

describe('planejarSubstituicao', () => {
  it('encerra o vigente e numera a seguinte', () => {
    expect(planejarSubstituicao(VIGENTE, 2)).toEqual({
      acao: 'SUBSTITUICAO',
      versao: 3,
      encerrarId: 'cert-2',
    });
  });

  it('sem vigente, substituir é recusado', () => {
    expect(codigoDe(() => planejarSubstituicao(null, 2))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
    );
  });
});

describe('planejarAtivacao', () => {
  it('segue a operação do ticket', () => {
    expect(planejarAtivacao('CADASTRO', null, 0).acao).toBe('CADASTRO');
    expect(planejarAtivacao('SUBSTITUICAO', VIGENTE, 2).acao).toBe('SUBSTITUICAO');
  });

  it('estado que mudou depois da emissão do ticket vira recusa, não outra operação', () => {
    expect(codigoDe(() => planejarAtivacao('CADASTRO', VIGENTE, 2))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE,
    );
    expect(codigoDe(() => planejarAtivacao('SUBSTITUICAO', null, 2))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
    );
  });
});

describe('planejarDesativacao', () => {
  it('guarda o motivo aparado e aponta o vigente', () => {
    expect(planejarDesativacao(VIGENTE, '  Troca de titularidade  ')).toEqual({
      encerrarId: 'cert-2',
      motivo: 'Troca de titularidade',
    });
  });

  it('motivo vazio ou só espaços é bloqueado no domínio', () => {
    expect(codigoDe(() => planejarDesativacao(VIGENTE, ''))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_MOTIVO_OBRIGATORIO,
    );
    expect(codigoDe(() => planejarDesativacao(VIGENTE, '   '))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_MOTIVO_OBRIGATORIO,
    );
  });

  it('motivo acima de 500 caracteres é recusado', () => {
    expect(codigoDe(() => planejarDesativacao(VIGENTE, 'x'.repeat(501)))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_MOTIVO_OBRIGATORIO,
    );
    expect(planejarDesativacao(VIGENTE, 'x'.repeat(500)).motivo).toHaveLength(500);
  });

  it('sem vigente não há o que desativar', () => {
    expect(codigoDe(() => planejarDesativacao(null, 'motivo'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
    );
  });
});

describe('planejarTrocaDeResponsavel', () => {
  it('novo responsável elegível muda', () => {
    expect(planejarTrocaDeResponsavel(VIGENTE, 'resp-2', true)).toEqual({
      mudou: true,
      responsavelAnteriorId: 'resp-1',
    });
  });

  it('escolher o mesmo responsável não muda nada (idempotente)', () => {
    expect(planejarTrocaDeResponsavel(VIGENTE, 'resp-1', true).mudou).toBe(false);
  });

  it('responsável inelegível é recusado', () => {
    expect(codigoDe(() => planejarTrocaDeResponsavel(VIGENTE, 'resp-2', false))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO,
    );
  });

  it('sem vigente, não há a quem atribuir', () => {
    expect(codigoDe(() => planejarTrocaDeResponsavel(null, 'resp-2', true))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
    );
  });
});

describe('avaliarMetadadosDoCertificado', () => {
  // 2026-10-15 12:00 em São Paulo
  const agora = new Date('2026-10-15T15:00:00Z');
  const contexto = { cnpjDaEmpresa: '12.345.678/0001-95', agora };
  const metadados = {
    cnpjsDoTitular: ['12345678000195'],
    naoAntes: new Date('2026-01-01T03:00:00Z'),
    naoDepois: new Date('2027-01-01T02:59:59Z'),
  };

  it('aceita CNPJ igual (normalizado) e vigência corrente', () => {
    expect(avaliarMetadadosDoCertificado(metadados, contexto)).toEqual({
      ok: true,
      validoDe: '2026-01-01',
      validoAte: '2026-12-31',
    });
  });

  it('recusa CNPJ divergente antes de olhar a validade', () => {
    expect(
      avaliarMetadadosDoCertificado(
        { ...metadados, cnpjsDoTitular: ['11222333000181'], naoDepois: new Date('2020-01-01T00:00:00Z') },
        contexto,
      ),
    ).toEqual({ ok: false, codigo: 'CERTIFICADO_CNPJ_DIVERGENTE' });
  });

  it('certificado com vários CNPJs vale se QUALQUER um é o da empresa, em qualquer posição', () => {
    for (const lista of [
      ['11222333000181', '12.345.678/0001-95'],
      ['12345678000195', '11222333000181'],
    ]) {
      expect(avaliarMetadadosDoCertificado({ ...metadados, cnpjsDoTitular: lista }, contexto).ok).toBe(true);
    }
  });

  it('lista vazia ou sem o CNPJ da empresa é divergente', () => {
    for (const lista of [[], ['11222333000181', '99888777000166']]) {
      expect(avaliarMetadadosDoCertificado({ ...metadados, cnpjsDoTitular: lista }, contexto)).toEqual({
        ok: false,
        codigo: 'CERTIFICADO_CNPJ_DIVERGENTE',
      });
    }
  });

  it('o último dia de validade ainda vale; o dia seguinte não', () => {
    const ultimoDia = new Date('2026-10-16T02:59:59Z'); // 15/10 23:59:59 em SP
    expect(
      avaliarMetadadosDoCertificado({ ...metadados, naoDepois: ultimoDia }, contexto).ok,
    ).toBe(true);
    expect(
      avaliarMetadadosDoCertificado(
        { ...metadados, naoDepois: new Date('2026-10-15T02:59:59Z') },
        contexto,
      ),
    ).toEqual({ ok: false, codigo: 'CERTIFICADO_EXPIRADO' });
  });

  it('ainda não vigente é recusado; a véspera conta como futuro', () => {
    expect(
      avaliarMetadadosDoCertificado(
        { ...metadados, naoAntes: new Date('2026-10-16T03:00:00Z') },
        contexto,
      ),
    ).toEqual({ ok: false, codigo: 'CERTIFICADO_AINDA_NAO_VIGENTE' });
  });
});
