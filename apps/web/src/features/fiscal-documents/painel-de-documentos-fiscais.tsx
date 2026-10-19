'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Download, FileCheck2, RefreshCw, ListFilter } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select, type OpcaoDoSelect } from '@/components/ui/select';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { InboxDeManifestacoes } from './inbox-de-manifestacoes';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { baixarOriginalFiscal, listarDocumentosFiscais, obterDocumentoFiscal, reprocessarDocumentoFiscal, verificarIntegridadeFiscal, listarCienciasDaEmissao, obterCienciaDaEmissao, retomarCienciaDaEmissao, listarResolucaoTributaria, processarResolucaoTributaria, compararResolucaoTributaria, type DocumentoFiscal, type CienciaDaEmissaoUI } from './api';

const rotulo: Record<DocumentoFiscal['estado'], string> = {
  PENDENTE: 'Pendente', PROCESSANDO: 'Em processamento',
  PROCESSADO: 'Processado', PENDENTE_LAYOUT: 'Layout pendente', PENDENTE_IBS_CBS: 'IBS/CBS pendente',
  XML_INVALIDO: 'XML inválido', CONFLITO: 'Conflito de identidade', FALHA: 'Falha no processamento',
};
const tom: Record<DocumentoFiscal['estado'], TomDoStatus> = {
  PENDENTE: 'atencao', PROCESSANDO: 'atencao',
  PROCESSADO: 'conforme', PENDENTE_LAYOUT: 'atencao', PENDENTE_IBS_CBS: 'atencao',
  XML_INVALIDO: 'critico', CONFLITO: 'critico', FALHA: 'critico',
};
const opcoesDeEstado: readonly OpcaoDoSelect[] = [
  { valor: 'TODOS', rotulo: 'Todos os estados' },
  ...Object.entries(rotulo).map(([valor, label]) => ({ valor, rotulo: label })),
];
const estadosValidos = new Set(opcoesDeEstado.map((opcao) => opcao.valor));
const data = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(`${value.slice(0,10)}T12:00:00-03:00`)) : '—';
const dataHora = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : '—';
const moedaFiscal = (value: string | null) => {
  if (value === null) return '—';
  const [integer = '0', fraction = ''] = value.split('.');
  const negative = integer.startsWith('-');
  const digits = integer.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `R$ ${negative ? '-' : ''}${digits},${fraction.padEnd(2,'0')}`;
};
const rotuloCiencia:Record<CienciaDaEmissaoUI['estado'],string>={RESUMO_CAPTURADO:'Resumo capturado',CIENCIA_PENDENTE:'Aguardando Ciência',CIENCIA_EM_ENVIO:'Enviando Ciência',CIENCIA_REGISTRADA:'Ciência registrada',XML_COMPLETO_PENDENTE:'Aguardando XML completo',XML_COMPLETO_OBTIDO:'XML completo obtido',PARSEADO:'Encaminhado à F18',JA_MANIFESTADO:'Já manifestado',XML_COMPLETO_JA_DISPONIVEL:'XML já disponível',RESULTADO_INCERTO:'Resultado incerto',RETRY_AGENDADO:'Nova tentativa agendada',REJEITADO:'Rejeitado',IMPEDIDO:'Impedido',DLQ:'Fila de falhas'};
const tomCiencia:Record<CienciaDaEmissaoUI['estado'],TomDoStatus>={RESUMO_CAPTURADO:'atencao',CIENCIA_PENDENTE:'atencao',CIENCIA_EM_ENVIO:'atencao',CIENCIA_REGISTRADA:'conforme',XML_COMPLETO_PENDENTE:'atencao',XML_COMPLETO_OBTIDO:'conforme',PARSEADO:'conforme',JA_MANIFESTADO:'atencao',XML_COMPLETO_JA_DISPONIVEL:'conforme',RESULTADO_INCERTO:'critico',RETRY_AGENDADO:'atencao',REJEITADO:'critico',IMPEDIDO:'critico',DLQ:'critico'};

