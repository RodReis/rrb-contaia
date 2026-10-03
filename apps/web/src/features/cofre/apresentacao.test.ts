/**
 * Provas das funções puras de apresentação do cofre (SPEC-011 §5): estado com
 * texto além da cor, data civil sem passar por `Date`, impressão digital
 * truncada e a ligação de cada recusa ao campo certo.
 */
import { CODIGOS_DE_RECUSA_DA_INGESTAO, ESTADOS_NO_COFRE, MENSAGEM_DA_RECUSA } from '@contaia/shared';
import { describe, expect, it } from 'vitest';

import {
  APRESENTACAO_DO_ESTADO,
  autorDoEvento,
  campoDaRecusa,
  detalheDoEvento,
  formatarDataCivil,
  impressaoDigitalAgrupada,
  impressaoDigitalCurta,
  iniciaisDe,
  mensagemDoCofre,
  podeEnviar,
  prazoEmTexto,
  rotuloDoEnvio,
} from './apresentacao';

describe('estados do cofre', () => {
  it('todo estado tem rótulo textual: cor nunca é o único sinal', () => {
    for (const estado of ESTADOS_NO_COFRE) {
      expect(APRESENTACAO_DO_ESTADO[estado].rotulo.length).toBeGreaterThan(3);
    }
  });

  it('vencido e D-7 são críticos; D-30 e D-15 são atenção; válido é conforme', () => {
    expect(APRESENTACAO_DO_ESTADO.VENCIDO.tom).toBe('critico');
    expect(APRESENTACAO_DO_ESTADO.VENCE_D7.tom).toBe('critico');
    expect(APRESENTACAO_DO_ESTADO.VENCE_D15.tom).toBe('atencao');
    expect(APRESENTACAO_DO_ESTADO.VENCE_D30.tom).toBe('atencao');
    expect(APRESENTACAO_DO_ESTADO.VALIDO.tom).toBe('conforme');
  });
});

describe('formatos', () => {
  it('data civil vira dd/mm/aaaa sem passar por Date (sem "um dia a menos")', () => {
    expect(formatarDataCivil('2026-11-14')).toBe('14/11/2026');
    expect(formatarDataCivil('2027-01-01')).toBe('01/01/2027');
    expect(formatarDataCivil('quebrado')).toBe('quebrado');
  });

  it('o prazo é dito por extenso, com singular, hoje e vencido', () => {
    expect(prazoEmTexto(618)).toBe('618 dias restantes');
    expect(prazoEmTexto(1)).toBe('1 dia restante');
    expect(prazoEmTexto(0)).toBe('Vence hoje');
    expect(prazoEmTexto(-1)).toBe('Venceu ontem');
    expect(prazoEmTexto(-12)).toBe('Venceu há 12 dias');
    expect(prazoEmTexto(null)).toBeNull();
  });

  it('a impressão digital é truncada em 8 + … + 4 e a completa fica agrupada em pares', () => {
    const hash = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';

    expect(impressaoDigitalCurta(hash)).toBe('E3B0C442…B855');
    expect(impressaoDigitalCurta('ABCD')).toBe('ABCD');
    expect(impressaoDigitalAgrupada('E3B0C4')).toBe('E3 B0 C4');
  });

  it('iniciais usam a primeira e a última palavra do nome', () => {
    expect(iniciaisDe('Ana Maria Lima')).toBe('AL');
    expect(iniciaisDe('  roberto ')).toBe('R');
    expect(iniciaisDe('')).toBe('');
  });
});

describe('ações do item', () => {
  it('cadastrar e substituir são envio; o rótulo diz renovar quando vence ou venceu', () => {
    expect(podeEnviar({ acoes: ['CADASTRAR'] })).toBe(true);
    expect(podeEnviar({ acoes: ['DESATIVAR'] })).toBe(false);
    expect(rotuloDoEnvio({ acoes: ['CADASTRAR'], estado: 'SEM_CERTIFICADO' })).toBe(
      'Cadastrar certificado',
    );
    expect(rotuloDoEnvio({ acoes: ['SUBSTITUIR'], estado: 'VALIDO' })).toBe('Substituir certificado');
    expect(rotuloDoEnvio({ acoes: ['SUBSTITUIR'], estado: 'VENCE_D15' })).toBe('Renovar certificado');
    expect(rotuloDoEnvio({ acoes: ['SUBSTITUIR'], estado: 'VENCIDO' })).toBe('Renovar certificado');
  });
});

