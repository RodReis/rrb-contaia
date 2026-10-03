/**
 * Central de Carteiras (SPEC-009 §5.1): lista orientada a colaboradores, com
 * nome, e-mail, papéis, situação e quantidade de empresas. Busca, filtros e página
 * vivem na URL (FRONTEND.md §7); a seleção — que alimenta as operações em lote —
 * é estado local, porque ainda não é uma visão que valha compartilhar.
 *
 * Abaixo de 1024px a tabela vira cartões, como na lista de usuários: com seis
 * colunas e ação por linha, a tabela não cabe em 768px sem cortar a ação.
 */
'use client';

import { PAPEIS_PADRAO } from '@contaia/domain';
import type { EstadoDoUsuario, PapelPadrao } from '@contaia/domain';
import { Briefcase, Minus, Plus, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import { ErroDaConsulta } from '../usuarios/erro-da-consulta';
import { ROTULO_DO_PAPEL } from '../usuarios/rotulos';
import type { ColaboradorNaCentral, SituacaoDaCarteira } from './api';
import { DialogoDeLote } from './dialogo-de-lote';
import { obterColaborador } from './api';
import { useColaboradores } from './queries';
import { ROTULO_DA_SITUACAO, ROTULO_DO_ESTADO, plural } from './rotulos';

const POR_PAGINA = 25;
const ATRASO_DA_BUSCA_MS = 300;
const BASE = '/configuracoes/usuarios';
const ABA = 'carteiras';
const TODOS = 'todos';
export const CAMINHO_DA_GESTAO = `${BASE}/carteiras`;

const ESTADOS: readonly EstadoDoUsuario[] = ['CONVIDADO', 'ATIVO', 'SUSPENSO', 'ARQUIVADO'];
const SITUACOES: readonly SituacaoDaCarteira[] = ['COM_EMPRESAS', 'SEM_EMPRESAS'];

const OPCOES_DE_ESTADO = [
  { valor: 'ATIVO', rotulo: 'Ativos' },
  { valor: 'CONVIDADO', rotulo: 'Convidados' },
  { valor: 'SUSPENSO', rotulo: 'Suspensos' },
  { valor: 'ARQUIVADO', rotulo: 'Arquivados' },
] as const;

const OPCOES_DE_PAPEL = [
  { valor: TODOS, rotulo: 'Todos os papéis' },
  ...PAPEIS_PADRAO.map((papel) => ({ valor: papel, rotulo: ROTULO_DO_PAPEL[papel] })),
];

const OPCOES_DE_CARTEIRA = [
  { valor: TODOS, rotulo: 'Qualquer carteira' },
  ...SITUACOES.map((situacao) => ({ valor: situacao, rotulo: ROTULO_DA_SITUACAO[situacao] })),
];

const ehEstado = (valor: string | null): valor is EstadoDoUsuario =>
  valor !== null && (ESTADOS as readonly string[]).includes(valor);
const ehPapel = (valor: string | null): valor is PapelPadrao =>
  valor !== null && (PAPEIS_PADRAO as readonly string[]).includes(valor);
const ehSituacao = (valor: string | null): valor is SituacaoDaCarteira =>
  valor !== null && (SITUACOES as readonly string[]).includes(valor);

const Papeis = ({ colaborador }: { colaborador: ColaboradorNaCentral }) => (
  <ul className="flex flex-wrap gap-xs" aria-label="Papéis">
    {colaborador.papeis.map((papel) => (
      <li key={papel}>
        <StatusBadge tom="neutro" rotulo={ROTULO_DO_PAPEL[papel]} />
      </li>
    ))}
    {colaborador.papeisPersonalizados.map((nome) => (
      <li key={nome}>
        <StatusBadge tom="processando" rotulo={nome} />
      </li>
    ))}
  </ul>
);

const Empresas = ({ quantidade }: { quantidade: number }) => (
  // A contagem nunca depende só de cor: zero é dito por extenso e vira "Sem empresas".
  <StatusBadge
    tom={quantidade === 0 ? 'atencao' : 'neutro'}
    rotulo={quantidade === 0 ? 'Sem empresas' : plural(quantidade, 'empresa', 'empresas')}
  />
);

const Marca = ({
  colaborador,
  marcado,
  aoAlternar,
}: {
  colaborador: ColaboradorNaCentral;
  marcado: boolean;
  aoAlternar: () => void;
}) => (
  <input
    type="checkbox"
    checked={marcado}
    onChange={aoAlternar}
    aria-label={`Selecionar ${colaborador.nome}`}
    className={cn(
      'size-4 shrink-0 cursor-pointer rounded-sm border border-input bg-card accent-primary',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    )}
  />
);

const Gerenciar = ({ colaborador }: { colaborador: ColaboradorNaCentral }) => (
  <Button asChild variante="contorno" tamanho="compacto">
    <Link
      href={`${CAMINHO_DA_GESTAO}/${colaborador.id}`}
      aria-label={`Gerenciar carteira de ${colaborador.nome}`}
    >
      <Briefcase aria-hidden="true" />
      Gerenciar carteira
    </Link>
  </Button>
);

const Esqueleto = () => (
  <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
    <span className="sr-only">Carregando os colaboradores do escritório</span>
    <Skeleton className="h-9 w-full" />
    {Array.from({ length: 5 }, (_, indice) => (
      <Skeleton key={indice} className="h-12 w-full" />
    ))}
  </div>
);

export const CentralDeCarteiras = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const buscaNaUrl = parametros.get('busca') ?? '';
  const estadoNaUrl = parametros.get('estado');
  const papelNaUrl = parametros.get('papel');
  const carteiraNaUrl = parametros.get('carteira');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  const [rascunho, definirRascunho] = useState<string | null>(null);
  const buscaDigitada = rascunho ?? buscaNaUrl;
  const [buscaPublicada, definirBuscaPublicada] = useState(buscaNaUrl);
  const [buscaVistaNaUrl, definirBuscaVistaNaUrl] = useState(buscaNaUrl);

  // A URL mudou por fora (menu, "voltar"): o que estava digitado deixa de valer.
  if (buscaNaUrl !== buscaVistaNaUrl) {
    definirBuscaVistaNaUrl(buscaNaUrl);

    if (buscaNaUrl !== buscaPublicada) {
      definirRascunho(null);
    }
  }

  const parametrosDeAgora = useRef(parametros);

  useEffect(() => {
    parametrosDeAgora.current = parametros;
  });

  const ir = (proximos: URLSearchParams): void => {
    proximos.set('aba', ABA);
    navegador.replace(`${BASE}?${proximos.toString()}`, { scroll: false });
  };

  const publicar = (ajustar: (proximos: URLSearchParams) => void): void => {
    const proximos = new URLSearchParams(parametrosDeAgora.current.toString());

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
      definirBuscaPublicada(rascunho);
      publicar((proximos) => {
        if (rascunho.length > 0) {
          proximos.set('busca', rascunho);
        } else {
          proximos.delete('busca');
        }
      });
    }, ATRASO_DA_BUSCA_MS);

    return () => clearTimeout(temporizador);
    // `publicar` é recriada a cada render e só lê `parametros`: depender dela reiniciaria o debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho, buscaNaUrl]);

  const filtro = useMemo(
    () => ({
      busca: buscaNaUrl.length > 0 ? buscaNaUrl : null,
      // Colaboradores ativos por padrão; arquivados só por seleção explícita (SPEC-009 §5.1).
      estado: ehEstado(estadoNaUrl) ? estadoNaUrl : ('ATIVO' as const),
      papel: ehPapel(papelNaUrl) ? papelNaUrl : null,
      carteira: ehSituacao(carteiraNaUrl) ? carteiraNaUrl : null,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [buscaNaUrl, estadoNaUrl, papelNaUrl, carteiraNaUrl, paginaNaUrl],
  );

  const { data, isPending, isError, error, refetch, isPlaceholderData } = useColaboradores(filtro);

  // Seleção: ids marcados e o último retrato de cada um. A revisão enviada na operação vem da
  // lista mais recente que contém o colaborador — se a carteira mudou, o 409 pede recarga.
  const [marcados, definirMarcados] = useState<ReadonlyMap<string, ColaboradorNaCentral>>(new Map());

  const selecionados = useMemo(
    () =>
      [...marcados.values()].map(
        (retrato) => data?.colaboradores.find((c) => c.id === retrato.id) ?? retrato,
      ),
    [marcados, data],
  );

  // Depois de um 409 a revisão guardada na seleção está velha, inclusive a de quem está em outra
  // página: renova todos os selecionados direto no servidor.
  const renovarSelecao = async (): Promise<void> => {
    const frescos = await Promise.all([...marcados.keys()].map((id) => obterColaborador(id)));

    definirMarcados(new Map(frescos.map((colaborador) => [colaborador.id, colaborador])));
  };

  const alternar = (colaborador: ColaboradorNaCentral): void =>
    definirMarcados((anteriores) => {
      const proximos = new Map(anteriores);

      if (proximos.has(colaborador.id)) {
        proximos.delete(colaborador.id);
      } else {
        proximos.set(colaborador.id, colaborador);
      }

      return proximos;
    });

  const todosDaPaginaMarcados =
    data !== undefined &&
    data.colaboradores.length > 0 &&
    data.colaboradores.every((c) => marcados.has(c.id));

  const alternarPagina = (): void => {
    if (data === undefined) {
      return;
    }

    definirMarcados((anteriores) => {
      const proximos = new Map(anteriores);

      for (const colaborador of data.colaboradores) {
        if (todosDaPaginaMarcados) {
          proximos.delete(colaborador.id);
        } else {
          proximos.set(colaborador.id, colaborador);
        }
      }

      return proximos;
    });
  };

  const definir = (chave: string, valor: string, padrao: string = TODOS): void =>
    publicar((proximos) => {
      if (valor === padrao) {
        proximos.delete(chave);
      } else {
        proximos.set(chave, valor);
      }
    });

  const irParaPagina = (pagina: number): void => {
    const proximos = new URLSearchParams(parametros.toString());

    if (pagina <= 1) {
      proximos.delete('pagina');
    } else {
      proximos.set('pagina', String(pagina));
    }

    ir(proximos);
  };

  const limpar = (): void => {
    definirRascunho(null);
    navegador.replace(`${BASE}?aba=${ABA}`, { scroll: false });
  };

  const temFiltro =
    filtro.busca !== null ||
    estadoNaUrl !== null ||
    filtro.papel !== null ||
    filtro.carteira !== null;
  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));
  const temArquivado = selecionados.some((c) => c.estado === 'ARQUIVADO');

  const barraDeFiltro = (
    <div className="flex flex-col gap-md tablet:flex-row tablet:flex-wrap tablet:items-end">
      <div className="flex-1 tablet:min-w-[14rem]">
        <Campo
          rotulo="Buscar"
          placeholder="Nome ou e-mail"
          value={buscaDigitada}
          onValorChange={definirRascunho}
          type="search"
          inputMode="search"
        />
      </div>
      <div className="w-full tablet:w-[11rem]">
        <Select
          rotulo="Colaborador"
          opcoes={OPCOES_DE_ESTADO}
          valor={filtro.estado}
          onValorChange={(valor) => definir('estado', valor, 'ATIVO')}
          ajuda="Estado do colaborador."
        />
      </div>
      <div className="w-full tablet:w-[15rem]">
        <Select
          rotulo="Papel"
          opcoes={OPCOES_DE_PAPEL}
          valor={filtro.papel ?? TODOS}
          onValorChange={(valor) => definir('papel', valor)}
        />
      </div>
      <div className="w-full tablet:w-[13rem]">
        <Select
          rotulo="Carteira"
          opcoes={OPCOES_DE_CARTEIRA}
          valor={filtro.carteira ?? TODOS}
          onValorChange={(valor) => definir('carteira', valor)}
        />
      </div>
      {temFiltro ? (
        <Button variante="contorno" tamanho="compacto" onClick={limpar}>
          <SlidersHorizontal aria-hidden="true" />
          Limpar
        </Button>
      ) : null}
    </div>
  );

  if (isPending) {
    return (
      <div className="flex flex-col gap-lg">
        {barraDeFiltro}
        <Esqueleto />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-lg">
        {barraDeFiltro}
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível carregar as carteiras"
          aoTentarDeNovo={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      {barraDeFiltro}

      <p className="text-body-sm text-muted-foreground" aria-live="polite">
        {data.total === 1
          ? '1 colaborador encontrado.'
          : `${data.total.toLocaleString('pt-BR')} colaboradores encontrados.`}
      </p>

      {selecionados.length > 0 ? (
        <section
          aria-label="Operações em lote"
          className="flex flex-col gap-sm rounded-lg border border-primary bg-accent/40 p-md tablet:flex-row tablet:items-center tablet:justify-between"
        >
          <div className="flex flex-col gap-xs">
            <p className="text-title-sm text-foreground" aria-live="polite">
              {plural(selecionados.length, 'colaborador selecionado', 'colaboradores selecionados')}
            </p>
            {temArquivado ? (
              <p className="text-body-sm text-muted-foreground" role="note">
                Há usuário arquivado na seleção: ele não recebe carteira. Desmarque-o para liberar as
                operações.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-sm">
            <DialogoDeLote
              operacao="ADICIONAR"
              colaboradores={selecionados}
              aoConcluir={() => definirMarcados(new Map())}
              aoDesatualizar={renovarSelecao}
              gatilho={
                <Button tamanho="compacto" disabled={temArquivado}>
                  <Plus aria-hidden="true" />
                  Adicionar empresas
                </Button>
              }
            />
            <DialogoDeLote
              operacao="REMOVER"
              colaboradores={selecionados}
              aoConcluir={() => definirMarcados(new Map())}
              aoDesatualizar={renovarSelecao}
              gatilho={
                <Button tamanho="compacto" variante="contorno" disabled={temArquivado}>
                  <Minus aria-hidden="true" />
                  Remover empresas
                </Button>
              }
            />
            <Button tamanho="compacto" variante="fantasma" onClick={() => definirMarcados(new Map())}>
              Limpar seleção
            </Button>
          </div>
        </section>
      ) : null}

      {data.colaboradores.length === 0 ? (
        temFiltro ? (
          <EmptyState
            nivel={2}
            icone={<Search />}
            titulo="Nenhum colaborador encontrado"
            descricao="Nenhum colaborador corresponde à busca ou aos filtros aplicados. Ajuste os critérios para ver mais resultados."
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={limpar}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            nivel={2}
            icone={<Briefcase />}
            titulo="Nenhum colaborador ativo"
            descricao="Convide pessoas na aba Usuários. Depois de ativas, elas aparecem aqui para receber empresas na carteira."
          />
        )
      ) : (
        <div className={isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined}>
          <ul className="grid gap-sm tablet:grid-cols-2 desktop:hidden" aria-label="Colaboradores">
            {data.colaboradores.map((colaborador) => {
              const estado = ROTULO_DO_ESTADO[colaborador.estado];

              return (
                <li
                  key={colaborador.id}
                  className="flex flex-col gap-sm rounded-lg border border-border bg-card p-md"
                >
                  <div className="flex items-start gap-sm">
                    <Marca
                      colaborador={colaborador}
                      marcado={marcados.has(colaborador.id)}
                      aoAlternar={() => alternar(colaborador)}
                    />
                    <div className="flex min-w-0 flex-col gap-xs">
                      <span className="break-words text-title-sm text-foreground">
                        {colaborador.nome}
                      </span>
                      <span className="break-words text-body-sm text-muted-foreground">
                        {colaborador.email}
                      </span>
                    </div>
                  </div>
                  <Papeis colaborador={colaborador} />
                  <div className="flex flex-wrap items-center gap-xs">
                    <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />
                    <Empresas quantidade={colaborador.empresas} />
                  </div>
                  <Gerenciar colaborador={colaborador} />
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card desktop:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Colaboradores do escritório, com papéis, situação e quantidade de empresas na
                carteira
              </caption>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className="w-10 px-md py-sm">
                    <input
                      type="checkbox"
                      checked={todosDaPaginaMarcados}
                      onChange={alternarPagina}
                      aria-label="Selecionar todos os colaboradores desta página"
                      className="size-4 cursor-pointer rounded-sm border border-input bg-card accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </th>
                  {['Colaborador', 'Papéis', 'Situação', 'Carteira'].map((titulo) => (
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
                {data.colaboradores.map((colaborador) => {
                  const estado = ROTULO_DO_ESTADO[colaborador.estado];

                  return (
                    <tr
                      key={colaborador.id}
                      className="border-b border-border align-top last:border-b-0 hover:bg-accent/40"
                    >
                      <td className="px-md py-sm">
                        <Marca
                          colaborador={colaborador}
                          marcado={marcados.has(colaborador.id)}
                          aoAlternar={() => alternar(colaborador)}
                        />
                      </td>
                      {/* Nome e e-mail na mesma célula: com sete colunas a ação "Gerenciar carteira"
                          ficava cortada na largura útil de 1440px. */}
                      <td className="px-md py-sm">
                        <div className="flex flex-col gap-xs">
                          <span className="break-words text-title-sm text-foreground">
                            {colaborador.nome}
                          </span>
                          <span className="text-body-sm text-muted-foreground [overflow-wrap:anywhere]">
                            {colaborador.email}
                          </span>
                        </div>
                      </td>
                      <td className="px-md py-sm">
                        <Papeis colaborador={colaborador} />
                      </td>
                      <td className="px-md py-sm">
                        <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />
                      </td>
                      <td className="px-md py-sm">
                        <Empresas quantidade={colaborador.empresas} />
                      </td>
                      <td className="px-md py-sm text-right whitespace-nowrap">
                        <Gerenciar colaborador={colaborador} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalDePaginas > 1 ? (
            <nav
              className="flex items-center justify-between gap-md pt-md"
              aria-label="Paginação dos colaboradores"
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
