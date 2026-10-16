import type { ComandoCienciaDfe } from '@contaia/shared';
import { C14N_1_0, type Adaptador } from './xml/adaptadores.js';

export const ADAPTADOR_CIENCIA_DFE: Adaptador = {
  finalidade: 'DFE_TESTE', raiz: 'envEvento', alvo: /^infEvento$/u, canonicalizacao: C14N_1_0,
};

export const criarXmlDaCiencia = (comando: Pick<ComandoCienciaDfe, 'cnpj'|'chaveAcesso'|'tipoEvento'|'sequencia'|'ocorridoEm'>): string => {
  const ocorridoEm = new Date(comando.ocorridoEm);
  if (comando.tipoEvento !== '210210' || comando.sequencia !== 1 || !/^\d{14}$/u.test(comando.cnpj) || !/^\d{44}$/u.test(comando.chaveAcesso) ||
      Number.isNaN(ocorridoEm.getTime())) throw new Error('FISCAL_ACK_IDENTITY_INVALID');
  const chave = comando.chaveAcesso;
  const id = `ID${comando.tipoEvento}${chave}${comando.sequencia.toString().padStart(2,'0')}`;
  return `<?xml version="1.0" encoding="UTF-8"?><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><evento versao="1.00"><infEvento Id="${id}"><cOrgao>${chave.slice(0,2)}</cOrgao><tpAmb>2</tpAmb><CNPJ>${comando.cnpj}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${ocorridoEm.toISOString()}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento></evento></envEvento>`;
};
