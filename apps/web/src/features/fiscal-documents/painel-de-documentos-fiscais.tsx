'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { RefreshCw, ListFilter } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { toast } from 'sonner';
import { Select, type OpcaoDoSelect } from '@/components/ui/select';
import { ErroDaApi } from '@/lib/http';
import { InboxDeManifestacoes } from './inbox-de-manifestacoes';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { listarDocumentosFiscais, listarCienciasDaEmissao, obterCienciaDaEmissao, retomarCienciaDaEmissao, type DocumentoFiscal, type CienciaDaEmissaoUI } from './api';
import { FilaResolucaoTributaria } from './fila-resolucao-tributaria';
import { ListaDocumentosFiscais } from './lista-documentos-fiscais';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';

const dataHora = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : '—';

const rotulo: Record<DocumentoFiscal['estado'], string> = {
  PENDENTE: 'Pendente', PROCESSANDO: 'Em processamento', PROCESSADO: 'Processado', PENDENTE_LAYOUT: 'Layout pendente',
  PENDENTE_IBS_CBS: 'IBS/CBS pendente', XML_INVALIDO: 'XML inválido', CONFLITO: 'Conflito de identidade', FALHA: 'Falha no processamento',
};
const opcoesDeEstado: readonly OpcaoDoSelect[] = [
  { valor: 'TODOS', rotulo: 'Todos os estados' },
  ...Object.entries(rotulo).map(([valor, label]) => ({ valor, rotulo: label })),
];
const estadosValidos = new Set(opcoesDeEstado.map((opcao) => opcao.valor));
const tomCiencia: Record<CienciaDaEmissaoUI['estado'], TomDoStatus> = {
  RESUMO_CAPTURADO:'atencao', CIENCIA_PENDENTE:'atencao', CIENCIA_EM_ENVIO:'atencao', CIENCIA_REGISTRADA:'conforme',
  XML_COMPLETO_PENDENTE:'atencao', XML_COMPLETO_OBTIDO:'conforme', PARSEADO:'conforme', JA_MANIFESTADO:'atencao',
  XML_COMPLETO_JA_DISPONIVEL:'conforme', RESULTADO_INCERTO:'critico', RETRY_AGENDADO:'atencao', REJEITADO:'critico', IMPEDIDO:'critico', DLQ:'critico',
};
const rotuloCiencia:Record<CienciaDaEmissaoUI['estado'],string>={RESUMO_CAPTURADO:'Resumo capturado',CIENCIA_PENDENTE:'Aguardando Ciência',CIENCIA_EM_ENVIO:'Enviando Ciência',CIENCIA_REGISTRADA:'Ciência registrada',XML_COMPLETO_PENDENTE:'Aguardando XML completo',XML_COMPLETO_OBTIDO:'XML completo obtido',PARSEADO:'Encaminhado à F18',JA_MANIFESTADO:'Já manifestado',XML_COMPLETO_JA_DISPONIVEL:'XML já disponível',RESULTADO_INCERTO:'Resultado incerto',RETRY_AGENDADO:'Nova tentativa agendada',REJEITADO:'Rejeitado',IMPEDIDO:'Impedido',DLQ:'Fila de falhas'};

