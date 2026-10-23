import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PainelHistoricoIcmsSt } from './painel-historico-icms-st';
import { baixarPacoteHistoricoIcmsSt, gerarPacoteHistoricoIcmsSt } from './api';

vi.mock('./api', () => ({ baixarPacoteHistoricoIcmsSt: vi.fn(), gerarPacoteHistoricoIcmsSt: vi.fn() }));

const Envolvido=({children}:{children:ReactNode})=><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;
const pacote={id:'00000000-0000-4000-8000-000000000001',hash:'a'.repeat(64),reused:false,package:{status:'BLOCKED_POR_ACRESCIMOS_LEGAIS',grossRestitutionCents:12500,
  grossComplementCents:3000,reversedRestitutionCents:2500,reversedComplementCents:0,netPrincipalBalanceCents:7000,lines:[{sourceKind:'APPROVED_SETTLEMENT',sourceLineId:'line-1',competence:'2017-01',documentId:'doc-1',itemId:'1',
    restitutionPrincipalCents:12500,complementPrincipalCents:3000,sourceMemory:{ruleId:'GO-ICMS-ST-v1',formulaVersion:'F29-v1'}}],excludedCompetences:[{competence:'2017-02',reasonCodes:['SOURCE_REVISION_NOT_APPROVED']}]}};

describe('painel de reconstrução histórica F33',()=>{
  beforeEach(()=>vi.mocked(gerarPacoteHistoricoIcmsSt).mockResolvedValue(pacote));

  it('gera dossiê a partir de revisão aprovada e explica o bloqueio de acréscimos legais',async()=>{
    const user=userEvent.setup();
    render(<PainelHistoricoIcmsSt empresaId="00000000-0000-4000-8000-000000000002" podeGerar/>,{wrapper:Envolvido});
    await user.click(screen.getByRole('button',{name:/Gerar dossiê interno/u}));
    expect(await screen.findByText('Uso externo bloqueado')).toBeTruthy();
    expect(screen.getByText('2017-02')).toBeTruthy();
    expect(screen.getByText(/GO-ICMS-ST-v1/u)).toBeTruthy();
    expect(screen.getAllByText(/R\$\s*125,00/u)).toHaveLength(2);
    expect(gerarPacoteHistoricoIcmsSt).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002',{
      regime:'SIMPLES_NACIONAL',periodStart:'2016-10',periodEnd:'2018-02'});
  });

  it('mantém ações indisponíveis sem permissão para gerar',()=>{
    render(<PainelHistoricoIcmsSt empresaId="00000000-0000-4000-8000-000000000002" podeGerar={false}/>,{wrapper:Envolvido});
    expect(screen.getByRole('button',{name:/Gerar dossiê interno/u})).toBeDisabled();
    expect(screen.getByLabelText('Regime histórico')).toBeDisabled();
  });

  it('baixa o formato escolhido com nome ligado ao identificador do pacote',async()=>{
    const user=userEvent.setup();
    vi.mocked(baixarPacoteHistoricoIcmsSt).mockResolvedValue({blob:new Blob(['{}']),filename:`icms-st-historico-${pacote.id}.json`,hash:'b'.repeat(64)});
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn().mockReturnValue('blob:f33')});
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>undefined);
    render(<PainelHistoricoIcmsSt empresaId="00000000-0000-4000-8000-000000000002" podeGerar/>,{wrapper:Envolvido});
    await user.click(screen.getByRole('button',{name:/Gerar dossiê interno/u}));
    await user.click(await screen.findByRole('button',{name:'JSON'}));
    expect(baixarPacoteHistoricoIcmsSt).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002',pacote.id,'JSON');
    expect(click).toHaveBeenCalledOnce();
  });
});
