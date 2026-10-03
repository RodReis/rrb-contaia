/**
 * Lista das empresas no cofre (SPEC-011 §5.2): busca, filtro de estado,
 * ordenação e paginação na URL e executados no servidor. Abaixo de 1024px a
 * tabela vira cartões (pendência P-02 do design system: sobrevivem empresa,
 * certificado, validade, situação e responsável, e as ações ficam no rodapé do
 * cartão), porque seis colunas com ação por linha não cabem em 768px.
 */
'use client';

import type { ItemDoCofre } from '@contaia/shared';
import { Building2, Search, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { juntar } from './estilos';
import { AcoesDoItem } from './acoes-do-item';
import { OPCOES_DE_ESTADO, ORDENACOES, TODOS } from './apresentacao';
import { ErroDoCofre } from './erro-do-cofre';
import {
  CertificadoDoItem,
  EmpresaDoItem,
  ResponsavelDoItem,
  SituacaoDoItem,
  tingimentoDoItem,
} from './pecas-do-item';
import type { useCofre } from './queries';
import { POR_PAGINA, type useFiltroDoCofre } from './use-filtro-do-cofre';

type Controle = ReturnType<typeof useFiltroDoCofre>;
type Consulta = ReturnType<typeof useCofre>;

/** Larguras em %: a tabela é `table-fixed` para a coluna de ações nunca ser cortada. */
const COLUNAS = [
  { titulo: 'Empresa', largura: 'w-[21%]' },
  { titulo: 'Certificado', largura: 'w-[19%]' },
  { titulo: 'Situação e validade', largura: 'w-[22%]' },
  { titulo: 'Responsável', largura: 'w-[17%]' },
] as const;

const OPCOES_DO_FILTRO = [
  { valor: TODOS, rotulo: 'Todos os estados' },
  ...OPCOES_DE_ESTADO,
] as const;

const Esqueleto = () => (
  <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
    <span className="sr-only">Carregando os certificados do escritório</span>
    <Skeleton className="h-9 w-full" />
    {Array.from({ length: 6 }, (_, indice) => (
      <Skeleton key={indice} className="h-16 w-full" />
    ))}
  </div>
);

const Cartao = ({
  item,
  aoAbrir,
  aoEnviar,
}: {
  item: ItemDoCofre;
  aoAbrir: (empresaId: string) => void;
  aoEnviar: (item: ItemDoCofre) => void;
}) => (
  <li
    className={juntar(
      'flex flex-col gap-md rounded-lg border border-border p-md',
      tingimentoDoItem(item) ?? 'bg-card',
    )}
  >
    <div className="flex flex-wrap items-start justify-between gap-sm">
      <EmpresaDoItem item={item} aoAbrir={aoAbrir} />
      <SituacaoDoItem item={item} />
    </div>
    <dl className="grid gap-md tablet:grid-cols-2">
      <div className="flex flex-col gap-xs">
        <dt className="text-label-sm uppercase text-muted-foreground">Certificado</dt>
        <dd>
          <CertificadoDoItem item={item} />
        </dd>
      </div>
      <div className="flex flex-col gap-xs">
        <dt className="text-label-sm uppercase text-muted-foreground">Responsável</dt>
        <dd>
          <ResponsavelDoItem item={item} />
        </dd>
      </div>
    </dl>
    <AcoesDoItem item={item} variante="linha" aoEnviar={aoEnviar} />
  </li>
);

const Tabela = ({
  itens,
  aoAbrir,
  aoEnviar,
}: {
  itens: readonly ItemDoCofre[];
  aoAbrir: (empresaId: string) => void;
  aoEnviar: (item: ItemDoCofre) => void;
}) => (
  <div className="hidden overflow-hidden rounded-lg border border-border bg-card desktop:block">
    <table className="w-full table-fixed border-collapse text-left">
      <caption className="sr-only">
        Empresas do escritório, com o certificado A1, a situação e a validade e o responsável de
        cada uma
      </caption>
      <thead>
        <tr className="border-b border-border bg-muted/40">
          {COLUNAS.map(({ titulo, largura }) => (
            <th
              key={titulo}
              scope="col"
              className={juntar('px-md py-sm text-label-sm uppercase text-muted-foreground', largura)}
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
        {itens.map((item) => (
          <tr
            key={item.empresaId}
            className={juntar(
              'border-b border-border align-top transition-colors duration-fast last:border-b-0',
              tingimentoDoItem(item) ?? 'hover:bg-accent/40',
            )}
          >
            <td className="px-md py-sm">
              <EmpresaDoItem item={item} aoAbrir={aoAbrir} />
            </td>
            <td className="px-md py-sm">
              <CertificadoDoItem item={item} />
            </td>
            <td className="px-md py-sm">
              <SituacaoDoItem item={item} />
            </td>
            <td className="px-md py-sm">
              <ResponsavelDoItem item={item} />
            </td>
            <td className="px-md py-sm">
              <AcoesDoItem item={item} variante="linha" aoEnviar={aoEnviar} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const ListaDoCofre = ({
  controle,
  consulta,
  aoEnviar,
}: {
  controle: Controle;
  consulta: Consulta;
  aoEnviar: (item: ItemDoCofre) => void;
}) => {
  const { filtro, buscaDigitada, definirBusca, definir, irParaPagina, limpar, temFiltro, temAjuste } =
    controle;

  const barraDeFiltro = (
    <div className="flex flex-col gap-md tablet:flex-row tablet:flex-wrap tablet:items-end">
      <div className="flex-1 tablet:min-w-[16rem]">
        <Campo
          rotulo="Buscar empresa"
          placeholder="Nome, CNPJ ou autoridade"
          value={buscaDigitada}
          onValorChange={definirBusca}
          type="search"
          inputMode="search"
        />
      </div>
      <div className="w-full tablet:w-[14rem]">
        <Select
          rotulo="Estado do certificado"
          opcoes={OPCOES_DO_FILTRO}
          valor={filtro.estado ?? TODOS}
          onValorChange={(valor) => definir('estado', valor)}
        />
      </div>
      <div className="w-full tablet:w-[14rem]">
        <Select
          rotulo="Ordenar por"
          opcoes={ORDENACOES}
          valor={filtro.ordem}
          onValorChange={(valor) => definir('ordem', valor, 'EMPRESA')}
        />
      </div>
      {temAjuste ? (
        <Button variante="contorno" tamanho="compacto" onClick={limpar}>
          <SlidersHorizontal aria-hidden="true" />
          Limpar
        </Button>
      ) : null}
    </div>
  );

  if (consulta.isPending) {
    return (
      <div className="flex flex-col gap-lg">
        {barraDeFiltro}
        <Esqueleto />
      </div>
    );
  }

  if (consulta.isError) {
    return (
      <div className="flex flex-col gap-lg">
        {barraDeFiltro}
        <ErroDoCofre
          erro={consulta.error}
          titulo="Não foi possível carregar o cofre"
          aoTentarDeNovo={() => void consulta.refetch()}
        />
      </div>
    );
  }

  const { data } = consulta;
  const totalDePaginas = Math.max(1, Math.ceil(data.total / POR_PAGINA));

  return (
    <div className="flex flex-col gap-lg">
      {barraDeFiltro}

      <p className="text-body-sm text-muted-foreground" aria-live="polite">
        {data.total === 1
          ? '1 empresa encontrada.'
          : `${data.total.toLocaleString('pt-BR')} empresas encontradas.`}
      </p>

      {data.itens.length === 0 ? (
        temFiltro ? (
          <EmptyState
            nivel={2}
            icone={<Search />}
            titulo="Nenhuma empresa encontrada"
            descricao="Nenhuma empresa corresponde à busca ou ao filtro aplicados. Ajuste os critérios para ver mais resultados."
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={limpar}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            nivel={2}
            icone={<Building2 />}
            titulo="Nenhuma empresa no cofre ainda"
            descricao="As empresas ativas da sua carteira aparecem aqui, cada uma com o certificado A1 vigente, a validade e o responsável."
          />
        )
      ) : (
        <div
          className={consulta.isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined}
        >
          <ul
            className="grid gap-sm tablet:grid-cols-2 desktop:hidden"
            aria-label="Certificados por empresa"
          >
            {data.itens.map((item) => (
              <Cartao key={item.empresaId} item={item} aoAbrir={controle.abrirEmpresa} aoEnviar={aoEnviar} />
            ))}
          </ul>

          <Tabela itens={data.itens} aoAbrir={controle.abrirEmpresa} aoEnviar={aoEnviar} />

          {totalDePaginas > 1 ? (
            <nav
              className="flex items-center justify-between gap-md pt-md"
              aria-label="Paginação do cofre"
            >
              <p className="text-body-sm text-muted-foreground">
                Página {filtro.pagina} de {totalDePaginas}
              </p>
              <div className="flex gap-xs">
                <Button
                  variante="contorno"
                  tamanho="compacto"
                  disabled={filtro.pagina <= 1}
                  onClick={() => irParaPagina(filtro.pagina - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variante="contorno"
                  tamanho="compacto"
                  disabled={filtro.pagina >= totalDePaginas}
                  onClick={() => irParaPagina(filtro.pagina + 1)}
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
