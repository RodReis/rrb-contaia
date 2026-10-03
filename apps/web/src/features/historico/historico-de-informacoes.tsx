/**
 * Histórico de Informações (SPEC-003 §3.6): área global do escritório com os
 * eventos auditáveis de todas as empresas.
 *
 * Somente leitura por natureza, não por permissão de tela: o banco recusa
 * `UPDATE` e `DELETE` por trigger. Aqui não existe nenhuma ação de escrita —
 * nem editar, nem excluir, nem "corrigir" um evento.
 *
 * Filtros e aba ficam na URL (FRONTEND.md §7): auditoria se compartilha por
 * link, e o estado precisa sobreviver ao recarregamento.
 */
'use client';

import { ABAS_DO_HISTORICO } from '@contaia/domain';
import type { AbaDoHistorico } from '@contaia/domain';
import * as Tabs from '@radix-ui/react-tabs';
import { FileClock, SlidersHorizontal } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { EventoDoHistorico } from '../empresa/manutencao-api';
import { useCamposDoHistorico, useHistorico } from '../empresa/manutencao-queries';
import { ABA_DE_USUARIOS, HistoricoDeUsuarios } from '../usuarios/historico-de-usuarios';
import { useSessao } from '../usuarios/queries';

const POR_PAGINA = 25;

const ROTULO_DA_ABA: Readonly<Record<AbaDoHistorico, string>> = {
  DADOS_CADASTRAIS: 'Dados cadastrais',
  DADOS_FISCAIS: 'Dados fiscais',
  ENDERECOS: 'Endereços',
  STATUS_DA_EMPRESA: 'Status da empresa',
};

const ACAO: Readonly<Record<string, { rotulo: string; tom: TomDoStatus }>> = {
  ALTERACAO: { rotulo: 'Alteração', tom: 'neutro' },
  INCLUSAO: { rotulo: 'Inclusão', tom: 'conforme' },
  ARQUIVAMENTO: { rotulo: 'Arquivamento', tom: 'atencao' },
  REATIVACAO: { rotulo: 'Reativação', tom: 'conforme' },
};

const ROTULO_DO_CAMPO: Readonly<Record<string, string>> = {
  razaoSocial: 'Razão social',
  nomeFantasia: 'Nome fantasia',
  telefone: 'Telefone',
  email: 'E-mail',
  logoArquivoId: 'Logo',
  regimeTributario: 'Regime tributário',
  enquadramentoSimples: 'Enquadramento no Simples',
  cnaePrincipal: 'CNAE principal',
  cnaesSecundarios: 'CNAEs secundários',
  situacao: 'Situação da empresa',
  'enderecos.finalidade': 'Finalidade do endereço',
};

const nomeDoCampo = (campo: string): string =>
  ROTULO_DO_CAMPO[campo] ??
  (campo.startsWith('enderecos.') ? `Endereço — ${campo.slice('enderecos.'.length)}` : campo);

const CLASSES_DA_ABA = [
  'flex-1 rounded-md px-md py-sm text-title-sm transition-colors duration-fast ease-out',
  'text-muted-foreground hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[var(--elevation-1)]',
];

const ehAba = (valor: string | null): valor is AbaDoHistorico =>
  valor !== null && (ABAS_DO_HISTORICO as readonly string[]).includes(valor);

/** Data e hora em `America/Sao_Paulo` (I-11). */
const formatarInstante = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

const formatarDataCivil = (data: string): string => {
  const [ano, mes, dia] = data.split('-');

  return `${dia}/${mes}/${ano}`;
};

const Valor = ({ valor }: { valor: string | null }) =>
  valor === null || valor.length === 0 ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="text-foreground">{valor}</span>
  );

