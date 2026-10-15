'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Download, FileCheck2, RefreshCw, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select, type OpcaoDoSelect } from '@/components/ui/select';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { baixarOriginalFiscal, listarDocumentosFiscais, obterDocumentoFiscal, reprocessarDocumentoFiscal, verificarIntegridadeFiscal, type DocumentoFiscal } from './api';

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

export const PainelDeDocumentosFiscais = ({ empresaId, somenteLeitura, podeReprocessar }: {
  empresaId: string;
  somenteLeitura: boolean;
  podeReprocessar: boolean;
}) => {
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const detalhe = useQuery({
    queryKey: ['sessao', 'eu', 'documento-fiscal', empresaId, selecionado],
    queryFn: async () => {
      if (selecionado === null) throw new Error('Selecione um documento fiscal para consultar.');
      return obterDocumentoFiscal(empresaId, selecionado);
    },
    enabled: selecionado !== null,
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
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <Select rotulo="Estado do processamento" opcoes={opcoesDeEstado} valor={filtro} onValorChange={(valor) => atualizarUrl('documentosEstado', valor, true)} />
      </div>
    </header>
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
                            onClick={() => setSelecionado((previous) => previous === item.id ? null : item.id)}>
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
                                  <dt className="text-muted-foreground">Tamanho original</dt><dd className="tabular-nums text-foreground">{new Intl.NumberFormat('pt-BR').format(detalhe.data.tamanho_bytes)} bytes</dd>
                                  <dt className="text-muted-foreground">IBS/CBS</dt><dd className="text-foreground">{detalhe.data.estado === 'PENDENTE_IBS_CBS' ? 'Dados ausentes ou incompletos' : 'Valores extraídos do XML'}</dd>
                                </dl>
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
                                <h4 className="font-display text-title-sm text-foreground">Itens e tributos presentes</h4>
                                {detalhe.data.itens.length ? (
                                  <div className="mt-sm overflow-x-auto">
                                    <table className="w-full min-w-[440px] text-body-sm">
                                      <thead className="text-label-sm text-muted-foreground"><tr><th scope="col" className="py-xs text-left">Item</th><th scope="col" className="py-xs text-right">Valor</th><th scope="col" className="py-xs text-right">IBS</th><th scope="col" className="py-xs text-right">CBS</th></tr></thead>
                                      <tbody>{detalhe.data.itens.map((line, index) => (
                                        <tr key={index} className="border-t border-border/60">
                                          <td className="max-w-48 py-xs pr-sm"><span className="block truncate text-foreground">{String(line['descricao'] ?? 'Item sem descrição')}</span><span className="text-label-sm text-muted-foreground">{String(line['codigo'] ?? '—')}</span></td>
                                          <td className="py-xs text-right tabular-nums">{moedaFiscal(typeof line['valor'] === 'string' ? line['valor'] : null)}</td>
                                          <td className="py-xs text-right tabular-nums">{moedaFiscal(typeof line['ibs'] === 'string' ? line['ibs'] : null)}</td>
                                          <td className="py-xs text-right tabular-nums">{moedaFiscal(typeof line['cbs'] === 'string' ? line['cbs'] : null)}</td>
                                        </tr>
                                      ))}</tbody>
                                    </table>
                                  </div>
                                ) : <p className="mt-sm text-body-sm text-muted-foreground">Sem itens estruturados neste layout.</p>}
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
    <nav aria-label="Paginação de documentos fiscais" className="flex items-center justify-between gap-sm">
      <Button variante="contorno" disabled={pagina === 1} onClick={() => atualizarUrl('documentosPagina', String(Math.max(1, pagina - 1)))}>Página anterior</Button>
      <span aria-live="polite" className="text-body-sm text-muted-foreground">Página {pagina}</span>
      <Button variante="contorno" disabled={!documentos.data.temProximaPagina} onClick={() => atualizarUrl('documentosPagina', String(pagina + 1))}>Próxima página</Button>
    </nav>
  </section>;
};
