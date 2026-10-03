/**
 * Aba "Usuários e acessos" do Histórico de Informações (SPEC-007 §3.5): eventos
 * auditáveis de convite, acesso e ciclo de vida, do mais recente ao mais antigo.
 *
 * Somente leitura por natureza: o banco recusa `UPDATE` e `DELETE` por trigger,
 * e aqui não existe nenhuma ação de escrita. Filtros e página ficam na URL
 * (FRONTEND.md §7): auditoria se compartilha por link.
 *
 * O autor ausente é o sistema (ex.: a expiração de um convite, que ninguém fez).
 */
'use client';

import type { PapelPadrao } from '@contaia/domain';
import { FileClock, SlidersHorizontal } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import type { EventoDeUsuario } from './api';
import { useCatalogo } from '../papeis/queries';
import { rotuloDaChave } from '../papeis/rotulos';
import { ErroDaConsulta } from './erro-da-consulta';
import { useHistoricoDeUsuarios, useListaDeUsuarios } from './queries';
import {
  ROTULO_DO_EVENTO,
  ehEventoDePapel,
  ROTULO_DO_PAPEL,
  SITUACAO,
  TIPOS_DE_EVENTO,
  type TipoDeEvento,
} from './rotulos';

const POR_PAGINA = 25;
const TODOS = 'todos';
export const ABA_DE_USUARIOS = 'USUARIOS_E_ACESSOS';

const OPCOES_DE_TIPO = [
  { valor: TODOS, rotulo: 'Todos os tipos' },
  ...TIPOS_DE_EVENTO.map((tipo) => ({ valor: tipo, rotulo: ROTULO_DO_EVENTO[tipo] })),
];

const ROTULO_DO_VALOR: Readonly<Record<string, string>> = {
  estado: 'Situação',
  papeis: 'Papéis',
  nome: 'Nome',
  telefone: 'Telefone',
  crc: 'Registro no CRC',
  email: 'E-mail',
  papeisPersonalizados: 'Papéis personalizados',
  descricao: 'Descrição',
  origem: 'Papel de origem',
};

/** Data e hora em `America/Sao_Paulo` (I-11). */
const formatarInstante = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

const ehTipo = (valor: string | null): valor is TipoDeEvento =>
  valor !== null && (TIPOS_DE_EVENTO as readonly string[]).includes(valor);

/** Papéis e situações aparecem com o rótulo do produto, nunca com o identificador técnico. */
const mostrar = (campo: string, valor: unknown): string => {
  // Lista vazia (ex.: usuário só com papel personalizado) é ausência de valor, não texto em branco.
  if (valor === null || valor === undefined || valor === '' || (Array.isArray(valor) && valor.length === 0)) {
    return '—';
  }

  if (campo === 'papeisPersonalizados' && Array.isArray(valor)) {
    return valor.map((papel) => (papel as { nome?: string }).nome ?? 'Papel').join(', ');
  }

  if (campo === 'origem' && typeof valor === 'string') {
    return ROTULO_DO_PAPEL[valor as PapelPadrao] ?? valor;
  }

  if (campo === 'papeis' && Array.isArray(valor)) {
    return valor.map((papel) => ROTULO_DO_PAPEL[papel as PapelPadrao] ?? String(papel)).join(', ');
  }

  if (campo === 'estado' && typeof valor === 'string') {
    return (SITUACAO as Record<string, { rotulo: string } | undefined>)[valor]?.rotulo ?? valor;
  }

  return String(valor);
};

const Alteracoes = ({ evento }: { evento: EventoDeUsuario }) => {
  const campos = [
    ...new Set([...Object.keys(evento.antes ?? {}), ...Object.keys(evento.depois ?? {})]),
  ].filter((campo) => campo in ROTULO_DO_VALOR);

  if (campos.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-col gap-xs text-body-sm">
      {campos.map((campo) => (
        <li key={campo} className="flex flex-wrap items-baseline gap-x-sm gap-y-xs">
          <span className="text-muted-foreground">{ROTULO_DO_VALOR[campo]}</span>
          <span className="break-words text-foreground">{mostrar(campo, evento.antes?.[campo])}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <span className="sr-only">para</span>
          <span className="break-words text-foreground">{mostrar(campo, evento.depois?.[campo])}</span>
        </li>
      ))}
    </ul>
  );
};

const textos = (valor: unknown): readonly string[] =>
  Array.isArray(valor) ? valor.filter((item): item is string => typeof item === 'string') : [];

