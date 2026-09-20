/**
 * Listagem de empresas clientes (SPEC-002 §3.1).
 *
 * Busca, filtro e página vivem na URL (FRONTEND.md §7): a listagem é conferida
 * e auditada, então o estado precisa ser compartilhável e sobreviver ao
 * recarregamento e à volta do wizard.
 *
 * A tabela é da fatia e não o `DataTable` do catálogo, que ainda não existe no
 * repositório. Declarado na PR: paginação de servidor já ativa (25/página) e
 * colapso em cartões abaixo de 768px, conforme a pendência P-02 do DEBITO.md.
 */
'use client';

import { Building2, Plus, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { formatarCnpj } from '@contaia/domain';
import type { StatusDaEmpresa } from '@contaia/domain';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { EmpresaNaLista } from './api';
import { useListaDeEmpresas } from './queries';

const POR_PAGINA = 25;
const ATRASO_DA_BUSCA_MS = 300;

const ROTULO_DO_REGIME: Readonly<Record<string, string>> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};

const STATUS: Readonly<Record<StatusDaEmpresa, { rotulo: string; tom: TomDoStatus }>> = {
  ATIVA: { rotulo: 'Ativa', tom: 'conforme' },
  CADASTRO_INCOMPLETO: { rotulo: 'Incompleta', tom: 'atencao' },
};

const OPCOES_DE_STATUS = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'ATIVA', rotulo: 'Ativa' },
  { valor: 'CADASTRO_INCOMPLETO', rotulo: 'Incompleta' },
] as const;

const ehStatus = (valor: string | null): valor is StatusDaEmpresa =>
  valor === 'ATIVA' || valor === 'CADASTRO_INCOMPLETO';

const Cabecalho = ({ total }: { total: number | null }) => (
  <header className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
    <div className="flex flex-col gap-xs">
      <h1 className="font-display text-headline-lg text-foreground">Empresas</h1>
      <p className="max-w-prose text-body-md text-muted-foreground">
        {/* Contagem total visível: o usuário precisa saber o tamanho do universo
            antes de agir (FRONTEND.md §10.2). */}
        {total === null
          ? 'Carteira de empresas clientes atendidas por este escritório.'
          : total === 1
            ? '1 empresa na carteira deste escritório.'
            : `${total.toLocaleString('pt-BR')} empresas na carteira deste escritório.`}
      </p>
    </div>

    <Button asChild>
      <Link href="/empresas/nova">
        <Plus aria-hidden="true" />
        Cadastrar empresa
      </Link>
    </Button>
  </header>
);

const LinhaDaEmpresa = ({ empresa }: { empresa: EmpresaNaLista }) => {
  const status = STATUS[empresa.status];
  const incompleta = empresa.status === 'CADASTRO_INCOMPLETO';
  const nome = empresa.nomeFantasia ?? empresa.razaoSocial ?? 'Empresa sem nome';

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-accent/40">
      <td className="px-md py-sm">
        <div className="flex flex-col gap-xs">
          <span className="text-title-sm text-foreground">{nome}</span>
          {empresa.razaoSocial !== null && empresa.razaoSocial !== empresa.nomeFantasia ? (
            <span className="text-body-sm text-muted-foreground">{empresa.razaoSocial}</span>
          ) : null}
        </div>
      </td>
      <td className="px-md py-sm">
        <span className="font-mono text-code-sm tabular-nums text-foreground">
          {formatarCnpj(empresa.cnpj)}
        </span>
      </td>
      <td className="px-md py-sm text-body-sm text-muted-foreground">
        {empresa.regimeTributario === null
          ? '—'
          : (ROTULO_DO_REGIME[empresa.regimeTributario] ?? empresa.regimeTributario)}
      </td>
      <td className="px-md py-sm">
        <StatusBadge tom={status.tom} rotulo={status.rotulo} />
      </td>
      <td className="px-md py-sm text-right">
        <Button asChild variante="fantasma" tamanho="compacto">
          <Link href={`/empresas/${empresa.id}`}>
            {incompleta ? 'Continuar cadastro' : 'Abrir'}
          </Link>
        </Button>
      </td>
    </tr>
  );
};

