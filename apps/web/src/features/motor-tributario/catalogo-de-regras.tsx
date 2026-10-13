/**
 * Catálogo global de regras tributárias (SPEC-016 §3.1–3.3, §5.2 itens 2–4): tabela com filtros por
 * tributo, regime, operação, estado e vigência, tudo na URL, paginada no servidor. O catálogo não
 * pertence a tenant nem a empresa. Quem só consulta vê o publicado; criar, editar, publicar e
 * arquivar aparecem só quando a API diz que o usuário administra (`canAdminister`), mas a decisão
 * continua sendo da API.
 *
 * A tabela rola na horizontal dentro do próprio contêiner abaixo de 1024 px; o colapso em cartões
 * é a pendência P-02 do design system e fica registrado na PR.
 */
'use client';

import { Plus, Scale, Search, SlidersHorizontal, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { formatarCentesimosDePercentual } from '@/lib/moeda';
import { AbrirRegra, ArquivarRegra, PublicarRegra } from './acoes-da-regra';
import {
  APRESENTACAO_DO_ESTADO,
  OPCOES_DE_ESTADO,
  OPCOES_DE_OPERACAO,
  OPCOES_DE_REGIME,
  OPCOES_DE_TRIBUTO,
  formatarVigencia,
} from './apresentacao';
import { EditorDeRegra } from './editor-de-regra';
import { ErroDoMotor } from './erro-do-motor';
import { useCatalogo } from './queries';
import { rotuloDaRegra } from './resultado-da-simulacao';
import { NOVA_REGRA, POR_PAGINA, TODOS, useFiltroDoCatalogo } from './use-filtro-do-catalogo';
import type { TaxRuleVersionDto } from '@contaia/shared';

const NUMERICO = 'font-mono text-code-sm tabular-nums';

const comTodos = (rotulo: string, opcoes: readonly Readonly<{ valor: string; rotulo: string }>[]) => [{ valor: TODOS, rotulo }, ...opcoes];

const TITULOS = ['Regra', 'Versão', 'Vigência', 'Alíquota', 'Estado'] as const;

const Esqueleto = () => (
  <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
    <span className="sr-only">Carregando o catálogo de regras</span>
    <Skeleton className="h-9 w-full" />
    {Array.from({ length: 5 }, (_, indice) => (
      <Skeleton key={indice} className="h-12 w-full" />
    ))}
  </div>
);

const LinhaDaRegra = ({
  regra,
  podeAdministrar,
  aoAbrir,
}: {
  regra: TaxRuleVersionDto;
  podeAdministrar: boolean;
  aoAbrir: (id: string) => void;
}) => {
  const estado = APRESENTACAO_DO_ESTADO[regra.status];
  const rascunho = regra.status === 'DRAFT';

  return (
    <tr className="border-b border-border align-top last:border-b-0 hover:bg-accent/40">
      <td className="min-w-[11rem] px-md py-sm text-body-md text-foreground">
        <span className="break-words">{rotuloDaRegra(regra)}</span>
      </td>
      <td className={`px-md py-sm ${NUMERICO}`}>v{regra.versionNumber}</td>
      <td className="min-w-[9rem] px-md py-sm text-body-md text-foreground">{formatarVigencia(regra.validFrom, regra.validUntil)}</td>
      <td className="px-md py-sm">
        <span className={NUMERICO}>{formatarCentesimosDePercentual(regra.rateBasisPoints)}</span>
        {regra.baseReductionBasisPoints === null ? null : (
          <span className="block text-body-sm text-muted-foreground">
            redução de base <span className={NUMERICO}>{formatarCentesimosDePercentual(regra.baseReductionBasisPoints)}</span>
          </span>
        )}
      </td>
      <td className="px-md py-sm">
        <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />
      </td>
      <td className="sticky right-0 bg-card px-md py-sm text-right shadow-[-1px_0_0_var(--border)]">
        <div className="flex flex-col items-end gap-xs desktop:flex-row desktop:flex-nowrap desktop:justify-end">
          <AbrirRegra regra={regra} podeEditar={podeAdministrar && rascunho} aoAbrir={aoAbrir} />
          {podeAdministrar && rascunho ? <PublicarRegra regra={regra} /> : null}
          {podeAdministrar && regra.status === 'PUBLISHED' ? <ArquivarRegra regra={regra} /> : null}
        </div>
      </td>
    </tr>
  );
};

export const CatalogoDeRegras = () => {
  const { filtro, temFiltro, regraAberta, definir, limpar, irParaPagina, abrir } = useFiltroDoCatalogo();
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useCatalogo(filtro);

  const podeAdministrar = data?.canAdminister ?? false;
  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));
  const nova = podeAdministrar ? (
    <Button onClick={() => abrir(NOVA_REGRA)}>
      <Plus aria-hidden="true" />
      Nova regra
    </Button>
  ) : undefined;

  const barraDeFiltro = (
    <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-5">
      <Select
        rotulo="Tributo"
        opcoes={comTodos('Todos os tributos', OPCOES_DE_TRIBUTO)}
        valor={filtro.taxType ?? TODOS}
        onValorChange={(valor) => definir('tributo', valor)}
      />
      <Select
        rotulo="Regime"
        opcoes={comTodos('Todos os regimes', OPCOES_DE_REGIME)}
        valor={filtro.regime ?? TODOS}
        onValorChange={(valor) => definir('regime', valor)}
      />
      <Select
        rotulo="Operação"
        opcoes={comTodos('Todas as operações', OPCOES_DE_OPERACAO)}
        valor={filtro.operationType ?? TODOS}
        onValorChange={(valor) => definir('operacao', valor)}
      />
      <Select
        rotulo="Estado"
        opcoes={comTodos('Todos os estados', OPCOES_DE_ESTADO)}
        valor={filtro.status ?? TODOS}
        onValorChange={(valor) => definir('estado', valor)}
      />
      <Campo rotulo="Vigente em" type="date" value={filtro.validOn ?? ''} onValorChange={(valor) => definir('vigente', valor)} />
    </div>
  );

  const cabecalho = (
    <div className="flex flex-col gap-sm tablet:flex-row tablet:items-start tablet:justify-between">
      <div className="flex flex-col gap-xs">
        <h2 className="font-display text-headline-md text-foreground">Catálogo de regras</h2>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Regras por tributo, regime, operação e vigência. Dados de teste não oficiais: provam o comportamento do motor e não
          orientam o recolhimento de tributo.
          {podeAdministrar || data === undefined ? '' : ' Você vê as regras publicadas; criar, editar, publicar e arquivar é do administrador da plataforma.'}
        </p>
      </div>
      {nova}
    </div>
  );

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <div className="flex flex-col gap-lg">
        {cabecalho}
        {problema?.code === 'SEM_AUTORIZACAO' ? (
          <EmptyState
            icone={<Lock />}
            titulo="Você não tem acesso às regras tributárias"
            descricao="O seu papel não inclui a consulta ao motor tributário. Se você precisa dela, peça a um administrador do escritório."
          />
        ) : (
          <ErroDoMotor
            erro={error}
            titulo="Não foi possível carregar o catálogo"
            acao={
              <div>
                <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
                  Tentar de novo
                </Button>
              </div>
            }
          />
        )}
      </div>
    );
  }

  // `?regra=nova` só abre para quem administra; sem essa conferência um perfil de consulta veria o
  // formulário de criação por link e só a API o recusaria.
  const painelAberto = regraAberta !== null && (regraAberta !== NOVA_REGRA || podeAdministrar);

  return (
    <div className="flex flex-col gap-lg">
      {painelAberto ? <EditorDeRegra regraId={regraAberta} podeAdministrar={podeAdministrar} aoFechar={() => abrir(null)} /> : null}
      {cabecalho}
      {barraDeFiltro}
      {/* Com o vazio por filtro na tela, a ação de limpar já está nele; duas seriam o mesmo botão repetido. */}
      {temFiltro && data?.items.length !== 0 ? (
        <div>
          <Button variante="contorno" tamanho="compacto" onClick={limpar}>
            <SlidersHorizontal aria-hidden="true" />
            Limpar filtros
          </Button>
        </div>
      ) : null}

      {isPending ? (
        <Esqueleto />
      ) : (
        <>
          <p className="text-body-sm text-muted-foreground" aria-live="polite">
            {data.total === 1 ? '1 versão no catálogo.' : `${data.total.toLocaleString('pt-BR')} versões no catálogo.`}
          </p>

          {data.items.length === 0 ? (
            temFiltro ? (
              <EmptyState
                icone={<Search />}
                titulo="Nenhuma regra encontrada"
                descricao="Nenhuma versão corresponde aos filtros aplicados. Ajuste os critérios para ver mais resultados."
                acao={
                  <Button variante="contorno" tamanho="compacto" onClick={limpar}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : podeAdministrar ? (
              <EmptyState
                icone={<Scale />}
                titulo="Nenhuma regra no catálogo"
                descricao="Crie o primeiro rascunho: tributo, regime, operação, vigência e alíquota. Ele só passa a valer depois de publicado."
                {...(nova === undefined ? {} : { acao: nova })}
              />
            ) : (
              <EmptyState
                icone={<Scale />}
                titulo="Nenhuma regra publicada ainda"
                descricao="O administrador da plataforma ainda não publicou regras. Quando houver, elas aparecem aqui e podem ser usadas no simulador."
              />
            )
          ) : (
            <div className={isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined}>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full min-w-[44rem] border-collapse text-left">
                  <caption className="sr-only">Regras tributárias do catálogo, com versão, vigência, alíquota e estado</caption>
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {TITULOS.map((titulo) => (
                        <th key={titulo} scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                          {titulo}
                        </th>
                      ))}
                      <th scope="col" className="sticky right-0 bg-card px-md py-sm text-right text-label-sm uppercase text-muted-foreground">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((regra) => (
                      <LinhaDaRegra key={regra.id} regra={regra} podeAdministrar={podeAdministrar} aoAbrir={abrir} />
                    ))}
                  </tbody>
                </table>
              </div>

              {totalDePaginas > 1 ? (
                <nav className="flex items-center justify-between gap-md pt-md" aria-label="Paginação do catálogo">
                  <p className="text-body-sm text-muted-foreground">
                    Página {filtro.page} de {totalDePaginas}
                  </p>
                  <div className="flex gap-xs">
                    <Button variante="contorno" tamanho="compacto" disabled={filtro.page <= 1} onClick={() => irParaPagina(filtro.page - 1)}>
                      Anterior
                    </Button>
                    <Button
                      variante="contorno"
                      tamanho="compacto"
                      disabled={filtro.page >= totalDePaginas}
                      onClick={() => irParaPagina(filtro.page + 1)}
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
    </div>
  );
};