export const PainelDeDocumentosFiscais = ({ empresaId, somenteLeitura, podeReprocessar, permitirDecisao, podeResolverTributos = false }: {
  empresaId: string;
  somenteLeitura: boolean;
  podeReprocessar: boolean;
  permitirDecisao?: boolean;
  podeResolverTributos?: boolean;
}) => {
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [motivoReprocessamento, setMotivoReprocessamento] = useState('');
  const [comparacaoSelecionada, setComparacaoSelecionada] = useState<{ de: number; para: number } | null>(null);
  const [chaveIdempotencia, setChaveIdempotencia] = useState<string | null>(null);
  const [cienciaSelecionada,setCienciaSelecionada]=useState<string|null>(null);
  const router = useRouter();
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
    if (resetarPagina) parametros.delete('documentosPagina');
    const consulta = parametros.toString();
    router.replace(consulta === '' ? `/empresas/${empresaId}` : `/empresas/${empresaId}?${consulta}`, { scroll: false });
  };
  const queryClient = useQueryClient();
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
  const detalhe = useQuery({
    queryKey: ['sessao', 'eu', 'documento-fiscal', empresaId, selecionado],
    queryFn: async () => {
      if (selecionado === null) throw new Error('Selecione um documento fiscal para consultar.');
      return obterDocumentoFiscal(empresaId, selecionado);
    },
    enabled: selecionado !== null,
  });
  const snapshotsTributarios = useQuery({
    queryKey: ['sessao', 'eu', 'resolucao-tributaria', empresaId, selecionado],
    queryFn: () => listarResolucaoTributaria(empresaId, selecionado!),
    enabled: selecionado !== null && detalhe.data !== undefined,
  });
  const processarTributario = useMutation({
    mutationFn: (idempotencyKey: string) => {
      if (!selecionado || !detalhe.data) throw new Error('Documento fiscal indisponível.');
      const houveSnapshot = (snapshotsTributarios.data?.itens.length ?? 0) > 0;
      const motivo = motivoReprocessamento.trim();
      return processarResolucaoTributaria(empresaId, selecionado, {
        expectedDocumentRevision: detalhe.data.parser_version,
        idempotencyKey,
        ...(houveSnapshot ? { reprocessingReason: motivo } : {}),
      });
    },
    onSuccess: async (result) => {
      setMotivoReprocessamento('');
      setComparacaoSelecionada(null);
      setChaveIdempotencia(null);
      await queryClient.invalidateQueries({ queryKey: ['sessao', 'eu', 'resolucao-tributaria', empresaId, selecionado] });
      toast.success(result.reused ? `Revisão ${result.revision} já estava registrada.` : `Revisão ${result.revision} registrada; itens sem contexto suficiente ficaram indeterminados.`);
    },
    onError: (error: unknown) => {
      const problema = error instanceof ErroDaApi ? error.problema : null;
      toast.error(problema?.code === 'TAX_RESOLUTION_REPROCESSING_REASON_REQUIRED'
        ? 'Informe um motivo com pelo menos 10 caracteres para reprocessar.'
        : problema?.code === 'TAX_RESOLUTION_DOCUMENT_REVISION_MISMATCH'
          ? 'O documento mudou; atualize os detalhes antes de processar.'
          : 'Não foi possível registrar a resolução tributária.');
    },
  });
  const compararTributario = useQuery({
    queryKey: ['sessao', 'eu', 'resolucao-tributaria-comparacao', empresaId, selecionado, comparacaoSelecionada],
    queryFn: () => compararResolucaoTributaria(empresaId, selecionado!, comparacaoSelecionada!.de, comparacaoSelecionada!.para),
    enabled: selecionado !== null && comparacaoSelecionada !== null,
  });
  const integridade = useMutation({
    mutationFn: (id: string) => verificarIntegridadeFiscal(empresaId, id),
    onSuccess: () => toast.success('Integridade do XML confirmada pelo SHA-256.'),
    onError: (error: unknown) => {
      const problema = error instanceof ErroDaApi ? error.problema : null;
      toast.error(problema?.code === 'FISCAL_DOCUMENT_INTEGRITY_MISMATCH'
        ? 'O hash do XML original diverge do documento armazenado.'
        : 'Não foi possível confirmar a integridade do original.');
    },
  });
  const reprocessar = useMutation({
    mutationFn: (id: string) => reprocessarDocumentoFiscal(empresaId, id),
    onSuccess: () => {
      toast.success('Documento adicionado à fila de reprocessamento.');
      void queryClient.invalidateQueries({ queryKey: ['sessao', 'eu', 'documentos-fiscais', empresaId] });
    },
    onError: (error: unknown) => {
      const problema = error instanceof ErroDaApi ? error.problema : null;
      toast.error(problema?.code === 'FISCAL_REPROCESS_ALREADY_QUEUED'
        ? 'Este documento já está na fila de reprocessamento.'
        : 'Não foi possível solicitar o reprocessamento.');
    },
  });
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
  const rows = documentos.data.itens;
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
    <section aria-labelledby="acknowledgements-title" className="flex flex-col gap-sm border-t border-border pt-lg">
      <div><h4 id="acknowledgements-title" className="font-display text-title-md text-foreground">Ciência da Emissão</h4><p className="mt-xs max-w-2xl text-body-sm text-muted-foreground">Resumos de NF-e destinados à empresa, tentativas técnicas e recuperação do XML completo.</p></div>
      {ciencias.isPending?<div aria-busy="true"><Skeleton className="h-20 w-full"/></div>:null}
      {ciencias.isError?<ErroDeTela titulo="Não foi possível carregar Ciências" descricao="Tente novamente em instantes." acao={<Button variante="contorno" onClick={()=>void ciencias.refetch()}><RefreshCw aria-hidden="true"/>Tentar novamente</Button>}/>:null}
      {ciencias.data?.itens.length===0?<p className="text-body-sm text-muted-foreground">Nenhum resumo aguardando manifestação automática.</p>:null}
        {ciencias.data?.itens.length? <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full min-w-[760px] text-left text-body-sm"><caption className="sr-only">Ciência automática e recuperação de NF-e</caption><thead className="bg-muted/60 text-label-sm text-muted-foreground"><tr><th scope="col" className="px-md py-sm">Estado</th><th scope="col" className="px-md py-sm">Chave de acesso</th><th scope="col" className="px-md py-sm">NSU do resumo</th><th scope="col" className="px-md py-sm">Tentativas totais</th><th scope="col" className="px-md py-sm">Protocolo e próxima ação</th></tr></thead><tbody>{ciencias.data.itens.map((item)=><Fragment key={item.id}><tr className="border-t border-border/70"><td className="px-md py-sm"><StatusBadge tom={tomCiencia[item.estado]} rotulo={rotuloCiencia[item.estado]}/><span className="mt-xs block text-label-sm text-muted-foreground">Atualizado {dataHora(item.atualizado_em)}</span></td><td className="max-w-64 break-all px-md py-sm font-mono text-label-sm">{item.chave_acesso?`${item.chave_acesso.slice(0,6)}…${item.chave_acesso.slice(-4)}`:'Identidade inválida'}</td><td className="px-md py-sm font-mono text-label-sm">{item.nsu_resumo}</td><td className="px-md py-sm tabular-nums">Ciência {item.tentativas_ciencia} · XML {item.tentativas_xml}</td><td className="px-md py-sm"><span className="block">{item.protocolo?`${item.ambiente??'Ambiente'} · ${item.protocolo}`:item.motivo_sanitizado??item.codigo??'—'}</span>{item.proxima_tentativa_em?<span className="text-label-sm text-muted-foreground">Nova tentativa {dataHora(item.proxima_tentativa_em)}</span>:null}<div className="mt-xs flex flex-wrap gap-xs"><Button variante="contorno" tamanho="compacto" onClick={()=>setCienciaSelecionada(cienciaSelecionada===item.id?null:item.id)} aria-expanded={cienciaSelecionada===item.id}>{cienciaSelecionada===item.id?'Fechar histórico':'Histórico e detalhes'}</Button>{podeReprocessar&&!somenteLeitura&&['DLQ','RESULTADO_INCERTO','RETRY_AGENDADO'].includes(item.estado)?<Button variante="contorno" tamanho="compacto" disabled={retomarCiencia.isPending} onClick={()=>retomarCiencia.mutate(item.id)}>Retomar tecnicamente</Button>:null}</div></td></tr>{cienciaSelecionada===item.id?<tr className="border-t border-border bg-muted/20"><td colSpan={5} className="p-md">{detalheCiencia.isPending?<div aria-busy="true"><Skeleton className="h-20 w-full"/></div>:null}{detalheCiencia.isError?<ErroDeTela titulo="Histórico indisponível" descricao="Tente novamente em instantes."/>:null}{detalheCiencia.data?<div className="grid gap-lg lg:grid-cols-2"><section><h5 className="font-display text-title-sm text-foreground">Histórico</h5><ol className="mt-sm space-y-xs">{detalheCiencia.data.historico.map((event,index)=><li key={`${String(event['ocorrido_em'])}-${index}`} className="border-t border-border/70 pt-xs"><span className="font-medium text-foreground">{String(event['estado']??'Estado')}</span><span className="ml-sm text-label-sm text-muted-foreground">{dataHora(String(event['ocorrido_em']??''))} · tentativa {String(event['tentativa']??'0')}</span>{event['protocolo']?<span className="ml-sm font-mono text-label-sm">{String(event['protocolo'])}</span>:null}</li>)}</ol></section><section><h5 className="font-display text-title-sm text-foreground">Tentativas</h5><ul className="mt-sm space-y-xs">{detalheCiencia.data.tentativas.map((attempt,index)=><li key={`${String(attempt['etapa'])}-${String(attempt['tentativa'])}-${index}`} className="border-t border-border/70 pt-xs">{String(attempt['etapa'])} · {String(attempt['resultado'])} · {String(attempt['codigo']??'sem código')} · {dataHora(String(attempt['finalizada_em']??''))}</li>)}</ul></section></div>:null}</td></tr>:null}</Fragment>)}</tbody></table></div>:null}
    </section>
    {rows.length === 0 ? (
      <EmptyState
        nivel={3}
        icone={<FileCheck2 />}
        titulo={filtro === 'TODOS' ? 'Nenhum documento fiscal encontrado' : 'Nenhum documento neste filtro'}
        descricao="Os documentos elegíveis da captura aparecem aqui conforme o processamento avança."
      />
    ) : (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-body-sm">
            <caption className="sr-only">Documentos fiscais capturados e processados para esta empresa</caption>
            <thead className="bg-muted/60 text-label-sm text-muted-foreground">
              <tr>
                <th scope="col" className="px-md py-sm">Estado</th>
                <th scope="col" className="px-md py-sm">Documento</th>
                <th scope="col" className="px-md py-sm">Emissão</th>
                <th scope="col" className="px-md py-sm">NSU e atividade</th>
                <th scope="col" className="px-md py-sm">Emitente</th>
                <th scope="col" className="px-md py-sm text-right">Total</th>
                <th scope="col" className="px-md py-sm">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const emProcessamento = item.estado === 'PENDENTE' || item.estado === 'PROCESSANDO';
                return (
                  <Fragment key={item.id}>
                    <tr className="border-t border-border/70 align-middle hover:bg-muted/30">
                      <td className="px-md py-sm"><StatusBadge tom={tom[item.estado]} rotulo={rotulo[item.estado]} /></td>
                      <td className="px-md py-sm">
                        <span className="block font-medium text-foreground">{item.especie === 'NFE_55' ? 'NF-e · modelo 55' : 'CT-e · modelo 57'}</span>
                        <span className="font-mono text-label-sm text-muted-foreground">Chave {item.chave_acesso ?? 'indisponível'}</span>
                      </td>
                      <td className="px-md py-sm tabular-nums">{data(item.emitido_em)}</td>
                      <td className="px-md py-sm">
                        <span className="block font-mono text-label-sm text-foreground">{item.nsu ?? '—'}</span>
                        <span className="text-label-sm text-muted-foreground">Atividade {dataHora(item.atividade_em)}</span>
                      </td>
                      <td className="max-w-48 truncate px-md py-sm">{item.emitente ?? '—'}</td>
                      <td className="px-md py-sm text-right tabular-nums">{moedaFiscal(item.total)}</td>
                      <td className="px-md py-sm">
                        <div className="flex items-center gap-xs">
                          <Button variante="contorno" tamanho="compacto" aria-expanded={selecionado === item.id}
                            aria-label={emProcessamento ? 'Detalhes disponíveis após o processamento' : selecionado === item.id ? 'Fechar detalhes' : 'Abrir detalhes'}
                            className="min-h-11 min-w-11"
                            disabled={emProcessamento}
                            onClick={() => {
                              setSelecionado((previous) => previous === item.id ? null : item.id);
                              setMotivoReprocessamento('');
                              setComparacaoSelecionada(null);
                              setChaveIdempotencia(null);
                            }}>
                            {selecionado === item.id ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                          </Button>
                          <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11" aria-label="Verificar integridade"
                            disabled={emProcessamento || integridade.isPending} onClick={() => integridade.mutate(item.id)}>
                            <Check aria-hidden="true" />
                          </Button>
                          <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11" aria-label="Baixar XML original" disabled={emProcessamento}
                            onClick={() => void baixarOriginalFiscal(empresaId, item.id).catch(() => toast.error('Download indisponível.'))}>
                            <Download aria-hidden="true" />
                          </Button>
                          {podeReprocessar ? (
                            <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11" aria-label="Reprocessar documento"
                              disabled={emProcessamento || somenteLeitura || reprocessar.isPending}
                              onClick={() => reprocessar.mutate(item.id)}>
                              <RefreshCw aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {selecionado === item.id ? (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={7} className="p-md">
                          {detalhe.isPending ? <div aria-busy="true"><Skeleton className="h-20 w-full" /></div> : null}
                          {detalhe.isError ? (
                            <ErroDeTela titulo="Não foi possível abrir os detalhes" descricao="Tente novamente em instantes." />
                          ) : null}
                          {detalhe.data ? (
                            <div className="space-y-lg">
                            <div className="grid gap-lg lg:grid-cols-[1fr_1.3fr]">
                              <section>
                                <h4 className="font-display text-title-sm text-foreground">Resumo normalizado</h4>
                                <dl className="mt-sm grid grid-cols-[auto_1fr] gap-x-md gap-y-xs text-body-sm">
                                  <dt className="text-muted-foreground">Chave de acesso</dt>
                                  <dd className="flex min-w-0 items-start gap-xs text-foreground">
                                    <code className="break-all font-mono text-code-sm">{detalhe.data.chave_acesso ?? '—'}</code>
                                    {detalhe.data.chave_acesso ? (
                                      <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11 shrink-0" aria-label="Copiar chave de acesso" onClick={() => void copiar(detalhe.data.chave_acesso ?? '', 'Chave de acesso')}>
                                        <Copy aria-hidden="true" />
                                      </Button>
                                    ) : null}
                                  </dd>
                                  <dt className="text-muted-foreground">Hash SHA-256</dt>
                                  <dd className="flex min-w-0 items-start gap-xs text-foreground">
                                    <code className="break-all font-mono text-code-sm">{detalhe.data.hash_sha256}</code>
                                    <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11 shrink-0" aria-label="Copiar hash SHA-256" onClick={() => void copiar(detalhe.data.hash_sha256, 'Hash SHA-256')}>
                                      <Copy aria-hidden="true" />
                                    </Button>
                                  </dd>
                                  <dt className="text-muted-foreground">Destinatário</dt><dd className="text-foreground">{detalhe.data.destinatario ?? '—'}</dd>
                                  <dt className="text-muted-foreground">Layout</dt><dd className="text-foreground">{item.versao_layout ?? '—'}</dd>
                                  <dt className="text-muted-foreground">Protocolo</dt><dd className="text-foreground">{detalhe.data.protocolo ?? '—'}</dd>
                                  <dt className="text-muted-foreground">Recebido em</dt><dd className="text-foreground">{dataHora(detalhe.data.protocolo_recebido_em)}</dd>
                                  <dt className="text-muted-foreground">Tamanho original</dt><dd className="tabular-nums text-foreground">{new Intl.NumberFormat('pt-BR').format(detalhe.data.tamanho_bytes)} bytes</dd>
                                  <dt className="text-muted-foreground">IBS/CBS</dt><dd className="text-foreground">{detalhe.data.estado === 'PENDENTE_IBS_CBS' ? 'Dados ausentes ou incompletos' : 'Valores extraídos do XML'}</dd>
                                  <dt className="text-muted-foreground">Base IBS/CBS</dt><dd className="tabular-nums text-foreground">{moedaFiscal(detalhe.data.base_ibs_cbs)}</dd>
                                  <dt className="text-muted-foreground">Total IBS</dt><dd className="tabular-nums text-foreground">{moedaFiscal(detalhe.data.total_ibs)}</dd>
                                  <dt className="text-muted-foreground">Total CBS</dt><dd className="tabular-nums text-foreground">{moedaFiscal(detalhe.data.total_cbs)}</dd>
                                </dl>
                                {detalhe.data.referencias.length ? (
                                  <div className="mt-sm">
                                    <h5 className="text-label-sm text-muted-foreground">Documentos referenciados</h5>
                                    <ul className="mt-xs space-y-1 text-body-sm text-foreground">
                                      {detalhe.data.referencias.map((referencia) => (
                                        <li key={`${referencia.tipo}-${referencia.chave}`} className="break-all">{referencia.tipo}: {referencia.chave}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                {detalhe.data.partes.length ? (
                                  <section className="mt-md">
                                    <h4 className="font-display text-title-sm text-foreground">Partes e localização declarada</h4>
                                    <dl className="mt-xs grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-sm gap-y-1 text-body-sm">
                                      {detalhe.data.partes.map((parte) => (
                                        <Fragment key={parte.papel}>
                                          <dt className="text-muted-foreground">{parte.papel === 'EMITENTE' ? 'Emitente' : 'Destinatário'}</dt>
                                          <dd className="min-w-0 break-words text-foreground">
                                            <span className="block">{parte.nome ?? 'Nome não informado'}{parte.identificador ? ` · ${parte.identificador}` : ''}</span>
                                            <span className="block text-label-sm text-muted-foreground">
                                              {[parte.logradouro, parte.numero, parte.complemento, parte.bairro, parte.municipio, parte.uf, parte.cep].filter(Boolean).join(', ') || 'Endereço não informado'}
                                            </span>
                                          </dd>
                                        </Fragment>
                                      ))}
                                    </dl>
                                  </section>
                                ) : null}
                                {detalhe.data.estado === 'PENDENTE_IBS_CBS' ? (
                                  <p className="mt-sm flex items-start gap-xs rounded-md border border-warning/40 bg-warning/10 p-sm text-body-sm text-foreground">
                                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                                    Documento preservado como pendente; nenhum valor foi presumido.
                                  </p>
                                ) : null}
                                <p className="mt-sm text-label-sm text-muted-foreground">
                                  {detalhe.data.origens.length} origem(ns) · última captura {dataHora(detalhe.data.origens.at(-1)?.capturado_em ?? null)}
                                </p>
                              </section>
                              <section>
                                <h4 className="font-display text-title-sm text-foreground">Itens e componentes</h4>
                                {detalhe.data.itens.length ? (
                                  <div className="mt-sm overflow-x-auto">
                                    <table className="w-full min-w-[320px] text-body-sm">
                                      <thead className="text-label-sm text-muted-foreground"><tr><th scope="col" className="py-xs text-left">Descrição</th><th scope="col" className="py-xs text-right">Valor</th></tr></thead>
                                      <tbody>{detalhe.data.itens.map((line, index) => (
                                        <tr key={index} className="border-t border-border/60">
                                          <td className="max-w-48 py-xs pr-sm"><span className="block truncate text-foreground">{String(line['descricao'] ?? 'Item sem descrição')}</span><span className="text-label-sm text-muted-foreground">{line['tipo'] === 'COMPONENTE' ? 'Componente do frete' : line['tipo'] === 'MEDIDA_CARGA' ? 'Medida da carga' : String(line['codigo'] ?? '—')}</span></td>
                                          <td className="py-xs text-right tabular-nums">{moedaFiscal(typeof line['valor'] === 'string' ? line['valor'] : null)}</td>
                                        </tr>
                                      ))}</tbody>
                                    </table>
                                  </div>
                                ) : <p className="mt-sm text-body-sm text-muted-foreground">Sem itens estruturados neste layout.</p>}
                                {detalhe.data.tributos.length ? (
                                  <div className="mt-md overflow-x-auto">
                                    <h5 className="mb-xs text-label-sm text-muted-foreground">Tributos normalizados</h5>
                                    <table className="w-full min-w-[520px] text-body-sm">
                                      <thead className="text-label-sm text-muted-foreground"><tr><th scope="col" className="py-xs text-left">Escopo</th><th scope="col" className="py-xs text-left">Tributo</th><th scope="col" className="py-xs text-right">Base</th><th scope="col" className="py-xs text-right">Alíquota</th><th scope="col" className="py-xs text-right">Valor</th></tr></thead>
                                      <tbody>{detalhe.data.tributos.map((tributo, index) => (
                                        <tr key={`${tributo.escopo}-${tributo.numero_item ?? 'doc'}-${tributo.codigo}-${index}`} className="border-t border-border/60">
                                          <td className="py-xs text-muted-foreground">{tributo.escopo === 'ITEM' ? `Item ${tributo.numero_item}` : 'Documento'}</td>
                                          <td className="py-xs font-medium text-foreground">{tributo.codigo}{tributo.situacao ? ` · ${tributo.situacao}` : ''}</td>
                                          <td className="py-xs text-right tabular-nums">{moedaFiscal(tributo.base_calculo)}</td>
                                          <td className="py-xs text-right tabular-nums">{tributo.aliquota ? `${tributo.aliquota}%` : '—'}</td>
                                          <td className="py-xs text-right tabular-nums">{moedaFiscal(tributo.valor)}</td>
                                        </tr>
                                      ))}</tbody>
                                    </table>
                                  </div>
                                ) : null}
                              </section>
                            </div>
                            <section aria-labelledby="resolucao-tributaria-titulo" className="rounded-md border border-border bg-card p-md">
                              <div className="flex flex-wrap items-start justify-between gap-md">
                                <div>
                                  <h4 id="resolucao-tributaria-titulo" className="font-display text-title-sm text-foreground">Tratamento tributário por item</h4>
                                  <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">Registra fatos e decisões versionados. Contexto ausente ou cobertura não confirmada mantém o item indeterminado; esta resolução não apura valores devidos.</p>
                                </div>
                                {podeResolverTributos && !somenteLeitura ? (
                                  <Button variante="primaria" disabled={processarTributario.isPending || detalhe.data.estado !== 'PROCESSADO' || ((snapshotsTributarios.data?.itens.length ?? 0) > 0 && motivoReprocessamento.trim().length < 10)} onClick={() => {
                                    const idempotencyKey = chaveIdempotencia ?? crypto.randomUUID();
                                    setChaveIdempotencia(idempotencyKey);
                                    processarTributario.mutate(idempotencyKey);
                                  }}>
                                    {processarTributario.isPending ? 'Registrando…' : (snapshotsTributarios.data?.itens.length ?? 0) > 0 ? 'Reprocessar itens' : 'Processar itens'}
                                  </Button>
                                ) : null}
                              </div>
                              {snapshotsTributarios.isPending ? <div className="mt-md" aria-busy="true"><Skeleton className="h-16 w-full" /></div> : null}
                              {snapshotsTributarios.isError ? <div className="mt-md"><ErroDeTela titulo="Histórico de resolução indisponível" descricao="Tente novamente em instantes." /></div> : null}
                              {snapshotsTributarios.data && snapshotsTributarios.data.itens.length === 0 ? <p className="mt-md rounded-md border border-dashed border-border p-md text-body-sm text-muted-foreground">Nenhuma resolução foi registrada para este documento.</p> : null}
                              {snapshotsTributarios.data && snapshotsTributarios.data.itens.length > 0 ? (() => {
                                const revisoes = [...new Set(snapshotsTributarios.data.itens.map((snapshot) => snapshot.revision))].sort((a,b)=>b-a);
                                const ultima = revisoes[0] ?? 0;
                                const anterior = revisoes[1] ?? 0;
                                return <div className="mt-md space-y-md">
                                  {revisoes.length > 1 ? <div className="flex flex-wrap items-center gap-sm"><Button variante={comparacaoSelecionada?.para === ultima && comparacaoSelecionada.de === anterior ? 'primaria' : 'contorno'} tamanho="compacto" onClick={()=>setComparacaoSelecionada({de:anterior,para:ultima})}>Comparar revisões {anterior} → {ultima}</Button></div> : null}
                                  {comparacaoSelecionada ? compararTributario.isPending ? <div aria-busy="true"><Skeleton className="h-12 w-full" /></div> : compararTributario.isError ? <ErroDeTela titulo="Comparação indisponível" descricao="Tente novamente em instantes." /> : compararTributario.data ? <p role="status" className="rounded-md bg-muted/50 p-sm text-body-sm text-foreground">{compararTributario.data.diff.filter((item)=>item.changed).length} de {compararTributario.data.diff.length} itens com fatos ou decisões diferentes entre as revisões {comparacaoSelecionada.de} e {comparacaoSelecionada.para}.</p> : null : null}
                                  {revisoes.map((revision)=><section key={revision} className="rounded-md border border-border/70 p-md">
                                    <div className="flex flex-wrap items-center justify-between gap-sm"><h5 className="font-medium text-foreground">Revisão {revision}</h5><span className="text-label-sm text-muted-foreground">{dataHora(snapshotsTributarios.data.itens.find((snapshot)=>snapshot.revision===revision)?.processed_at ?? null)}</span></div>
                                    <ul className="mt-sm grid gap-sm md:grid-cols-2">{snapshotsTributarios.data.itens.filter((snapshot)=>snapshot.revision===revision).map((snapshot)=><li key={snapshot.id} className="rounded-md bg-muted/30 p-sm">
                                      <div className="flex flex-wrap items-center justify-between gap-xs"><span className="font-medium text-foreground">Item {snapshot.item_number}</span><StatusBadge tom={snapshot.decisions.every((decision)=>decision.status==='INDETERMINATE')?'atencao':'conforme'} rotulo={snapshot.decisions.every((decision)=>decision.status==='INDETERMINATE')?'Indeterminado':'Resolvido'} /></div>
                                      <ul className="mt-xs space-y-xs text-body-sm">{snapshot.decisions.map((decision)=><li key={decision.tax} className="border-t border-border/50 pt-xs"><span className="font-medium text-foreground">{decision.tax}</span><span className="ml-xs text-muted-foreground">{decision.status} · crédito {decision.creditEligibility}</span><p className="text-muted-foreground">{decision.rationale}</p>{decision.missingInputs.length ? <p className="text-muted-foreground">Dados ausentes: {decision.missingInputs.join(', ')}</p> : null}</li>)}</ul>
                                      {snapshot.package_sha256 ? <p className="mt-xs break-all font-mono text-label-sm text-muted-foreground">Pacote SHA-256: {snapshot.package_sha256}</p> : <p className="mt-xs text-label-sm text-muted-foreground">Sem pacote curado associado.</p>}
                                    </li>)}</ul>
                                  </section>)}
                                  {podeResolverTributos && !somenteLeitura ? <div className="max-w-2xl"><AreaDeTexto rotulo="Motivo do reprocessamento" obrigatorio value={motivoReprocessamento} onValorChange={setMotivoReprocessamento} maxLength={500} ajuda="Obrigatório a partir da segunda revisão; mínimo de 10 caracteres." /></div> : null}
                                </div>;
                              })() : null}
                            </section>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    )}
    {abaAtual==='captura-dfe'?<InboxDeManifestacoes empresaId={empresaId} permitirDecisao={!somenteLeitura && (permitirDecisao ?? false)} />:null}
    <nav aria-label="Paginação de documentos fiscais" className="flex items-center justify-between gap-sm">
      <Button variante="contorno" disabled={pagina === 1} onClick={() => atualizarUrl('documentosPagina', String(Math.max(1, pagina - 1)))}>Página anterior</Button>
      <span aria-live="polite" className="text-body-sm text-muted-foreground">Página {pagina}</span>
      <Button variante="contorno" disabled={!documentos.data.temProximaPagina} onClick={() => atualizarUrl('documentosPagina', String(pagina + 1))}>Próxima página</Button>
    </nav>
  </section>;
};