const CartaoDaEmpresa = ({ empresa }: { empresa: EmpresaNaLista }) => {
  const status = STATUS[empresa.status];
  const nome = empresa.nomeFantasia ?? empresa.razaoSocial ?? 'Empresa sem nome';

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-border bg-card p-md">
      <div className="flex items-start justify-between gap-sm">
        <span className="text-title-sm text-foreground">{nome}</span>
        <StatusBadge tom={status.tom} rotulo={status.rotulo} />
      </div>
      <span className="font-mono text-code-sm tabular-nums text-muted-foreground">
        {formatarCnpj(empresa.cnpj)}
      </span>
      {empresa.regimeTributario !== null ? (
        <span className="text-body-sm text-muted-foreground">
          {ROTULO_DO_REGIME[empresa.regimeTributario] ?? empresa.regimeTributario}
        </span>
      ) : null}
      <Button asChild variante="contorno" tamanho="compacto">
        <Link href={`/empresas/${empresa.id}`}>
          {empresa.status === 'CADASTRO_INCOMPLETO' ? 'Continuar cadastro' : 'Abrir'}
        </Link>
      </Button>
    </li>
  );
};

const EsqueletoDaTabela = () => (
  <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
    <span className="sr-only">Carregando as empresas do escritório</span>
    {/* Skeleton com a forma da tabela, não spinner (FRONTEND.md §21). */}
    <Skeleton className="h-9 w-full" />
    {Array.from({ length: 6 }, (_, indice) => (
      <Skeleton key={indice} className="h-12 w-full" />
    ))}
  </div>
);

