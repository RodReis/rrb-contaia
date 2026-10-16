import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';

const estado=vi.hoisted(()=>({url:'aba=captura-dfe&manifestacaoTipo=210200',replace:vi.fn(),history:[] as Array<Record<string,unknown>>,items:[{document_id:'00000000-0000-4000-8000-000000000001',chave_acesso:'1'.repeat(44),emitente:'Fornecedor teste',total:'12.34',analysis_id:'00000000-0000-4000-8000-000000000002',tipo_manifestacao:'210200',confianca:'0.9',faixa_confianca:'PRONTA_PARA_REVISAO',riscos:[],evidencias:[],lacunas:[],proposta:'Revisar evento',dias_restantes:5,risco_alto:1}] as Array<Record<string,unknown>>}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:estado.replace}),useSearchParams:()=>new URLSearchParams(estado.url)}));
vi.mock('./api',()=>({aprovarLote210200:vi.fn(async()=>({itens:[]})),decidirManifestacao:vi.fn(),listarHistoricoManifestacoes:vi.fn(async()=>({itens:estado.history})),listarInboxManifestacoes:vi.fn(async()=>({itens:estado.items})),reconciliarManifestacao:vi.fn()}));
import { InboxDeManifestacoes } from './inbox-de-manifestacoes';

describe('inbox de manifestações F21',()=>{
 it('preserva filtros e documento na URL e mostra a revisão mestre-detalhe',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><InboxDeManifestacoes empresaId="00000000-0000-4000-8000-000000000003" permitirDecisao/></QueryClientProvider>);
  expect((await screen.findAllByText('Fornecedor teste')).length).toBe(2);
  fireEvent.click(screen.getByRole('button',{name:/aprovar lote 210200/i}));
  expect(estado.replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Emitente'),{target:{value:'Fornecedor'}});
  await waitFor(()=>expect(estado.replace).toHaveBeenCalledWith(expect.stringContaining('manifestacaoEmitente=Fornecedor'),{scroll:false}));
  client.clear();
 });
 it('estado incerto permite consulta de destino e bloqueia nova decisão e lote',async()=>{
  estado.url='aba=captura-dfe&manifestacaoEstado=RESULTADO_INCERTO';estado.history=[{id:'00000000-0000-4000-8000-000000000004',document_id:'00000000-0000-4000-8000-000000000001',chave_acesso:'1'.repeat(44),tipo:'210200',estado:'RESULTADO_INCERTO',detalhe_sanitizado:'Aguardando reconciliação',codigo:null,protocolo:null}];
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><InboxDeManifestacoes empresaId="00000000-0000-4000-8000-000000000003" permitirDecisao/></QueryClientProvider>);
  expect(await screen.findByText('Esta manifestação está em acompanhamento. Nenhuma nova decisão ou transmissão pode ser iniciada aqui.')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/aprovar lote/i})).toBeNull();expect(screen.queryByRole('button',{name:/aprovar e enfileirar/i})).toBeNull();expect(screen.queryByRole('button',{name:/rejeitar proposta/i})).toBeNull();expect(screen.getByRole('button',{name:'Consultar destino'})).toBeTruthy();client.clear();
 });
 it('mostra o evento final antes de abrir a fila para transmissão',async()=>{
  estado.url='aba=captura-dfe';estado.history=[];const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><InboxDeManifestacoes empresaId="00000000-0000-4000-8000-000000000003" permitirDecisao/></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'Aprovar e enfileirar'}));const dialog=await screen.findByRole('alertdialog');expect(dialog.textContent).toContain(`NF-e ${'1'.repeat(44)}`);expect(dialog.textContent).toContain('Evento 210200, sequência 1, ambiente de homologação.');expect(screen.getByRole('button',{name:'Confirmar e enfileirar'})).toBeTruthy();client.clear();
 });
});