const LinhaDoEvento = ({ evento }: { evento: EventoDoHistorico }) => {
  const acao = ACAO[evento.acao] ?? { rotulo: evento.acao, tom: 'neutro' as TomDoStatus };

  return (
    <li className="flex flex-col gap-sm border-b border-border py-md last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <div className="flex flex-wrap items-baseline gap-x-sm gap-y-xs">
          <span className="text-title-sm text-foreground">{evento.empresaNome}</span>
          <span className="text-body-sm text-muted-foreground">
            {nomeDoCampo(evento.campo)}
          </span>
        </div>
        <StatusBadge tom={acao.tom} rotulo={acao.rotulo} />
      </div>

      <div className="flex flex-col gap-xs text-body-sm tablet:flex-row tablet:gap-lg">
        <span className="text-muted-foreground">
          De: <Valor valor={evento.valorAnterior} />
        </span>
        <span className="text-muted-foreground">
          Para: <Valor valor={evento.valorNovo} />
        </span>
      </div>

      {evento.vigencia !== null ? (
        <p className="text-body-sm text-muted-foreground">
          Vigência: <span className="text-foreground">{formatarDataCivil(evento.vigencia)}</span>
        </p>
      ) : null}

      {evento.justificativa !== null ? (
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Justificativa: <span className="text-foreground">{evento.justificativa}</span>
        </p>
      ) : null}

      <p className="text-body-sm text-muted-foreground">
        {evento.usuarioNome} ·{' '}
        <time dateTime={evento.ocorridoEm} className="tabular-nums">
          {formatarInstante(evento.ocorridoEm)}
        </time>
      </p>
    </li>
  );
};