export const ListaDeEmpresas = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const buscaNaUrl = parametros.get('busca') ?? '';
  const statusNaUrl = parametros.get('status');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  // A busca digita rápido e a URL é o estado: o campo publica na URL só depois
  // do debounce, senão cada tecla empilha uma entrada no histórico e uma
  // requisição.
  //
  // `null` significa "nada digitado desde a última publicação": o valor exibido
  // é então derivado da URL. Guardar o texto num estado espelhado por efeito
  // criaria renderização em cascata e deixaria o campo dessincronizado quando a
  // URL mudasse por fora (voltar no histórico, link com filtro).
  const [rascunhoDaBusca, definirRascunho] = useState<string | null>(null);
  const buscaDigitada = rascunhoDaBusca ?? buscaNaUrl;

  useEffect(() => {
    if (rascunhoDaBusca === null || rascunhoDaBusca === buscaNaUrl) {
      return;
    }

    const digitado = rascunhoDaBusca;

    const temporizador = setTimeout(() => {
      const proximos = new URLSearchParams(parametros.toString());

      if (digitado.length > 0) {
        proximos.set('busca', digitado);
      } else {
        proximos.delete('busca');
      }

      // Busca nova volta para a primeira página: manter a página 4 de um
      // resultado que agora tem uma página mostraria vazio por engano.
      proximos.delete('pagina');
      navegador.replace(`/empresas?${proximos.toString()}`, { scroll: false });
    }, ATRASO_DA_BUSCA_MS);

    return () => clearTimeout(temporizador);
  }, [rascunhoDaBusca, buscaNaUrl, navegador, parametros]);

  const filtro = useMemo(
    () => ({
      busca: buscaNaUrl.length > 0 ? buscaNaUrl : null,
      status: ehStatus(statusNaUrl) ? statusNaUrl : null,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [buscaNaUrl, statusNaUrl, paginaNaUrl],
  );

  const { data, isPending, isError, error, refetch, isPlaceholderData } =
    useListaDeEmpresas(filtro);

  const trocarStatus = (valor: string): void => {
    const proximos = new URLSearchParams(parametros.toString());

    if (valor === 'todas') {
      proximos.delete('status');
    } else {
      proximos.set('status', valor);
    }

    proximos.delete('pagina');
    navegador.replace(`/empresas?${proximos.toString()}`, { scroll: false });
  };

  const irParaPagina = (pagina: number): void => {
    const proximos = new URLSearchParams(parametros.toString());

    if (pagina <= 1) {
      proximos.delete('pagina');
    } else {
      proximos.set('pagina', String(pagina));
    }

    navegador.replace(`/empresas?${proximos.toString()}`, { scroll: false });
  };

  const limparFiltros = (): void => {
    definirRascunho(null);
    navegador.replace('/empresas', { scroll: false });
  };

  const temFiltroAtivo = buscaNaUrl.length > 0 || ehStatus(statusNaUrl);
  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));

  const barraDeFiltro = (
    <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
      <div className="flex-1">
        <Campo
          rotulo="Buscar"
          placeholder="Nome fantasia, razão social ou CNPJ"
          value={buscaDigitada}
          onValorChange={definirRascunho}
          type="search"
          inputMode="search"
          ajuda="A busca considera nome fantasia, razão social e CNPJ."
        />
      </div>
      <div className="tablet:w-56">
        <Select
          rotulo="Situação"
          opcoes={OPCOES_DE_STATUS}
          valor={ehStatus(statusNaUrl) ? statusNaUrl : 'todas'}
          onValorChange={trocarStatus}
        />
      </div>
      {temFiltroAtivo ? (
        <Button variante="contorno" tamanho="compacto" onClick={limparFiltros}>
          <SlidersHorizontal aria-hidden="true" />
          Limpar
        </Button>
      ) : null}
    </div>
  );

  if (isPending) {
    return (
      <div className="flex flex-col gap-xl">
        <Cabecalho total={null} />
        {barraDeFiltro}
        <EsqueletoDaTabela />
      </div>
    );
  }

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <div className="flex flex-col gap-xl">
        <Cabecalho total={null} />
        {barraDeFiltro}
        <ErroDeTela
          nivel={2}
          titulo="Não foi possível carregar as empresas"
          descricao={
            problema === null ? 'Tente novamente em instantes.' : mensagemDoCodigo(problema.code)
          }
          correlationId={problema?.correlationId}
          acao={
            <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho total={data.total} />
      {barraDeFiltro}

      {data.empresas.length === 0 ? (
        // As três causas do vazio têm textos distintos (PATTERNS.md §5):
        // filtro sem resultado não é o mesmo que carteira vazia.
        temFiltroAtivo ? (
          <EmptyState
            nivel={2}
            icone={<Search />}
            titulo="Nenhuma empresa encontrada"
            descricao="Nenhuma empresa corresponde à busca ou ao filtro aplicado. Ajuste os critérios para ver mais resultados."
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={limparFiltros}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            nivel={2}
            icone={<Building2 />}
            titulo="Nenhuma empresa cadastrada"
            descricao="Cadastre a primeira empresa cliente para começar a acompanhar obrigações e documentos no ContaIA."
            acao={
              <Button asChild>
                <Link href="/empresas/nova">
                  <Plus aria-hidden="true" />
                  Cadastrar empresa
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <div
          className={
            // Enquanto a próxima página carrega, a atual continua visível e
            // levemente apagada: a tabela não pisca nem salta.
            isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined
          }
        >
          {/* Abaixo de 768px a tabela vira cartões (pendência P-02). */}
          <ul className="flex flex-col gap-sm tablet:hidden">
            {data.empresas.map((empresa) => (
              <CartaoDaEmpresa key={empresa.id} empresa={empresa} />
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card tablet:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Empresas clientes deste escritório, com CNPJ, regime tributário e situação do
                cadastro
              </caption>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                    Empresa
                  </th>
                  <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                    CNPJ
                  </th>
                  <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                    Regime
                  </th>
                  <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                    Situação
                  </th>
                  <th scope="col" className="px-md py-sm text-right text-label-sm uppercase text-muted-foreground">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.empresas.map((empresa) => (
                  <LinhaDaEmpresa key={empresa.id} empresa={empresa} />
                ))}
              </tbody>
            </table>
          </div>

          {totalDePaginas > 1 ? (
            <nav
              className="flex items-center justify-between gap-md pt-md"
              aria-label="Paginação das empresas"
            >
              <p className="text-body-sm text-muted-foreground">
                Página {paginaNaUrl} de {totalDePaginas}
              </p>
              <div className="flex gap-xs">
                <Button
                  variante="contorno"
                  tamanho="compacto"
                  disabled={paginaNaUrl <= 1}
                  onClick={() => irParaPagina(paginaNaUrl - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variante="contorno"
                  tamanho="compacto"
                  disabled={paginaNaUrl >= totalDePaginas}
                  onClick={() => irParaPagina(paginaNaUrl + 1)}
                >
                  Próxima
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
};