const ListaDePermissoes = ({
  titulo,
  chaves,
  sinal,
}: {
  titulo: string;
  chaves: readonly string[];
  sinal: '+' | '−';
}) => {
  // Sem o catálogo (carregando ou fora do ar) a chave aparece crua, mas a linha não some.
  const catalogo = useCatalogo();

  if (chaves.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-xs">
      <span className="text-label-md text-muted-foreground">
        {titulo} ({chaves.length})
      </span>
      <ul className="flex flex-col gap-xs text-body-sm text-foreground">
        {chaves.map((chave) => (
          <li key={chave} className="flex gap-xs break-words">
            <span aria-hidden="true" className="text-muted-foreground">
              {sinal}
            </span>
            <span>{catalogo.data === undefined ? chave : rotuloDaChave(catalogo.data, chave)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Eventos de papel (SPEC-008 §3.6): matriz alterada diz o que entrou e o que saiu. */
const DetalhesDoPapel = ({ evento }: { evento: EventoDeUsuario }) => {
  const depois = evento.depois ?? {};

  if (evento.tipo === 'PAPEL_MATRIZ_ALTERADA') {
    return (
      <div className="flex flex-col gap-sm">
        <ListaDePermissoes titulo="Permissões adicionadas" chaves={textos(depois['adicionadas'])} sinal="+" />
        <ListaDePermissoes titulo="Permissões retiradas" chaves={textos(depois['retiradas'])} sinal="−" />
      </div>
    );
  }

  if (evento.tipo === 'PAPEL_CRIADO') {
    return (
      <div className="flex flex-col gap-sm">
        <Alteracoes evento={{ ...evento, antes: null, depois: { origem: depois['origem'], descricao: depois['descricao'] } }} />
        <p className="text-body-sm text-muted-foreground">
          {textos(depois['permissoes']).length} permissões na matriz inicial.
        </p>
      </div>
    );
  }

  if (evento.tipo === 'PAPEL_REATIVADO') {
    return (
      <ListaDePermissoes
        titulo="Incompatibilidades removidas na reativação"
        chaves={textos(depois['incompatibilidadesRemovidas'])}
        sinal="−"
      />
    );
  }

  return <Alteracoes evento={evento} />;
};

const LinhaDoEvento = ({ evento }: { evento: EventoDeUsuario }) => {
  const dePapel = ehEventoDePapel(evento.tipo);

  return (
    <li className="flex flex-col gap-sm border-b border-border py-md last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <div className="flex flex-wrap items-baseline gap-x-sm gap-y-xs">
          {dePapel ? (
            <>
              <span className="text-label-md text-muted-foreground">Papel</span>
              <span className="break-words text-title-sm text-foreground">{evento.papelNome ?? '—'}</span>
              {evento.revisao === null ? null : (
                <span className="tabular-nums text-body-sm text-muted-foreground">
                  revisão {evento.revisao}
                </span>
              )}
            </>
          ) : (
            <span className="break-words text-title-sm text-foreground">
              {evento.usuarioAfetadoNome ?? '—'}
            </span>
          )}
        </div>
        <StatusBadge tom="neutro" rotulo={ROTULO_DO_EVENTO[evento.tipo as TipoDeEvento] ?? evento.tipo} />
      </div>

      {dePapel ? <DetalhesDoPapel evento={evento} /> : <Alteracoes evento={evento} />}

      <p className="text-body-sm text-muted-foreground">
        Por {evento.autorNome ?? 'Sistema'} ·{' '}
        <time dateTime={evento.ocorridoEm} className="tabular-nums">
          {formatarInstante(evento.ocorridoEm)}
        </time>
      </p>
    </li>
  );
};

export const HistoricoDeUsuarios = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const afetado = parametros.get('afetado');
  const autor = parametros.get('autor');
  const tipoNaUrl = parametros.get('tipo');
  const inicio = parametros.get('inicio');
  const fim = parametros.get('fim');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  const filtro = useMemo(
    () => ({
      usuarioAfetadoId: afetado,
      autorId: autor,
      tipo: ehTipo(tipoNaUrl) ? tipoNaUrl : null,
      de: inicio,
      ate: fim,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [afetado, autor, tipoNaUrl, inicio, fim, paginaNaUrl],
  );

  const { data, isPending, isError, error, refetch } = useHistoricoDeUsuarios(filtro);
  // Os usuários do escritório alimentam os filtros de afetado e autor.
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

    proximos.set('aba', ABA_DE_USUARIOS);
    ajustar(proximos);

    // Qualquer mudança de filtro volta à primeira página: manter a página 4 num
    // resultado que encolheu mostraria vazio por engano.
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
    navegador.replace(`/historico?aba=${ABA_DE_USUARIOS}`, { scroll: false });

  const temFiltro =
    afetado !== null || autor !== null || ehTipo(tipoNaUrl) || inicio !== null || fim !== null;
  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));

  const barraDeFiltro = (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
        <div className="flex-1">
          <Select
            rotulo="Usuário afetado"
            opcoes={opcoesDeUsuario}
            valor={afetado ?? TODOS}
            onValorChange={(valor) => definir('afetado', valor)}
            ajuda="Quem sofreu a mudança."
          />
        </div>
        <div className="flex-1">
          <Select
            rotulo="Autor"
            opcoes={opcoesDeUsuario}
            valor={autor ?? TODOS}
            onValorChange={(valor) => definir('autor', valor)}
            ajuda="Quem fez a mudança."
          />
        </div>
        <div className="flex-1">
          <Select
            rotulo="Tipo de evento"
            opcoes={OPCOES_DE_TIPO}
            valor={ehTipo(tipoNaUrl) ? tipoNaUrl : TODOS}
            onValorChange={(valor) => definir('tipo', valor)}
            ajuda="Convite, acesso ou ciclo de vida."
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
          <span className="sr-only">Carregando o histórico de usuários</span>
          {Array.from({ length: 6 }, (_, indice) => (
            <Skeleton key={indice} className="h-20 w-full" />
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
      // O vazio muda de texto conforme a causa (PATTERNS.md §5).
      return temFiltro ? (
        <EmptyState
          nivel={2}
          icone={<FileClock />}
          titulo="Nenhum evento no período ou filtro"
          descricao="Nenhum evento de usuários e acessos corresponde aos filtros aplicados."
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
          titulo="Nenhum evento registrado"
          descricao="Ainda não há convites, mudanças de acesso ou de papéis registrados neste escritório."
        />
      );
    }

    return (
      <div className="flex flex-col gap-lg">
        <ul aria-label="Eventos de usuários e acessos" className="flex flex-col">
          {data.eventos.map((evento) => (
            <LinhaDoEvento key={evento.id} evento={evento} />
          ))}
        </ul>

        {totalDePaginas > 1 ? (
          <nav
            aria-label="Paginação do histórico de usuários"
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