/** Conteúdo de uma das abas de empresa: filtros e lista dos eventos daquela aba. */
const HistoricoDeEmpresas = ({ aba }: { aba: AbaDoHistorico }) => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const empresaId = parametros.get('empresaId');
  const inicio = parametros.get('inicio');
  const fim = parametros.get('fim');
  const campo = parametros.get('campo');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  const filtro = useMemo(
    () => ({
      aba,
      empresaId,
      inicio,
      fim,
      usuarioId: parametros.get('usuarioId'),
      campo,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [aba, empresaId, inicio, fim, campo, paginaNaUrl, parametros],
  );

  const { data, isPending, isError, error, refetch } = useHistorico(filtro);
  const campos = useCamposDoHistorico(aba);

  const publicar = (ajustar: (proximos: URLSearchParams) => void): void => {
    const proximos = new URLSearchParams(parametros.toString());
    ajustar(proximos);
    // Qualquer mudança de filtro volta à primeira página: manter a página 4
    // num resultado que encolheu mostraria vazio por engano.
    proximos.delete('pagina');
    navegador.replace(`/historico?${proximos.toString()}`, { scroll: false });
  };

  const definir = (chave: string, valor: string | null): void =>
    publicar((proximos) => {
      if (valor === null || valor.length === 0) {
        proximos.delete(chave);
      } else {
        proximos.set(chave, valor);
      }
    });

  const temFiltro =
    empresaId !== null || inicio !== null || fim !== null || campo !== null;

  const totalDePaginas =
    data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));

  const barraDeFiltro = (
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
      <div className="flex-1">
        <Select
          rotulo="Campo alterado"
          opcoes={[
            { valor: 'todos', rotulo: 'Todos os campos' },
            ...(campos.data ?? []).map((item) => ({
              valor: item,
              rotulo: nomeDoCampo(item),
            })),
          ]}
          valor={campo ?? 'todos'}
          onValorChange={(valor) => definir('campo', valor === 'todos' ? null : valor)}
          ajuda="Somente campos que já têm evento registrado."
        />
      </div>
      {temFiltro ? (
        <Button
          variante="contorno"
          tamanho="compacto"
          onClick={() => navegador.replace(`/historico?aba=${aba}`, { scroll: false })}
        >
          <SlidersHorizontal aria-hidden="true" />
          Limpar
        </Button>
      ) : null}
    </div>
  );

  const conteudo = (): React.ReactNode => {
    if (isPending) {
      return (
        <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando o histórico</span>
          {Array.from({ length: 6 }, (_, indice) => (
            <Skeleton key={indice} className="h-20 w-full" />
          ))}
        </div>
      );
    }

    if (isError) {
      const problema = error instanceof ErroDaApi ? error.problema : null;

      return (
        <ErroDeTela
          nivel={2}
          titulo="Não foi possível carregar o histórico"
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
      );
    }

    if (data.eventos.length === 0) {
      // O vazio muda de texto conforme a causa (PATTERNS.md §5): filtro sem
      // resultado não é o mesmo que aba ainda sem nenhum evento.
      return temFiltro ? (
        <EmptyState
          nivel={2}
          icone={<FileClock />}
          titulo="Nenhum evento no período ou filtro"
          descricao={`Nenhum evento de ${ROTULO_DA_ABA[aba].toLowerCase()} corresponde aos filtros aplicados.`}
          acao={
            <Button
              variante="contorno"
              tamanho="compacto"
              onClick={() => navegador.replace(`/historico?aba=${aba}`, { scroll: false })}
            >
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <EmptyState
          nivel={2}
          icone={<FileClock />}
          titulo="Nenhum evento registrado"
          descricao={`Ainda não há alterações de ${ROTULO_DA_ABA[aba].toLowerCase()} registradas neste escritório.`}
        />
      );
    }

    return (
      <div className="flex flex-col gap-lg">
        <ul aria-label="Eventos do histórico" className="flex flex-col">
          {data.eventos.map((evento) => (
            <LinhaDoEvento key={evento.id} evento={evento} />
          ))}
        </ul>

        {totalDePaginas > 1 ? (
          <nav
            aria-label="Paginação do histórico"
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
                  })
                }
              >
                Anterior
              </Button>
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={paginaNaUrl >= totalDePaginas}
                onClick={() =>
                  publicar((proximos) => proximos.set('pagina', String(paginaNaUrl + 1)))
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

export const HistoricoDeInformacoes = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();
  const { data: sessao } = useSessao();

  // A aba de usuários exige as duas capacidades: ler o Histórico e ler usuários
  // (SPEC-007 §3.1). Esconder a aba não é controle de acesso: a API recusa de
  // qualquer jeito. Enquanto a sessão carrega, só as abas de empresa aparecem.
  const veUsuarios =
    sessao !== undefined &&
    sessao.permissoes.HISTORICO.includes('consultar') &&
    sessao.permissoes.USUARIOS.includes('consultar');

  const abaNaUrl = parametros.get('aba');
  const aba: AbaDoHistorico = ehAba(abaNaUrl) ? abaNaUrl : 'DADOS_CADASTRAIS';
  const naAbaDeUsuarios = abaNaUrl === ABA_DE_USUARIOS && veUsuarios;
  const abaAtiva = naAbaDeUsuarios ? ABA_DE_USUARIOS : aba;

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-headline-lg text-foreground">
          Histórico de Informações
        </h1>
        <p className="max-w-prose text-body-md text-muted-foreground">
          Todas as mudanças auditáveis do escritório, da mais recente para a mais antiga. O
          histórico é somente leitura: nenhum evento pode ser alterado ou excluído.
        </p>
      </header>

      <Tabs.Root
        value={abaAtiva}
        onValueChange={(valor) =>
          // Trocar de aba zera os filtros de campo: o campo escolhido pertence
          // à aba anterior e não existiria na nova.
          navegador.replace(`/historico?aba=${valor}`, { scroll: false })
        }
        className="flex flex-col gap-lg"
      >
        <Tabs.List
          aria-label="Abas do histórico"
          className="flex flex-wrap gap-xs rounded-md bg-secondary p-xs"
        >
          {ABAS_DO_HISTORICO.map((item) => (
            <Tabs.Trigger key={item} value={item} className={cn(CLASSES_DA_ABA)}>
              {ROTULO_DA_ABA[item]}
            </Tabs.Trigger>
          ))}
          {veUsuarios ? (
            <Tabs.Trigger value={ABA_DE_USUARIOS} className={cn(CLASSES_DA_ABA)}>
              Usuários e acessos
            </Tabs.Trigger>
          ) : null}
        </Tabs.List>

        <Tabs.Content
          value={abaAtiva}
          className="flex flex-col gap-lg rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {naAbaDeUsuarios ? <HistoricoDeUsuarios /> : <HistoricoDeEmpresas aba={aba} />}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};
