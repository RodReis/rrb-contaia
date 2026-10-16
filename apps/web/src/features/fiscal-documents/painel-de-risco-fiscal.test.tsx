import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PainelDeRiscoFiscal } from './painel-de-risco-fiscal';
import { listarAnalisesDeRiscoFiscal, listarDocumentosFiscais, obterConfiguracaoDeRiscoFiscal, reprocessarAnaliseDeRiscoFiscal, salvarConfiguracaoDeRiscoFiscal } from './api';

vi.mock('./api',()=>({
  listarAnalisesDeRiscoFiscal:vi.fn(),listarDocumentosFiscais:vi.fn(),obterConfiguracaoDeRiscoFiscal:vi.fn(),
  reprocessarAnaliseDeRiscoFiscal:vi.fn(),salvarConfiguracaoDeRiscoFiscal:vi.fn(),
}));

Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});

const Envolvido=({children}:{children:ReactNode})=><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;
const config={id:'00000000-0000-4000-8000-000000000001',tenant_id:'00000000-0000-4000-8000-000000000002',empresa_id:'00000000-0000-4000-8000-000000000003',versao:2,limite_centavos:'250000',motivo:'Configuração inicial aprovada.',ator_id:'00000000-0000-4000-8000-000000000004',criado_em:'2026-10-15T12:00:00.000Z',fornecedores:[]};

describe('painel de risco fiscal F20',()=>{
  beforeEach(()=>{
    vi.mocked(obterConfiguracaoDeRiscoFiscal).mockResolvedValue({configuracao:config,historico:[config]});
    vi.mocked(listarAnalisesDeRiscoFiscal).mockResolvedValue({documento:{},execucoes:[]});
    vi.mocked(listarDocumentosFiscais).mockResolvedValue({pagina:1,temProximaPagina:false,itens:[{id:'00000000-0000-4000-8000-000000000007',especie:'NFE_55',chave_acesso:'0000…0000',hash_sha256:'a'.repeat(64),emitido_em:'2026-10-15',emitente:'Fornecedor',destinatario:'Empresa',total:'2500.00',estado:'PROCESSADO',versao_layout:'4.00',criado_em:'2026-10-15T12:00:00Z',nsu:'1',capturado_em:'2026-10-15T12:00:00Z',atividade_em:'2026-10-15T12:00:00Z',origens:1}]});
    vi.mocked(salvarConfiguracaoDeRiscoFiscal).mockResolvedValue({configuracao:config,historico:[config]});
    vi.mocked(reprocessarAnaliseDeRiscoFiscal).mockResolvedValue({documentId:'00000000-0000-4000-8000-000000000005',executionId:'00000000-0000-4000-8000-000000000006',status:'QUEUED'});
  });

  it('exibe configuração versionada e não oferece ações de manifestação',async()=>{
    render(<PainelDeRiscoFiscal empresaId={config.empresa_id} somenteLeitura={false} podeConfigurar/>,{wrapper:Envolvido});
    expect(await screen.findByText('Versão 2')).toBeTruthy();
    expect(screen.getByLabelText(/Limite por operação/u)).toHaveProperty('value','2.500,00');
    expect(screen.queryByRole('button',{name:/aprovar|rejeitar|manifestar|transmitir/iu})).toBeNull();
  });

  it('não oferece mutação em somente leitura',async()=>{
    render(<PainelDeRiscoFiscal empresaId={config.empresa_id} somenteLeitura podeConfigurar={false}/>,{wrapper:Envolvido});
    expect(await screen.findByText('Versão 2')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Salvar nova versão'})).toBeNull();
  });

  it('mostra abstenção, evidências e lacunas sem tratar confiança como risco',async()=>{
    vi.mocked(listarAnalisesDeRiscoFiscal).mockResolvedValue({documento:{id:'00000000-0000-4000-8000-000000000007'},execucoes:[{
      id:'00000000-0000-4000-8000-000000000008',estado:'ABSTER_SE',tentativas:1,codigo_erro:'FISCAL_RISK_EVIDENCE_INSUFFICIENT',parser_version:'f18-1.0.0',classifier_version:'f20-1.0.0',configuration_id:config.id,correlation_id:'corr-f20-01',solicitado_em:'2026-10-16T12:00:00Z',atualizado_em:'2026-10-16T12:00:01Z',analysis_id:'00000000-0000-4000-8000-000000000009',tipo_manifestacao:'ABSTER_SE',confianca:'0',faixa_confianca:'ABSTER_SE',justificativa:'Os sinais disponíveis não sustentam proposta conclusiva; ausência de cadastro ou de histórico não comprova operação não solicitada ou não realizada.',riscos:[],evidencias:['documento:hash-f18-verificado'],lacunas:['HISTORICO_INSUFICIENTE_PARA_PADRAO'],origem:'ABSTENCAO',provedor:null,modelo:null,versao_prompt:null,versao_schema:'f20-risk-v1',fallback:true,tokens_entrada:null,tokens_saida:null,custo_microusd:null,duracao_ms:2,analisado_em:'2026-10-16T12:00:01Z',
    }]});
    const user=userEvent.setup();
    render(<PainelDeRiscoFiscal empresaId={config.empresa_id} somenteLeitura={false} podeConfigurar/>,{wrapper:Envolvido});
    const seletorDoDocumento = await screen.findByRole('combobox', { name: 'Documento fiscal' });
    seletorDoDocumento.focus();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');
    expect(await screen.findByText('Sem proposta conclusiva')).toBeTruthy();
    expect(screen.getByText('Confiança: 0')).toBeTruthy();
    expect(screen.getByText('HISTORICO_INSUFICIENTE_PARA_PADRAO')).toBeTruthy();
    await waitFor(()=>expect(listarAnalisesDeRiscoFiscal).toHaveBeenCalled());
  });

  it('diferencia a ausência de NF-e processada da seleção pendente',async()=>{
    vi.mocked(listarDocumentosFiscais).mockResolvedValue({pagina:1,temProximaPagina:false,itens:[]});
    render(<PainelDeRiscoFiscal empresaId={config.empresa_id} somenteLeitura podeConfigurar={false}/>,{wrapper:Envolvido});
    expect(await screen.findByText('Nenhuma NF-e processada nesta página')).toBeTruthy();
    expect(screen.getByRole('combobox',{name:'Documento fiscal'})).toBeDisabled();
  });

  it('usa os controles de seleção e moeda do design system',async()=>{
    render(<PainelDeRiscoFiscal empresaId={config.empresa_id} somenteLeitura={false} podeConfigurar/>,{wrapper:Envolvido});
    expect(await screen.findByRole('combobox',{name:'Documento fiscal'})).toBeTruthy();
    expect(screen.getByLabelText(/Limite por operação/u)).toHaveProperty('value','2.500,00');
    expect(screen.getByRole('textbox',{name:'Localizar NF-e'})).toBeTruthy();
  });

  it('filtra a lista de NF-e e mostra vazio distinto quando não há correspondência',async()=>{
    const user=userEvent.setup();
    render(<PainelDeRiscoFiscal empresaId={config.empresa_id} somenteLeitura podeConfigurar={false}/>,{wrapper:Envolvido});
    await user.type(await screen.findByRole('textbox',{name:'Localizar NF-e'}),'emitente inexistente');
    expect(await screen.findByText('Nenhuma NF-e corresponde à busca')).toBeTruthy();
  });
});
