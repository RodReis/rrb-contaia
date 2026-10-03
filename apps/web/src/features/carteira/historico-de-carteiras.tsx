/**
 * Aba "Carteiras" do Histórico de Informações (SPEC-009 §3.6): atribuição,
 * remoção, autoatribuição e encerramento por arquivamento, do mais recente ao mais
 * antigo, com autor, origem, colaboradores afetados, empresas adicionadas ou
 * removidas, revisão e data/hora em `America/Sao_Paulo` (I-11).
 *
 * Somente leitura por natureza: o banco recusa `UPDATE` e `DELETE` por trigger e
 * aqui não existe nenhuma ação de escrita. Filtros e página ficam na URL
 * (FRONTEND.md §7): auditoria se compartilha por link.
 */
'use client';

import { FileClock, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaConsulta } from '../usuarios/erro-da-consulta';
import { useListaDeUsuarios } from '../usuarios/queries';
import type { AfetadoDoEvento, EventoDeCarteira, OrigemDoEvento } from './api';
import { useHistoricoDeCarteiras } from './queries';
import { ROTULO_DA_ORIGEM, formatarQuando, nomeDaEmpresa } from './rotulos';

const POR_PAGINA = 25;
const TODOS = 'todos';
export const ABA_DE_CARTEIRAS = 'CARTEIRAS';

const ORIGENS = Object.keys(ROTULO_DA_ORIGEM) as OrigemDoEvento[];

const OPCOES_DE_ORIGEM = [
  { valor: TODOS, rotulo: 'Todas as origens' },
  ...ORIGENS.map((origem) => ({ valor: origem, rotulo: ROTULO_DA_ORIGEM[origem] })),
];

const ehOrigem = (valor: string | null): valor is OrigemDoEvento =>
  valor !== null && (ORIGENS as readonly string[]).includes(valor);

const ehDataCivil = (valor: string | null): valor is string =>
  valor !== null && /^\d{4}-\d{2}-\d{2}$/u.test(valor);

const Empresas = ({
  titulo,
  sinal,
  empresas,
}: {
  titulo: string;
  sinal: 'adicionada' | 'removida';
  empresas: AfetadoDoEvento['adicionadas'];
}) =>
  empresas.length === 0 ? null : (
    <div className="flex flex-col gap-xs">
      <h4 className="flex items-center gap-xs text-label-md text-foreground">
        {/* O sinal acompanha o texto: o efeito nunca depende só de cor ou símbolo. */}
        <span aria-hidden="true" className="text-muted-foreground [&>svg]:size-4">
          {sinal === 'adicionada' ? <Plus /> : <Minus />}
        </span>
        {titulo} ({empresas.length})
      </h4>
      <ul className="flex flex-col gap-xs">
        {empresas.map((empresa) => (
          <li key={empresa.id} className="break-words text-body-sm text-foreground">
            {nomeDaEmpresa(empresa)}
          </li>
        ))}
      </ul>
    </div>
  );

const Afetado = ({ afetado }: { afetado: AfetadoDoEvento }) => (
  <li className="flex flex-col gap-sm rounded-md border border-border bg-card p-md">
    <div className="flex flex-wrap items-center justify-between gap-xs">
      <span className="break-words text-title-sm text-foreground">{afetado.usuarioNome}</span>
      <StatusBadge
        tom="neutro"
        rotulo={`Revisão ${afetado.revisaoAnterior} → ${afetado.revisaoNova}`}
      />
    </div>
    <div className="grid gap-md tablet:grid-cols-2">
      <Empresas titulo="Adicionadas" sinal="adicionada" empresas={afetado.adicionadas} />
      <Empresas titulo="Removidas" sinal="removida" empresas={afetado.removidas} />
    </div>
  </li>
);

const LinhaDoEvento = ({ evento }: { evento: EventoDeCarteira }) => (
  <li className="flex flex-col gap-sm border-b border-border py-md last:border-b-0">
    <div className="flex flex-wrap items-center gap-x-md gap-y-xs">
      <time dateTime={evento.ocorridoEm} className="font-mono text-code-sm text-muted-foreground">
        {formatarQuando(evento.ocorridoEm)}
      </time>
      <StatusBadge tom="processando" rotulo={ROTULO_DA_ORIGEM[evento.origem]} />
      <span className="text-body-sm text-muted-foreground">
        por <span className="text-foreground">{evento.autorNome ?? 'o sistema'}</span>
      </span>
    </div>
    <ul aria-label="Colaboradores afetados" className="flex flex-col gap-sm">
      {evento.afetados.map((afetado) => (
        <Afetado key={afetado.usuarioId} afetado={afetado} />
      ))}
    </ul>
  </li>
);