export const PainelDeDocumentosFiscais = ({ empresaId, somenteLeitura, podeReprocessar, permitirDecisao, podeResolverTributos = false }: {
  empresaId: string;
  somenteLeitura: boolean;
  podeReprocessar: boolean;
  permitirDecisao?: boolean;
  podeResolverTributos?: boolean;
}) => {
  const [cienciaSelecionada,setCienciaSelecionada]=useState<string|null>(null);
  const [documentoSelecionadoNaFila, setDocumentoSelecionadoNaFila] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const abaAtual=searchParams.get('aba')??'captura-dfe';
  const paginaParam = Number(searchParams.get('documentosPagina') ?? '1');
  const pagina = Number.isSafeInteger(paginaParam) && paginaParam > 0 ? paginaParam : 1;
  const filtroParam = searchParams.get('documentosEstado') ?? 'TODOS';
  const filtro = estadosValidos.has(filtroParam) ? filtroParam : 'TODOS';
  const atualizarUrl = (chave: string, valor: string, resetarPagina = false): void => {
    const parametros = new URLSearchParams(searchParams.toString());
    if (
      valor === '' ||
      (chave === 'documentosPagina' && valor === '1') ||
      (chave === 'documentosEstado' && valor === 'TODOS')
    ) {
      parametros.delete(chave);
    } else {
      parametros.set(chave, valor);
    }
    if (resetarPagina) { parametros.delete('documentosPagina'); parametros.delete('filaResolucaoPagina'); }
    const consulta = parametros.toString();
    router.replace(consulta === '' ? `/empresas/${empresaId}` : `/empresas/${empresaId}?${consulta}`, { scroll: false });
  };
  const copiar = async (valor: string, nome: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success(`${nome} copiado.`);
    } catch {
      toast.error(`Não foi possível copiar ${nome.toLocaleLowerCase('pt-BR')}.`);
    }
  };
  const documentos = useQuery({
    queryKey: ['sessao', 'eu', 'documentos-fiscais', empresaId, pagina, filtro],
    queryFn: () => listarDocumentosFiscais(empresaId, pagina, filtro),
  });
  const ciencias=useQuery({queryKey:['sessao','eu','ciencias-emissao',empresaId],queryFn:()=>listarCienciasDaEmissao(empresaId)});
  const detalheCiencia=useQuery({queryKey:['sessao','eu','ciencia-emissao',empresaId,cienciaSelecionada],queryFn:()=>obterCienciaDaEmissao(empresaId,cienciaSelecionada!),enabled:cienciaSelecionada!==null});
  const retomarCiencia=useMutation({mutationFn:(id:string)=>retomarCienciaDaEmissao(empresaId,id),onSuccess:()=>{toast.success('Retomada técnica agendada.');void queryClient.invalidateQueries({queryKey:['sessao','eu','ciencias-emissao',empresaId]});},onError:()=>toast.error('Não foi possível solicitar a retomada técnica.')});
  if (documentos.isPending) {
    return (
      <section aria-busy="true" className="mt-lg flex flex-col gap-md">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-52 w-full" />
      </section>
    );
  }
  if (documentos.isError) {
    const problema = documentos.error instanceof ErroDaApi ? documentos.error.problema : null;
    return (
      <section className="mt-lg rounded-lg border border-border bg-card p-lg">
        <h3 className="font-display text-title-md text-foreground">Documentos fiscais</h3>
        <ErroDeTela
          titulo="Não foi possível carregar os documentos"
          descricao={problema === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoCodigo(problema.code)}
          correlationId={problema?.correlationId}
          acao={
            <Button className="mt-md" variante="contorno" onClick={() => void documentos.refetch()}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          }
        />
      </section>
    );
  }
  return <section aria-labelledby="fiscal-documents-title" className="mt-xl flex flex-col gap-md">
    <header className="flex flex-wrap items-end justify-between gap-md border-t border-border pt-lg">
      <div>
        <p className="text-label-sm uppercase tracking-wide text-muted-foreground">Documentos fiscais · integridade e processamento</p>
        <h3 id="fiscal-documents-title" className="mt-xs font-display text-title-lg text-foreground">Documentos fiscais</h3>
        <p className="mt-xs max-w-2xl text-body-sm text-muted-foreground">XML original preservado, dados normalizados e pendências técnicas rastreáveis. Este painel não calcula tributos.</p>
      </div>
      <div className="flex min-w-56 items-center gap-sm rounded-md border border-input bg-background px-sm">
        <ListFilter aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <Select rotulo="Estado do processamento" opcoes={opcoesDeEstado} valor={filtro} onValorChange={(valor) => atualizarUrl('documentosEstado', valor, true)} />
      </div>
    </header>
    <FilaResolucaoTributaria empresaId={empresaId} onAbrirDocumento={(id) => setDocumentoSelecionadoNaFila(id)} />
    <section aria-labelledby="acknowledgements-title" className="flex flex-col gap-sm border-t border-border pt-lg">
      <div><h4 id="acknowledgements-title" className="font-display text-title-md text-foreground">Ciência da Emissão</h4><p className="mt-xs max-w-2xl text-body-sm text-muted-foreground">Resumos de NF-e destinados à empresa, tentativas técnicas e recuperação do XML completo.</p></div>
      {ciencias.isPending?<div aria-busy="true"><Skeleton className="h-20 w-full"/></div>:null}
      {ciencias.isError?<ErroDeTela titulo="Não foi possível carregar Ciências" descricao="Tente novamente em instantes." acao={<Button variante="contorno" onClick={()=>void ciencias.refetch()}><RefreshCw aria-hidden="true"/>Tentar novamente</Button>}/>:null}
      {ciencias.data?.itens.length===0?<p className="text-body-sm text-muted-foreground">Nenhum resumo aguardando manifestação automática.</p>:null}
        {ciencias.data?.itens.length? <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full min-w-[760px] text-left text-body-sm"><caption className="sr-only">Ciência automática e recuperação de NF-e</caption><thead className="bg-muted/60 text-label-sm text-muted-foreground"><tr><th scope="col" className="px-md py-sm">Estado</th><th scope="col" className="px-md py-sm">Chave de acesso</th><th scope="col" className="px-md py-sm">NSU do resumo</th><th scope="col" className="px-md py-sm">Tentativas totais</th><th scope="col" className="px-md py-sm">Protocolo e próxima ação</th></tr></thead><tbody>{ciencias.data.itens.map((item)=><Fragment key={item.id}><tr className="border-t border-border/70"><td className="px-md py-sm"><StatusBadge tom={tomCiencia[item.estado]} rotulo={rotuloCiencia[item.estado]}/><span className="mt-xs block text-label-sm text-muted-foreground">Atualizado {dataHora(item.atualizado_em)}</span></td><td className="max-w-64 break-all px-md py-sm font-mono text-label-sm">{item.chave_acesso?`${item.chave_acesso.slice(0,6)}…${item.chave_acesso.slice(-4)}`:'Identidade inválida'}</td><td className="px-md py-sm font-mono text-label-sm">{item.nsu_resumo}</td><td className="px-md py-sm tabular-nums">Ciência {item.tentativas_ciencia} · XML {item.tentativas_xml}</td><td className="px-md py-sm"><span className="block">{item.protocolo?`${item.ambiente??'Ambiente'} · ${item.protocolo}`:item.motivo_sanitizado??item.codigo??'—'}</span>{item.proxima_tentativa_em?<span className="text-label-sm text-muted-foreground">Nova tentativa {dataHora(item.proxima_tentativa_em)}</span>:null}<div className="mt-xs flex flex-wrap gap-xs"><Button variante="contorno" tamanho="compacto" onClick={()=>setCienciaSelecionada(cienciaSelecionada===item.id?null:item.id)} aria-expanded={cienciaSelecionada===item.id}>{cienciaSelecionada===item.id?'Fechar histórico':'Histórico e detalhes'}</Button>{podeReprocessar&&!somenteLeitura&&['DLQ','RESULTADO_INCERTO','RETRY_AGENDADO'].includes(item.estado)?<Button variante="contorno" tamanho="compacto" disabled={retomarCiencia.isPending} onClick={()=>retomarCiencia.mutate(item.id)}>Retomar tecnicamente</Button>:null}</div></td></tr>{cienciaSelecionada===item.id?<tr className="border-t border-border bg-muted/20"><td colSpan={5} className="p-md">{detalheCiencia.isPending?<div aria-busy="true"><Skeleton className="h-20 w-full"/></div>:null}{detalheCiencia.isError?<ErroDeTela titulo="Histórico indisponível" descricao="Tente novamente em instantes."/>:null}{detalheCiencia.data?<div className="grid gap-lg lg:grid-cols-2"><section><h5 className="font-display text-title-sm text-foreground">Histórico</h5><ol className="mt-sm space-y-xs">{detalheCiencia.data.historico.map((event,index)=><li key={`${String(event['ocorrido_em'])}-${index}`} className="border-t border-border/70 pt-xs"><span className="font-medium text-foreground">{String(event['estado']??'Estado')}</span><span className="ml-sm text-label-sm text-muted-foreground">{dataHora(String(event['ocorrido_em']??''))} · tentativa {String(event['tentativa']??'0')}</span>{event['protocolo']?<span className="ml-sm font-mono text-label-sm">{String(event['protocolo'])}</span>:null}</li>)}</ol></section><section><h5 className="font-display text-title-sm text-foreground">Tentativas</h5><ul className="mt-sm space-y-xs">{detalheCiencia.data.tentativas.map((attempt,index)=><li key={`${String(attempt['etapa'])}-${String(attempt['tentativa'])}-${index}`} className="border-t border-border/70 pt-xs">{String(attempt['etapa'])} · {String(attempt['resultado'])} · {String(attempt['codigo']??'sem código')} · {dataHora(String(attempt['finalizada_em']??''))}</li>)}</ul></section></div>:null}</td></tr>:null}</Fragment>)}</tbody></table></div>:null}
    </section>
    <ListaDocumentosFiscais empresaId={empresaId} items={documentos.data.itens} pagina={pagina} filtro={filtro} proximaPagina={documentos.data.temProximaPagina}
      somenteLeitura={somenteLeitura} podeReprocessar={podeReprocessar} podeResolver={podeResolverTributos}
      documentoInicialSelecionado={documentoSelecionadoNaFila} aoFecharDocumentoExterno={() => setDocumentoSelecionadoNaFila(null)}
      aoPaginar={(page) => atualizarUrl('documentosPagina', String(page))} aoCopiar={copiar} />
    {abaAtual==='captura-dfe'?<InboxDeManifestacoes empresaId={empresaId} permitirDecisao={!somenteLeitura && (permitirDecisao ?? false)} />:null}
  </section>;
};
