import { createHash } from 'node:crypto';

import type { Finalidade } from '@contaia/domain';

/**
 * XML de teste do diagnóstico (SPEC-012 §3.9). O chamador não envia conteúdo: o Signer monta o
 * seu, mínimo, com o CNPJ da empresa. O `Id` deriva do correlationId por hash — nunca do texto
 * cru — para que seja único por execução e sempre caiba no alfabeto seguro do XPath.
 */
export const xmlDeDiagnostico = (finalidade: Finalidade, cnpj: string, correlationId: string): string => {
  const sufixo = createHash('sha256').update(`${finalidade}:${correlationId}`).digest('hex').slice(0, 32);

  if (finalidade === 'DFE_TESTE') {
    return (
      `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe${sufixo}">` +
      `<ide><tpAmb>2</tpAmb></ide><emit><CNPJ>${cnpj}</CNPJ></emit></infNFe></NFe>`
    );
  }

  return (
    `<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtDiagnostico/v_S_01_02_00">` +
    `<evtDiagnostico Id="ID${sufixo}"><ideEvento><tpAmb>2</tpAmb></ideEvento>` +
    `<ideEmpregador><nrInsc>${cnpj}</nrInsc></ideEmpregador></evtDiagnostico></eSocial>`
  );
};
