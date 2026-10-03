/**
 * Aba "Usuários" (SPEC-007 §5.1): busca, filtros por situação e papel, contagem
 * total e paginação de servidor. Busca, filtro e página vivem na URL
 * (FRONTEND.md §7): a lista é conferida e auditada, então o estado precisa ser
 * compartilhável e sobreviver ao recarregamento.
 *
 * Abaixo de 1024px a tabela vira cartões (e não de 768px, como na lista de empresas): com
 * cinco colunas e ações por linha, a tabela não cabe em 768px sem cortar as ações. Ambos
 * existem no DOM e o CSS esconde um deles.
 */
'use client';

import { PAPEIS_PADRAO } from '@contaia/domain';
import type { EstadoDoUsuario, PapelPadrao } from '@contaia/domain';
import { Plus, Search, SlidersHorizontal, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import type { VisaoDeUsuario } from './api';
import { AcoesDoUsuario } from './acoes-do-usuario';
import { ErroDaConsulta } from './erro-da-consulta';
import { useListaDeUsuarios } from './queries';
import { ROTULO_DO_PAPEL, SITUACAO } from './rotulos';

const POR_PAGINA = 25;
const ATRASO_DA_BUSCA_MS = 300;
const BASE = '/configuracoes/usuarios';
const TODOS = 'todos';

const ESTADOS: readonly EstadoDoUsuario[] = ['CONVIDADO', 'ATIVO', 'SUSPENSO', 'ARQUIVADO'];

const OPCOES_DE_ESTADO = [
  { valor: TODOS, rotulo: 'Todas' },
  { valor: 'CONVIDADO', rotulo: 'Convidados' },
  { valor: 'ATIVO', rotulo: 'Ativos' },
  { valor: 'SUSPENSO', rotulo: 'Suspensos' },
  { valor: 'ARQUIVADO', rotulo: 'Arquivados' },
] as const;

const OPCOES_DE_PAPEL = [
  { valor: TODOS, rotulo: 'Todos os papéis' },
  ...PAPEIS_PADRAO.map((papel) => ({ valor: papel, rotulo: ROTULO_DO_PAPEL[papel] })),
];

const ehEstado = (valor: string | null): valor is EstadoDoUsuario =>
  valor !== null && (ESTADOS as readonly string[]).includes(valor);

const ehPapel = (valor: string | null): valor is PapelPadrao =>
  valor !== null && (PAPEIS_PADRAO as readonly string[]).includes(valor);

const Papeis = ({ papeis }: { papeis: readonly PapelPadrao[] }) => (
  <ul className="flex flex-wrap gap-xs" aria-label="Papéis">
    {papeis.map((papel) => (
      <li key={papel}>
        <StatusBadge tom="neutro" rotulo={ROTULO_DO_PAPEL[papel]} />
      </li>
    ))}
  </ul>
);

const Situacao = ({ usuario }: { usuario: VisaoDeUsuario }) => {
  const situacao = SITUACAO[usuario.situacao];

  return (
    <div className="flex flex-wrap items-center gap-xs">
      <StatusBadge tom={situacao.tom} rotulo={situacao.rotulo} />
      {/* Falha de envio não apaga o cadastro: a lista avisa e o reenvio resolve (§3.2). */}
      {usuario.envioFalhou ? <StatusBadge tom="atencao" rotulo="E-mail não enviado" /> : null}
    </div>
  );
};

const LinhaDoUsuario = ({
  usuario,
  podeAdministrar,
}: {
  usuario: VisaoDeUsuario;
  podeAdministrar: boolean;
}) => (
  <tr className="border-b border-border align-top last:border-b-0 hover:bg-accent/40">
    <td className="px-md py-sm text-title-sm text-foreground">
      <span className="break-words">{usuario.nome}</span>
    </td>
    <td className="min-w-[12rem] px-md py-sm text-body-md text-muted-foreground">
      {/* A largura mínima cabe o domínio inteiro (quebra no hífen do usuário, nunca no meio da
          palavra); `anywhere` só vale como último recurso para um endereço enorme. */}
      <span className="[overflow-wrap:anywhere]">{usuario.email}</span>
    </td>
    <td className="px-md py-sm">
      <Papeis papeis={usuario.papeis} />
    </td>
    <td className="px-md py-sm">
      <Situacao usuario={usuario} />
    </td>
    <td className="px-md py-sm text-right [&>div]:flex-nowrap">
      <AcoesDoUsuario usuario={usuario} podeAdministrar={podeAdministrar} />
    </td>
  </tr>
);

const CartaoDoUsuario = ({
  usuario,
  podeAdministrar,
}: {
  usuario: VisaoDeUsuario;
  podeAdministrar: boolean;
}) => (
  <li className="flex flex-col gap-sm rounded-lg border border-border bg-card p-md">
    <div className="flex flex-col gap-xs">
      <span className="break-words text-title-sm text-foreground">{usuario.nome}</span>
      <span className="break-words text-body-sm text-muted-foreground">{usuario.email}</span>
    </div>
    <Papeis papeis={usuario.papeis} />
    <Situacao usuario={usuario} />
    <AcoesDoUsuario usuario={usuario} podeAdministrar={podeAdministrar} />
  </li>
);

const Esqueleto = () => (
  <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
    <span className="sr-only">Carregando os usuários do escritório</span>
    {/* Skeleton com a forma da tabela, não spinner (FRONTEND.md §21). */}
    <Skeleton className="h-9 w-full" />
    {Array.from({ length: 5 }, (_, indice) => (
      <Skeleton key={indice} className="h-12 w-full" />
    ))}
  </div>
);

export const ListaDeUsuarios = ({ podeAdministrar }: { podeAdministrar: boolean }) => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const buscaNaUrl = parametros.get('busca') ?? '';
  const estadoNaUrl = parametros.get('estado');
  const papelNaUrl = parametros.get('papel');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  // A busca digita rápido e a URL é o estado: o campo publica na URL só depois do
  // debounce. `null` = nada digitado desde a última publicação, e então o valor
  // exibido é derivado da URL (sem espelhar estado por efeito).
  const [rascunho, definirRascunho] = useState<string | null>(null);
  const buscaDigitada = rascunho ?? buscaNaUrl;

  // A URL mudou por fora (menu, "voltar" do navegador) e não foi esta tela que a publicou: o
  // que estava digitado deixa de valer, senão o debounce desfaria a navegação. Ajuste de estado
  // durante o render, o padrão do React para reiniciar estado derivado de outro valor.
  const [buscaPublicada, definirBuscaPublicada] = useState(buscaNaUrl);
  const [buscaVistaNaUrl, definirBuscaVistaNaUrl] = useState(buscaNaUrl);

  if (buscaNaUrl !== buscaVistaNaUrl) {
    definirBuscaVistaNaUrl(buscaNaUrl);

    if (buscaNaUrl !== buscaPublicada) {
      definirRascunho(null);
    }
  }

  // O debounce dispara com a `publicar` do render em que foi agendado: ela precisa enxergar a
  // URL de agora, e não a daquele render, para não apagar um filtro escolhido nesse intervalo.
  const parametrosDeAgora = useRef(parametros);

  useEffect(() => {
    parametrosDeAgora.current = parametros;
  });

  const publicar = (ajustar: (proximos: URLSearchParams) => void): void => {
    const proximos = new URLSearchParams(parametrosDeAgora.current.toString());

    ajustar(proximos);
    // Qualquer mudança de filtro volta à primeira página: manter a página 4 de um
    // resultado que encolheu mostraria vazio por engano.
    proximos.delete('pagina');

    const texto = proximos.toString();

    navegador.replace(texto === '' ? BASE : `${BASE}?${texto}`, { scroll: false });
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
    // `publicar` é recriada a cada render e só lê `parametros`: depender dela
    // reiniciaria o debounce a cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho, buscaNaUrl]);

  const filtro = useMemo(
    () => ({
      busca: buscaNaUrl.length > 0 ? buscaNaUrl : null,
      estado: ehEstado(estadoNaUrl) ? estadoNaUrl : null,
      papel: ehPapel(papelNaUrl) ? papelNaUrl : null,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [buscaNaUrl, estadoNaUrl, papelNaUrl, paginaNaUrl],
  );

  const { data, isPending, isError, error, refetch, isPlaceholderData } = useListaDeUsuarios(filtro);

  const definir = (chave: string, valor: string): void =>
    publicar((proximos) => {
      if (valor === TODOS) {
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

    const texto = proximos.toString();

    navegador.replace(texto === '' ? BASE : `${BASE}?${texto}`, { scroll: false });
  };

  const limpar = (): void => {
    definirRascunho(null);
    navegador.replace(BASE, { scroll: false });
  };

  const temFiltro = filtro.busca !== null || filtro.estado !== null || filtro.papel !== null;
  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));

  const convidar = podeAdministrar ? (
    <Button asChild>
      <Link href={`${BASE}/novo`}>
        <Plus aria-hidden="true" />
        Convidar usuário
      </Link>
    </Button>
  ) : undefined;

  const barraDeFiltro = (
    <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
      <div className="flex-1">
        <Campo
          rotulo="Buscar"
          placeholder="Nome ou e-mail"
          value={buscaDigitada}
          onValorChange={definirRascunho}
          type="search"
          inputMode="search"
          ajuda="A busca considera nome e e-mail."
        />
      </div>
      <div className="w-full tablet:w-[12rem]">
        <Select
          rotulo="Situação"
          opcoes={OPCOES_DE_ESTADO}
          valor={filtro.estado ?? TODOS}
          onValorChange={(valor) => definir('estado', valor)}
          ajuda="Filtra pelo estado do usuário."
        />
      </div>
      <div className="w-full tablet:w-[16rem]">
        <Select
          rotulo="Papel"
          opcoes={OPCOES_DE_PAPEL}
          valor={filtro.papel ?? TODOS}
          onValorChange={(valor) => definir('papel', valor)}
          ajuda="Filtra por papel padrão."
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
          titulo="Não foi possível carregar os usuários"
          aoTentarDeNovo={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      {barraDeFiltro}

      {/* Contagem total visível: o usuário precisa saber o tamanho do universo
          antes de agir (FRONTEND.md §10.2). */}
      <p className="text-body-sm text-muted-foreground" aria-live="polite">
        {data.total === 1
          ? '1 usuário neste escritório.'
          : `${data.total.toLocaleString('pt-BR')} usuários neste escritório.`}
      </p>

      {data.usuarios.length === 0 ? (
        // As causas do vazio têm textos distintos (PATTERNS.md §5).
        temFiltro ? (
          <EmptyState
            nivel={2}
            icone={<Search />}
            titulo="Nenhum usuário encontrado"
            descricao="Nenhum usuário corresponde à busca ou aos filtros aplicados. Ajuste os critérios para ver mais resultados."
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={limpar}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            nivel={2}
            icone={<Users />}
            titulo="Nenhum usuário cadastrado"
            descricao="Convide a primeira pessoa do escritório: ela recebe um e-mail para definir a senha e entrar."
            {...(convidar === undefined ? {} : { acao: convidar })}
          />
        )
      ) : (
        <div
          className={
            // Enquanto a próxima página carrega, a atual continua visível e apagada.
            isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined
          }
        >
          <ul className="grid gap-sm tablet:grid-cols-2 desktop:hidden" aria-label="Usuários">
            {data.usuarios.map((usuario) => (
              <CartaoDoUsuario key={usuario.id} usuario={usuario} podeAdministrar={podeAdministrar} />
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card desktop:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Usuários deste escritório, com e-mail, papéis padrão e situação
              </caption>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {['Nome', 'E-mail', 'Papéis', 'Situação'].map((titulo) => (
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
                {data.usuarios.map((usuario) => (
                  <LinhaDoUsuario
                    key={usuario.id}
                    usuario={usuario}
                    podeAdministrar={podeAdministrar}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalDePaginas > 1 ? (
            <nav
              className="flex items-center justify-between gap-md pt-md"
              aria-label="Paginação dos usuários"
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
