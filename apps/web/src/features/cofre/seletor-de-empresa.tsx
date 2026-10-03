/**
 * Escolha da empresa do certificado (COMPONENTS.md §1.4: seletor de empresa é
 * sempre busca, porque a carteira tem centenas de CNPJs). A busca roda no
 * servidor, por nome ou CNPJ, e só empresas em que a pessoa pode enviar
 * certificado são selecionáveis; as demais aparecem com o motivo.
 */
'use client';

import { Building2, ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ItemDoCofre } from '@contaia/shared';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { juntar } from './estilos';
import { cnpjFormatado } from '../carteira/rotulos';
import { APRESENTACAO_DO_ESTADO, podeEnviar } from './apresentacao';
import { useCofre } from './queries';

const POR_PAGINA = 8;
const ATRASO_DA_BUSCA_MS = 300;

const Opcao = ({
  item,
  selecionada,
  aoEscolher,
}: {
  item: ItemDoCofre;
  selecionada: boolean;
  aoEscolher: (item: ItemDoCofre) => void;
}) => {
  const estado = APRESENTACAO_DO_ESTADO[item.estado];
  const liberada = podeEnviar(item);

  return (
    <li>
      <button
        type="button"
        data-opcao-de-empresa=""
        disabled={!liberada}
        aria-pressed={selecionada}
        onClick={() => aoEscolher(item)}
        className={juntar(
          'flex w-full flex-col gap-xs rounded-md px-md py-sm text-left transition-colors duration-fast ease-out',
          'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
          selecionada && 'bg-accent',
        )}
      >
        <span className="break-words text-title-sm text-foreground">{item.empresaNome}</span>
        <span className="flex flex-wrap items-center gap-x-sm gap-y-xs">
          <span className="font-mono text-code-sm tabular-nums text-muted-foreground">
            {cnpjFormatado(item.cnpj)}
          </span>
          <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />
          {liberada ? null : (
            <span className="text-body-sm text-muted-foreground">Sem permissão para enviar</span>
          )}
        </span>
      </button>
    </li>
  );
};

export const SeletorDeEmpresa = ({
  id,
  empresa,
  erro,
  desabilitado = false,
  aoEscolher,
}: {
  id: string;
  empresa: ItemDoCofre | null;
  erro: string | undefined;
  desabilitado?: boolean;
  aoEscolher: (item: ItemDoCofre) => void;
}) => {
  const idGerado = useId();
  const idDoErro = `${idGerado}-erro`;
  const lista = useRef<HTMLUListElement>(null);
  const [aberto, definirAberto] = useState(false);
  const [rascunho, definirRascunho] = useState('');
  const [busca, definirBusca] = useState('');
  const temErro = erro !== undefined && erro.length > 0;

  useEffect(() => {
    const temporizador = setTimeout(() => definirBusca(rascunho.trim()), ATRASO_DA_BUSCA_MS);

    return () => clearTimeout(temporizador);
  }, [rascunho]);

  const { data, isPending, isError, refetch } = useCofre(
    { busca: busca.length > 0 ? busca : null, estado: null, ordem: 'EMPRESA', pagina: 1, limite: POR_PAGINA },
    aberto,
  );

  const alternar = (proximo: boolean): void => {
    definirAberto(proximo);

    if (proximo) {
      definirRascunho('');
      definirBusca('');
    }
  };

  const escolher = (item: ItemDoCofre): void => {
    aoEscolher(item);
    definirAberto(false);
  };

  const navegar = (evento: KeyboardEvent<HTMLElement>): void => {
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') {
      return;
    }

    const opcoes = [...(lista.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const atual = opcoes.findIndex((opcao) => opcao === document.activeElement);
    const proxima = evento.key === 'ArrowDown' ? atual + 1 : atual - 1;

    evento.preventDefault();
    opcoes[Math.max(0, Math.min(opcoes.length - 1, proxima))]?.focus();
  };

  return (
    <div className="flex w-full flex-col gap-xs">
      <label id={`${id}-rotulo`} htmlFor={id} className="text-label-md text-foreground">
        Empresa
        <span className="ml-xs text-danger-foreground" aria-hidden="true">
          *
        </span>
      </label>

      <Popover open={aberto} onOpenChange={alternar}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={desabilitado}
            aria-haspopup="dialog"
            // O rótulo sozinho esconderia a empresa escolhida: o nome acessível diz as duas coisas.
            aria-labelledby={`${id}-rotulo ${id}-valor`}
            aria-describedby={temErro ? idDoErro : undefined}
            className={juntar(
              'flex min-h-11 w-full items-center justify-between gap-sm rounded-md border bg-card px-md py-xs text-left',
              'text-body-md text-foreground transition-colors duration-fast ease-out tablet:min-h-10',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50',
              temErro ? 'border-destructive' : 'border-input',
            )}
          >
            {empresa === null ? (
              <span id={`${id}-valor`} className="text-muted-foreground/70">
                Buscar por nome ou CNPJ
              </span>
            ) : (
              <span id={`${id}-valor`} className="flex min-w-0 flex-col">
                <span className="break-words">{empresa.empresaNome}</span>
                <span className="font-mono text-code-xs tabular-nums text-muted-foreground">
                  {cnpjFormatado(empresa.cnpj)}
                </span>
              </span>
            )}
            <ChevronsUpDown className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="flex w-[min(30rem,calc(100vw-2rem))] flex-col gap-sm p-sm"
          onKeyDown={navegar}
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-md top-1/2 size-icon-sm -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={rascunho}
              onChange={(evento) => definirRascunho(evento.target.value)}
              aria-label="Buscar empresa por nome ou CNPJ"
              placeholder="Nome ou CNPJ"
              className={juntar(
                'h-11 w-full rounded-md border border-input bg-card pl-[2.25rem] pr-md text-body-md text-foreground',
                'placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-ring tablet:h-10',
              )}
            />
          </div>

          <div aria-live="polite" aria-busy={isPending}>
            {isPending ? (
              <div className="flex flex-col gap-xs">
                <span className="sr-only">Buscando empresas</span>
                {Array.from({ length: 3 }, (_, indice) => (
                  <Skeleton key={indice} className="h-14 w-full" />
                ))}
              </div>
            ) : isError ? (
              <div className="flex flex-col items-start gap-sm p-sm">
                <p role="alert" className="text-body-sm text-danger-foreground">
                  Não foi possível buscar as empresas.
                </p>
                <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
                  Tentar de novo
                </Button>
              </div>
            ) : data.itens.length === 0 ? (
              <p className="flex items-center gap-sm p-sm text-body-sm text-muted-foreground">
                <Building2 className="size-icon-sm shrink-0" aria-hidden="true" />
                Nenhuma empresa da sua carteira corresponde à busca.
              </p>
            ) : (
              <ul ref={lista} aria-label="Empresas encontradas" className="flex max-h-72 flex-col overflow-y-auto">
                {data.itens.map((item) => (
                  <Opcao
                    key={item.empresaId}
                    item={item}
                    selecionada={item.empresaId === empresa?.empresaId}
                    aoEscolher={escolher}
                  />
                ))}
              </ul>
            )}
          </div>

          {data !== undefined && data.total > data.itens.length ? (
            <p className="px-sm text-body-sm text-muted-foreground">
              Mostrando {data.itens.length} de {data.total.toLocaleString('pt-BR')} empresas. Refine a busca para
              encontrar a sua.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>

      {temErro ? (
        <p id={idDoErro} className="text-body-sm text-danger-foreground">
          {erro}
        </p>
      ) : null}
    </div>
  );
};