describe('recusa da ingestão', () => {
  it('todo código de recusa do domínio tem mensagem e destino definidos', () => {
    for (const codigo of CODIGOS_DE_RECUSA_DA_INGESTAO) {
      expect(mensagemDoCofre(codigo)).toBe(MENSAGEM_DA_RECUSA[codigo]);
      expect(['arquivo', 'senha', 'empresa', 'responsavel', null]).toContain(campoDaRecusa(codigo));
    }
  });

  it('liga cada recusa ao campo que a pessoa precisa corrigir', () => {
    expect(campoDaRecusa('CERTIFICADO_SENHA_INCORRETA')).toBe('senha');
    expect(campoDaRecusa('CERTIFICADO_CNPJ_DIVERGENTE')).toBe('empresa');
    expect(campoDaRecusa('CERTIFICADO_RESPONSAVEL_INVALIDO')).toBe('responsavel');
    for (const codigo of [
      'CERTIFICADO_EXTENSAO_INVALIDA',
      'CERTIFICADO_TAMANHO_EXCEDIDO',
      'CERTIFICADO_ARQUIVO_VAZIO',
      'CERTIFICADO_CONTEINER_INVALIDO',
      'CERTIFICADO_EXPIRADO',
      'CERTIFICADO_AINDA_NAO_VIGENTE',
      'CERTIFICADO_TIPO_INCOMPATIVEL',
    ]) {
      expect(campoDaRecusa(codigo)).toBe('arquivo');
    }
  });

  it('ticket inválido, cofre indisponível e código desconhecido são do envio inteiro, não de um campo', () => {
    expect(campoDaRecusa('CERTIFICADO_TICKET_INVALIDO')).toBeNull();
    expect(campoDaRecusa('COFRE_INDISPONIVEL')).toBeNull();
    expect(campoDaRecusa('QUALQUER_OUTRO')).toBeNull();
  });

  it('código desconhecido cai na mensagem genérica acionável, nunca em texto cru do servidor', () => {
    expect(mensagemDoCofre('QUALQUER_OUTRO')).toMatch(/tente de novo/i);
  });

  it('conflitos de estado do cofre (409) mandam recarregar e dizem o que fazer', () => {
    expect(mensagemDoCofre('CERTIFICADO_JA_VIGENTE')).toMatch(/Substituir certificado/u);
    expect(mensagemDoCofre('CERTIFICADO_VIGENTE_INEXISTENTE')).toMatch(/Recarregue/u);
    expect(mensagemDoCofre('CERTIFICADO_MOTIVO_OBRIGATORIO')).toBe('Informe o motivo da desativação.');
  });
});

describe('histórico de certificados', () => {
  it('recusa mostra a mensagem do código; alerta mostra o marco; o resto mostra o motivo', () => {
    expect(detalheDoEvento('RECUSA', 'CERTIFICADO_SENHA_INCORRETA', null)).toBe(
      MENSAGEM_DA_RECUSA.CERTIFICADO_SENHA_INCORRETA,
    );
    expect(detalheDoEvento('ALERTA_EMITIDO', 'D15', null)).toBe('Faltam 15 dias para o vencimento');
    expect(detalheDoEvento('ALERTA_EMITIDO', 'MARCO_NOVO', null)).toBe('MARCO_NOVO');
    expect(detalheDoEvento('DESATIVACAO', null, 'Trocou de AC.')).toBe('Trocou de AC.');
    expect(detalheDoEvento('CADASTRO', null, null)).toBeNull();
  });

  it('o autor é a pessoa ou a identidade técnica legível', () => {
    expect(autorDoEvento('Ana Lima', null)).toBe('Ana Lima');
    expect(autorDoEvento(null, 'cofre')).toBe('Cofre');
    expect(autorDoEvento(null, 'job-de-alertas')).toBe('Verificação de vencimentos');
    expect(autorDoEvento(null, 'outro')).toBe('outro');
    expect(autorDoEvento(null, null)).toBe('Sistema');
  });
});
