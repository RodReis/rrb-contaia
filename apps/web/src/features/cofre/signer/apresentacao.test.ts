/**
 * Apresentação do Signer (SPEC-012 §5): estado nunca só por cor, código estável → mensagem
 * acionável em PT-BR e formatos de latência e instante.
 */
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import { ESTADOS_DA_FINALIDADE_NO_SIGNER, FINALIDADES, RESULTADOS_DO_HISTORICO } from '@contaia/shared';
import { describe, expect, it } from 'vitest';

import {
  APRESENTACAO_DA_FINALIDADE_NO_SIGNER,
  APRESENTACAO_DO_RESULTADO,
  APRESENTACAO_DO_SERVICO,
  ROTULO_DA_FINALIDADE,
  descreverVerificacao,
  mensagemDoSigner,
  textoDaLatencia,
} from './apresentacao';

describe('apresentação do Signer', () => {
  it('todo estado do serviço tem rótulo textual e tom distintos (nunca só cor)', () => {
    const rotulos = Object.values(APRESENTACAO_DO_SERVICO).map((a) => a.rotulo);

    expect(rotulos).toEqual(['Operacional', 'Degradado', 'Indisponível']);
    expect(new Set(Object.values(APRESENTACAO_DO_SERVICO).map((a) => a.tom)).size).toBe(3);
  });

  it('todo estado de finalidade do contrato tem apresentação com rótulo', () => {
    for (const estado of ESTADOS_DA_FINALIDADE_NO_SIGNER) {
      expect(APRESENTACAO_DA_FINALIDADE_NO_SIGNER[estado].rotulo.length).toBeGreaterThan(0);
    }
  });

  it('toda finalidade e todo resultado do contrato têm rótulo', () => {
    for (const finalidade of FINALIDADES) {
      expect(ROTULO_DA_FINALIDADE[finalidade].length).toBeGreaterThan(0);
    }
    for (const resultado of RESULTADOS_DO_HISTORICO) {
      expect(APRESENTACAO_DO_RESULTADO[resultado].rotulo.length).toBeGreaterThan(0);
    }
  });

  it('todo código SIGNER_* do domínio tem mensagem própria, sem vazar o código cru', () => {
    const codigos = Object.values(CODIGOS_DE_ERRO).filter((c) => c.startsWith('SIGNER_'));

    expect(codigos.length).toBeGreaterThan(10);
    for (const codigo of codigos) {
      const mensagem = mensagemDoSigner(codigo);

      expect(mensagem).not.toContain('SIGNER_');
      expect(mensagem).toMatch(/[.]$/u);
      expect(mensagem).not.toBe(mensagemDoSigner('CODIGO_QUE_NAO_EXISTE'));
    }
  });

  it('código desconhecido cai numa mensagem genérica acionável', () => {
    expect(mensagemDoSigner('CODIGO_QUE_NAO_EXISTE')).toMatch(/tente/iu);
  });

  it('a falha de certificado manda para o cofre, onde se resolve', () => {
    expect(mensagemDoSigner(CODIGOS_DE_ERRO.SIGNER_CERTIFICADO_VENCIDO)).toMatch(/renovad/iu);
    expect(mensagemDoSigner(CODIGOS_DE_ERRO.SIGNER_CERTIFICADO_AUSENTE)).toMatch(/cadastre/iu);
  });

  it('latência em milissegundos com separador pt-BR; ausente vira travessão', () => {
    expect(textoDaLatencia(42)).toBe('42 ms');
    expect(textoDaLatencia(1234)).toBe('1.234 ms');
    expect(textoDaLatencia(null)).toBe('—');
  });

  it('descreve a verificação do serviço em horário de São Paulo, ou diz que não há', () => {
    expect(descreverVerificacao(null)).toBe('Nenhuma verificação registrada ainda.');
    expect(descreverVerificacao('2026-10-07T15:04:00.000Z')).toBe('Verificado em 07/10/2026 12:04');
  });
});
