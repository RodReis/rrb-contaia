import { describe, expect, it } from 'vitest';
import { avaliarExpressaoMonetaria, balancearPartidas, ratearCentavos, selecionarRegraUnica, type OrigemContabil, type RegraElegivel } from './partidas-automaticas.js';

const origem: OrigemContabil = { sourceType:'DFE',sourceId:'dfe-1',tenantId:'tenant',companyId:'empresa',sourceVersion:1,effectiveDate:'2026-03-10',competence:'2026-03',attributes:{model:'55',direction:'IN',amountCents:101n} };
const regra: RegraElegivel = { ruleId:'rule-1',version:1,source:'DFE',validFrom:'2026-01-01',validUntil:null,criteria:[{field:'model',operator:'EQ',value:'55'}] };

describe('F41 motor determinístico',()=>{
  it('seleciona somente regra da mesma família e vigência que satisfaça todos os critérios',()=>{
    expect(selecionarRegraUnica(origem,[regra]).result).toBe('MATCH');
    expect(selecionarRegraUnica({...origem,attributes:{model:'65'}},[regra])).toEqual({result:'NO_MATCH'});
    expect(selecionarRegraUnica(origem,[regra,{...regra,ruleId:'rule-2'}])).toEqual({result:'AMBIGUOUS_MATCH',ruleIds:['rule-1','rule-2']});
  });
  it('bloqueia configuração inválida mesmo quando os critérios correspondem',()=>{
    expect(selecionarRegraUnica(origem,[{...regra,configurationValid:false}])).toEqual({result:'INVALID_CONFIGURATION',ruleIds:['rule-1']});
  });
  it('usa piso e distribui resíduo em ordem persistida sem perder centavos',()=>{
    const lines=ratearCentavos(101n,[{costCenterId:'b',percentageBasisPoints:5000,position:1},{costCenterId:'a',percentageBasisPoints:5000,position:0}]);
    expect(lines).toEqual([{costCenterId:'a',amountCents:51n,position:0},{costCenterId:'b',amountCents:50n,position:1}]);
  });
  it('rejeita alocação incompleta, valor zero e expressão fora da gramática',()=>{
    expect(()=>ratearCentavos(101n,[{costCenterId:'a',percentageBasisPoints:9900,position:0}])).toThrow('ACCOUNTING_RULE_ALLOCATION_INVALID');
    expect(()=>ratearCentavos(1n,[{costCenterId:'a',percentageBasisPoints:10000,position:0},{costCenterId:'b',percentageBasisPoints:1,position:1}])).toThrow('ACCOUNTING_RULE_ALLOCATION_INVALID');
    expect(()=>avaliarExpressaoMonetaria('amountCents / 3',{amountCents:100n})).toThrow('ACCOUNTING_RULE_INVALID_EXPRESSION');
  });
  it('avalia expressão limitada a campos monetários declarados e confere balanceamento em bigint',()=>{
    expect(avaliarExpressaoMonetaria('amountCents * 2',{amountCents:501n})).toBe(1002n);
    expect(avaliarExpressaoMonetaria('tax.amountCents / 2',{'tax.amountCents':1000n})).toBe(500n);
    expect(balancearPartidas([{side:'DEBIT',accountId:'a',amountCents:100n,costCenterId:null,position:0},{side:'CREDIT',accountId:'b',amountCents:100n,costCenterId:null,position:1}])).toBe(true);
  });
});
