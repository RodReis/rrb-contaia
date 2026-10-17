import { Injectable } from '@nestjs/common';
import { comContextoHumano, listarRegrasDeObrigacao, criarRegraDeObrigacao, publicarRegraDeObrigacao, arquivarRegraDeObrigacao, salvarCoberturaDoCalendario, salvarFeriado, gerarOcorrenciasPublicadas, listarAgenda, obterOcorrencia, listarEventosDaObrigacao, listarAlertasDaObrigacao, registrarBaixaDaObrigacao, registrarReaberturaDaObrigacao, type FiltroAgenda } from '@contaia/db';
import type { RegraDeObrigacao } from '@contaia/domain';
import type { AtorDoCatalogo } from '../auth/catalogo-tributario.guard';
import { noCatalogoTributario } from '../tax-rules/catalogo-contexto';
import { PoolDoBanco } from '../banco/pool.provider';

@Injectable()
export class ObligationsService {
  constructor(private readonly pool: PoolDoBanco) {}
  async regrasCatalogo(ator:AtorDoCatalogo,correlationId:string){const regras=await noCatalogoTributario(this.pool.instancia,correlationId,c=>listarRegrasDeObrigacao(c));return ator.tipo==='SUPER_ADMIN'?regras:regras.filter(r=>r.estado==='PUBLICADA');}
  criarRegra(ator:AtorDoCatalogo,entrada:Omit<RegraDeObrigacao,'versao'>,correlationId:string){return noCatalogoTributario(this.pool.instancia,correlationId,c=>criarRegraDeObrigacao(c,entrada,'',ator.id,correlationId));}
  publicar(ator:AtorDoCatalogo,id:string,versao:number,correlationId:string){return noCatalogoTributario(this.pool.instancia,correlationId,c=>publicarRegraDeObrigacao(c,'',id,versao,ator.id,correlationId));}
  arquivar(ator:AtorDoCatalogo,id:string,versao:number,correlationId:string){return noCatalogoTributario(this.pool.instancia,correlationId,c=>arquivarRegraDeObrigacao(c,'',id,versao,ator.id,correlationId));}
  feriado(ator:AtorDoCatalogo,entrada:Omit<Parameters<typeof salvarFeriado>[1],'autorId'>,correlationId:string){return noCatalogoTributario(this.pool.instancia,correlationId,c=>salvarFeriado(c,{...entrada,autorId:ator.id}));}
  salvarCobertura(ator:AtorDoCatalogo,entrada:Omit<Parameters<typeof salvarCoberturaDoCalendario>[1],'autorId'>,correlationId:string){return noCatalogoTributario(this.pool.instancia,correlationId,c=>salvarCoberturaDoCalendario(c,{...entrada,autorId:ator.id}));}
  gerar(tenantId:string,usuarioId:string,competencia:string){const referencia=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return comContextoHumano(this.pool.instancia,{tenantId,usuarioId},c=>gerarOcorrenciasPublicadas(c,tenantId,competencia,referencia));}
  agenda(tenantId:string,usuarioId:string,filtro:FiltroAgenda){return comContextoHumano(this.pool.instancia,{tenantId,usuarioId},c=>listarAgenda(c,tenantId,usuarioId,filtro));}
  detalhe(tenantId:string,usuarioId:string,id:string){return comContextoHumano(this.pool.instancia,{tenantId,usuarioId},async c=>{const ocorrencia=await obterOcorrencia(c,tenantId,id);if(!ocorrencia)return null;const [eventos,alertas]=await Promise.all([listarEventosDaObrigacao(c,tenantId,id),listarAlertasDaObrigacao(c,tenantId,id)]);return {ocorrencia,eventos,alertas};});}
  baixa(tenantId:string,usuarioId:string,id:string,entrada:{versao:number;dataEntrega:string;referencia:string},correlationId:string){return comContextoHumano(this.pool.instancia,{tenantId,usuarioId},c=>registrarBaixaDaObrigacao(c,{tenantId,occurrenceId:id,...entrada,autorId:usuarioId,correlationId}));}
  reabrir(tenantId:string,usuarioId:string,id:string,entrada:{versao:number;motivo:string},correlationId:string){return comContextoHumano(this.pool.instancia,{tenantId,usuarioId},c=>registrarReaberturaDaObrigacao(c,{tenantId,occurrenceId:id,...entrada,autorId:usuarioId,correlationId}));}
}
