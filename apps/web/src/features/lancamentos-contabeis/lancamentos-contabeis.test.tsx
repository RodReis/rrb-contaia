import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api=vi.hoisted(()=>({listarLancamentos:vi.fn(),listarContasAnaliticas:vi.fn(),listarCentrosAnaliticos:vi.fn(),salvarLancamento:vi.fn(),efetivarLancamento:vi.fn(),descartarLancamento:vi.fn(),cancelarLancamento:vi.fn(),estornarLancamento:vi.fn(),obterLancamento:vi.fn()}));
vi.mock('./api',()=>api);
vi.mock('../importacao/api',()=>({novoCorrelationId:()=> 'correlation-f40'}));
vi.mock('../empresa/api',()=>({listarEmpresas:async()=>({empresas:[{id:'empresa-1',nomeFantasia:'Aurora',razaoSocial:'Aurora Ltda'}]})}));
vi.mock('../usuarios/queries',()=>({useSessao:()=>({data:{permissoes:['contabil.lancamentos.consultar','contabil.lancamentos.preparar_rascunho','contabil.lancamentos.efetivar','contabil.lancamentos.cancelar_estornar'],papeis:['contador']}})}));

import { LancamentosContabeis } from './lancamentos-contabeis';

const renderizar=()=>{const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={client}><LancamentosContabeis/></QueryClientProvider>)};

describe('lançamentos contábeis',()=>{
  beforeEach(()=>{vi.clearAllMocks();api.listarLancamentos.mockResolvedValue([]);api.listarContasAnaliticas.mockResolvedValue({items:[{accountId:'conta-a',code:'1.01',name:'Caixa',type:'ANALYTICAL',status:'ACTIVE',costCenterPolicy:'OPTIONAL'},{accountId:'conta-b',code:'2.01',name:'Capital',type:'ANALYTICAL',status:'ACTIVE',costCenterPolicy:'OPTIONAL'}]});api.listarCentrosAnaliticos.mockResolvedValue({items:[]});api.salvarLancamento.mockResolvedValue({entryId:'lancamento-1',version:1});api.obterLancamento.mockResolvedValue({entryId:'lancamento-1',entryNumber:null,accountingDate:'2026-10-01',competence:'2026-10',history:'Integralização de capital',externalReference:null,status:'DRAFT',version:1,debitCents:'0',creditCents:'0',lines:[]});});
  it('prepara rascunho com partidas em centavos e empresa selecionada',async()=>{
    renderizar();
    fireEvent.click(await screen.findByRole('button',{name:'Novo rascunho'}));
    fireEvent.change(screen.getByLabelText('Histórico'),{target:{value:'Integralização de capital'}});
    await screen.findAllByRole('option',{name:'1.01 · Caixa'});const contas=screen.getAllByRole('combobox',{name:'Conta'});fireEvent.change(contas[0]!,{target:{value:'conta-a'}});fireEvent.change(contas[1]!,{target:{value:'conta-b'}});
    const valores=screen.getAllByLabelText('Valor (R$)');fireEvent.change(valores[0]!,{target:{value:'125,90'}});fireEvent.change(valores[1]!,{target:{value:'125,90'}});
    fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));
    await waitFor(()=>expect(api.salvarLancamento).toHaveBeenCalledWith('empresa-1',expect.objectContaining({history:'Integralização de capital',lines:expect.arrayContaining([expect.objectContaining({accountId:'conta-a',amountCents:12590}),expect.objectContaining({accountId:'conta-b',amountCents:12590})])}),undefined));
  });
});
