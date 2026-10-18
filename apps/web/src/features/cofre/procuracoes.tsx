'use client';

import type { ChaveDePermissao, PoderRfb } from '@contaia/domain';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CaixaDeSelecao } from '@/components/ui/caixa-de-selecao';
import { Campo } from '@/components/ui/campo';
import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { ErroDaApi, requisitar } from '@/lib/http';
import type { Sessao } from '../usuarios/api';
import { CAIXA_DE_DIALOGO, FUNDO_DA_SOBREPOSICAO } from './estilos';

type Estado = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
type Item = Readonly<{
  id: string;
  empresaId: string;
  empresaNome: string;
  empresaCnpj: string;
  outorganteCnpj: string;
  outorgadoCnpj: string;
  validFrom: string;
  validUntil: string;
  status: Estado;
  powers: readonly PoderRfb[];
  evidence: Readonly<{ nome: string; sha256: string; tamanho: number }> | null;
  revision: number;
  localTestResult: 'SUCCESS' | 'FAILURE' | null;
  localTestCorrelationId: string | null;
  declarationAt: string | null;
  catalogVersion: number;
  archivedAt: string | null;
}>;
type Pagina = Readonly<{ itens: readonly Item[]; total: number }>;
type Resumo = Readonly<Record<Estado, number>>;
type Empresas = Readonly<{
  empresas: readonly Readonly<{
    id: string;
    cnpj: string;
    razaoSocial: string | null;
    nomeFantasia: string | null;
  }>[];
}>;
type Historico = Readonly<{
  eventos: readonly Readonly<{
    id: string;
    acao: string;
    resultado: string | null;
    motivo: string | null;
    correlationId: string;
    criadoEm: string;
  }>[];
  total: number;
}>;
const PODERES: readonly Readonly<{ code: PoderRfb; label: string }>[] = [
  {
    code: 'RFB_CNPJ_STATUS_READ',
    label: 'Consultar situação cadastral do CNPJ',
  },
  {
    code: 'RFB_TAX_CLEARANCE_CERTIFICATE_READ',
    label: 'Consultar certidão de regularidade fiscal',
  },
  {
    code: 'RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE',
    label: 'Emitir certidão de regularidade fiscal',
  },
];
const ESTADOS: readonly Readonly<{ valor: string; rotulo: string }>[] = [
  { valor: 'TODOS', rotulo: 'Todos os estados' },
  { valor: 'DRAFT', rotulo: 'Rascunho' },
  { valor: 'SCHEDULED', rotulo: 'Futura' },
  { valor: 'ACTIVE', rotulo: 'Ativa' },
  { valor: 'EXPIRED', rotulo: 'Vencida' },
  { valor: 'REVOKED', rotulo: 'Revogada' },
];
const VENCIMENTOS: readonly Readonly<{ valor: string; rotulo: string }>[] = [
  { valor: 'TODOS', rotulo: 'Qualquer vencimento' },
  { valor: '7_DIAS', rotulo: 'Vence em até 7 dias' },
  { valor: '30_DIAS', rotulo: 'Vence em até 30 dias' },
  { valor: 'VENCIDAS', rotulo: 'Vencidas' },
];
const ORDENACOES: readonly Readonly<{ valor: string; rotulo: string }>[] = [
  { valor: 'VENCIMENTO_ASC', rotulo: 'Vencimento mais próximo' },
  { valor: 'VENCIMENTO_DESC', rotulo: 'Vencimento mais distante' },
  { valor: 'EMPRESA_ASC', rotulo: 'Empresa A–Z' },
];
const rotulosEstado: Record<Estado, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Futura',
  ACTIVE: 'Ativa',
  EXPIRED: 'Vencida',
  REVOKED: 'Revogada',
};
const rotulosAcao: Record<string, string> = {
  CRIADA: 'Rascunho criado',
  RASCUNHO_ALTERADO: 'Rascunho alterado',
  EVIDENCIA_ENVIADA: 'PDF anexado',
  EVIDENCIA_SUBSTITUIDA: 'PDF substituído',
  TESTE_LOCAL: 'Teste local',
  CONFIRMADA: 'Conferência declarada',
  ATIVADA: 'Procuração ativada',
  RENOVADA: 'Nova versão criada',
  REVOGADA: 'Procuração revogada',
  ARQUIVADA: 'Versão arquivada',
  OPERACAO_RFB: 'Operação no dublê',
  EVIDENCIA_BAIXADA: 'Evidência baixada',
};
const pode = (s: Sessao | undefined, acao: string) =>
  Boolean(
    s?.permissoes.includes(`procuracoes.registro.${acao}` as ChaveDePermissao),
  );