export const HistoricoDeCarteiras = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const afetado = parametros.get('afetado');
  const origemNaUrl = parametros.get('origem');
  const inicio = ehDataCivil(parametros.get('inicio')) ? parametros.get('inicio') : null;
  const fim = ehDataCivil(parametros.get('fim')) ? parametros.get('fim') : null;
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  const filtro = useMemo(
    () => ({
      usuarioAfetadoId: afetado,
      empresaId: null,
      origem: ehOrigem(origemNaUrl) ? origemNaUrl : null,
      de: inicio,
      ate: fim,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [afetado, origemNaUrl, inicio, fim, paginaNaUrl],
  );

  const { data, isPending, isError, error, refetch } = useHistoricoDeCarteiras(filtro);
  // Os usuários do escritório alimentam o filtro de colaborador afetado (inclusive arquivados).
  const usuarios = useListaDeUsuarios({
    busca: null,
    estado: null,
    papel: null,
    limite: 100,
    deslocamento: 0,
  });

  const opcoesDeUsuario = [
    { valor: TODOS, rotulo: 'Todos' },
    ...(usuarios.data?.usuarios ?? []).map((usuario) => ({ valor: usuario.id, rotulo: usuario.nome })),
  ];

  const publicar = (ajustar: (proximos: URLSearchParams) => void, voltarAPrimeira = true): void => {
    const proximos = new URLSearchParams(parametros.toString());

    proximos.set('aba', ABA_DE_CARTEIRAS);
    ajustar(proximos);

    // Qualquer mudança de filtro volta à primeira página.
    if (voltarAPrimeira) {
      proximos.delete('pagina');
    }

    navegador.replace(`/historico?${proximos.toString()}`, { scroll: false });
  };

  const definir = (chave: string, valor: string | null): void =>
    publicar((proximos) => {
      if (valor === null || valor === '' || valor === TODOS) {
        proximos.delete(chave);
      } else {
        proximos.set(chave, valor);
      }
    });

  const limpar = (): void =>
    navegador.replace(`/historico?aba=${ABA_DE_CARTEIRAS}`, { scroll: false });

  const temFiltro = afetado !== null || ehOrigem(origemNaUrl) || inicio !== null || fim !== null;
  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));

  const barraDeFiltro = (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
        <div className="flex-1">
          <Select
            rotulo="Colaborador afetado"
            opcoes={opcoesDeUsuario}
            valor={afetado ?? TODOS}
            onValorChange={(valor) => definir('afetado', valor)}
            ajuda="Quem teve a carteira alterada."
          />
        </div>
        <div className="flex-1">
          <Select
            rotulo="Origem"
            opcoes={OPCOES_DE_ORIGEM}
            valor={ehOrigem(origemNaUrl) ? origemNaUrl : TODOS}
            onValorChange={(valor) => definir('origem', valor)}
            ajuda="Individual, lote, criação ou arquivamento."
          />
        </div>
      </div>
      <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
        <div className="tablet:w-[12rem]">
          <Campo
            rotulo="De"
            type="date"
            value={inicio ?? ''}
            onValorChange={(valor) => definir('inicio', valor)}
            ajuda="Início do período."
          />
        </div>
        <div className="tablet:w-[12rem]">
          <Campo
            rotulo="Até"
            type="date"
            value={fim ?? ''}
            onValorChange={(valor) => definir('fim', valor)}
            ajuda="Fim do período, incluído."
          />
        </div>
        {temFiltro ? (
          <Button variante="contorno" tamanho="compacto" onClick={limpar}>
            <SlidersHorizontal aria-hidden="true" />
            Limpar
          </Button>
        ) : null}
      </div>
    </div>
  );

  const conteudo = (): React.ReactNode => {
    if (isPending) {
      return (
        <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando o histórico de carteiras</span>
          {Array.from({ length: 4 }, (_, indice) => (
            <Skeleton key={indice} className="h-24 w-full" />
          ))}
        </div>
      );
    }

    if (isError) {
      return (
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível carregar o histórico"
          aoTentarDeNovo={() => void refetch()}
        />
      );
    }

    if (data.eventos.length === 0) {
      return temFiltro ? (
        <EmptyState
          nivel={2}
          icone={<FileClock />}
          titulo="Nenhum evento no período ou filtro"
          descricao="Nenhuma alteração de carteira corresponde aos filtros aplicados."
          acao={
            <Button variante="contorno" tamanho="compacto" onClick={limpar}>
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <EmptyState
          nivel={2}
          icone={<FileClock />}
          titulo="Nenhuma alteração de carteira registrada"
          descricao="Atribuições, remoções e encerramentos por arquivamento aparecem aqui, com autor, origem e as empresas envolvidas."
        />
      );
    }

    return (
      <div className="flex flex-col gap-lg">
        <ul aria-label="Eventos de carteira" className="flex flex-col">
          {data.eventos.map((evento) => (
            <LinhaDoEvento key={evento.id} evento={evento} />
          ))}
        </ul>

        {totalDePaginas > 1 ? (
          <nav
            aria-label="Paginação do histórico de carteiras"
            className="flex items-center justify-between gap-md"
          >
            <span className="text-body-sm text-muted-foreground" aria-live="polite">
              Página {paginaNaUrl} de {totalDePaginas}
            </span>
            <div className="flex gap-sm">
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={paginaNaUrl <= 1}
                onClick={() =>
                  publicar((proximos) => {
                    if (paginaNaUrl - 1 > 1) {
                      proximos.set('pagina', String(paginaNaUrl - 1));
                    }
                  }, false)
                }
              >
                Anterior
              </Button>
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={paginaNaUrl >= totalDePaginas}
                onClick={() =>
                  publicar((proximos) => proximos.set('pagina', String(paginaNaUrl + 1)), false)
                }
              >
                Próxima
              </Button>
            </div>
          </nav>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-lg">
      {barraDeFiltro}
      {conteudo()}
    </div>
  );
};
