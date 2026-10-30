import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { fireEvent,render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {consultarMock,permissions}=vi.hoisted(()=>({consultarMock:vi.fn(),permissions:['contabil.saldos_abertura.consultar','contabil.saldos_abertura.preparar']}));
vi.mock('next/navigation',()=>({usePathname:()=>'/contabil/saldos-abertura',useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams('empresaId=empresa-1')}));
vi.mock('@/features/usuarios/queries',()=>({useSessao:()=>({data:{permissoes:permissions}})}));
vi.mock('@/features/empresa/api',()=>({listarEmpresas:vi.fn().mockResolvedValue({empresas:[{id:'empresa-1',nomeFantasia:'Empresa teste',razaoSocial:null}]})}));
vi.mock('@/features/lancamentos-contabeis/api',()=>({listarContasAnaliticas:vi.fn().mockResolvedValue({items:[{accountId:'account-1',code:'1.01',name:'Caixa',type:'ANALYTICAL',status:'ACTIVE'}]}),listarCentrosAnaliticos:vi.fn().mockResolvedValue({items:[]})}));
vi.mock('./api',()=>({consultarAbertura:consultarMock,criarAbertura:vi.fn(),salvarAbertura:vi.fn(),previsualizarAberturaCsv:vi.fn(),confirmarAberturaCsv:vi.fn(),aprovarAbertura:vi.fn()}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
import { SaldosAbertura } from './saldos-abertura';

const draft={openingBalanceId:'draft-1',version:1,baseDate:'2097-03-31',source:'MANUAL' as const,status:'DRAFT' as const,revision:2,debitCents:'1250',creditCents:'1250',contentHash:null,createdBy:'user-1',approvedBy:null,approvedAt:null,supersedesId:null,replacementReason:null,lines:[{accountId:'account-1',costCenterId:null,debitCents:1250,creditCents:0,note:'Saldo inicial'},{accountId:'account-1',costCenterId:null,debitCents:0,creditCents:1250,note:'Contrapartida'}]};

describe('saldos de abertura',()=>{
 beforeEach(()=>{consultarMock.mockReset();permissions.splice(0,permissions.length,'contabil.saldos_abertura.consultar','contabil.saldos_abertura.preparar');});
 it('carrega linhas e data-base do rascunho selecionado e mostra totais equilibrados',async()=>{
  consultarMock.mockResolvedValue({active:null,drafts:[draft],history:[],events:[]});
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SaldosAbertura empresaId="empresa-1" nomeEmpresa="Empresa teste"/></QueryClientProvider>);
  expect(await screen.findByDisplayValue('2097-03-31')).toBeInTheDocument();
  expect(await screen.findAllByDisplayValue('12,50')).toHaveLength(2);
  expect(screen.getByDisplayValue('Saldo inicial')).toBeInTheDocument();
  expect(screen.getByText('Diferença')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Rascunho existente'),{target:{value:'__new__'}}); expect(screen.getByLabelText('Data-base')).toHaveValue(''); expect(screen.getByLabelText('Valor da linha 1')).toHaveValue('');
 });
});
