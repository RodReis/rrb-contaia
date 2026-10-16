import {describe,expect,it,vi} from 'vitest';
import {FiscalRiskController} from './fiscal-risk.controller';

const request={sessao:{tenantId:'00000000-0000-4000-8000-000000000001',usuarioId:'00000000-0000-4000-8000-000000000002',papeis:['contador']},header:()=> 'corr-test-0001',query:{tipo:'210200',pagina:'2'}};
describe('rotas F21 do controller fiscal',()=>{
 it('encaminha os filtros validados da inbox e identifica a página',()=>{const service={inbox:vi.fn()};const controller=new FiscalRiskController(service as never);controller.inbox(request as never,'00000000-0000-4000-8000-000000000003',request as never);expect(service.inbox).toHaveBeenCalledWith(expect.any(String),expect.any(String),expect.any(String),expect.any(String),expect.objectContaining({tipo:'210200',pagina:2}));});
 it('recusa tipo fiscal fora do conjunto permitido antes do serviço',()=>{const service={inbox:vi.fn()};const controller=new FiscalRiskController(service as never);expect(()=>controller.inbox(request as never,'00000000-0000-4000-8000-000000000003',{...request,query:{tipo:'210210'}} as never)).toThrow();expect(service.inbox).not.toHaveBeenCalled();});
});
