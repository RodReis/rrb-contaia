import { Logger, type Provider } from '@nestjs/common';
import { NFCE_IMPORT_QUEUE, NFCE_IMPORT_JOB } from '@contaia/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const NFCE_IMPORT_API_QUEUE=Symbol('NFCE_IMPORT_API_QUEUE');
export const NFCE_IMPORT_JOB_NAME=NFCE_IMPORT_JOB;
const abrir=()=>{const url=process.env['REDIS_URL']?.trim();if(!url)return{queue:null as Queue|null,fechar:async()=>undefined};const connection=new Redis(url,{maxRetriesPerRequest:3});const queue=new Queue(NFCE_IMPORT_QUEUE,{connection});queue.on('error',(error:Error)=>new Logger('FilaNfce').warn(`Fila NFC-e indisponível: ${error.name}`));return{queue,fechar:async()=>{await queue.close();await connection.quit().catch(()=>connection.disconnect());}};};
let shared:ReturnType<typeof abrir>|null=null;
export const PROVEDOR_DA_FILA_NFCE:Provider[]=[{provide:NFCE_IMPORT_API_QUEUE,useFactory:()=>{shared??=abrir();return shared.queue;}},{provide:'NFCE_IMPORT_API_QUEUE_LIFECYCLE',useFactory:()=>({onModuleDestroy:async()=>{await shared?.fechar();shared=null;}})}];
