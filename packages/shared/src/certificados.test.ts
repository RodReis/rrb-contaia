import { CODIGOS_DE_ERRO, MARCOS_DE_VENCIMENTO as MARCOS_DO_DOMINIO } from '@contaia/domain';
import { describe, expect, it } from 'vitest';

import {
  CODIGOS_DE_RECUSA_DA_INGESTAO,
  ESTADOS_NO_COFRE,
  MARCOS_DE_VENCIMENTO,
  MENSAGEM_DA_RECUSA,
  TIPOS_DE_NOTIFICACAO_DO_COFRE,
} from './certificados.js';

describe('contrato do cofre alinhado ao domínio', () => {
  it('os marcos de vencimento são os mesmos nos dois pacotes', () => {
    expect([...MARCOS_DE_VENCIMENTO]).toEqual([...MARCOS_DO_DOMINIO]);
  });

  it('todo código de recusa tem mensagem acionável e existe como código de erro estável', () => {
    const codigosDeErro = Object.values(CODIGOS_DE_ERRO) as string[];

    for (const codigo of CODIGOS_DE_RECUSA_DA_INGESTAO) {
      expect(MENSAGEM_DA_RECUSA[codigo].length).toBeGreaterThan(10);
      expect(codigosDeErro).toContain(codigo);
    }
  });

  it('mensagens de recusa não prometem detalhe criptográfico', () => {
    for (const mensagem of Object.values(MENSAGEM_DA_RECUSA)) {
      expect(mensagem).not.toMatch(/PKCS|OID|pbe|iteraç|chave privada|stack/iu);
    }
  });

  it('o alerta do sino carrega o marco no tipo', () => {
    expect([...TIPOS_DE_NOTIFICACAO_DO_COFRE]).toEqual([
      ...MARCOS_DE_VENCIMENTO.map((marco) => `CERTIFICADO_${marco}`),
      'CERTIFICADO_RESPONSAVEL_INCONSISTENTE',
    ]);
  });

  it('o estado "sem responsável" é filtro, não estado: convive com os demais', () => {
    expect(ESTADOS_NO_COFRE).not.toContain('SEM_RESPONSAVEL');
    expect(ESTADOS_NO_COFRE).toContain('DESATIVADO');
  });
});
