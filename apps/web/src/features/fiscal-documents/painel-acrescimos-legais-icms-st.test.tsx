import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { PainelAcrescimosLegaisIcmsSt } from './painel-acrescimos-legais-icms-st';
import { calcularAcrescimosLegaisF34,listarAtosFormaisF34,listarFontesAcrescimosF34,listarPacotesNormativosF34,listarResultadosAcrescimosF34 } from './api';

vi.mock('./api',()=>({
  aprovarFonteF33ParaF34:vi.fn(),baixarAcrescimosLegaisF34:vi.fn(),calcularAcrescimosLegaisF34:vi.fn(),decidirAtoFormalF34:vi.fn(),decidirPacoteNormativoF34:vi.fn(),
  importarAtoFormalF34:vi.fn(),importarPacoteNormativoF34:vi.fn(),listarAtosFormaisF34:vi.fn(),listarFontesAcrescimosF34:vi.fn(),listarPacotesNormativosF34:vi.fn(),
  listarResultadosAcrescimosF34:vi.fn(),revisarAcrescimosLegaisF34:vi.fn(),
}));
const Wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;
const sourceId='00000000-0000-4000-8000-000000000001';

describe('painel de acréscimos legais F34',()=>{
  beforeEach(()=>{
    vi.mocked(listarFontesAcrescimosF34).mockResolvedValue({itens:[{id:sourceId,regime:'SIMPLES_NACIONAL',periodStart:'2016-10',periodEnd:'2018-02',status:'BLOQUEADO_POR_ACRESCIMOS_LEGAIS',hash:'a'.repeat(64),periodComplete:true,approved:true,superseded:false}]});
    vi.mocked(listarPacotesNormativosF34).mockResolvedValue({itens:[]});vi.mocked(listarAtosFormaisF34).mockResolvedValue({itens:[]});vi.mocked(listarResultadosAcrescimosF34).mockResolvedValue({itens:[]});
  });

  it('mantém valores conhecidos e total indeterminado sem cobertura legal aprovada',async()=>{
    vi.mocked(calcularAcrescimosLegaisF34).mockResolvedValue({id:'00000000-0000-4000-8000-000000000002',hash:'b'.repeat(64),reused:false,result:{
      status:'INDETERMINATE',restitution:{principalCents:0,monetaryUpdateCents:0,lateInterestCents:0,latePaymentFineCents:0,infractionPenaltyCents:0,totalCents:0},
      complement:{principalCents:10000,monetaryUpdateCents:0,lateInterestCents:null,latePaymentFineCents:0,infractionPenaltyCents:0,totalCents:null},
      gaps:[{track:'COMPLEMENT',component:'LATE_INTEREST',from:'2017-01-01',through:'2018-02-28',reason:'TIMELINE_GAP'}],memory:[]}});
    const user=userEvent.setup();render(<PainelAcrescimosLegaisIcmsSt empresaId="company-1" podeGerar/>,{wrapper:Wrapper});
    await screen.findByRole('option',{name:/2016-10/u});
    await user.selectOptions(screen.getByRole('combobox',{name:'Pacote F33'}),sourceId);
    await user.type(screen.getByLabelText('Data de referência'),'2018-02-28');
    await user.click(screen.getByRole('button',{name:'Calcular acréscimos'}));
    expect(await screen.findByText('Lacunas que mantêm o resultado indeterminado')).toBeTruthy();
    expect(screen.getByText(/100,00/u)).toBeTruthy();
    expect(screen.getAllByText('Indeterminado').length).toBeGreaterThan(0);
    expect(calcularAcrescimosLegaisF34).toHaveBeenCalledWith('company-1',{sourcePackageId:sourceId,referenceDate:'2018-02-28',rulePackageId:null,formalActIds:[]});
  });

  it('não libera cálculo sem fonte F33 e não presume pacote de regras',()=>{
    render(<PainelAcrescimosLegaisIcmsSt empresaId="company-1" podeGerar/>,{wrapper:Wrapper});
    expect(screen.getByRole('button',{name:'Calcular acréscimos'})).toBeDisabled();
    expect(screen.getByText(/Nenhum pacote normativo aprovado/u)).toBeTruthy();
  });
});
