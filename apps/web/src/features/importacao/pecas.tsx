/**
 * Peças pequenas das abas de importação: código de suporte copiável, download com estado de
 * falha e paginação. Compostas a partir de `Button`; nenhuma vira componente do design system.
 */
'use client';

import { ChevronLeft, ChevronRight, Copy, Download, LoaderCircle } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { clsx } from 'clsx';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ErroDaApi, type Problema } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { baixarArquivo } from './api';
import { formatarNumero } from './apresentacao';

/** `correlationId` visível e copiável em um clique (PATTERNS.md §5): é o que o suporte pede. */
export const CodigoDeSuporte = ({ valor, className }: { valor: string; className?: string }) => {
  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success('Código de suporte copiado.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o código e copie manualmente.');
    }
  };

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-xs', className)}>
      <span>Código de suporte:</span>
      <code className="select-all rounded-sm bg-muted px-xs font-mono text-code-sm tabular-nums text-foreground [overflow-wrap:anywhere]">
        {valor}
      </code>
      <Button
        variante="fantasma"
        tamanho="icone"
        className="tablet:size-8"
        aria-label="Copiar código de suporte"
        onClick={() => void copiar()}
      >
        <Copy aria-hidden="true" />
      </Button>
    </span>
  );
};

/**
 * Download que pode falhar sem esconder o resto da tela (SPEC-013/014 §7, relatório indisponível): a
 * falha fica escrita ao lado do botão, com o código de suporte, e o mesmo botão tenta de novo.
 */
