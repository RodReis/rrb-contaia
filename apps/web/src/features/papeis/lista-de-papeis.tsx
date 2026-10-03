/**
 * Aba "Papéis e permissões" (SPEC-008 §5.1): a seção `Papéis padrão`, somente
 * leitura, e a seção `Papéis personalizados`, com busca por nome, filtro de
 * estado (`Ativos` por padrão), contagem e paginação de servidor. Busca, filtro
 * e página vivem na URL (FRONTEND.md §7).
 *
 * Abaixo de 1024px a tabela vira cartões, como na lista de usuários: com ações
 * por linha, a tabela não cabe em 768px sem cortar o que se faz com o papel.
 */
'use client';

import type { EstadoDoPapel } from '@contaia/domain';
import { Plus, Search, ShieldPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { ErroDaConsulta } from '../usuarios/erro-da-consulta';
import { DESCRICAO_DO_PAPEL, ROTULO_DO_PAPEL } from '../usuarios/rotulos';
import type { VisaoDePapel } from './api';
import { useArquivarPapel, useCatalogo, useListaDePapeis } from './queries';
import { ESTADO_DO_PAPEL, textoDeUsuarios } from './rotulos';
import { ResumoDaMatriz } from './resumo-da-matriz';

const POR_PAGINA = 25;
const ATRASO_DA_BUSCA_MS = 300;
const BASE = '/configuracoes/usuarios?aba=papeis';
const NOVO = '/configuracoes/usuarios/papeis/novo';
const TODOS = 'todos';
const ATIVOS = 'ATIVO';

const OPCOES_DE_ESTADO = [
  { valor: ATIVOS, rotulo: 'Ativos' },
  { valor: 'ARQUIVADO', rotulo: 'Arquivados' },
  { valor: TODOS, rotulo: 'Todos' },
] as const;

const urlDoPapel = (id: string): string => `/configuracoes/usuarios/papeis/${id}`;

// -- Papéis padrão -----------------------------------------------------------

const PapeisPadrao = () => {
  const { data: catalogo, isPending, isError, error, refetch } = useCatalogo();

  return (
    <section aria-labelledby="papeis-padrao" className="flex flex-col gap-md">
      <div className="flex flex-col gap-xs">
        <h2 id="papeis-padrao" className="text-headline-sm text-foreground">
          Papéis padrão
        </h2>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Vêm com o produto e não podem ser editados. Um papel personalizado nasce como uma cópia de
          um deles, e dali em diante os dois seguem separados. Quando um usuário tem mais de um
          papel, as permissões se somam.
        </p>
      </div>

      {isPending ? (
        <div className="grid gap-md tablet:grid-cols-2" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando os papéis padrão</span>
          {Array.from({ length: 4 }, (_, indice) => (
            <Skeleton key={indice} className="h-28 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível carregar os papéis padrão"
          aoTentarDeNovo={() => void refetch()}
        />
      ) : (
        <ul className="grid gap-md tablet:grid-cols-2">
          {catalogo.papeisPadrao.map((item) => (
            <li key={item.papel}>
              <article
                aria-labelledby={`papel-${item.papel}`}
                className="flex h-full flex-col gap-sm rounded-lg border border-border bg-card p-lg"
              >
                <header className="flex flex-col gap-xs">
                  <h3 id={`papel-${item.papel}`} className="text-title-md text-foreground">
                    {ROTULO_DO_PAPEL[item.papel]}
                  </h3>
                  <p className="text-body-sm text-muted-foreground">{DESCRICAO_DO_PAPEL[item.papel]}</p>
                </header>
                <details className="group">
                  <summary className="cursor-pointer rounded-md text-label-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                    Ver o que concede
                  </summary>
                  <div className="pt-sm">
                    <ResumoDaMatriz catalogo={catalogo} permissoes={item.permissoes} />
                  </div>
                </details>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// -- Papéis personalizados ---------------------------------------------------

const AcoesDoPapel = ({
  papel,
  podeAdministrar,
}: {
  papel: VisaoDePapel;
  podeAdministrar: boolean;
}) => {
  const arquivar = useArquivarPapel(papel.id);

  if (!podeAdministrar) {
    return (
      <Button asChild variante="fantasma" tamanho="compacto">
        <Link href={urlDoPapel(papel.id)} aria-label={`Ver — ${papel.nome}`}>
          Ver
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-xs">
      <Button asChild variante="fantasma" tamanho="compacto">
        <Link
          href={urlDoPapel(papel.id)}
          aria-label={`${papel.estado === 'ATIVO' ? 'Editar' : 'Reativar'} — ${papel.nome}`}
        >
          {papel.estado === 'ATIVO' ? 'Editar' : 'Reativar'}
        </Link>
      </Button>

      {papel.estado === 'ATIVO' ? (
        <ConfirmacaoDeAcao
          gatilho={
            <Button variante="fantasma" tamanho="compacto" aria-label={`Arquivar — ${papel.nome}`}>
              Arquivar
            </Button>
          }
          titulo={`Arquivar “${papel.nome}”?`}
          descricao={
            papel.usuariosVinculados > 0
              ? `Este papel está atribuído a ${textoDeUsuarios(papel.usuariosVinculados)}. Só é possível arquivar depois de remover ou substituir o papel neles.`
              : 'O papel deixa de poder ser atribuído. A definição, as revisões e o histórico são mantidos: nada é excluído, e você pode reativá-lo depois, revisando as permissões.'
          }
          rotuloDeConfirmacao="Arquivar papel"
          destrutivo
          explicarBloqueio={(erro) =>
            erro instanceof ErroDaApi && erro.problema.code === 'PAPEL_EM_USO'
              ? `Este papel está atribuído a ${textoDeUsuarios(papel.usuariosVinculados)}. Remova ou substitua o papel nesses usuários antes de arquivar.`
              : null
          }
          aoConfirmar={() => arquivar.mutateAsync(papel.revisao)}
        />
      ) : null}
    </div>
  );
};

const Estado = ({ estado }: { estado: EstadoDoPapel }) => {
  const { rotulo, tom } = ESTADO_DO_PAPEL[estado];

  return <StatusBadge tom={tom} rotulo={rotulo} />;
};

const LinhaDoPapel = ({
  papel,
  podeAdministrar,
}: {
  papel: VisaoDePapel;
  podeAdministrar: boolean;
}) => (
  <tr className="border-b border-border align-top last:border-b-0 hover:bg-accent/40">
    <td className="max-w-[22rem] px-md py-sm">
      <div className="flex flex-col gap-xs">
        <span className="break-words text-title-sm text-foreground">{papel.nome}</span>
        {papel.descricao === null ? null : (
          <span className="line-clamp-2 break-words text-body-sm text-muted-foreground">
            {papel.descricao}
          </span>
        )}
      </div>
    </td>
    <td className="px-md py-sm text-body-md text-muted-foreground">
      {ROTULO_DO_PAPEL[papel.papelBase]}
    </td>
    <td className="px-md py-sm">
      <Estado estado={papel.estado} />
    </td>
    <td className="px-md py-sm text-body-md tabular-nums text-muted-foreground">
      {papel.usuariosVinculados.toLocaleString('pt-BR')}
    </td>
    <td className="px-md py-sm text-right [&>div]:flex-nowrap">
      <AcoesDoPapel papel={papel} podeAdministrar={podeAdministrar} />
    </td>
  </tr>
);

const CartaoDoPapel = ({
  papel,
  podeAdministrar,
}: {
  papel: VisaoDePapel;
  podeAdministrar: boolean;
}) => (
  <li className="flex flex-col gap-sm rounded-lg border border-border bg-card p-md">
    <div className="flex flex-col gap-xs">
      <span className="break-words text-title-sm text-foreground">{papel.nome}</span>
      {papel.descricao === null ? null : (
        <span className="break-words text-body-sm text-muted-foreground">{papel.descricao}</span>
      )}
    </div>
    <dl className="flex flex-wrap gap-x-lg gap-y-xs text-body-sm">
      <div className="flex gap-xs">
        <dt className="text-muted-foreground">Base:</dt>
        <dd className="text-foreground">{ROTULO_DO_PAPEL[papel.papelBase]}</dd>
      </div>
      <div className="flex gap-xs">
        <dt className="text-muted-foreground">Usuários:</dt>
        <dd className="tabular-nums text-foreground">{papel.usuariosVinculados}</dd>
      </div>
    </dl>
    <Estado estado={papel.estado} />
    <AcoesDoPapel papel={papel} podeAdministrar={podeAdministrar} />
  </li>
);

const Esqueleto = () => (
  <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
    <span className="sr-only">Carregando os papéis personalizados</span>
    <Skeleton className="h-9 w-full" />
    {Array.from({ length: 4 }, (_, indice) => (
      <Skeleton key={indice} className="h-12 w-full" />
    ))}
  </div>
);

const PapeisPersonalizados = ({ podeAdministrar }: { podeAdministrar: boolean }) => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const buscaNaUrl = parametros.get('busca') ?? '';
  const estadoNaUrl = parametros.get('estado');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  // Sem `estado` na URL a lista mostra os ativos; "Todos" é seleção explícita (§5.1).
  const estadoDoFiltro: EstadoDoPapel | null =
    estadoNaUrl === TODOS ? null : estadoNaUrl === 'ARQUIVADO' ? 'ARQUIVADO' : 'ATIVO';

  // A busca digita rápido e a URL é o estado: o campo publica na URL só depois do debounce.
  const [rascunho, definirRascunho] = useState<string | null>(null);
  const buscaDigitada = rascunho ?? buscaNaUrl;

  // O debounce dispara com a URL de agora, não a do render em que foi agendado.
  const parametrosDeAgora = useRef(parametros);

  useEffect(() => {
    parametrosDeAgora.current = parametros;
  });

  const ir = (proximos: URLSearchParams): void => {
    const texto = proximos.toString();

    navegador.replace(texto === '' ? BASE : `${BASE}&${texto}`, { scroll: false });
  };

  const publicar = (ajustar: (proximos: URLSearchParams) => void): void => {
    const proximos = new URLSearchParams(parametrosDeAgora.current.toString());

    proximos.delete('aba');
    ajustar(proximos);
    // Qualquer mudança de filtro volta à primeira página.
    proximos.delete('pagina');
    ir(proximos);
  };

  useEffect(() => {
    if (rascunho === null || rascunho === buscaNaUrl) {
      return;
    }

    const temporizador = setTimeout(() => {
      publicar((proximos) => {
        if (rascunho.length > 0) {
          proximos.set('busca', rascunho);
        } else {
          proximos.delete('busca');
        }
      });
    }, ATRASO_DA_BUSCA_MS);

    return () => clearTimeout(temporizador);
    // `publicar` só lê a URL de agora (ref): depender dela reiniciaria o debounce a cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho, buscaNaUrl]);

  const filtro = useMemo(
    () => ({
      busca: buscaNaUrl.length > 0 ? buscaNaUrl : null,
      estado: estadoDoFiltro,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [buscaNaUrl, estadoDoFiltro, paginaNaUrl],
  );

  const { data, isPending, isError, error, refetch, isPlaceholderData } = useListaDePapeis(filtro);

  const definirEstado = (valor: string): void =>
    publicar((proximos) => {
      if (valor === ATIVOS) {
        proximos.delete('estado');
      } else {
        proximos.set('estado', valor);
      }
    });

  const irParaPagina = (pagina: number): void => {
    const proximos = new URLSearchParams(parametros.toString());

    proximos.delete('aba');

    if (pagina <= 1) {
      proximos.delete('pagina');
    } else {
      proximos.set('pagina', String(pagina));
    }

    ir(proximos);
  };

  const limpar = (): void => {
    definirRascunho(null);
    navegador.replace(BASE, { scroll: false });
  };

  const temFiltro = filtro.busca !== null || estadoDoFiltro !== 'ATIVO';
  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));

  const criar = podeAdministrar ? (
    <Button asChild>
      <Link href={NOVO}>
        <Plus aria-hidden="true" />
        Criar papel
      </Link>
    </Button>
  ) : undefined;

  const barraDeFiltro = (
    <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
      <div className="flex-1">
        <Campo
          rotulo="Buscar papel"
          placeholder="Nome do papel"
          value={buscaDigitada}
          onValorChange={definirRascunho}
          type="search"
          inputMode="search"
          ajuda="A busca considera o nome do papel."
        />
      </div>
      <div className="w-full tablet:w-[12rem]">
        <Select
          rotulo="Situação do papel"
          opcoes={OPCOES_DE_ESTADO}
          valor={estadoNaUrl === TODOS ? TODOS : (estadoDoFiltro ?? ATIVOS)}
          onValorChange={definirEstado}
          ajuda="Ativos por padrão."
        />
      </div>
      {temFiltro ? (
        <Button variante="contorno" tamanho="compacto" onClick={limpar}>
          Limpar
        </Button>
      ) : null}
    </div>
  );

  return (
    <section aria-labelledby="papeis-personalizados" className="flex flex-col gap-md">
      <div className="flex flex-col gap-xs">
        <h2 id="papeis-personalizados" className="text-headline-sm text-foreground">
          Papéis personalizados
        </h2>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Papéis próprios do escritório, com permissões ajustadas por módulo, funcionalidade e
          ação. Uma mudança vale na próxima requisição de cada usuário vinculado.
        </p>
      </div>

      {barraDeFiltro}

      {isPending ? (
        <Esqueleto />
      ) : isError ? (
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível carregar os papéis personalizados"
          aoTentarDeNovo={() => void refetch()}
        />
      ) : (
        <>
          {/* Contagem total visível: o usuário precisa saber o tamanho do universo antes de agir. */}
          <p className="text-body-sm text-muted-foreground" aria-live="polite">
            {data.total === 1
              ? '1 papel personalizado.'
              : `${data.total.toLocaleString('pt-BR')} papéis personalizados.`}
          </p>

          {data.papeis.length === 0 ? (
            // As causas do vazio têm textos distintos (PATTERNS.md §5).
            temFiltro ? (
              <EmptyState
                nivel={3}
                icone={<Search />}
                titulo="Nenhum papel encontrado"
                descricao="Nenhum papel corresponde à busca ou ao filtro aplicados. Ajuste os critérios para ver mais resultados."
                acao={
                  <Button variante="contorno" tamanho="compacto" onClick={limpar}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <EmptyState
                nivel={3}
                icone={<ShieldPlus />}
                titulo="Nenhum papel personalizado"
                descricao="Crie um papel a partir de um dos papéis padrão e ajuste as permissões à rotina do escritório."
                {...(criar === undefined ? {} : { acao: criar })}
              />
            )
          ) : (
            <div
              className={isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined}
            >
              <ul className="grid gap-sm tablet:grid-cols-2 desktop:hidden" aria-label="Papéis personalizados">
                {data.papeis.map((papel) => (
                  <CartaoDoPapel key={papel.id} papel={papel} podeAdministrar={podeAdministrar} />
                ))}
              </ul>

              <div className="hidden overflow-hidden rounded-lg border border-border bg-card desktop:block">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">
                    Papéis personalizados deste escritório, com base, situação e usuários vinculados
                  </caption>
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {['Nome', 'Base original', 'Situação', 'Usuários'].map((titulo) => (
                        <th
                          key={titulo}
                          scope="col"
                          className="px-md py-sm text-label-sm uppercase text-muted-foreground"
                        >
                          {titulo}
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="px-md py-sm text-right text-label-sm uppercase text-muted-foreground"
                      >
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.papeis.map((papel) => (
                      <LinhaDoPapel key={papel.id} papel={papel} podeAdministrar={podeAdministrar} />
                    ))}
                  </tbody>
                </table>
              </div>

              {totalDePaginas > 1 ? (
                <nav
                  className="flex items-center justify-between gap-md pt-md"
                  aria-label="Paginação dos papéis personalizados"
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
        </>
      )}
    </section>
  );
};

export const ListaDePapeis = ({ podeAdministrar }: { podeAdministrar: boolean }) => (
  <div className="flex flex-col gap-xl">
    <PapeisPadrao />
    <PapeisPersonalizados podeAdministrar={podeAdministrar} />
  </div>
);