const json = (corpo: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});
const caminho = '/configuracoes/cofre';
const hoje = (valor: string) => {
  const fim = new Date(`${valor}T00:00:00Z`);
  const agora = new Date();
  const inicio = Date.UTC(
    agora.getUTCFullYear(),
    agora.getUTCMonth(),
    agora.getUTCDate(),
  );
  return Math.ceil((fim.getTime() - inicio) / 86400000);
};
const data = (valor: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${valor}T12:00:00Z`));

const Revogar = ({ item }: { item: Item }) => {
  const [aberto, setAberto] = useState(false),
    [motivo, setMotivo] = useState('');
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      requisitar(
        `/procurações-rfb/${item.id}/revogacao`,
        json({ expectedRevision: item.revision, motivo: motivo.trim() }),
      ),
    onSuccess: async () => {
      toast.success(
        'Procuração revogada. A autorização foi bloqueada imediatamente.',
      );
      await cache.invalidateQueries({ queryKey: ['procurações-rfb'] });
      setAberto(false);
    },
    onError: (erro: unknown) =>
      toast.error('Não foi possível revogar.', {
        duration: Infinity,
        description:
          erro instanceof ErroDaApi
            ? `Código de suporte: ${erro.problema.correlationId}`
            : 'Tente novamente.',
      }),
  });
  return (
    <AlertDialog.Root open={aberto} onOpenChange={setAberto}>
      <Button variante="destrutiva" onClick={() => setAberto(true)}>
        Revogar
      </Button>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={FUNDO_DA_SOBREPOSICAO} />
        <AlertDialog.Content className={CAIXA_DE_DIALOGO}>
          <AlertDialog.Title className="text-headline-sm text-foreground">
            Revogar procuração
          </AlertDialog.Title>
          <AlertDialog.Description className="text-body-md text-muted-foreground">
            O bloqueio é imediato. O motivo será preservado no histórico.
          </AlertDialog.Description>
          <AreaDeTexto
            rotulo="Motivo da revogação"
            obrigatorio
            value={motivo}
            onValorChange={setMotivo}
            maxLength={500}
            ajuda="Informe ao menos 5 caracteres."
          />
          <div className="flex justify-end gap-sm">
            <AlertDialog.Cancel asChild>
              <Button variante="contorno" disabled={mutation.isPending}>
                Cancelar
              </Button>
            </AlertDialog.Cancel>
            <Button
              variante="destrutiva"
              disabled={mutation.isPending || motivo.trim().length < 5}
              aria-busy={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Revogar
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};

export const ProcuracoesRfb = ({ sessao }: { sessao: Sessao }) => {
  const router = useRouter(),
    params = useSearchParams(),
    cache = useQueryClient();
  const [empresaId, setEmpresaId] = useState(''),
    [inicio, setInicio] = useState(''),
    [fim, setFim] = useState(''),
    [poderes, setPoderes] = useState<PoderRfb[]>([]),
    [pdf, setPdf] = useState<File | null>(null),
    [etapa, setEtapa] = useState(1),
    [historicoId, setHistoricoId] = useState<string | null>(null),
    [historicoPagina, setHistoricoPagina] = useState(1);
  const busca = params.get('procuracaoBusca') ?? '',
    estado = params.get('procuracaoEstado') ?? 'TODOS',
    poder = params.get('procuracaoPoder') ?? 'TODOS',
    vencimento = params.get('procuracaoVencimento') ?? 'TODOS',
    ordem = params.get('procuracaoOrdem') ?? 'VENCIMENTO_ASC',
    pagina = Math.max(1, Number(params.get('procuracaoPagina') ?? '1') || 1),
    limite = 25;
  const definir = (
    alteracoes: Record<string, string | null>,
    resetar = true,
  ) => {
    const prox = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(alteracoes)) {
      if (!v) prox.delete(`procuracao${k}`);
      else prox.set(`procuracao${k}`, v);
    }
    if (resetar) prox.delete('procuracaoPagina');
    const qs = prox.toString();
    router.replace(qs ? `${caminho}?${qs}` : caminho, { scroll: false });
  };
  const query = useQuery({
    queryKey: [
      'procurações-rfb',
      'lista',
      { busca, estado, poder, vencimento, ordem, pagina },
    ],
    queryFn: () => {
      const q = new URLSearchParams({
        pagina: String(pagina),
        limite: String(limite),
        ordem,
      });
      if (busca) q.set('busca', busca);
      if (estado !== 'TODOS') q.set('estado', estado);
      if (poder !== 'TODOS') q.set('poder', poder);
      if (vencimento !== 'TODOS') q.set('vencimento', vencimento);
      return requisitar<Pagina>(`/procurações-rfb?${q}`);
    },
    placeholderData: keepPreviousData,
  });
  const resumo = useQuery({
    queryKey: ['procurações-rfb', 'resumo'],
    queryFn: () => requisitar<Resumo>('/procurações-rfb/resumo'),
  });
  const empresas = useQuery({
    queryKey: ['procurações-rfb', 'empresas'],
    queryFn: () => requisitar<Empresas>('/empresas?limite=100&deslocamento=0'),
    enabled: pode(sessao, 'administrar'),
  });
  const historico = useQuery({
    queryKey: ['procurações-rfb', 'historico', historicoId, historicoPagina],
    queryFn: () =>
      requisitar<Historico>(
        `/procurações-rfb/${historicoId}/historico?pagina=${historicoPagina}`,
      ),
    enabled: historicoId !== null,
  });
  const mutation = useMutation({
    mutationFn: async (acao: () => Promise<unknown>) => acao(),
    onSuccess: (resultado: unknown) => {
      if (
        typeof resultado === 'object' &&
        resultado !== null &&
        'configuracaoTestadaLocalmente' in resultado &&
        resultado.configuracaoTestadaLocalmente === false
      )
        toast.error(
          'Teste local falhou. A tentativa foi registrada no histórico.',
        );
      else toast.success('Alteração registrada.');
    },
    onSettled: async () => {
      await cache.invalidateQueries({ queryKey: ['procurações-rfb'] });
    },
    onError: (erro: unknown) =>
      toast.error('Não foi possível concluir a ação.', {
        duration: Infinity,
        description:
          erro instanceof ErroDaApi
            ? `Código de suporte: ${erro.problema.correlationId}`
            : 'Confira revisão e permissões.',
      }),
  });
  const itens = query.data?.itens ?? [];
  const executar = (acao: () => Promise<unknown>) => mutation.mutateAsync(acao);
  const operar = async (item: Item, power: PoderRfb) => {
    try {
      const resultado = await requisitar<{
        code: string;
        summary: Readonly<Record<string, unknown>>;
      }>(
        `/procurações-rfb/${item.id}/operacoes`,
        json({ power, idempotencyKey: crypto.randomUUID() }),
      );
      toast.success('Operação local concluída.', {
        description: `Resultado do dublê: ${resultado.code}`,
      });
      await cache.invalidateQueries({ queryKey: ['procurações-rfb'] });
    } catch (erro) {
      toast.error('Operação recusada ou indisponível.', {
        duration: Infinity,
        description:
          erro instanceof ErroDaApi
            ? `Código de suporte: ${erro.problema.correlationId}`
            : 'Tente novamente.',
      });
    }
  };
  const criar = async () => {
    if (etapa < 5) {
      if (
        (etapa === 1 && !empresaId) ||
        (etapa === 2 && (!inicio || !fim || fim < inicio)) ||
        (etapa === 3 && !poderes.length) ||
        (etapa === 4 && !pdf)
      ) {
        toast.error('Complete os campos desta etapa.');
        return;
      }
      setEtapa(etapa + 1);
      return;
    }
    await executar(async () => {
      const p = await requisitar<Item>('/procurações-rfb', {
        ...json({
          empresaId,
          validFrom: inicio,
          validUntil: fim,
          powers: poderes,
        }),
        method: 'POST',
      });
      if (pdf) {
        const fd = new FormData();
        fd.set('expectedRevision', String(p.revision));
        fd.set('arquivo', pdf);
        await requisitar(`/procurações-rfb/${p.id}/evidencia`, {
          method: 'POST',
          body: fd,
        });
      }
      setEtapa(1);
      setEmpresaId('');
      setInicio('');
      setFim('');
      setPoderes([]);
      setPdf(null);
    });
  };
  const editarEtapa = (n: number) => setEtapa(n);
  const renovar = (i: Item) => {
    const proximo = new Date(`${i.validUntil}T00:00:00Z`);
    proximo.setUTCDate(proximo.getUTCDate() + 1);
    setEmpresaId(i.empresaId);
    setInicio(proximo.toISOString().slice(0, 10));
    setFim('');
    setPoderes([...i.powers]);
    setEtapa(1);
    document.getElementById('formulario-procuracao')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'center',
    });
  };
  const baixar = async (i: Item) => {
    try {
      const response = await fetch(
        `/api/proxy/procurações-rfb/${i.id}/evidencia`,
      );
      if (!response.ok) throw new Error();
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = i.evidence?.nome ?? 'procuracao.pdf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (erro) {
      toast.error('PDF indisponível.', {
        duration: Infinity,
        description:
          erro instanceof ErroDaApi
            ? erro.problema.correlationId
            : 'Tente novamente.',
      });
    }
  };
  const estados = Object.keys(rotulosEstado) as Estado[];

  return (
    <section
      aria-labelledby="titulo-procuracoes"
      className="flex flex-col gap-md border-t border-border pt-xl"
    >
      <header className="flex flex-col gap-sm">
        <div className="flex flex-col gap-sm tablet:flex-row tablet:items-end tablet:justify-between">
          <div>
            <h2
              id="titulo-procuracoes"
              className="text-headline-sm text-foreground"
            >
              Procurações RFB/e-CAC
            </h2>
            <p className="max-w-prose text-body-sm text-muted-foreground">
              Registro declarado pelo escritório. Sem conexão automática com
              Receita Federal.
            </p>
          </div>
          <Campo
            rotulo="Buscar empresa ou CNPJ"
            value={busca}
            onValorChange={(v) => definir({ Busca: v })}
            className="tablet:max-w-80"
          />
        </div>
        <div
          role="group"
          aria-label="Contagem por estado"
          className="grid grid-cols-2 gap-sm tablet:grid-cols-5"
        >
          {resumo.isPending
            ? estados.map((e) => <Skeleton key={e} className="h-16 w-full" />)
            : estados.map((e) => (
                <button
                  type="button"
                  key={e}
                  onClick={() => definir({ Estado: estado === e ? '' : e })}
                  aria-pressed={estado === e}
                  className="rounded-lg border border-border bg-card px-md py-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-body-sm text-muted-foreground">
                    {rotulosEstado[e]}
                  </span>
                  <strong className="font-mono text-title-md tabular-nums text-foreground">
                    {resumo.data?.[e] ?? 0}
                  </strong>
                </button>
              ))}
        </div>
      </header>
      <div
        aria-label="Filtros da procuração"
        className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-2 desktop:grid-cols-4"
      >
        <Select
          rotulo="Estado"
          valor={estado}
          opcoes={ESTADOS}
          onValorChange={(v) => definir({ Estado: v === 'TODOS' ? '' : v })}
        />
        <Select
          rotulo="Poder RFB"
          valor={poder}
          opcoes={[
            { valor: 'TODOS', rotulo: 'Todos os poderes' },
            ...PODERES.map((x) => ({ valor: x.code, rotulo: x.label })),
          ]}
          onValorChange={(v) => definir({ Poder: v === 'TODOS' ? '' : v })}
        />
        <Select
          rotulo="Vencimento"
          valor={vencimento}
          opcoes={VENCIMENTOS}
          onValorChange={(v) => definir({ Vencimento: v === 'TODOS' ? '' : v })}
        />
        <Select
          rotulo="Ordenar por"
          valor={ordem}
          opcoes={ORDENACOES}
          onValorChange={(v) =>
            definir({ Ordem: v === 'VENCIMENTO_ASC' ? '' : v }, false)
          }
        />
      </div>
      {pode(sessao, 'administrar') ? (
        <fieldset
          id="formulario-procuracao"
          className="flex flex-col gap-md rounded-lg border border-border bg-card p-md"
        >
          <legend className="px-xs text-title-sm">
            Nova versão · etapa {etapa} de 5
          </legend>
          <ol
            className="grid grid-cols-5 gap-xs"
            aria-label="Etapas do cadastro"
          >
            {['Empresa', 'Período', 'Poderes', 'PDF', 'Revisão'].map(
              (nome, index) => (
                <li key={nome}>
                  <button
                    type="button"
                    aria-current={etapa === index + 1 ? 'step' : undefined}
                    onClick={() => editarEtapa(index + 1)}
                    className={`w-full border-b-2 py-xs text-body-sm ${etapa === index + 1 ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}
                  >
                    {index + 1}. {nome}
                  </button>
                </li>
              ),
            )}
          </ol>
          {etapa === 1 ? (
            <Select
              rotulo="Empresa"
              obrigatorio
              valor={empresaId}
              onValorChange={setEmpresaId}
              placeholder="Selecione uma empresa"
              opcoes={(empresas.data?.empresas ?? []).map((e) => ({
                valor: e.id,
                rotulo: `${e.nomeFantasia ?? e.razaoSocial ?? e.cnpj} · ${e.cnpj}`,
              }))}
            />
          ) : null}
          {etapa === 2 ? (
            <div className="grid gap-md tablet:grid-cols-2">
              <Campo
                rotulo="Início da vigência"
                obrigatorio
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/AAAA"
                value={
                  inicio
                    ? `${inicio.slice(8, 10)}/${inicio.slice(5, 7)}/${inicio.slice(0, 4)}`
                    : ''
                }
                onValorChange={(v) => {
                  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(v);
                  setInicio(m ? `${m[3]}-${m[2]}-${m[1]}` : v);
                }}
              />
              <Campo
                rotulo="Fim da vigência"
                obrigatorio
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/AAAA"
                value={
                  fim
                    ? `${fim.slice(8, 10)}/${fim.slice(5, 7)}/${fim.slice(0, 4)}`
                    : ''
                }
                onValorChange={(v) => {
                  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(v);
                  setFim(m ? `${m[3]}-${m[2]}-${m[1]}` : v);
                }}
              />
            </div>
          ) : null}
          {etapa === 3 ? (
            <fieldset className="flex flex-col gap-sm">
              <legend className="mb-xs text-label-md text-foreground">
                Poderes RFB · escolha ao menos um
              </legend>
              {PODERES.map((p) => (
                <CaixaDeSelecao
                  key={p.code}
                  rotulo={p.label}
                  marcada={poderes.includes(p.code)}
                  onMarcadaChange={(marcada) =>
                    setPoderes((v) =>
                      marcada ? [...v, p.code] : v.filter((x) => x !== p.code),
                    )
                  }
                />
              ))}
            </fieldset>
          ) : null}
          {etapa === 4 ? (
            <label className="flex flex-col gap-xs text-label-md text-foreground">
              Comprovante PDF obrigatório
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
                aria-label="Comprovante PDF"
                className="text-body-sm file:mr-sm file:rounded-md file:border file:border-input file:bg-secondary file:px-sm file:py-xs file:text-label-md file:text-secondary-foreground"
              />
              <span className="text-body-sm text-muted-foreground">
                PDF até 20 MB. O arquivo é validado pelo servidor.
              </span>
            </label>
          ) : null}
          {etapa === 5 ? (
            <div className="flex flex-col gap-xs rounded-md bg-secondary p-md text-body-sm text-secondary-foreground">
              <p>
                <strong>Empresa:</strong>{' '}
                {(empresas.data?.empresas ?? []).find((e) => e.id === empresaId)
                  ?.razaoSocial ?? empresaId}
              </p>
              <p>
                <strong>Período:</strong> {inicio} a {fim} (dias inclusivos)
              </p>
              <p>
                <strong>Poderes:</strong>{' '}
                {poderes
                  .map((p) => PODERES.find((x) => x.code === p)?.label)
                  .join('; ')}
              </p>
              <p>
                <strong>Arquivo:</strong> {pdf?.name}
              </p>
            </div>
          ) : null}
          <div className="flex justify-between">
            <Button
              variante="contorno"
              disabled={etapa === 1 || mutation.isPending}
              onClick={() => setEtapa(etapa - 1)}
            >
              Voltar
            </Button>
            <Button
              disabled={mutation.isPending || empresas.isPending}
              aria-busy={mutation.isPending}
              onClick={() => void criar()}
            >
              {etapa === 5 ? (
                <>
                  <Plus aria-hidden="true" />
                  Criar rascunho
                </>
              ) : (
                'Continuar'
              )}
            </Button>
          </div>
        </fieldset>
      ) : null}
      {query.isPending ? (
        <div
          role="status"
          aria-label="Carregando procurações"
          className="flex flex-col gap-sm"
        >
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}
      {query.isError ? (
        <ErroDeTela
          titulo="Falha ao carregar procurações"
          descricao="A consulta falhou. O último resultado conhecido permanece no cache; tente novamente."
          correlationId={
            query.error instanceof ErroDaApi
              ? query.error.problema.correlationId
              : undefined
          }
          acao={
            <Button variante="contorno" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      ) : null}
      {query.isSuccess && itens.length === 0 ? (
        <EmptyState
          nivel={3}
          icone={<FileText />}
          titulo="Nenhuma procuração encontrada"
          descricao="Ajuste os filtros ou cadastre a primeira procuração declarada pelo escritório."
        />
      ) : null}
      {itens.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card px-md">
          {itens.map((i) => {
            const restante = hoje(i.validUntil);
            return (
              <li
                key={i.id}
                className="grid gap-sm py-md desktop:grid-cols-[minmax(14rem,1.2fr)_minmax(13rem,1fr)_minmax(14rem,1.4fr)_auto] desktop:items-center"
              >
                <div>
                  <h3 className="text-title-sm text-foreground">
                    {i.empresaNome}
                  </h3>
                  <p className="font-mono text-body-sm tabular-nums text-muted-foreground">
                    CNPJ {i.outorganteCnpj} · Outorgado {i.outorgadoCnpj}
                  </p>
                </div>
                <div>
                  <p className="text-label-md text-foreground">
                    {rotulosEstado[i.status]}
                    {restante >= 0 && restante <= 30 && i.status === 'ACTIVE'
                      ? ` · ${restante} dias`
                      : ''}
                  </p>
                  <p className="font-mono text-body-sm tabular-nums text-muted-foreground">
                    {data(i.validFrom)} – {data(i.validUntil)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-xs">
                  {i.powers.map((p) => (
                    <span
                      key={p}
                      className="rounded-md bg-secondary px-sm py-xs text-label-sm text-secondary-foreground"
                    >
                      {PODERES.find((x) => x.code === p)?.label ?? p}
                    </span>
                  ))}
                  {i.evidence ? (
                    <button
                      type="button"
                      onClick={() => void baixar(i)}
                      className="inline-flex items-center gap-xs text-body-sm text-muted-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FileText aria-hidden="true" />
                      PDF · SHA-256 {i.evidence.sha256.slice(0, 12)}…
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-xs text-body-sm text-muted-foreground">
                      <AlertTriangle aria-hidden="true" />
                      Sem evidência
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-xs">
                  {i.status === 'ACTIVE' && pode(sessao, 'operar')
                    ? i.powers.map((power) => (
                        <Button
                          key={power}
                          variante="contorno"
                          disabled={mutation.isPending}
                          onClick={() => void operar(i, power)}
                        >
                          {PODERES.find((p) => p.code === power)?.label ??
                            power}
                        </Button>
                      ))
                    : null}
                  {i.status === 'DRAFT' &&
                  i.evidence &&
                  i.localTestResult !== 'SUCCESS' &&
                  pode(sessao, 'testar') ? (
                    <Button
                      variante="contorno"
                      disabled={mutation.isPending}
                      onClick={() =>
                        void executar(() =>
                          requisitar(
                            `/procurações-rfb/${i.id}/teste-local`,
                            json({
                              expectedRevision: i.revision,
                              power: i.powers[0],
                            }),
                          ),
                        )
                      }
                    >
                      <RefreshCw aria-hidden="true" />
                      Testar local
                    </Button>
                  ) : null}
                  {i.status === 'DRAFT' &&
                  i.localTestResult === 'SUCCESS' &&
                  pode(sessao, 'confirmar') ? (
                    <ConfirmacaoDeAcao
                      gatilho={
                        <Button disabled={mutation.isPending}>Confirmar</Button>
                      }
                      titulo="Confirmar procuração"
                      descricao="Declaro que conferi no Portal de Serviços/e-CAC a autorização e que período, outorgantes e poderes correspondem ao PDF. Esta declaração não é validação oficial da Receita Federal."
                      rotuloDeConfirmacao="Declaro e confirmo"
                      aoConfirmar={() =>
                        executar(() =>
                          requisitar(
                            `/procurações-rfb/${i.id}/confirmacao`,
                            json({
                              expectedRevision: i.revision,
                              declaracaoConferida: true,
                            }),
                          ),
                        )
                      }
                    />
                  ) : null}
                  {i.status === 'ACTIVE' || i.status === 'SCHEDULED' ? (
                    <Button variante="contorno" onClick={() => renovar(i)}>
                      Renovar
                    </Button>
                  ) : null}
                  {(i.status === 'ACTIVE' || i.status === 'SCHEDULED') &&
                  pode(sessao, 'revogar') ? (
                    <Revogar item={i} />
                  ) : null}
                  {(i.status === 'EXPIRED' || i.status === 'REVOKED') &&
                  i.archivedAt === null &&
                  pode(sessao, 'arquivar') ? (
                    <ConfirmacaoDeAcao
                      gatilho={
                        <Button
                          variante="contorno"
                          disabled={mutation.isPending}
                        >
                          Arquivar
                        </Button>
                      }
                      titulo="Arquivar versão terminal"
                      descricao="O arquivo mantém evidência e histórico, sem excluir o registro."
                      rotuloDeConfirmacao="Arquivar"
                      aoConfirmar={() =>
                        executar(() =>
                          requisitar(
                            `/procurações-rfb/${i.id}/arquivamento`,
                            json({ expectedRevision: i.revision }),
                          ),
                        )
                      }
                    />
                  ) : null}
                  <Button
                    variante="fantasma"
                    onClick={() => {
                      setHistoricoId(historicoId === i.id ? null : i.id);
                      setHistoricoPagina(1);
                    }}
                    aria-expanded={historicoId === i.id}
                  >
                    Histórico
                  </Button>
                </div>
                {historicoId === i.id ? (
                  <div className="desktop:col-span-4">
                    <h4 className="text-label-md text-foreground">
                      Histórico da versão · revisão {i.revision} · catálogo v
                      {i.catalogVersion}
                    </h4>
                    {historico.isPending ? (
                      <Skeleton className="mt-sm h-16 w-full" />
                    ) : null}
                    {historico.data?.eventos.map((e) => (
                      <article
                        key={e.id}
                        className="grid gap-xs border-t border-border py-sm text-body-sm tablet:grid-cols-[12rem_1fr_auto]"
                      >
                        <span className="text-muted-foreground">
                          {new Intl.DateTimeFormat('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                            timeZone: 'America/Sao_Paulo',
                          }).format(new Date(e.criadoEm))}
                        </span>
                        <span className="text-foreground">
                          {rotulosAcao[e.acao] ?? e.acao}
                          {e.resultado ? ` · ${e.resultado}` : ''}
                          {e.motivo ? ` · ${e.motivo}` : ''}
                        </span>
                        <code className="text-code-sm text-muted-foreground">
                          {e.correlationId}
                        </code>
                      </article>
                    ))}
                    {historico.data && historico.data.total > 25 ? (
                      <div className="flex items-center justify-between">
                        <Button
                          variante="contorno"
                          disabled={historicoPagina === 1}
                          onClick={() =>
                            setHistoricoPagina(historicoPagina - 1)
                          }
                        >
                          Mais recentes
                        </Button>
                        <span className="text-body-sm text-muted-foreground">
                          Página {historicoPagina} de{' '}
                          {Math.ceil(historico.data.total / 25)}
                        </span>
                        <Button
                          variante="contorno"
                          disabled={
                            historicoPagina * 25 >= historico.data.total
                          }
                          onClick={() =>
                            setHistoricoPagina(historicoPagina + 1)
                          }
                        >
                          Mais antigos
                        </Button>
                      </div>
                    ) : null}
                    {i.declarationAt ? (
                      <p className="text-body-sm text-muted-foreground">
                        Conferência humana registrada em{' '}
                        {new Intl.DateTimeFormat('pt-BR', {
                          dateStyle: 'short',
                          timeZone: 'America/Sao_Paulo',
                        }).format(new Date(i.declarationAt))}
                        . Configuração testada localmente.{' '}
                        {i.localTestCorrelationId
                          ? `Correlação ${i.localTestCorrelationId}`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {query.data && query.data.total > limite ? (
        <nav
          aria-label="Paginação das procurações"
          className="flex items-center justify-between"
        >
          <Button
            variante="contorno"
            disabled={pagina === 1}
            onClick={() => definir({ Pagina: String(pagina - 1) }, false)}
          >
            <ChevronLeft aria-hidden="true" />
            Anterior
          </Button>
          <span className="text-body-sm text-muted-foreground">
            Página {pagina} de {Math.ceil(query.data.total / limite)} ·{' '}
            {query.data.total} versões
          </span>
          <Button
            variante="contorno"
            disabled={pagina * limite >= query.data.total}
            onClick={() => definir({ Pagina: String(pagina + 1) }, false)}
          >
            Próxima
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
      <p role="note" className="text-body-sm text-muted-foreground">
        Declaração conferida pelo escritório; sem validação automática pela
        Receita Federal.
      </p>
    </section>
  );
};
