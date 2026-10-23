import { describe, expect, it } from 'vitest';
import { calculateIcmsStLegalAccruals, type IcmsStLegalAccrualRule } from './calculate-icms-st-legal-accruals.js';

const source = { id:'source-1', tenantId:'tenant-1', companyId:'company-1', regime:'SIMPLES_NACIONAL' as const,
  approved:true, superseded:false, hash:'a'.repeat(64), lines:[{ id:'line-1', competence:'2017-01', track:'COMPLEMENT' as const,
    principalCents:10000, termStartDate:'2017-01-01' }] };
const rule = (overrides:Partial<IcmsStLegalAccrualRule>={}):IcmsStLegalAccrualRule=>({id:'interest-1',version:'1',component:'LATE_INTEREST',
  tracks:['COMPLEMENT'],validFrom:'2017-01-01',validThrough:'2017-01-02',formula:'SIMPLE_DAILY_PPM',ratePpm:1000,annualizationDays:1,
  termStartBasis:'COMPETENCE_START',termStartOffsetDays:0,
  rounding:'HALF_UP',officialBasis:'lei oficial',sourceSha256:'b'.repeat(64),...overrides});

describe('calculateIcmsStLegalAccruals',()=>{
  it('calcula apenas regra aprovada, por trechos inclusivos e em centavos inteiros',()=>{
    const result=calculateIcmsStLegalAccruals({source,referenceDate:'2017-01-02',rulePackage:{id:'rules-1',version:'1',approved:true,
      superseded:false,hash:'c'.repeat(64),coverageThrough:'2017-01-02',requiredComponents:{RESTITUTION:[],COMPLEMENT:['LATE_INTEREST']},rules:[rule()]},formalActs:[]});
    expect(result.status).toBe('READY_FOR_INTERNAL_REVIEW');
    expect(result.complement.lateInterestCents).toBe(20);
    expect(result.complement.totalCents).toBe(10020);
    expect(result.restitution.totalCents).toBe(0);
    expect(result.memory.map(step=>step.ruleId)).toEqual(['interest-1']);
  });

  it('preserva principal, marca total indeterminado diante de lacuna ou ausência de pacote',()=>{
    const result=calculateIcmsStLegalAccruals({source,referenceDate:'2017-01-03',rulePackage:{id:'rules-1',version:'1',approved:true,
      superseded:false,hash:'c'.repeat(64),coverageThrough:'2017-01-02',requiredComponents:{RESTITUTION:[],COMPLEMENT:['LATE_INTEREST']},rules:[rule()]},formalActs:[]});
    expect(result.status).toBe('INDETERMINATE');
    expect(result.complement.principalCents).toBe(10000);
    expect(result.complement.lateInterestCents).toBeNull();
    expect(result.complement.totalCents).toBeNull();
    expect(result.gaps).toContainEqual(expect.objectContaining({component:'LATE_INTEREST',track:'COMPLEMENT'}));
  });

  it('mantém o resultado indeterminado quando um componente requerido não tem regra',()=>{
    const result=calculateIcmsStLegalAccruals({source,referenceDate:'2017-01-02',rulePackage:{id:'rules-1',version:'1',approved:true,
      superseded:false,hash:'c'.repeat(64),coverageThrough:'2017-01-02',requiredComponents:{RESTITUTION:[],COMPLEMENT:['LATE_INTEREST','LATE_PAYMENT_FINE']},rules:[rule()]},formalActs:[]});
    expect(result.status).toBe('INDETERMINATE');
    expect(result.complement.lateInterestCents).toBe(20);
    expect(result.complement.latePaymentFineCents).toBeNull();
    expect(result.complement.totalCents).toBeNull();
    expect(result.gaps).toContainEqual(expect.objectContaining({component:'LATE_PAYMENT_FINE',reason:'TIMELINE_GAP'}));
  });

  it('rejeita fonte F33 adulterada, regras sobrepostas e valor financeiro inseguro',()=>{
    expect(calculateIcmsStLegalAccruals({source:{...source,hash:'bad'},referenceDate:'2017-01-02',rulePackage:null,formalActs:[]}).status).toBe('INDETERMINATE');
    const conflict=calculateIcmsStLegalAccruals({source,referenceDate:'2017-01-02',rulePackage:{id:'rules-1',version:'1',approved:true,
      superseded:false,hash:'c'.repeat(64),coverageThrough:'2017-01-02',requiredComponents:{RESTITUTION:[],COMPLEMENT:['LATE_INTEREST']},rules:[rule(),rule({id:'interest-2'})]},formalActs:[]});
    expect(conflict.status).toBe('INDETERMINATE');
    expect(conflict.gaps[0]?.reason).toBe('RULE_TIMELINE_CONFLICT');
    expect(()=>calculateIcmsStLegalAccruals({source:{...source,lines:[{...source.lines[0]!,principalCents:Number.MAX_SAFE_INTEGER+1}]},
      referenceDate:'2017-01-02',rulePackage:null,formalActs:[]})).toThrow();
  });

  it('só consome penalidade por infração com ato formal aprovado e valor vinculado à linha F33',()=>{
    const rulePackage={id:'rules-1',version:'1',approved:true,superseded:false,hash:'c'.repeat(64),coverageThrough:'2017-01-02',
      requiredComponents:{RESTITUTION:[],COMPLEMENT:['INFRACTION_PENALTY']},rules:[rule({id:'penalty-1',component:'INFRACTION_PENALTY',formula:'FIXED_PERCENT_PPM',formalActId:'act-1'})]};
    const base={source,referenceDate:'2017-01-02',rulePackage,formalActs:[]};
    expect(calculateIcmsStLegalAccruals(base).complement.totalCents).toBeNull();
    const result=calculateIcmsStLegalAccruals({...base,formalActs:[{id:'act-1',tenantId:'tenant-1',companyId:'company-1',sourcePackageId:'source-1',approved:true,
      valid:true,hash:'d'.repeat(64),components:['INFRACTION_PENALTY'],penaltyAmounts:[{lineId:'line-1',amountCents:2500}]}]});
    expect(result.status).toBe('READY_FOR_INTERNAL_REVIEW');
    expect(result.complement.infractionPenaltyCents).toBe(2500);
    expect(result.memory[0]?.formalActId).toBe('act-1');
  });
});
