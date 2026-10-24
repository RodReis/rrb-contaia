export type IcmsStLegalAccrualComponent = 'MONETARY_UPDATE'|'LATE_INTEREST'|'LATE_PAYMENT_FINE'|'INFRACTION_PENALTY';
export type IcmsStLegalAccrualTrackName = 'RESTITUTION'|'COMPLEMENT';
export type IcmsStLegalAccrualRule = Readonly<{
  id:string; version:string; component:IcmsStLegalAccrualComponent; tracks:readonly IcmsStLegalAccrualTrackName[];
  validFrom:string; validThrough:string; formula:'SIMPLE_DAILY_PPM'|'FIXED_PERCENT_PPM'; ratePpm:number; annualizationDays:number;
  termStartBasis:'SOURCE_FACT_DATE'|'COMPETENCE_START'|'COMPETENCE_END'; termStartOffsetDays:number;
  rounding:'HALF_UP'|'DOWN'; officialBasis:string; sourceSha256:string; formalActId?:string;
}>;
export type IcmsStLegalAccrualSource = Readonly<{ id:string; tenantId:string; companyId:string; regime:'SIMPLES_NACIONAL'|'LUCRO_PRESUMIDO';
  approved:boolean; superseded:boolean; hash:string; lines:readonly Readonly<{id:string;competence:string;track:IcmsStLegalAccrualTrackName;
    principalCents:number;termStartDate:string|null}>[] }>;
export type IcmsStLegalAccrualRulePackage = Readonly<{id:string;version:string;approved:boolean;superseded:boolean;hash:string;
  coverageThrough:string; requiredComponents:Readonly<Record<IcmsStLegalAccrualTrackName,readonly IcmsStLegalAccrualComponent[]>>;
  rules:readonly IcmsStLegalAccrualRule[] }>;
export type IcmsStLegalFormalAct = Readonly<{id:string;tenantId:string;companyId:string;sourcePackageId:string;approved:boolean;valid:boolean;
  hash:string;components:readonly IcmsStLegalAccrualComponent[];penaltyAmounts?:readonly Readonly<{lineId:string;amountCents:number}>[]}>;
export type IcmsStLegalAccrualInput = Readonly<{source:IcmsStLegalAccrualSource;referenceDate:string;rulePackage:IcmsStLegalAccrualRulePackage|null;
  formalActs:readonly IcmsStLegalFormalAct[]}>;
export type IcmsStLegalAccrualGap = Readonly<{track:IcmsStLegalAccrualTrackName;component:IcmsStLegalAccrualComponent;
  from:string|null;through:string|null;reason:'SOURCE_INELIGIBLE'|'RULE_PACKAGE_NOT_APPROVED'|'TIMELINE_GAP'|'RULE_TIMELINE_CONFLICT'|'FORMAL_ACT_REQUIRED'|'TERM_START_MISSING'}>;
export type IcmsStLegalAccrualResult = Readonly<{sourcePackageId:string;referenceDate:string;regime:IcmsStLegalAccrualSource['regime'];
  status:'READY_FOR_INTERNAL_REVIEW'|'INDETERMINATE';restitution:Readonly<{principalCents:number;monetaryUpdateCents:number|null;lateInterestCents:number|null;latePaymentFineCents:number|null;infractionPenaltyCents:number|null;totalCents:number|null}>;
  complement:Readonly<{principalCents:number;monetaryUpdateCents:number|null;lateInterestCents:number|null;latePaymentFineCents:number|null;infractionPenaltyCents:number|null;totalCents:number|null}>;
  rulePackageVersion:string|null;formalActIds:readonly string[];memory:readonly Readonly<{lineId:string;track:IcmsStLegalAccrualTrackName;component:IcmsStLegalAccrualComponent;ruleId:string;ruleVersion:string;from:string;through:string;principalCents:number;amountCents:number;formula:string;ratePpm:number;rounding:string;officialBasis:string;sourceSha256:string;formalActId:string|null}>[];
  gaps:readonly IcmsStLegalAccrualGap[] }>;

const hashPattern=/^[0-9a-f]{64}$/u;
const datePattern=/^\d{4}-\d{2}-\d{2}$/u;
const validDate=(value:string):boolean=>datePattern.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))&&new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)===value;
const round=(numerator:bigint,denominator:bigint,mode:'HALF_UP'|'DOWN'):bigint=>mode==='HALF_UP'?(numerator*2n+denominator)/(denominator*2n):numerator/denominator;
const daysBetweenInclusive=(start:string,end:string):bigint=>BigInt((Date.parse(`${end}T00:00:00.000Z`)-Date.parse(`${start}T00:00:00.000Z`))/86_400_000+1);
const addDays=(value:string,offset:number):string=>new Date(Date.parse(`${value}T00:00:00.000Z`)+offset*86_400_000).toISOString().slice(0,10);
const competenceEnd=(value:string):string=>new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),0)).toISOString().slice(0,10);
const asSafeNumber=(value:bigint):number=>{if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('valor monetário excede precisão segura');return Number(value);};
type MutableTrack={principalCents:number;monetaryUpdateCents:number|null;lateInterestCents:number|null;latePaymentFineCents:number|null;infractionPenaltyCents:number|null;totalCents:number|null};
const zeroTrack=():MutableTrack=>({principalCents:0,monetaryUpdateCents:0,lateInterestCents:0,latePaymentFineCents:0,infractionPenaltyCents:0,totalCents:0});

