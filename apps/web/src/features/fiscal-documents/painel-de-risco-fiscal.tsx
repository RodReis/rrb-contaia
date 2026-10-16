'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, CircleHelp, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { CampoDeValor } from '@/components/ui/campo-de-valor';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';

import {
  listarAnalisesDeRiscoFiscal,
  listarDocumentosFiscais,
  obterConfiguracaoDeRiscoFiscal,
  reprocessarAnaliseDeRiscoFiscal,
  salvarConfiguracaoDeRiscoFiscal,
} from './api';

type Fornecedor = Readonly<{
  id: string;
  cnpj: string;
  nome_exibicao: string;
  situacao: 'ATIVO' | 'ARQUIVADO';
  motivo: string;
  ator_id: string;
  criado_em: string;
}>;

type Rascunho = Readonly<{
  limiteCentavos: number | null;
  motivo: string;
  fornecedores: readonly Fornecedor[];
}>;

const statusLabel: Readonly<Record<string, string>> = {
  AGUARDANDO: 'Aguardando análise',
  PROCESSANDO: 'Analisando',
  CONCLUIDA: 'Análise concluída',
  INELEGIVEL: 'Inelegível',
  ABSTER_SE: 'Abstenção',
  FALHA: 'Falha',
  DLQ: 'Fila de falhas',
};

const faixaLabel: Readonly<Record<string, string>> = {
  PRONTA_PARA_REVISAO: 'Pronta para revisão',
  ATENCAO: 'Atenção',
  INCONCLUSIVA: 'Inconclusiva',
  ABSTER_SE: 'Abstenção',
};

const centavosSeguros = (texto: string | undefined): number | null => {
  if (texto === undefined || !/^\d+$/u.test(texto)) return null;

  try {
    const valor = BigInt(texto);
    if (valor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(valor);
  } catch {
    return null;
  }
};

const limiteEmReais = (centavos: number | null): string | null => {
  if (centavos === null || !Number.isSafeInteger(centavos) || centavos < 0) return null;
  const inteiro = BigInt(centavos);
  return `${inteiro / 100n}.${(inteiro % 100n).toString().padStart(2, '0')}`;
};

const formatarCnpj = (valor: string): string =>
  valor.length === 14 ? valor.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/u, '$1.$2.$3/$4-$5') : valor;

const formatarDataCivil = (valor: string | null): string => {
  if (valor === null) return 'Sem data';
  const partes = /^(\d{4})-(\d{2})-(\d{2})/u.exec(valor);
  return partes === null ? valor : `${partes[3]}/${partes[2]}/${partes[1]}`;
};

const formatarValorFiscal = (valor: string | null): string => {
  if (valor === null) return 'Valor indisponível';
  const partes = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(valor);
  if (partes === null) return valor;
  const reais = (partes[1] ?? '').replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `R$ ${reais},${(partes[2] ?? '').padEnd(2, '0')}`;
};

const exibirReferencia = (valor: unknown): string => {
  if (typeof valor === 'string') return valor;
  return JSON.stringify(valor) ?? String(valor);
};