export const BotaoDeDownload = ({
  rotulo,
  caminho,
  nomePadrao,
  indisponivel,
  rotuloDeNovaTentativa,
  variante = 'contorno',
}: {
  rotulo: string;
  caminho: string;
  nomePadrao: string;
  /** Frase que abre a mensagem de falha (ex.: "O relatório não está disponível agora."). */
  indisponivel: string;
  /** Rótulo do mesmo botão depois da falha: diz o QUE será baixado de novo. */
  rotuloDeNovaTentativa: string;
  variante?: ComponentProps<typeof Button>['variante'];
}) => {
  const [baixando, definirBaixando] = useState(false);
  const [falha, definirFalha] = useState<Problema | null>(null);

  const baixar = async (): Promise<void> => {
    definirBaixando(true);
    definirFalha(null);

    try {
      await baixarArquivo(caminho, nomePadrao);
    } catch (erro) {
      definirFalha(
        erro instanceof ErroDaApi
          ? erro.problema
          : { type: 'x', title: 'x', status: 0, code: 'ERRO_DESCONHECIDO', correlationId: 'sem-correlacao' },
      );
    } finally {
      definirBaixando(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-xs">
      <Button variante={variante} tamanho="compacto" disabled={baixando} onClick={() => void baixar()}>
        {baixando ? (
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <Download aria-hidden="true" />
        )}
        {falha === null ? rotulo : rotuloDeNovaTentativa}
      </Button>

      {falha === null ? null : (
        <p role="alert" className="max-w-prose text-body-sm text-danger-foreground">
          {indisponivel} {mensagemDoCodigo(falha.code)}{' '}
          <CodigoDeSuporte valor={falha.correlationId} className="text-danger-foreground" />
        </p>
      )}
    </div>
  );
};

type BordasCortadas = { inicio: boolean; fim: boolean };

/** Tolerância de arredondamento do navegador (px fracionário) antes de dizer que há mais conteúdo. */
const FOLGA_DA_ROLAGEM = 1;

/** Que lados da região têm conteúdo escondido, relido a cada rolagem e mudança de tamanho. */
const useBordasCortadas = () => {
  const regiao = useRef<HTMLDivElement>(null);
  const [bordas, definirBordas] = useState<BordasCortadas>({ inicio: false, fim: false });

  useEffect(() => {
    const elemento = regiao.current;

    if (elemento === null) {
      return undefined;
    }

    const medir = (): void => {
      const { scrollLeft, scrollWidth, clientWidth } = elemento;
      const inicio = scrollLeft > FOLGA_DA_ROLAGEM;
      const fim = scrollLeft + clientWidth < scrollWidth - FOLGA_DA_ROLAGEM;
      definirBordas((atual) => (atual.inicio === inicio && atual.fim === fim ? atual : { inicio, fim }));
    };

    medir();
    elemento.addEventListener('scroll', medir, { passive: true });
    // jsdom não tem ResizeObserver; no navegador ele cobre a janela mudando e a tabela trocando de página.
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    observador?.observe(elemento);
    if (elemento.firstElementChild !== null) {
      observador?.observe(elemento.firstElementChild);
    }

    return () => {
      elemento.removeEventListener('scroll', medir);
      observador?.disconnect();
    };
  }, []);

  return { regiao, bordas };
};

const Esmaecido = ({ lado, visivel }: { lado: keyof BordasCortadas; visivel: boolean }) => (
  <span
    aria-hidden="true"
    data-borda={lado}
    className={clsx(
      'pointer-events-none absolute inset-y-0 w-xl from-card to-transparent transition-opacity duration-fast ease-out peer-focus-visible:opacity-0',
      lado === 'inicio' ? 'left-0 bg-linear-to-r' : 'right-0 bg-linear-to-l',
      visivel ? 'opacity-100' : 'opacity-0',
    )}
  />
);

/**
 * Contêiner de tabela larga que rola na horizontal. Precisa ser alcançável por teclado (WCAG 2.1.1,
 * axe `scrollable-region-focusable`): vira região nomeada, entra no Tab e mostra o anel de foco.
 *
 * `relative` é o que contém a rolagem: o texto `sr-only` das tabelas (legenda, cabeçalho "Ação") é
 * `position: absolute`; sem um ancestral posicionado ele escapa do `overflow` e alarga a página
 * (rolagem horizontal em 768 px, achada na prova visual do E2E).
 *
 * Quando a tabela não cabe, o lado cortado esmaece no fundo do cartão: a frase partida na borda
 * passa a dizer "continua ao lado" em vez de parecer texto truncado. Some no fim da rolagem e com o
 * foco de teclado (o anel de foco fica inteiro). Sem transbordo, nada muda.
 */
export const RegiaoRolavel = ({
  rotulo,
  className,
  children,
}: {
  /** Nome da região: diz que tabela é e que ela rola (não repete o título da seção). */
  rotulo: string;
  className?: string;
  children: ReactNode;
}) => {
  const { regiao, bordas } = useBordasCortadas();

  return (
    <div className="relative">
      <div
        ref={regiao}
        role="region"
        tabIndex={0}
        aria-label={rotulo}
        className={cn(
          'peer relative overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          className,
        )}
      >
        {children}
      </div>
      <Esmaecido lado="inicio" visivel={bordas.inicio} />
      <Esmaecido lado="fim" visivel={bordas.fim} />
    </div>
  );
};

export const Paginacao = ({
  rotulo,
  pagina,
  total,
  porPagina,
  aoIr,
  unidade,
}: {
  rotulo: string;
  pagina: number;
  total: number;
  porPagina: number;
  aoIr: (pagina: number) => void;
  /** Plural do que se conta (ex.: "importações"). */
  unidade: string;
}) => {
  const paginas = Math.max(1, Math.ceil(total / porPagina));

  if (total <= porPagina && pagina <= 1) {
    return null;
  }

  return (
    <nav
      aria-label={rotulo}
      className="flex flex-col gap-sm border-t border-border px-md py-sm tablet:flex-row tablet:items-center tablet:justify-between"
    >
      <p className="text-body-sm text-muted-foreground">
        Página <span className="font-mono tabular-nums">{formatarNumero(pagina)}</span> de{' '}
        <span className="font-mono tabular-nums">{formatarNumero(paginas)}</span> ·{' '}
        <span className="font-mono tabular-nums">{formatarNumero(total)}</span> {unidade}
      </p>
      <div className="flex gap-xs">
        <Button variante="contorno" tamanho="compacto" disabled={pagina <= 1} onClick={() => aoIr(pagina - 1)}>
          <ChevronLeft aria-hidden="true" />
          Anterior
        </Button>
        <Button
          variante="contorno"
          tamanho="compacto"
          disabled={pagina >= paginas}
          onClick={() => aoIr(pagina + 1)}
        >
          Próxima
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
};

/**
 * Cartão de seção da aba (COMPONENTS.md §3.1: `--card`, `radius-lg`, borda): título `headline-sm`
 * com ícone em ladrilho, como o cartão "Plano de contas" do protótipo, e ações à direita.
 */
export const Secao = ({
  id,
  icone,
  titulo,
  descricao,
  acoes,
  children,
  className,
  tituloRef,
}: {
  id: string;
  icone: ReactNode;
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Título que recebe o foco quando o controle acionado some (FRONTEND.md §17). */
  tituloRef?: Ref<HTMLHeadingElement>;
}) => (
  <section
    aria-labelledby={id}
    className={cn('flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-elevation-1', className)}
  >
    <header className="flex flex-col gap-md border-b border-border px-lg py-md tablet:flex-row tablet:items-center tablet:justify-between">
      <div className="flex items-start gap-sm">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&_svg]:size-icon-lg"
          aria-hidden="true"
        >
          {icone}
        </span>
        <div className="flex min-w-0 flex-col gap-xs">
          <h3
            id={id}
            ref={tituloRef}
            tabIndex={tituloRef === undefined ? undefined : -1}
            className="font-display text-headline-sm text-foreground focus-visible:outline-none"
          >
            {titulo}
          </h3>
          {descricao === undefined ? null : (
            <p className="max-w-prose text-body-sm text-muted-foreground">{descricao}</p>
          )}
        </div>
      </div>
      {acoes === undefined ? null : <div className="flex flex-wrap gap-sm">{acoes}</div>}
    </header>
    {children}
  </section>
);

/**
 * Código estável (`CODIGO_DUPLICADO_NO_ARQUIVO`) que só quebra linha depois de cada `_`. O `<wbr>`
 * não vira texto: copiar devolve o código exato. `break-word` fica como último recurso para um
 * pedaço longo demais; `anywhere` não serve, porque entra na largura mínima da coluna da tabela e
 * a encolhe até quebrar o código no meio da palavra.
 */
export const CodigoQuebravel = ({ codigo, className }: { codigo: string; className?: string }) => {
  const partes = codigo.split('_');

  return (
    // `clsx`, não `cn`: o tailwind-merge não conhece os tamanhos do tema (`text-code-xs`) e os descartaria
    // como conflito com a cor (`text-muted-foreground`).
    <code className={clsx('font-mono [overflow-wrap:break-word]', className)}>
      {partes.map((parte, indice) => (
        <Fragment key={indice}>
          {parte}
          {indice < partes.length - 1 ? (
            <>
              _<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </code>
  );
};
