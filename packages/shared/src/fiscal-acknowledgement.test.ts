import { describe, expect, it } from 'vitest';
import {
  classificarResumoParaCiencia,
  proximoEstadoDaCiencia,
  tempoDeRetryDaCiencia,
} from './fiscal-acknowledgement.js';

const xmlResumo = (chave = '35240112345678000195550010000000011000000019', cnpj = '12345678000195') =>
  `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>${chave}</chNFe><CNPJ>${cnpj}</CNPJ></resNFe>`;

describe('elegibilidade da Ciência da Emissão', () => {
  it('aceita apenas resNFe NF-e modelo 55 com chave válida e CNPJ destinatário igual à empresa', () => {
    expect(classificarResumoParaCiencia(Buffer.from(xmlResumo()), 'NFE_55', '12345678000195')).toEqual({ elegivel: true, chaveAcesso: '35240112345678000195550010000000011000000019' });
  });

  it.each([
    ['CT-e', xmlResumo(), 'CTE', '12345678000195'],
    ['raiz completa', xmlResumo().replace('resNFe', 'nfeProc'), 'NFE_55', '12345678000195'],
    ['destinatário divergente', xmlResumo(), 'NFE_55', '99887766000155'],
    ['chave inválida', xmlResumo('123'), 'NFE_55', '12345678000195'],
    ['modelo 57 com DV válido', xmlResumo('35240112345678000195570010000000011000000016'), 'NFE_55', '12345678000195'],
    ['XML inseguro', '<!DOCTYPE x [<!ENTITY a "x">]><resNFe/>', 'NFE_55', '12345678000195'],
  ])('impede %s', (_case, xml, especie, cnpj) => {
    expect(classificarResumoParaCiencia(Buffer.from(xml), especie as 'NFE_55' | 'CTE', cnpj)).toMatchObject({ elegivel: false });
  });
});

describe('máquina de estados da Ciência', () => {
  it('permite caminho automático até parse da F18', () => {
    const caminho = ['RESUMO_CAPTURADO', 'CIENCIA_PENDENTE', 'CIENCIA_EM_ENVIO', 'CIENCIA_REGISTRADA', 'XML_COMPLETO_PENDENTE', 'XML_COMPLETO_OBTIDO', 'PARSEADO'] as const;
    for (let index = 0; index < caminho.length - 1; index++) {
      expect(proximoEstadoDaCiencia(caminho[index]!, caminho[index + 1]!)).toBe(true);
    }
  });

  it('mantém envio incerto em reconciliação e bloqueia manifestação conclusiva', () => {
    expect(proximoEstadoDaCiencia('CIENCIA_EM_ENVIO', 'RESULTADO_INCERTO')).toBe(true);
    expect(proximoEstadoDaCiencia('RESULTADO_INCERTO', 'PARSEADO')).toBe(false);
    expect(proximoEstadoDaCiencia('RESUMO_CAPTURADO', 'CONFIRMACAO')).toBe(false);
  });

  it('aplica backoff exponencial limitado a três tentativas', () => {
    expect(tempoDeRetryDaCiencia(1)).toBe(1_000);
    expect(tempoDeRetryDaCiencia(2)).toBe(2_000);
    expect(tempoDeRetryDaCiencia(3)).toBe(4_000);
    expect(() => tempoDeRetryDaCiencia(4)).toThrow('FISCAL_ACK_RETRY_EXHAUSTED');
  });
});
