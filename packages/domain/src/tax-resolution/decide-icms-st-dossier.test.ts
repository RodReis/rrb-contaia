import { describe,expect,it } from 'vitest';
import { decideIcmsStDossierTrack,fiscalUseDossierStatus,type FiscalUseCommand } from './decide-icms-st-dossier.js';
const command=(overrides:Partial<FiscalUseCommand>={}):FiscalUseCommand=>({action:'APPROVED',track:'RESTITUTION',actorId:'reviewer',actorRole:'contador',reason:'Evidências conferidas para aprovação interna.',evidenceIds:['e1'],destination:'REFUND_REQUEST',rulePackageId:'rule-id',rulePackageVersion:'go-v1',ruleApproved:true,requiredConditionCount:2,conditionConfirmations:[0,1],preparedBy:'preparer',principalCents:1000,legalAccrualsCents:200,blockedByIndeterminate:false,nowUtc:'2026-10-24T00:00:00.000Z',...overrides});
describe('decisão interna do dossiê ICMS-ST',()=>{
 it('aprova só destino com regra aprovada, evidência, valores determinados e outro revisor',()=>{expect(decideIcmsStDossierTrack(command()).totalCents).toBe(1200);});
 it.each([{actorId:'preparer'},{ruleApproved:false},{evidenceIds:[]},{blockedByIndeterminate:true},{legalAccrualsCents:null}])('bloqueia aprovação sem precondições: %o',input=>{expect(()=>decideIcmsStDossierTrack(command(input))).toThrow();});
 it('mantém revisão devolvida e impede papel somente leitura',()=>{expect(decideIcmsStDossierTrack(command({action:'RETURNED_FOR_EVIDENCE'})).status).toBe('RETURNED_FOR_EVIDENCE');expect(()=>decideIcmsStDossierTrack(command({actorRole:'auditor_readonly'})).status).toThrow('ACCESS_DENIED');});
 it('permite ao auxiliar preparar, mas reserva devolução e rejeição ao revisor',()=>{expect(()=>decideIcmsStDossierTrack(command({actorRole:'auxiliar',action:'RETURNED_FOR_EVIDENCE'}))).toThrow('ACCESS_DENIED');expect(()=>decideIcmsStDossierTrack(command({actorRole:'auxiliar',action:'REJECTED'}))).toThrow('ACCESS_DENIED');});
 it('não cruza destinos entre as trilhas',()=>{expect(()=>decideIcmsStDossierTrack(command({track:'COMPLEMENT',destination:'REFUND_REQUEST'}))).toThrow('DESTINATION_NOT_SUPPORTED');});
 it('exige confirmação humana de todas as condições do pacote',()=>{expect(()=>decideIcmsStDossierTrack(command({conditionConfirmations:[0]}))).toThrow('DESTINATION_INDETERMINATE');});
 it('representa fechamento parcial sem misturar trilhas',()=>{expect(fiscalUseDossierStatus('APPROVED','PENDING',false)).toBe('PARTIALLY_DECIDED');expect(fiscalUseDossierStatus('BLOCKED','PENDING',true)).toBe('BLOCKED_INDETERMINATE');});
});
