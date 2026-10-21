import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api=vi.hoisted(()=>({upload:vi.fn(),obter:vi.fn(),baixar:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('sonner',()=>({toast:{success:api.success,error:api.error}}));
vi.mock('./api',()=>({enviarLoteNfce:api.upload,obterLoteNfce:api.obter,baixarRelatorioNfce:api.baixar}));

import { ImportacaoNfce } from './importacao-nfce';

const lote={id:'123e4567-e89b-12d3-a456-426614174000',status:'COMPLETED' as const,total:1,origem:'PORTAL_GO' as const,totais:{IMPORTED:1},itens:[{id:'223e4567-e89b-12d3-a456-426614174000',nome_sanitizado:'cupom.xml',status:'IMPORTED' as const,codigo:null,detalhe_sanitizado:null,document_id:'323e4567-e89b-12d3-a456-426614174000',modelo:'65',versao_layout:'4.00',ambiente:'PRODUCAO',chave_acesso:'5'.repeat(44)}]};

const renderizar=(somenteLeitura=false)=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><ImportacaoNfce empresaId="423e4567-e89b-12d3-a456-426614174000" somenteLeitura={somenteLeitura}/></QueryClientProvider>);
};

describe('ImportacaoNfce',()=>{
  beforeEach(()=>{api.upload.mockReset();api.obter.mockReset();api.baixar.mockReset();api.success.mockReset();api.error.mockReset();});

  it('explica limites, mantém envio desabilitado sem arquivo e bloqueia mutação em leitura',async()=>{
    const {container}=renderizar(true);
    expect(screen.getByText(/Máximo 10 MB por XML/u)).toBeTruthy();
    expect(screen.getByLabelText('Origem declarada')).toBeDisabled();
    expect(screen.getByLabelText('Arquivos XML ou ZIP')).toBeDisabled();
    expect(screen.getByRole('button',{name:'Enviar lote'})).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('envia XML, mostra resultado acessível e disponibiliza CSV após conclusão',async()=>{
    api.upload.mockResolvedValue({batchId:lote.id,status:'QUEUED',reused:false});
    api.obter.mockResolvedValue(lote);
    api.baixar.mockResolvedValue(undefined);
    const {container}=renderizar();
    const file=new File(['<nfeProc/>'],'cupom.xml',{type:'application/xml'});
    fireEvent.change(screen.getByLabelText('Arquivos XML ou ZIP'),{target:{files:[file]}});
    expect(screen.getByText('1 arquivo(s) selecionado(s): cupom.xml')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Enviar lote'}));
    await waitFor(()=>expect(api.upload).toHaveBeenCalledWith('423e4567-e89b-12d3-a456-426614174000',[file],'PORTAL_GO'));
    expect(await screen.findByText('Concluído · 1 arquivo(s)')).toBeTruthy();
    expect(screen.getByRole('cell',{name:'cupom.xml'})).toBeTruthy();
    expect(screen.getByRole('cell',{name:'Importado'})).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button',{name:'Baixar relatório CSV'}));
    await waitFor(()=>expect(api.baixar).toHaveBeenCalledWith('423e4567-e89b-12d3-a456-426614174000',lote.id));
    expect(api.success).toHaveBeenCalledWith('Lote NFC-e enviado para processamento.');
  });
});
