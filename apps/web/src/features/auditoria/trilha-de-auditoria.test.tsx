import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrilhaDeAuditoria } from './trilha-de-auditoria';

const estado=vi.hoisted(()=>({url:new URLSearchParams(),replace:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:estado.replace}),useSearchParams:()=>estado.url}));
vi.mock('@/features/usuarios/queries',()=>({useSessao:()=>({data:{permissoes:['usuarios.auditoria_payload.revelar']}})}));
const id='123e4567-e89b-42d3-a456-426614174000';
const evento={id,empresa_id:id,empresa:'Comércio Aurora',event_type:'agent.decision.210200',origin:'fiscal_risk_analysis',
  occurred_at:'2026-10-17T14:00:00.000Z',actor_id:id,ator:'Rodrigo',actor_kind:'AGENT',actor_role:null,agent:'Agente de Captura',
  agent_version:'f20-1.0.0',model:'modelo-dublado',provider:'fixture',source_type:'fiscal_risk_analysis',source_id:id,
  decision:'210200',state:'CONCLUIDA',score:'0.93',measured_cost_microusd:'0',input_tokens:12,output_tokens:8,
  correlation_id:'corr-auditoria-1',causation_id:id,envelope_sha256:'a'.repeat(64),payload_sha256:'b'.repeat(64),integridade:'VALIDA'};
const resposta=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const envolver=({children}:{children:ReactNode})=><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;

beforeEach(()=>{estado.url=new URLSearchParams();estado.replace.mockReset();vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
  const url=String(input);
  if(url.includes('/revelacao'))return resposta({eventId:id,payload:{prompt:'conteudo integral confidencial',decision:'210200'}});
  if(url.includes('/exportacoes'))return resposta({formato:'JSON',arquivo:'auditoria.json',sha256:'c'.repeat(64),quantidade:1,conteudo:'[]'});
  if(url.endsWith('/'+id))return resposta({...evento,envelope:{id},payload:{prompt:'[REDACTADO]',decision:'210200'},payload_status:'DISPONIVEL',envelope_valido:true,payload_valido:true});
  return resposta({eventos:[evento],total:1,pagina:1,limite:25});
}));});

describe('TrilhaDeAuditoria',()=>{
  it('lista decisões, abre detalhe redigido e mantém seleção na URL',async()=>{
    const user=userEvent.setup();
    const {rerender}=render(<TrilhaDeAuditoria/>,{wrapper:envolver});
    expect(await screen.findByText('agent.decision.210200')).toBeVisible();
    await user.click(screen.getByRole('button',{name:/Agente de Captura/}));
    await waitFor(()=>expect(estado.replace).toHaveBeenCalledWith('/auditoria?evento='+id,{scroll:false}));
    estado.url=new URLSearchParams('evento='+id);
    rerender(<TrilhaDeAuditoria/>);
    expect(await screen.findByText('Payload redigido')).toBeVisible();
    expect(screen.getByText(/\[REDACTADO\]/)).toBeVisible();
  });

  it('apresenta lista vazia e controles de filtro acessíveis',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>resposta({eventos:[],total:0,pagina:1,limite:25})));
    const {container}=render(<TrilhaDeAuditoria/>,{wrapper:envolver});
    expect(await screen.findByText('Nenhum evento neste recorte')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('pede justificativa e confirmação antes de revelar payload; API registra autoria',async()=>{
    const user=userEvent.setup();
    estado.url=new URLSearchParams('evento='+id);
    render(<TrilhaDeAuditoria/>,{wrapper:envolver});
    expect(await screen.findByText('Payload redigido')).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Revelar conteúdo integral'}));
    await user.type(screen.getByRole('textbox',{name:/Justificativa/}),'Investigação aprovada pelo PI');
    await user.click(screen.getByRole('button',{name:'Confirmar revelação'}));
    expect(await screen.findByText('Payload integral revelado')).toBeVisible();
    expect(screen.getByText(/conteudo integral confidencial/)).toBeVisible();
    const request=vi.mocked(fetch).mock.calls.find(([input])=>String(input).includes('/revelacao'));
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({justificativa:'Investigação aprovada pelo PI',confirmacao:true});
  });
});
