/**
 * Aba "Colaboradores" da empresa (SPEC-009 §5.2): quem tem a empresa na carteira,
 * com adição e remoção. Dá o mesmo resultado de autorização que a Central e a
 * aba "Carteira" do usuário — só o `admin_escritorio` altera, e o servidor decide.
 *
 * A remoção de acesso sempre pede confirmação, com o impacto dito por extenso.
 */
'use client';

import { UserMinus, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { CaixaDeSelecao } from '@/components/ui/caixa-de-selecao';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { ErroDaConsulta } from '../usuarios/erro-da-consulta';
import { ROTULO_DO_PAPEL } from '../usuarios/rotulos';
import { obterColaborador, type ColaboradorDaEmpresa, type ColaboradorNaCentral } from './api';
import { CAMINHO_DA_GESTAO } from './central-de-carteiras';
import { ProblemasDoLote, descreverProblemasDoLote } from './problemas-do-lote';
import { useAlterarCarteira, useColaboradores, useColaboradoresDaEmpresa } from './queries';
import { ROTULO_DO_ESTADO, formatarQuando, plural } from './rotulos';

const OPCOES_DE_ESTADO = [
  { valor: 'ATIVO', rotulo: 'Ativos' },
  { valor: 'CONVIDADO', rotulo: 'Convidados' },
  { valor: 'SUSPENSO', rotulo: 'Suspensos' },
] as const;

type EstadoDoSeletor = (typeof OPCOES_DE_ESTADO)[number]['valor'];

const SeletorDeColaboradores = ({
  jaVinculados,
  marcados,
  aoAlternar,
}: {
  jaVinculados: ReadonlySet<string>;
  marcados: ReadonlyMap<string, ColaboradorNaCentral>;
  aoAlternar: (colaborador: ColaboradorNaCentral) => void;
}) => {
  const [busca, definirBusca] = useState('');
  const [estado, definirEstado] = useState<EstadoDoSeletor>('ATIVO');
  const { data, isPending, isError, error, refetch } = useColaboradores({
    busca: busca.trim() === '' ? null : busca.trim(),
    estado,
    papel: null,
    carteira: null,
    limite: 25,
    deslocamento: 0,
  });

  return (
    <div
      className="flex flex-col gap-md"
      onKeyDown={(evento) => {
        if (evento.key === 'Enter' && evento.target instanceof HTMLInputElement) {
          evento.preventDefault();
        }
      }}
    >
      <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
        <div className="flex-1">
          <Campo
            rotulo="Buscar colaborador"
            placeholder="Nome ou e-mail"
            value={busca}
            onValorChange={definirBusca}
            type="search"
            inputMode="search"
          />
        </div>
        <div className="w-full tablet:w-[12rem]">
          <Select
            rotulo="Situação"
            opcoes={OPCOES_DE_ESTADO}
            valor={estado}
            onValorChange={(valor) => definirEstado(valor as EstadoDoSeletor)}
          />
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível carregar os colaboradores"
          aoTentarDeNovo={() => void refetch()}
        />
      ) : data.colaboradores.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          Nenhum colaborador corresponde à busca ou ao filtro.
        </p>
      ) : (
        <ul
          aria-label="Colaboradores do escritório"
          className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card"
        >
          {data.colaboradores.map((colaborador) => {
            const vinculado = jaVinculados.has(colaborador.id);

            return (
              <li key={colaborador.id} className="px-md py-sm">
                <CaixaDeSelecao
                  rotulo={colaborador.nome}
                  descricao={vinculado ? 'Já tem esta empresa na carteira.' : colaborador.email}
                  marcada={vinculado || marcados.has(colaborador.id)}
                  disabled={vinculado}
                  onMarcadaChange={() => aoAlternar(colaborador)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const Adicionar = ({
  empresaId,
  vinculados,
}: {
  empresaId: string;
  vinculados: readonly ColaboradorDaEmpresa[];
}) => {
  const alterar = useAlterarCarteira();
  const [marcados, definirMarcados] = useState<ReadonlyMap<string, ColaboradorNaCentral>>(new Map());
  const [problemas, definirProblemas] = useState<readonly string[] | null>(null);
  const [aberto, definirAberto] = useState(false);

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

  const adicionar = async (): Promise<void> => {
    definirProblemas(null);

    try {
      await alterar.mutateAsync({
        origem: 'INDIVIDUAL',
        usuarios: [...marcados.values()].map((c) => ({ id: c.id, revisao: c.revisaoCarteira })),
        adicionar: [empresaId],
        remover: [],
      });
      definirMarcados(new Map());
      definirAberto(false);
    } catch (erro) {
      if (erro instanceof ErroDaApi && erro.problema.code === 'CARTEIRA_DESATUALIZADA') {
        // A revisão guardada na seleção está velha: renova, ou o novo envio levaria o mesmo 409.
        const frescos = await Promise.all([...marcados.keys()].map((id) => obterColaborador(id))).catch(
          () => null,
        );

        if (frescos !== null) {
          definirMarcados(new Map(frescos.map((c) => [c.id, c])));
        }

        definirProblemas([
          'A carteira de algum colaborador mudou depois da seleção. Os dados foram atualizados: revise e adicione de novo.',
        ]);
        return;
      }

      definirProblemas(
        descreverProblemasDoLote(erro, new Map([...marcados.values()].map((c) => [c.id, c.nome]))),
      );
    }
  };

  if (!aberto) {
    return (
      // `self-start`: dentro de uma coluna flex o botão esticaria a largura inteira.
      <Button tamanho="compacto" className="self-start" onClick={() => definirAberto(true)}>
        <UserPlus aria-hidden="true" />
        Adicionar colaboradores
      </Button>
    );
  }

  return (
    <section
      aria-label="Adicionar colaboradores"
      className="flex flex-col gap-md rounded-lg border border-border bg-card p-md"
    >
      <h3 className="text-title-sm text-foreground">Adicionar colaboradores a esta carteira</h3>
      {problemas === null ? null : <ProblemasDoLote problemas={problemas} />}
      <SeletorDeColaboradores
        jaVinculados={new Set(vinculados.map((c) => c.id))}
        marcados={marcados}
        aoAlternar={alternar}
      />
      <div className="flex flex-wrap items-center justify-between gap-sm border-t border-border pt-md">
        <p className="text-body-sm text-muted-foreground" aria-live="polite">
          {marcados.size === 0
            ? 'Nenhum colaborador escolhido.'
            : `${plural(marcados.size, 'colaborador escolhido', 'colaboradores escolhidos')}. Cada um recebe um aviso no sino.`}
        </p>
        <div className="flex gap-sm">
          <Button
            variante="contorno"
            tamanho="compacto"
            disabled={alterar.isPending}
            onClick={() => {
              definirMarcados(new Map());
              definirProblemas(null);
              definirAberto(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            tamanho="compacto"
            disabled={marcados.size === 0 || alterar.isPending}
            onClick={() => void adicionar()}
          >
            {alterar.isPending ? 'Salvando…' : 'Adicionar e salvar'}
          </Button>
        </div>
      </div>
    </section>
  );
};

const LinhaDoColaborador = ({
  colaborador,
  empresaId,
  empresaNome,
}: {
  colaborador: ColaboradorDaEmpresa;
  empresaId: string;
  empresaNome: string;
}) => {
  const alterar = useAlterarCarteira();
  const estado = ROTULO_DO_ESTADO[colaborador.estado];

  return (
    <li className="flex flex-col gap-sm px-md py-sm tablet:flex-row tablet:items-center tablet:justify-between">
      <div className="flex min-w-0 flex-col gap-xs">
        <span className="break-words text-title-sm text-foreground">{colaborador.nome}</span>
        <span className="break-words text-body-sm text-muted-foreground">
          {colaborador.email} · desde {formatarQuando(colaborador.desde)}
        </span>
        <ul className="flex flex-wrap gap-xs" aria-label="Papéis">
          {colaborador.papeis.map((papel) => (
            <li key={papel}>
              <StatusBadge tom="neutro" rotulo={ROTULO_DO_PAPEL[papel]} />
            </li>
          ))}
          <li>
            <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />
          </li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-sm">
        <Button asChild variante="contorno" tamanho="compacto">
          <Link
            href={`${CAMINHO_DA_GESTAO}/${colaborador.id}`}
            aria-label={`Ver carteira de ${colaborador.nome}`}
          >
            Ver carteira
          </Link>
        </Button>
        <ConfirmacaoDeAcao
          gatilho={
            <Button
              variante="contorno"
              tamanho="compacto"
              aria-label={`Remover ${colaborador.nome} desta empresa`}
              disabled={alterar.isPending}
            >
              <UserMinus aria-hidden="true" />
              Remover
            </Button>
          }
          titulo="Remover colaborador desta empresa?"
          descricao={`${colaborador.nome} deixa de acessar ${empresaNome} na próxima requisição. O histórico fica registrado e o acesso só volta com uma nova atribuição.`}
          rotuloDeConfirmacao="Remover acesso"
          destrutivo
          aoConfirmar={() =>
            alterar.mutateAsync({
              origem: 'INDIVIDUAL',
              usuarios: [{ id: colaborador.id, revisao: colaborador.revisaoCarteira }],
              adicionar: [],
              remover: [empresaId],
            })
          }
        />
      </div>
    </li>
  );
};

export const AbaDeColaboradores = ({
  empresaId,
  empresaNome,
}: {
  empresaId: string;
  empresaNome: string;
}) => {
  const { data, isPending, isError, error, refetch } = useColaboradoresDaEmpresa(empresaId);

  if (isPending) {
    return (
      <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando os colaboradores da empresa</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErroDaConsulta
        erro={error}
        titulo="Não foi possível carregar os colaboradores"
        aoTentarDeNovo={() => void refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-body-sm text-muted-foreground" aria-live="polite">
          {data.colaboradores.length === 0
            ? 'Nenhum colaborador tem esta empresa na carteira.'
            : `${plural(data.colaboradores.length, 'colaborador atua', 'colaboradores atuam')} nesta empresa.`}
        </p>
      </div>

      <Adicionar empresaId={empresaId} vinculados={data.colaboradores} />

      {data.colaboradores.length === 0 ? (
        <EmptyState
          nivel={3}
          icone={<Users />}
          titulo="Empresa sem colaboradores"
          descricao="Ninguém tem esta empresa na carteira. Quem não está na carteira não opera a empresa — nem o administrador. Adicione colaboradores para ela voltar a ser atendida."
        />
      ) : (
        <ul
          aria-label="Colaboradores desta empresa"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
        >
          {data.colaboradores.map((colaborador) => (
            <LinhaDoColaborador
              key={colaborador.id}
              colaborador={colaborador}
              empresaId={empresaId}
              empresaNome={empresaNome}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
