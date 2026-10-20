'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Copy, Download, FileCheck2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import type { DocumentoFiscal, DocumentoFiscalDetalhe } from './api';
import { baixarOriginalFiscal, obterDocumentoFiscal, reprocessarDocumentoFiscal, verificarIntegridadeFiscal } from './api';
import { PainelResolucaoTributaria } from './painel-resolucao-tributaria';

const labels: Record<DocumentoFiscal['estado'], string> = {
  PENDENTE: 'Pendente', PROCESSANDO: 'Em processamento', PROCESSADO: 'Processado', PENDENTE_LAYOUT: 'Layout pendente',
  PENDENTE_IBS_CBS: 'IBS/CBS pendente', XML_INVALIDO: 'XML inválido', CONFLITO: 'Conflito de identidade', FALHA: 'Falha no processamento',
};
const tones: Record<DocumentoFiscal['estado'], TomDoStatus> = {
  PENDENTE: 'atencao', PROCESSANDO: 'atencao', PROCESSADO: 'conforme', PENDENTE_LAYOUT: 'atencao',
  PENDENTE_IBS_CBS: 'atencao', XML_INVALIDO: 'critico', CONFLITO: 'critico', FALHA: 'critico',
};
const data = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(`${value.slice(0,10)}T12:00:00-03:00`)) : '—';
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : '—';
const money = (value: string | null) => {
  if (value === null) return '—';
  const [integer = '0', fraction = ''] = value.split('.');
  const negative = integer.startsWith('-');
  const digits = integer.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `R$ ${negative ? '-' : ''}${digits},${fraction.padEnd(2, '0')}`;
};

