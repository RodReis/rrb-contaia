/**
 * Gestão individual da carteira de um colaborador (SPEC-009 §5.2): empresas
 * disponíveis e atribuídas, busca, seleção múltipla e um resumo do efeito antes
 * de salvar. Adições e remoções saem numa operação única — tudo ou nada.
 *
 * É o mesmo componente na página dedicada e na aba "Carteira" do usuário, para as
 * duas visões darem o mesmo resultado de autorização. Remover acesso sempre
 * passa por confirmação com o impacto dito por extenso.
 */
'use client';

import { ArrowRightLeft, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaConsulta } from '../usuarios/erro-da-consulta';
import type { EmpresaParaAtribuicao } from './api';
import { ProblemasDoLote, descreverProblemasDoLote } from './problemas-do-lote';
import { useAlterarCarteira, useColaborador } from './queries';
import { ROTULO_DO_ESTADO, nomeDaEmpresa, plural } from './rotulos';
import { SeletorDeEmpresas } from './seletor-de-empresas';

type Alteracao = Readonly<{ empresa: EmpresaParaAtribuicao; acao: 'ADICIONAR' | 'REMOVER' }>;

const ListaDoResumo = ({
  titulo,
  icone,
  alteracoes,
  vazio,
}: {
  titulo: string;
  icone: React.ReactNode;
  alteracoes: readonly Alteracao[];
  vazio: string;
}) => (
  <section aria-label={titulo} className="flex flex-col gap-xs">
    <h3 className="flex items-center gap-xs text-label-md text-foreground">
      <span aria-hidden="true" className="text-muted-foreground [&>svg]:size-4">
        {icone}
      </span>
      {titulo} ({alteracoes.length})
    </h3>
    {alteracoes.length === 0 ? (
      <p className="text-body-sm text-muted-foreground">{vazio}</p>
    ) : (
      <ul className="flex flex-col gap-xs">
        {alteracoes.map(({ empresa }) => (
          <li key={empresa.id} className="break-words text-body-sm text-foreground">
            {nomeDaEmpresa(empresa)}
          </li>
        ))}
      </ul>
    )}
  </section>
);