export const PainelDeRiscoFiscal = ({
  empresaId,
  somenteLeitura,
  podeConfigurar,
}: Readonly<{ empresaId: string; somenteLeitura: boolean; podeConfigurar: boolean }>) => {
  const client = useQueryClient();
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [cnpj, setCnpj] = useState('');
  const [nome, setNome] = useState('');
  const [motivoFornecedor, setMotivoFornecedor] = useState('');
  const [documento, setDocumento] = useState('');
  const [filtroDocumento, setFiltroDocumento] = useState('');
  const [paginaDocumento, setPaginaDocumento] = useState(1);

  const configuracao = useQuery({
    queryKey: ['sessao', 'eu', 'fiscal-risk-settings', empresaId],
    queryFn: () => obterConfiguracaoDeRiscoFiscal(empresaId),
  });
  const documentos = useQuery({
    queryKey: ['sessao', 'eu', 'documentos-fiscais', empresaId, paginaDocumento, 'risco'],
    queryFn: () => listarDocumentosFiscais(empresaId, paginaDocumento, 'TODOS'),
  });
  const analises = useQuery({
    queryKey: ['sessao', 'eu', 'fiscal-risk', empresaId, documento],
    queryFn: () => listarAnalisesDeRiscoFiscal(empresaId, documento),
    enabled: documento.length > 0,
    refetchInterval: (query) =>
      query.state.data?.execucoes.some((item) => ['AGUARDANDO', 'PROCESSANDO'].includes(item.estado))
        ? 3000
        : false,
  });

  const salvar = useMutation({
    mutationFn: () => {
      const limiteCentavos = rascunho === null
        ? centavosSeguros(configuracao.data?.configuracao?.limite_centavos)
        : rascunho.limiteCentavos;
      const limite = limiteEmReais(limiteCentavos);
      if (limite === null) throw new Error('Informe um limite monetário válido antes de salvar.');
      const motivoDaVersao = rascunho?.motivo ?? configuracao.data?.configuracao?.motivo ?? '';
      if (motivoDaVersao.trim().length < 3) throw new Error('Informe o motivo da versão com pelo menos 3 caracteres.');

      return salvarConfiguracaoDeRiscoFiscal(empresaId, {
        limite,
        motivo: motivoDaVersao,
        fornecedores: (rascunho?.fornecedores ?? configuracao.data?.configuracao?.fornecedores ?? []).map(
          ({ cnpj: taxId, nome_exibicao, situacao, motivo: reason }) => ({
            cnpj: taxId,
            nome_exibicao,
            situacao,
            motivo: reason,
          }),
        ),
      });
    },
    onSuccess: () => {
      toast.success('Configuração de risco versionada.');
      setRascunho(null);
      void client.invalidateQueries({ queryKey: ['sessao', 'eu', 'fiscal-risk-settings', empresaId] });
    },
    onError: (error) => {
      if (error instanceof Error && /^(Informe um limite monetário válido|Informe o motivo da versão)/u.test(error.message)) {
        return;
      }
      toast.error('Não foi possível salvar a configuração.');
    },
  });

  const reprocessar = useMutation({
    mutationFn: () => reprocessarAnaliseDeRiscoFiscal(empresaId, documento),
    onSuccess: () => {
      toast.success('Análise técnica adicionada à fila.');
      void client.invalidateQueries({ queryKey: ['sessao', 'eu', 'fiscal-risk', empresaId, documento] });
    },
    onError: () => toast.error('Não foi possível solicitar a análise técnica.'),
  });

  if (configuracao.isPending) {
    return (
      <section aria-busy="true" className="mt-xl flex flex-col gap-md border-t border-border pt-lg">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </section>
    );
  }

  if (configuracao.isError) {
    const denied = configuracao.error instanceof ErroDaApi && configuracao.error.problema.status === 403;
    return (
      <ErroDeTela
        titulo={denied ? 'Acesso negado' : 'Configuração de risco indisponível'}
        descricao={denied
          ? 'Seu papel ou carteira não permite consultar os dados fiscais desta empresa.'
          : 'Tente novamente em instantes.'}
      />
    );
  }

  const current = configuracao.data.configuracao;
  const podeEditar = podeConfigurar && !somenteLeitura;
  const limiteAtual = centavosSeguros(current?.limite_centavos);
  const limite = rascunho === null ? limiteAtual : rascunho.limiteCentavos;
  const motivo = rascunho?.motivo ?? current?.motivo ?? '';
  const fornecedores = rascunho?.fornecedores ?? current?.fornecedores ?? [];
  const nfe = (documentos.data?.itens ?? []).filter(
    (item) => item.especie === 'NFE_55' && item.estado === 'PROCESSADO',
  );

  const atualizarRascunho = (patch: Partial<Rascunho>): void => {
    setRascunho((previous) => ({
      limiteCentavos: previous === null ? limiteAtual : previous.limiteCentavos,
      motivo: previous === null ? current?.motivo ?? '' : previous.motivo,
      fornecedores: previous === null ? current?.fornecedores ?? [] : previous.fornecedores,
      ...patch,
    }));
  };

  const adicionarFornecedor = (): void => {
    if (!/^\d{14}$/u.test(cnpj) || nome.trim().length === 0 || motivoFornecedor.trim().length < 3) {
      toast.error('Informe CNPJ válido, nome e motivo com pelo menos 3 caracteres.');
      return;
    }

    atualizarRascunho({
      fornecedores: [
        ...fornecedores,
        {
          id: crypto.randomUUID(),
          cnpj,
          nome_exibicao: nome.trim(),
          situacao: 'ATIVO',
          motivo: motivoFornecedor.trim(),
          ator_id: '',
          criado_em: new Date().toISOString(),
        },
      ],
    });
    setCnpj('');
    setNome('');
    setMotivoFornecedor('');
  };

  const nfeFiltradas = nfe.filter((item) => {
    const consulta = filtroDocumento.trim().toLocaleLowerCase('pt-BR');
    if (consulta.length === 0) return true;
    return `${item.emitente ?? ''} ${item.emitido_em ?? ''} ${item.total ?? ''}`
      .toLocaleLowerCase('pt-BR')
      .includes(consulta);
  });
  const opcoesDeNfe = nfeFiltradas.map((item) => ({
    valor: item.id,
    rotulo: `${item.emitente ?? 'Emitente não identificado'} · ${formatarDataCivil(item.emitido_em)} · ${formatarValorFiscal(item.total)}`,
  }));

  return (
    <section aria-labelledby="fiscal-risk-title" className="mt-xl flex flex-col gap-lg border-t border-border pt-lg">
      <header>
        <h3 id="fiscal-risk-title" className="font-display text-title-lg text-foreground">
          Risco fiscal e proposta
        </h3>
        <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">
          Análises explicáveis, versionadas e sem executar manifestação. Confiança mede a sugestão; riscos ficam separados.
        </p>
      </header>

      <div className="grid gap-lg min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)]">
        <section aria-labelledby="fiscal-risk-settings-title" className="rounded-lg border border-border bg-card p-lg">
          <div className="flex flex-wrap items-start justify-between gap-sm">
            <div>
              <h4 id="fiscal-risk-settings-title" className="font-display text-title-md text-foreground">
                Configuração por empresa
              </h4>
              <p className="mt-xs text-body-sm text-muted-foreground">
                Versões anteriores ficam preservadas. Fornecedor é arquivado, nunca apagado.
              </p>
            </div>
            {current
              ? <StatusBadge tom="neutro" rotulo={`Versão ${current.versao}`} />
              : <StatusBadge tom="atencao" rotulo="Sem configuração" />}
          </div>
          {!podeEditar ? (
            <p className="mt-md text-body-sm text-muted-foreground">
              Consulta somente. Seu papel ou o estado da empresa não permite alterar esta configuração.
            </p>
          ) : null}

          <div className="mt-md grid gap-md">
            <CampoDeValor
              rotulo="Limite por operação"
              tipo="moeda"
              obrigatorio
              valor={limite}
              disabled={!podeEditar}
              onValorChange={(valor) => atualizarRascunho({ limiteCentavos: valor })}
              ajuda="Digite o valor em reais; o sistema guarda centavos exatos."
            />
            {current !== null && limiteAtual === null ? (
              <p role="alert" className="text-body-sm text-warning-foreground">
                O limite atual excede a precisão segura desta interface. Consulte o suporte antes de criar outra versão.
              </p>
            ) : null}
            <Campo
              rotulo="Motivo da versão"
              obrigatorio
              value={motivo}
              onValorChange={(value) => atualizarRascunho({ motivo: value })}
              disabled={!podeEditar}
              maxLength={500}
              placeholder="Por que esta configuração mudou?"
              ajuda="O motivo acompanha a versão no histórico."
            />
          </div>

          <div className="mt-lg grid gap-md tablet:grid-cols-2">
            <Campo rotulo="CNPJ do fornecedor" mascara="cnpj" value={cnpj} onValorChange={setCnpj} disabled={!podeEditar} />
            <Campo rotulo="Nome de exibição" value={nome} onValorChange={setNome} disabled={!podeEditar} maxLength={200} />
            <div className="tablet:col-span-2">
              <Campo
                rotulo="Motivo da inclusão"
                value={motivoFornecedor}
                onValorChange={setMotivoFornecedor}
                disabled={!podeEditar}
                maxLength={500}
              />
            </div>
            <div className="flex items-end">
              <Button variante="contorno" className="w-full" onClick={adicionarFornecedor} disabled={!podeEditar}>
                Adicionar fornecedor
              </Button>
            </div>
          </div>

          {fornecedores.length > 0 ? (
            <ul className="mt-md divide-y divide-border rounded-md border border-border">
              {fornecedores.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-sm p-sm">
                  <div className="min-w-0">
                    <span className="block font-mono text-code-sm tabular-nums text-foreground">{formatarCnpj(item.cnpj)}</span>
                    <span className="block break-words text-body-sm text-muted-foreground">
                      {item.nome_exibicao} · {item.motivo} · {item.situacao === 'ATIVO' ? 'Ativo' : 'Arquivado'}
                    </span>
                  </div>
                  <Button
                    variante="contorno"
                    tamanho="compacto"
                    disabled={!podeEditar}
                    onClick={() => atualizarRascunho({
                      fornecedores: fornecedores.map((row) => row.id === item.id
                        ? {
                            ...row,
                            situacao: row.situacao === 'ATIVO' ? 'ARQUIVADO' : 'ATIVO',
                            motivo: row.situacao === 'ATIVO'
                              ? 'Arquivamento solicitado pelo usuário'
                              : 'Reativação solicitada pelo usuário',
                          }
                        : row),
                    })}
                  >
                    {item.situacao === 'ATIVO' ? 'Arquivar' : 'Reativar'}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-md text-body-sm text-muted-foreground">Nenhum fornecedor aprovado nesta versão.</p>
          )}

          {current ? (
            <p className="mt-sm break-words text-label-sm text-muted-foreground">
              Autor {current.ator_id} · criada em{' '}
              {new Intl.DateTimeFormat('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: 'America/Sao_Paulo',
              }).format(new Date(current.criado_em))} · {current.motivo}
            </p>
          ) : null}

          {configuracao.data.historico.length > 0 ? (
            <details className="mt-md rounded-md border border-border px-md py-sm">
              <summary className="cursor-pointer text-label-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                Histórico de versões ({configuracao.data.historico.length})
              </summary>
              <ol className="mt-sm space-y-sm">
                {configuracao.data.historico.map((version) => (
                  <li key={version.id} className="break-words border-t border-border pt-sm">
                    <p className="text-body-sm font-medium text-foreground">
                      Versão {version.versao} · limite {formatarValorFiscal(limiteEmReais(centavosSeguros(version.limite_centavos)))}
                    </p>
                    <p className="mt-xs text-body-sm text-muted-foreground">
                      {version.motivo} ·{' '}
                      {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'America/Sao_Paulo',
                      }).format(new Date(version.criado_em))} · autor {version.ator_id}
                    </p>
                    <p className="text-body-sm text-muted-foreground">
                      {version.fornecedores.length} fornecedor(es):{' '}
                      {version.fornecedores.filter((supplier) => supplier.situacao === 'ATIVO').length} ativo(s),{' '}
                      {version.fornecedores.filter((supplier) => supplier.situacao === 'ARQUIVADO').length} arquivado(s).
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          {podeEditar ? (
            <div className="mt-lg flex justify-end">
              <ConfirmacaoDeAcao
                gatilho={<Button disabled={salvar.isPending}>Salvar nova versão</Button>}
                titulo="Publicar nova configuração?"
                descricao="A versão atual será preservada e a nova passará a orientar as próximas análises."
                rotuloDeConfirmacao="Publicar configuração"
                aoConfirmar={async () => { await salvar.mutateAsync(); }}
                explicarBloqueio={(erro) =>
                  erro instanceof Error && /^(Informe um limite monetário válido|Informe o motivo da versão)/u.test(erro.message)
                    ? erro.message
                    : null}
              />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="fiscal-risk-analysis-title" className="rounded-lg border border-border bg-card p-lg">
          <h4 id="fiscal-risk-analysis-title" className="font-display text-title-md text-foreground">
            Inspeção de análise
          </h4>
          <p className="mt-xs text-body-sm text-muted-foreground">
            Só NF-e modelo 55 processada e íntegra entra na fila.
          </p>

          <div className="mt-md">
            <div className="grid gap-md">
              <Campo
                rotulo="Localizar NF-e"
                value={filtroDocumento}
                onValorChange={(valor) => {
                  setFiltroDocumento(valor);
                  setDocumento('');
                }}
                disabled={documentos.isPending || documentos.isError || nfe.length === 0}
                placeholder="Filtrar por emitente ou data"
                ajuda="Filtra por emitente ou data nesta página. A lista contém NF-e processada desta empresa."
              />
              <Select
                rotulo="Documento fiscal"
                valor={documento}
                onValorChange={setDocumento}
                opcoes={opcoesDeNfe}
                placeholder="Selecione uma NF-e processada"
                disabled={documentos.isPending || documentos.isError || nfeFiltradas.length === 0}
              />
            </div>
          </div>

          {documentos.data ? (
            <nav aria-label="Páginas de documentos fiscais" className="mt-md flex flex-wrap items-center justify-between gap-sm">
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={paginaDocumento <= 1}
                onClick={() => {
                  setPaginaDocumento((pagina) => Math.max(1, pagina - 1));
                  setDocumento('');
                  setFiltroDocumento('');
                }}
              >
                <ChevronLeft aria-hidden="true" />
                Anterior
              </Button>
              <span aria-live="polite" className="text-label-sm text-muted-foreground">Página {paginaDocumento}</span>
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={!documentos.data.temProximaPagina}
                onClick={() => {
                  setPaginaDocumento((pagina) => pagina + 1);
                  setDocumento('');
                  setFiltroDocumento('');
                }}
              >
                Próxima
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          ) : null}

          {documentos.isError ? (
            <p role="alert" className="mt-sm text-body-sm text-danger-foreground">
              Lista de documentos indisponível. Tente novamente em instantes.
            </p>
          ) : null}
          {documentos.isPending ? (
            <div aria-busy="true" className="mt-md"><Skeleton className="h-24 w-full" /></div>
          ) : null}
          {!documentos.isPending && !documentos.isError && nfe.length === 0 ? (
            <div className="mt-md">
              <EmptyState
                nivel={3}
                icone={<CircleHelp />}
                titulo="Nenhuma NF-e processada nesta página"
                descricao="Navegue pelas páginas ou aguarde o processamento de uma NF-e íntegra."
              />
            </div>
          ) : null}
          {!documentos.isPending && !documentos.isError && nfe.length > 0 && nfeFiltradas.length === 0 ? (
            <div className="mt-md">
              <EmptyState
                nivel={3}
                icone={<CircleHelp />}
                titulo="Nenhuma NF-e corresponde à busca"
                descricao="Ajuste o emitente ou a data para localizar o documento."
              />
            </div>
          ) : null}
          {!documentos.isPending && !documentos.isError && nfeFiltradas.length > 0 && !documento ? (
            <div className="mt-md">
              <EmptyState
                nivel={3}
                icone={<CircleHelp />}
                titulo="Selecione uma NF-e processada"
                descricao="A análise, as evidências e o histórico aparecem depois da seleção."
              />
            </div>
          ) : null}

          {documento && podeEditar ? (
            <div className="mt-md">
              <ConfirmacaoDeAcao
                gatilho={(
                  <Button variante="contorno" disabled={reprocessar.isPending}>
                    <RefreshCw aria-hidden="true" />
                    Solicitar análise técnica
                  </Button>
                )}
                titulo="Enfileirar análise?"
                descricao="A análise não aprova nem transmite manifestação. A execução preservará versão, evidências e histórico."
                rotuloDeConfirmacao="Enfileirar análise"
                aoConfirmar={async () => { await reprocessar.mutateAsync(); }}
              />
            </div>
          ) : null}

          {documento && analises.isPending ? (
            <div aria-busy="true" className="mt-md"><Skeleton className="h-28 w-full" /></div>
          ) : null}
          {analises.isError ? (
            <ErroDeTela titulo="Análises indisponíveis" descricao="Tente novamente em instantes." />
          ) : null}
          {documento && analises.data?.execucoes.length === 0 ? (
            <p className="mt-md rounded-md bg-muted/40 p-md text-body-sm text-muted-foreground">
              Nenhuma execução registrada para esta NF-e.
            </p>
          ) : null}

          <ol className="mt-md space-y-md">
            {analises.data?.execucoes.map((execution) => (
              <li key={execution.id} className="rounded-md border border-border p-md">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <StatusBadge
                    tom={execution.estado === 'ABSTER_SE' || execution.estado === 'FALHA' || execution.estado === 'DLQ'
                      ? 'atencao'
                      : execution.estado === 'CONCLUIDA' ? 'conforme' : 'neutro'}
                    rotulo={statusLabel[execution.estado] ?? execution.estado}
                  />
                  <span className="break-all text-label-sm text-muted-foreground">
                    {execution.tentativas} tentativa(s) · {execution.correlation_id}
                  </span>
                </div>

                {execution.tipo_manifestacao ? (
                  <div className="mt-md">
                    <div className="flex flex-wrap items-center gap-sm">
                      <span className="text-body-md font-medium text-foreground">
                        {execution.tipo_manifestacao === 'ABSTER_SE'
                          ? 'Sem proposta conclusiva'
                          : `Proposta técnica ${execution.tipo_manifestacao}`}
                      </span>
                      <StatusBadge
                        tom="neutro"
                        rotulo={faixaLabel[execution.faixa_confianca ?? ''] ?? execution.faixa_confianca ?? 'Faixa indisponível'}
                      />
                    </div>
                    <p className="mt-xs text-body-sm text-muted-foreground">
                      Confiança: {execution.confianca === null
                        ? 'indisponível'
                        : String(execution.confianca).replace('.', ',')}
                    </p>
                    <p className="mt-sm break-words text-body-sm text-foreground">{execution.justificativa}</p>

                    <div className="mt-md grid gap-md tablet:grid-cols-2">
                      <div>
                        <h5 className="text-label-md text-foreground">Evidências</h5>
                        {execution.evidencias?.length ? (
                          <ul className="mt-xs list-inside list-disc break-words text-body-sm text-muted-foreground">
                            {execution.evidencias.map((value, index) => <li key={`${index}-${exibirReferencia(value)}`}>{exibirReferencia(value)}</li>)}
                          </ul>
                        ) : <p className="mt-xs text-body-sm text-muted-foreground">Nenhuma evidência registrada.</p>}
                      </div>
                      <div>
                        <h5 className="text-label-md text-foreground">Lacunas</h5>
                        {execution.lacunas?.length ? (
                          <ul className="mt-xs list-inside list-disc break-words text-body-sm text-muted-foreground">
                            {execution.lacunas.map((value, index) => <li key={`${index}-${exibirReferencia(value)}`}>{exibirReferencia(value)}</li>)}
                          </ul>
                        ) : <p className="mt-xs text-body-sm text-muted-foreground">Nenhuma lacuna registrada.</p>}
                      </div>
                    </div>

                    {execution.riscos?.length ? (
                      <div className="mt-md">
                        <h5 className="text-label-md text-foreground">Riscos identificados</h5>
                        <ul className="mt-xs list-inside list-disc break-words text-body-sm text-muted-foreground">
                          {execution.riscos.map((risk, index) => <li key={`${index}-${exibirReferencia(risk)}`}>{exibirReferencia(risk)}</li>)}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-md text-body-sm text-muted-foreground">Nenhum risco adicional registrado.</p>
                    )}
                  </div>
                ) : null}

                {execution.codigo_erro ? (
                  <p className="mt-sm flex items-start gap-xs break-words text-body-sm text-warning-foreground">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    {execution.codigo_erro}
                  </p>
                ) : null}

                <dl className="mt-md grid gap-xs border-t border-border pt-sm text-body-sm tablet:grid-cols-2">
                  <div><dt className="inline text-muted-foreground">Classificador: </dt><dd className="inline break-all text-foreground">{execution.classifier_version}</dd></div>
                  <div><dt className="inline text-muted-foreground">Parser: </dt><dd className="inline break-all text-foreground">{execution.parser_version}</dd></div>
                  <div><dt className="inline text-muted-foreground">Esquema: </dt><dd className="inline break-all text-foreground">{execution.versao_schema ?? 'não informado'}</dd></div>
                  <div><dt className="inline text-muted-foreground">Origem: </dt><dd className="inline text-foreground">{execution.origem ?? 'não informada'}</dd></div>
                  {execution.provedor ? <div><dt className="inline text-muted-foreground">Provedor: </dt><dd className="inline break-all text-foreground">{execution.provedor}</dd></div> : null}
                  {execution.modelo ? <div><dt className="inline text-muted-foreground">Modelo: </dt><dd className="inline break-all text-foreground">{execution.modelo}</dd></div> : null}
                  {execution.versao_prompt ? <div><dt className="inline text-muted-foreground">Prompt: </dt><dd className="inline break-all text-foreground">{execution.versao_prompt}</dd></div> : null}
                  {execution.duracao_ms !== null ? <div><dt className="inline text-muted-foreground">Duração: </dt><dd className="inline text-foreground">{execution.duracao_ms} ms</dd></div> : null}
                  {execution.custo_microusd !== null ? <div><dt className="inline text-muted-foreground">Custo (micro-USD): </dt><dd className="inline text-foreground">{execution.custo_microusd}</dd></div> : null}
                  {execution.fallback ? <div><dt className="inline text-muted-foreground">Execução: </dt><dd className="inline text-foreground">Fallback determinístico</dd></div> : null}
                </dl>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <p className="text-body-sm text-muted-foreground">
        Nenhuma ação desta tela aprova, rejeita, assina ou transmite manifestação. `210240` permanece hipótese, nunca fato.
      </p>
    </section>
  );
};