export const ListaDocumentosFiscais = ({ empresaId, items, pagina, filtro, proximaPagina, somenteLeitura, podeReprocessar, podeResolver,
  documentoInicialSelecionado, aoFecharDocumentoExterno, aoPaginar, aoCopiar }: {
  empresaId: string; items: readonly DocumentoFiscal[]; pagina: number; filtro: string; proximaPagina: boolean;
  somenteLeitura: boolean; podeReprocessar: boolean; podeResolver: boolean;
  documentoInicialSelecionado: string | null;
  aoFecharDocumentoExterno: () => void;
  aoPaginar: (page: number) => void; aoCopiar: (value: string, name: string) => void;
}) => {
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null);
  const selected = documentoInicialSelecionado ?? selectedLocal;
  const setSelected = (id: string | null) => {
    if (documentoInicialSelecionado !== null) {
      aoFecharDocumentoExterno();
      if (id !== null) setSelectedLocal(id);
      return;
    }
    setSelectedLocal(id);
  };
  const details = useQuery({
    queryKey: ['sessao', 'eu', 'documento-fiscal', empresaId, selected],
    queryFn: () => selected ? obterDocumentoFiscal(empresaId, selected) : Promise.reject(new Error('Selecione um documento fiscal.')),
    enabled: selected !== null,
  });
  const queryClient = useQueryClient();
  const integrity = useMutation({ mutationFn: (id: string) => verificarIntegridadeFiscal(empresaId, id), onSuccess: () => toast.success('Integridade do XML confirmada pelo SHA-256.'), onError: (error: unknown) => { const problem = error instanceof ErroDaApi ? error.problema : null; toast.error(problem?.code === 'FISCAL_DOCUMENT_INTEGRITY_MISMATCH' ? 'O hash do XML original diverge do documento armazenado.' : 'Não foi possível confirmar a integridade do original.'); } });
  const retry = useMutation({ mutationFn: (id: string) => reprocessarDocumentoFiscal(empresaId, id), onSuccess: () => { toast.success('Documento adicionado à fila de reprocessamento.'); void queryClient.invalidateQueries({ queryKey: ['sessao', 'eu', 'documentos-fiscais', empresaId] }); }, onError: (error: unknown) => { const problem = error instanceof ErroDaApi ? error.problema : null; toast.error(problem?.code === 'FISCAL_REPROCESS_ALREADY_QUEUED' ? 'Este documento já está na fila de reprocessamento.' : 'Não foi possível solicitar o reprocessamento.'); } });
  return <section aria-label="Documentos fiscais capturados">
    {items.length === 0 ? <EmptyState nivel={3} icone={<FileCheck2 />} titulo={filtro === 'TODOS' ? 'Nenhum documento fiscal encontrado' : 'Nenhum documento neste filtro'} descricao="Os documentos elegíveis da captura aparecem aqui conforme o processamento avança." /> : (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"><div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left text-body-sm"><caption className="sr-only">Documentos fiscais capturados e processados para esta empresa</caption>
          <thead className="bg-muted/60 text-label-sm text-muted-foreground"><tr><th scope="col" className="px-md py-sm">Estado</th><th scope="col" className="px-md py-sm">Documento</th><th scope="col" className="px-md py-sm">Emissão</th><th scope="col" className="px-md py-sm">NSU e atividade</th><th scope="col" className="px-md py-sm">Emitente</th><th scope="col" className="px-md py-sm text-right">Total</th><th scope="col" className="px-md py-sm">Ações</th></tr></thead>
          <tbody>{items.map((item) => {
            const busy = item.estado === 'PENDENTE' || item.estado === 'PROCESSANDO';
            return <Fragment key={item.id}>
              <tr className="border-t border-border/70 align-middle hover:bg-muted/30">
                <td className="px-md py-sm"><StatusBadge tom={tones[item.estado]} rotulo={labels[item.estado]} /></td>
                <td className="px-md py-sm"><span className="block font-medium text-foreground">{item.especie === 'NFE_55' ? 'NF-e · modelo 55' : 'CT-e · modelo 57'}</span><span className="font-mono text-label-sm text-muted-foreground">Chave {item.chave_acesso ?? 'indisponível'}</span></td>
                <td className="px-md py-sm tabular-nums">{data(item.emitido_em)}</td>
                <td className="px-md py-sm"><span className="block font-mono text-label-sm text-foreground">{item.nsu ?? '—'}</span><span className="text-label-sm text-muted-foreground">Atividade {dateTime(item.atividade_em)}</span></td>
                <td className="max-w-48 truncate px-md py-sm">{item.emitente ?? '—'}</td><td className="px-md py-sm text-right tabular-nums">{money(item.total)}</td>
                <td className="px-md py-sm"><div className="flex items-center gap-xs">
                  <Button variante="contorno" tamanho="compacto" aria-expanded={selected === item.id} aria-label={busy ? 'Detalhes disponíveis após o processamento' : selected === item.id ? 'Fechar detalhes' : 'Abrir detalhes'} className="min-h-11 min-w-11" disabled={busy} onClick={() => setSelected(selected === item.id ? null : item.id)}>{selected === item.id ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</Button>
                  <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11" aria-label="Verificar integridade" disabled={busy || integrity.isPending} onClick={() => integrity.mutate(item.id)}><Check aria-hidden="true" /></Button>
                  <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11" aria-label="Baixar XML original" disabled={busy} onClick={() => void baixarOriginalFiscal(empresaId, item.id).catch(() => toast.error('Download indisponível.'))}><Download aria-hidden="true" /></Button>
                  {podeReprocessar ? <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11" aria-label="Reprocessar documento" disabled={busy || somenteLeitura || retry.isPending} onClick={() => retry.mutate(item.id)}><RefreshCw aria-hidden="true" /></Button> : null}
                </div></td>
              </tr>
              {selected === item.id ? <tr className="border-t border-border bg-muted/20"><td colSpan={7} className="p-md">
                {details.isPending ? <div aria-busy="true"><Skeleton className="h-20 w-full" /></div> : null}
                {details.isError ? <ErroDeTela titulo="Não foi possível abrir os detalhes" descricao="Tente novamente em instantes." /> : null}
                {details.data ? <DetalheFiscal empresaId={empresaId} documento={details.data} layout={item.versao_layout} podeResolver={podeResolver && !somenteLeitura} aoCopiar={aoCopiar} /> : null}
              </td></tr> : null}
            </Fragment>;
          })}</tbody>
        </table>
      </div></div>
    )}
    {selected !== null && !items.some((item) => item.id === selected) ? <section className="space-y-sm rounded-lg border border-border bg-muted/20 p-md" aria-label="Documento selecionado na fila tributária">
      <div className="flex items-center justify-between gap-sm"><h4 className="font-display text-title-sm text-foreground">Documento selecionado na fila</h4><Button variante="contorno" onClick={() => setSelected(null)}>Fechar detalhes</Button></div>
      {details.isPending ? <div aria-busy="true"><Skeleton className="h-20 w-full" /></div> : null}
      {details.isError ? <ErroDeTela titulo="Não foi possível abrir os detalhes" descricao="Tente novamente em instantes." /> : null}
      {details.data ? <DetalheFiscal empresaId={empresaId} documento={details.data} layout={null} podeResolver={podeResolver && !somenteLeitura} aoCopiar={aoCopiar} /> : null}
    </section> : null}
    <nav aria-label="Paginação de documentos fiscais" className="flex items-center justify-between gap-sm">
      <Button variante="contorno" disabled={pagina === 1} onClick={() => aoPaginar(Math.max(1, pagina - 1))}>Página anterior</Button><span aria-live="polite" className="text-body-sm text-muted-foreground">Página {pagina}</span><Button variante="contorno" disabled={!proximaPagina} onClick={() => aoPaginar(pagina + 1)}>Próxima página</Button>
    </nav>
  </section>;
};

const DetalheFiscal = ({ empresaId, documento, layout, podeResolver, aoCopiar }: { empresaId: string; documento: DocumentoFiscalDetalhe; layout: string | null; podeResolver: boolean; aoCopiar: (value: string, name: string) => void }) => (
  <div className="space-y-lg">
    <div className="grid gap-lg lg:grid-cols-[1fr_1.3fr]">
      <section><h4 className="font-display text-title-sm text-foreground">Resumo normalizado</h4>
        <dl className="mt-sm grid grid-cols-[auto_1fr] gap-x-md gap-y-xs text-body-sm">
          <dt className="text-muted-foreground">Chave de acesso</dt><dd className="flex min-w-0 items-start gap-xs text-foreground"><code className="break-all font-mono text-code-sm">{documento.chave_acesso ?? '—'}</code>{documento.chave_acesso ? <Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11 shrink-0" aria-label="Copiar chave de acesso" onClick={() => aoCopiar(documento.chave_acesso ?? '', 'Chave de acesso')}><Copy aria-hidden="true" /></Button> : null}</dd>
          <dt className="text-muted-foreground">Hash SHA-256</dt><dd className="flex min-w-0 items-start gap-xs text-foreground"><code className="break-all font-mono text-code-sm">{documento.hash_sha256}</code><Button variante="contorno" tamanho="compacto" className="min-h-11 min-w-11 shrink-0" aria-label="Copiar hash SHA-256" onClick={() => aoCopiar(documento.hash_sha256, 'Hash SHA-256')}><Copy aria-hidden="true" /></Button></dd>
          <dt className="text-muted-foreground">Destinatário</dt><dd className="text-foreground">{documento.destinatario ?? '—'}</dd><dt className="text-muted-foreground">Layout</dt><dd className="text-foreground">{layout ?? '—'}</dd>
          <dt className="text-muted-foreground">Protocolo</dt><dd className="text-foreground">{documento.protocolo ?? '—'}</dd><dt className="text-muted-foreground">Recebido em</dt><dd className="text-foreground">{dateTime(documento.protocolo_recebido_em)}</dd>
          <dt className="text-muted-foreground">Tamanho original</dt><dd className="tabular-nums text-foreground">{new Intl.NumberFormat('pt-BR').format(documento.tamanho_bytes)} bytes</dd><dt className="text-muted-foreground">IBS/CBS</dt><dd className="text-foreground">{documento.estado === 'PENDENTE_IBS_CBS' ? 'Dados ausentes ou incompletos' : 'Valores extraídos do XML'}</dd>
          <dt className="text-muted-foreground">Base IBS/CBS</dt><dd className="tabular-nums text-foreground">{money(documento.base_ibs_cbs)}</dd><dt className="text-muted-foreground">Total IBS</dt><dd className="tabular-nums text-foreground">{money(documento.total_ibs)}</dd><dt className="text-muted-foreground">Total CBS</dt><dd className="tabular-nums text-foreground">{money(documento.total_cbs)}</dd>
        </dl>
        {documento.referencias.length ? <div className="mt-sm"><h5 className="text-label-sm text-muted-foreground">Documentos referenciados</h5><ul className="mt-xs space-y-1 text-body-sm text-foreground">{documento.referencias.map((reference) => <li key={`${reference.tipo}-${reference.chave}`} className="break-all">{reference.tipo}: {reference.chave}</li>)}</ul></div> : null}
        {documento.partes.length ? <section className="mt-md"><h4 className="font-display text-title-sm text-foreground">Partes e localização declarada</h4><dl className="mt-xs grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-sm gap-y-1 text-body-sm">{documento.partes.map((part) => <Fragment key={part.papel}><dt className="text-muted-foreground">{part.papel === 'EMITENTE' ? 'Emitente' : 'Destinatário'}</dt><dd className="min-w-0 break-words text-foreground"><span className="block">{part.nome ?? 'Nome não informado'}{part.identificador ? ` · ${part.identificador}` : ''}</span><span className="block text-label-sm text-muted-foreground">{[part.logradouro, part.numero, part.complemento, part.bairro, part.municipio, part.uf, part.cep].filter(Boolean).join(', ') || 'Endereço não informado'}</span></dd></Fragment>)}</dl></section> : null}
        {documento.estado === 'PENDENTE_IBS_CBS' ? <p className="mt-sm flex items-start gap-xs rounded-md border border-warning/40 bg-warning/10 p-sm text-body-sm text-foreground"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />Documento preservado como pendente; nenhum valor foi presumido.</p> : null}
        <p className="mt-sm text-label-sm text-muted-foreground">{documento.origens.length} origem(ns) · última captura {dateTime(documento.origens.at(-1)?.capturado_em ?? null)}</p>
      </section>
      <section><h4 className="font-display text-title-sm text-foreground">Itens e componentes</h4>
        {documento.itens.length ? <div className="mt-sm overflow-x-auto"><table className="w-full min-w-[320px] text-body-sm"><thead className="text-label-sm text-muted-foreground"><tr><th scope="col" className="py-xs text-left">Descrição</th><th scope="col" className="py-xs text-right">Valor</th></tr></thead><tbody>{documento.itens.map((line, index) => <tr key={index} className="border-t border-border/60"><td className="max-w-48 py-xs pr-sm"><span className="block truncate text-foreground">{String(line['descricao'] ?? 'Item sem descrição')}</span><span className="text-label-sm text-muted-foreground">{line['tipo'] === 'COMPONENTE' ? 'Componente do frete' : line['tipo'] === 'MEDIDA_CARGA' ? 'Medida da carga' : String(line['codigo'] ?? '—')}</span>{line['tipo'] === 'ITEM' ? <dl className="mt-xs grid grid-cols-[auto_1fr] gap-x-xs text-label-sm"><dt className="text-muted-foreground">CFOP</dt><dd className="text-foreground">{String(line['cfop'] ?? '—')}</dd><dt className="text-muted-foreground">NCM</dt><dd className="text-foreground">{String(line['ncm'] ?? '—')}</dd><dt className="text-muted-foreground">CST/CSOSN</dt><dd className="text-foreground">{String(line['cst_csosn'] ?? '—')}</dd></dl> : null}</td><td className="py-xs text-right tabular-nums">{money(typeof line['valor'] === 'string' ? line['valor'] : null)}</td></tr>)}</tbody></table></div> : <p className="mt-sm text-body-sm text-muted-foreground">Sem itens estruturados neste layout.</p>}
        {documento.tributos.length ? <div className="mt-md overflow-x-auto"><h5 className="mb-xs text-label-sm text-muted-foreground">Tributos normalizados</h5><table className="w-full min-w-[520px] text-body-sm"><thead className="text-label-sm text-muted-foreground"><tr><th scope="col" className="py-xs text-left">Escopo</th><th scope="col" className="py-xs text-left">Tributo</th><th scope="col" className="py-xs text-right">Base</th><th scope="col" className="py-xs text-right">Alíquota</th><th scope="col" className="py-xs text-right">Valor</th></tr></thead><tbody>{documento.tributos.map((tax, index) => <tr key={`${tax.escopo}-${tax.numero_item ?? 'doc'}-${tax.codigo}-${index}`} className="border-t border-border/60"><td className="py-xs text-muted-foreground">{tax.escopo === 'ITEM' ? `Item ${tax.numero_item}` : 'Documento'}</td><td className="py-xs font-medium text-foreground">{tax.codigo}{tax.situacao ? ` · ${tax.situacao}` : ''}</td><td className="py-xs text-right tabular-nums">{money(tax.base_calculo)}</td><td className="py-xs text-right tabular-nums">{tax.aliquota ? `${tax.aliquota}%` : '—'}</td><td className="py-xs text-right tabular-nums">{money(tax.valor)}</td></tr>)}</tbody></table></div> : null}
      </section>
    </div>
    <PainelResolucaoTributaria empresaId={empresaId} documento={documento} podeResolver={podeResolver} />
  </div>
);
