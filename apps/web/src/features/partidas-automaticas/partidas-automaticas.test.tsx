import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({simulate:vi.fn(),origins:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('sonner',()=>({toast:{success:mocks.success,error:mocks.error}}));
vi.mock('@/features/usuarios/queries',()=>({useSessao:()=>({data:{papel:'contador'}})}));
vi.mock('@/features/cofre/permissoes',()=>({concede:()=>true}));
vi.mock('@/features/empresa/api',()=>({listarEmpresas:vi.fn()}));
vi.mock('@/features/lancamentos-contabeis/api',()=>({listarContasAnaliticas:vi.fn(),listarCentrosAnaliticos:vi.fn()}));
vi.mock('./api',()=>({
  listarRegrasAutomaticas:async()=>({items:[]}),listarGeracoesAutomaticas:async()=>({items:[]}),listarPendenciasAutomaticas:async()=>({items:[]}),
  listarOrigensAutomaticas:mocks.origins,simularOrigemAutomatica:mocks.simulate,gerarOrigemAutomatica:vi.fn(),
  obterRegraAutomatica:vi.fn(),arquivarRegraAutomatica:vi.fn(),criarRegraAutomatica:vi.fn(),criarVersaoRegraAutomatica:vi.fn(),
  publicarRegraAutomatica:vi.fn(),reprocessarPendenciaAutomatica:vi.fn(),salvarRascunhoRegraAutomatica:vi.fn(),
}));
import { PartidasAutomaticas } from './partidas-automaticas';

const renderTela=(readOnly=false)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PartidasAutomaticas empresaId="423e4567-e89b-12d3-a456-426614174000" somenteLeitura={readOnly} origens={[{id:'423e4567-e89b-12d3-a456-426614174001',familia:'DFE',rotulo:'NF-e · 123',competencia:'2026-03',data:'2026-03-10',valor:'101.00'}]}/></QueryClientProvider>);

Object.defineProperty(HTMLElement.prototype,'hasPointerCapture',{configurable:true,value:()=>false});
Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>undefined});

describe('Automatização contábil F41',()=>{
 beforeEach(()=>{mocks.simulate.mockReset().mockResolvedValue({result:'MATCH',source:{attributes:{model:'55'}},evaluations:[{ruleId:'r1',version:1,criteria:[{field:'model',operator:'EQ',matched:true,value:'55'}],validityMatches:true,configurationValid:true}]});mocks.origins.mockReset();});
 it('expõe as quatro áreas e explica o estado vazio sem erro de acessibilidade',async()=>{const {container}=renderTela();expect(screen.getByRole('heading',{name:'Automatização contábil'})).toBeTruthy();expect(screen.getByRole('tab',{name:'Regras'})).toBeTruthy();expect(screen.getByRole('tab',{name:'Simulação'})).toBeTruthy();expect(screen.getByRole('tab',{name:'Gerações'})).toBeTruthy();expect(screen.getByRole('tab',{name:'Pendências'})).toBeTruthy();expect(await screen.findByText(/Nenhuma regra cadastrada/u)).toBeTruthy();expect(await axe(container)).toHaveNoViolations();});
 it('abre a área de simulação e bloqueia comandos sem origem selecionada',async()=>{renderTela();await userEvent.click(screen.getByRole('tab',{name:'Simulação'}));expect(screen.getByRole('tab',{name:'Simulação'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('button',{name:'Simular'})).toBeDisabled();expect(screen.getByRole('button',{name:'Gerar rascunho'})).toBeDisabled();});
 it('mostra o saldo calculado e identifica partida desbalanceada na simulação',async()=>{mocks.simulate.mockResolvedValue({result:'INVALID_CONFIGURATION',source:{attributes:{model:'55'}},evaluations:[{ruleId:'r1',version:1,criteria:[],validityMatches:true,configurationValid:false,configurationError:'ENTRY_UNBALANCED',calculation:{balanced:false,debitCents:'1250',creditCents:'1251',differenceCents:'1',lines:[{side:'DEBIT',accountId:'a',amountCents:'1250',costCenterId:null,position:0},{side:'CREDIT',accountId:'b',amountCents:'1251',costCenterId:null,position:1}]}}]});renderTela();await userEvent.click(screen.getByRole('tab',{name:'Simulação'}));const origem=screen.getByRole('combobox',{name:'Origem aprovada'});await userEvent.click(origem);await userEvent.click(await screen.findByRole('option',{name:/NF-e · 123/u}));await waitFor(()=>expect(screen.getByRole('button',{name:'Simular'})).toBeEnabled());await userEvent.click(screen.getByRole('button',{name:'Simular'}));expect(await screen.findByText('Partidas desbalanceadas')).toBeTruthy();expect(screen.getByText('R$ 0,01')).toBeTruthy();expect(screen.getByText('Erro no cálculo: ENTRY_UNBALANCED')).toBeTruthy();});
 it('modo somente leitura não mostra controles de manutenção',async()=>{renderTela(true);expect(await screen.findByText(/Nenhuma regra cadastrada/u)).toBeTruthy();expect(screen.queryByRole('button',{name:'Nova regra'})).toBeNull();});
});
