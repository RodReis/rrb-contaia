import { describe,expect,it } from 'vitest';
import { renderIcmsStLegalAccrualsPdf } from './icms-st-legal-accruals-pdf';

describe('renderIcmsStLegalAccrualsPdf',()=>{
  it('gera PDF com trilhas, lacuna e memória causal',()=>{
    const pdf=renderIcmsStLegalAccrualsPdf({sourcePackageId:'source-1',referenceDate:'2018-02-28',regime:'SIMPLES_NACIONAL',status:'INDETERMINATE',
      restitution:{principalCents:0,totalCents:0},complement:{principalCents:10000,totalCents:null},gaps:[{track:'COMPLEMENT',component:'LATE_INTEREST',reason:'TIMELINE_GAP'}],
      memory:[{track:'COMPLEMENT',component:'MONETARY_UPDATE',from:'2017-01-01',through:'2017-01-31',ruleId:'rule-1',ruleVersion:'1',principalCents:10000,amountCents:3,sourceSha256:'a'.repeat(64)}]},'b'.repeat(64)).toString('latin1');
    expect(pdf).toContain('%PDF-1.4');expect(pdf).toContain('(Lacuna COMPLEMENT / LATE_INTEREST indeterminado a indeterminado: TIMELINE_GAP) Tj');
    expect(pdf).toContain('(COMPLEMENT MONETARY_UPDATE 2017-01-01 a 2017-01-31 | regra rule-1 v1 | principal 10000 | valor 3 |) Tj');
    expect(pdf).toContain('%%EOF');
  });
});