/** Calcula somente fórmulas declaradas em pacote oficial aprovado; toda lacuna fica nula e rastreável. */
export const calculateIcmsStLegalAccruals=(input:IcmsStLegalAccrualInput):IcmsStLegalAccrualResult=>{
  const {source,rulePackage}=input;
  if(!validDate(input.referenceDate))throw new Error('data de referência inválida');
  for(const line of source.lines){if(!Number.isSafeInteger(line.principalCents)||line.principalCents<0)throw new Error('principal inválido');
    if(!validDate(line.competence+'-01')||(line.termStartDate!==null&&!validDate(line.termStartDate)))throw new Error('data da linha F33 inválida');}
  const sourceOk=source.approved&&!source.superseded&&hashPattern.test(source.hash)&&source.lines.length>0;
  const packageOk=rulePackage!==null&&rulePackage.approved&&!rulePackage.superseded&&hashPattern.test(rulePackage.hash)&&
    validDate(rulePackage.coverageThrough)&&input.referenceDate<=rulePackage.coverageThrough&&rulePackage.rules.length>0;
  const gaps:IcmsStLegalAccrualGap[]=[],memory:IcmsStLegalAccrualResult['memory'][number][]=[],totals={RESTITUTION:zeroTrack(),COMPLEMENT:zeroTrack()};
  const componentKeys:Record<IcmsStLegalAccrualComponent,'monetaryUpdateCents'|'lateInterestCents'|'latePaymentFineCents'|'infractionPenaltyCents'>={
    MONETARY_UPDATE:'monetaryUpdateCents',LATE_INTEREST:'lateInterestCents',LATE_PAYMENT_FINE:'latePaymentFineCents',INFRACTION_PENALTY:'infractionPenaltyCents'};
  const acts=input.formalActs.filter((act)=>act.tenantId===source.tenantId&&act.companyId===source.companyId&&act.sourcePackageId===source.id&&act.approved&&act.valid&&hashPattern.test(act.hash));
  const actIds=acts.map((act)=>act.id).sort();
  if(rulePackage!==null){
    for(const trackName of ['RESTITUTION','COMPLEMENT'] as const){
      const expected=rulePackage.requiredComponents[trackName]??[];
      for(const component of expected){
        if(!rulePackage.rules.some(rule=>rule.component===component&&rule.tracks.includes(trackName))){
          gaps.push({track:trackName,component,from:null,through:input.referenceDate,reason:'TIMELINE_GAP'});
          const track=totals[trackName];track[componentKeys[component]]=null;track.totalCents=null;
        }
      }
    }
  }
  for(const trackName of ['RESTITUTION','COMPLEMENT'] as const){
    const rows=source.lines.filter((line)=>line.track===trackName),track=totals[trackName];
    track.principalCents=asSafeNumber(rows.reduce((sum,line)=>sum+BigInt(line.principalCents),0n));
    if(rows.length===0){if((rulePackage?.requiredComponents[trackName]?.length??0)>0)track.totalCents=null;continue;}
    let indeterminate=false;
    const required=rulePackage?.requiredComponents[trackName]??[];
    if(!packageOk||rulePackage===null){
      gaps.push({track:trackName,component:required[0]??'LATE_INTEREST',from:null,through:input.referenceDate,reason:'RULE_PACKAGE_NOT_APPROVED'});
      indeterminate=true;
    }
    if(!sourceOk){
      gaps.push({track:trackName,component:required[0]??'LATE_INTEREST',from:null,through:input.referenceDate,reason:'SOURCE_INELIGIBLE'});
      indeterminate=true;
    }
    for(const component of required){
      if(!sourceOk){gaps.push({track:trackName,component,from:null,through:input.referenceDate,reason:'SOURCE_INELIGIBLE'});indeterminate=true;track[componentKeys[component]]=null;continue;}
      if(!packageOk||rulePackage===null){gaps.push({track:trackName,component,from:null,through:input.referenceDate,reason:'RULE_PACKAGE_NOT_APPROVED'});indeterminate=true;track[componentKeys[component]]=null;continue;}
      let componentTotal=0n;
      let componentIndeterminate=false;
      for(const line of rows){
        const rules=rulePackage.rules.filter((candidate)=>candidate.component===component&&candidate.tracks.includes(trackName));
        const termRule=rules.filter(candidate=>candidate.validFrom<=input.referenceDate).sort((a,b)=>a.validFrom.localeCompare(b.validFrom))[0];
        const competenceStart=`${line.competence}-01`;
        const termStart=line.termStartDate??(termRule?.termStartBasis==='COMPETENCE_START'?addDays(competenceStart,termRule.termStartOffsetDays):
          termRule?.termStartBasis==='COMPETENCE_END'?addDays(competenceEnd(line.competence),termRule.termStartOffsetDays):null);
        if(termStart===null){gaps.push({track:trackName,component,from:null,through:input.referenceDate,reason:'TERM_START_MISSING'});indeterminate=true;componentIndeterminate=true;continue;}
        if(termStart>input.referenceDate)continue;
        let cursor=termStart;
        while(cursor<=input.referenceDate){
          const applicable=rules.filter((candidate)=>candidate.validFrom<=cursor&&candidate.validThrough>=cursor);
          if(applicable.length!==1){
            let end=input.referenceDate;
            const nextStart=rules.filter((candidate)=>candidate.validFrom>cursor).map((candidate)=>candidate.validFrom).sort()[0];
            if(nextStart!==undefined&&nextStart<=end)end=new Date(Date.parse(`${nextStart}T00:00:00.000Z`)-86_400_000).toISOString().slice(0,10);
            gaps.push({track:trackName,component,from:cursor,through:end,reason:applicable.length===0?'TIMELINE_GAP':'RULE_TIMELINE_CONFLICT'});indeterminate=true;componentIndeterminate=true;
            cursor=new Date(Date.parse(`${end}T00:00:00.000Z`)+86_400_000).toISOString().slice(0,10);continue;
          }
          const selected=applicable[0]!;const end=selected.validThrough<input.referenceDate?selected.validThrough:input.referenceDate;
          const formalAct=acts.find((act)=>act.id===selected.formalActId&&act.components.includes(component));
          const assessedPenalty=component==='INFRACTION_PENALTY'?formalAct?.penaltyAmounts?.find(item=>item.lineId===line.id)?.amountCents:null;
          if(component==='INFRACTION_PENALTY'&&(!formalAct||assessedPenalty===undefined||assessedPenalty===null||!Number.isSafeInteger(assessedPenalty)||assessedPenalty<0)){
            gaps.push({track:trackName,component,from:cursor,through:end,reason:'FORMAL_ACT_REQUIRED'});indeterminate=true;componentIndeterminate=true;
          }else if(!hashPattern.test(selected.sourceSha256)||!Number.isSafeInteger(selected.ratePpm)||selected.ratePpm<0||selected.ratePpm>1_000_000_000||
            (selected.formula==='SIMPLE_DAILY_PPM'&&(!Number.isSafeInteger(selected.annualizationDays)||selected.annualizationDays<1))){
            gaps.push({track:trackName,component,from:cursor,through:end,reason:'TIMELINE_GAP'});indeterminate=true;componentIndeterminate=true;
          }else{
            const basis=selected.formula==='FIXED_PERCENT_PPM'?1_000_000n:1_000_000n*BigInt(selected.annualizationDays);
            const duration=selected.formula==='FIXED_PERCENT_PPM'?1n:daysBetweenInclusive(cursor,end);
            const amount=component==='INFRACTION_PENALTY'?BigInt(assessedPenalty!):round(BigInt(line.principalCents)*BigInt(selected.ratePpm)*duration,basis,selected.rounding);
            componentTotal+=amount;
            memory.push({lineId:line.id,track:trackName,component,ruleId:selected.id,ruleVersion:selected.version,from:cursor,through:end,
              principalCents:line.principalCents,amountCents:asSafeNumber(amount),formula:selected.formula,ratePpm:selected.ratePpm,rounding:selected.rounding,
              officialBasis:selected.officialBasis,sourceSha256:selected.sourceSha256,formalActId:selected.formalActId??null});
          }
          cursor=new Date(Date.parse(`${end}T00:00:00.000Z`)+86_400_000).toISOString().slice(0,10);
        }
      }
      track[componentKeys[component]]=componentIndeterminate?null:asSafeNumber(componentTotal);
    }
    if(!sourceOk||!packageOk){track.monetaryUpdateCents=null;track.lateInterestCents=null;track.latePaymentFineCents=null;track.infractionPenaltyCents=null;indeterminate=true;}
    if(indeterminate||gaps.some(gap=>gap.track===trackName))track.totalCents=null;
    else track.totalCents=asSafeNumber(BigInt(track.principalCents)+BigInt(track.monetaryUpdateCents??0)+BigInt(track.lateInterestCents??0)+BigInt(track.latePaymentFineCents??0)+BigInt(track.infractionPenaltyCents??0));
  }
  if(!sourceOk&&!gaps.length)gaps.push({track:'COMPLEMENT',component:'LATE_INTEREST',from:null,through:input.referenceDate,reason:'SOURCE_INELIGIBLE'});
  return {sourcePackageId:source.id,referenceDate:input.referenceDate,regime:source.regime,status:gaps.length?'INDETERMINATE':'READY_FOR_INTERNAL_REVIEW',
    restitution:totals.RESTITUTION,complement:totals.COMPLEMENT,rulePackageVersion:packageOk?rulePackage?.version??null:null,formalActIds:actIds,
    memory,gaps};
};