export const GestaoDaCarteira = ({ usuarioId }: { usuarioId: string }) => {
  const { data: colaborador, isPending, isError, error, refetch } = useColaborador(usuarioId);
  const alterar = useAlterarCarteira();
  const [alteracoes, definirAlteracoes] = useState<ReadonlyMap<string, Alteracao>>(new Map());
  const [problemas, definirProblemas] = useState<readonly string[] | null>(null);

  if (isPending) {
    return (
      <div className="flex flex-col gap-lg" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando a carteira do colaborador</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErroDaConsulta
        erro={error}
        titulo="Não foi possível carregar o colaborador"
        aoTentarDeNovo={() => void refetch()}
      />
    );
  }

  const arquivado = colaborador.estado === 'ARQUIVADO';
  const estado = ROTULO_DO_ESTADO[colaborador.estado];

  const estaMarcada = (empresa: EmpresaParaAtribuicao): boolean => {
    const alteracao = alteracoes.get(empresa.id);

    return empresa.atribuida ? alteracao?.acao !== 'REMOVER' : alteracao?.acao === 'ADICIONAR';
  };

  const alternar = (empresa: EmpresaParaAtribuicao): void => {
    definirAlteracoes((anteriores) => {
      const proximas = new Map(anteriores);

      // Clicar de novo desfaz: a empresa volta ao estado que o servidor conhece.
      if (proximas.has(empresa.id)) {
        proximas.delete(empresa.id);
      } else {
        proximas.set(empresa.id, { empresa, acao: empresa.atribuida ? 'REMOVER' : 'ADICIONAR' });
      }

      return proximas;
    });
  };

  const lista = [...alteracoes.values()];
  const aAdicionar = lista.filter((item) => item.acao === 'ADICIONAR');
  const aRemover = lista.filter((item) => item.acao === 'REMOVER');
  const semAlteracao = lista.length === 0;

  const salvar = async (): Promise<void> => {
    definirProblemas(null);

    try {
      await alterar.mutateAsync({
        origem: 'INDIVIDUAL',
        usuarios: [{ id: colaborador.id, revisao: colaborador.revisaoCarteira }],
        adicionar: aAdicionar.map((item) => item.empresa.id),
        remover: aRemover.map((item) => item.empresa.id),
      });
      definirAlteracoes(new Map());
    } catch (erro) {
      // Lote recusado por item inválido: a lista fica na tela e nada foi aplicado.
      definirProblemas(
        descreverProblemasDoLote(erro, new Map(lista.map((item) => [item.empresa.id, item.empresa.nome]))),
      );
      throw erro;
    }
  };

  return (
    <div className="flex flex-col gap-lg">
      <section
        aria-label="Colaborador"
        className="flex flex-col gap-sm rounded-lg border border-border bg-card p-md tablet:flex-row tablet:items-center tablet:justify-between"
      >
        <div className="flex min-w-0 flex-col gap-xs">
          <h2 className="break-words font-display text-headline-sm text-foreground">
            {colaborador.nome}
          </h2>
          <p className="break-words text-body-sm text-muted-foreground">{colaborador.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />
          <StatusBadge
            tom={colaborador.empresas === 0 ? 'atencao' : 'neutro'}
            rotulo={
              colaborador.empresas === 0
                ? 'Sem empresas'
                : plural(colaborador.empresas, 'empresa na carteira', 'empresas na carteira')
            }
          />
        </div>
      </section>

      {arquivado ? (
        <EmptyState
          nivel={3}
          icone={<ShieldAlert />}
          titulo="Usuário arquivado"
          descricao="Os vínculos de carteira foram encerrados no arquivamento e não voltam sozinhos. Para atribuir empresas, convide o usuário de novo e depois monte a carteira."
        />
      ) : (
        <>
          {colaborador.empresas === 0 && semAlteracao ? (
            <p
              className="rounded-md border border-border bg-muted/40 p-md text-body-md text-muted-foreground"
              role="note"
            >
              Este colaborador ainda não tem empresas na carteira. Enquanto isso, ele vê zero
              empresas e a orientação de ausência de alçada — o papel dele só vale sobre empresas
              atribuídas.
            </p>
          ) : null}

          {problemas === null ? null : <ProblemasDoLote problemas={problemas} />}

          <SeletorDeEmpresas
            usuarioId={colaborador.id}
            estaMarcada={estaMarcada}
            aoAlternar={alternar}
            desabilitado={alterar.isPending}
          />

          <section
            aria-label="Resumo antes de salvar"
            className="flex flex-col gap-md rounded-lg border border-border bg-card p-md"
          >
            <h2 className="text-title-sm text-foreground">Resumo antes de salvar</h2>
            <div className="grid gap-md tablet:grid-cols-2">
              <ListaDoResumo
                titulo="Passam a fazer parte da carteira"
                icone={<Plus />}
                alteracoes={aAdicionar}
                vazio="Nenhuma empresa a adicionar."
              />
              <ListaDoResumo
                titulo="Saem da carteira"
                icone={<Trash2 />}
                alteracoes={aRemover}
                vazio="Nenhuma empresa a remover."
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-sm border-t border-border pt-md">
              <p className="text-body-sm text-muted-foreground">
                {semAlteracao
                  ? 'Marque ou desmarque empresas para montar a alteração.'
                  : 'A mudança vale na próxima requisição do colaborador, que recebe um único aviso no sino.'}
              </p>
              <div className="flex gap-sm">
                <Button
                  type="button"
                  variante="contorno"
                  tamanho="compacto"
                  disabled={semAlteracao || alterar.isPending}
                  onClick={() => definirAlteracoes(new Map())}
                >
                  <ArrowRightLeft aria-hidden="true" />
                  Descartar alterações
                </Button>

                {aRemover.length > 0 ? (
                  <ConfirmacaoDeAcao
                    gatilho={
                      <Button type="button" disabled={alterar.isPending}>
                        Salvar carteira
                      </Button>
                    }
                    titulo="Remover acesso a empresas?"
                    descricao={`${colaborador.nome} deixa de acessar ${plural(
                      aRemover.length,
                      'empresa',
                      'empresas',
                    )} na próxima requisição: ${aRemover
                      .map((item) => item.empresa.nome)
                      .join(', ')}. O histórico fica registrado e o acesso só volta com uma nova atribuição.`}
                    rotuloDeConfirmacao="Remover e salvar"
                    destrutivo
                    aoConfirmar={salvar}
                  />
                ) : (
                  <Button
                    type="button"
                    disabled={semAlteracao || alterar.isPending}
                    onClick={() => void salvar().catch(() => undefined)}
                  >
                    Salvar carteira
                  </Button>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
