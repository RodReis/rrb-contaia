/**
 * Seleção dos papéis do usuário (SPEC-007 §3.1, SPEC-008 §3.4): ao menos um, de
 * qualquer tipo, e as permissões se somam. Dois grupos (`fieldset`) com legenda,
 * para o leitor de tela anunciar "Papéis padrão, grupo" e "Papéis personalizados,
 * grupo", cada caixa com a descrição do que o papel faz.
 *
 * Papel personalizado arquivado não aparece para escolha: o servidor recusa
 * nova atribuição, então a tela não a oferece.
 */
'use client';

import { PAPEIS_PADRAO } from '@contaia/domain';
import type { PapelPadrao } from '@contaia/domain';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { CaixaDeSelecao } from '@/components/ui/caixa-de-selecao';
import { Skeleton } from '@/components/ui/estados';
import { useListaDePapeis } from '../papeis/queries';
import { ErroDaConsulta } from './erro-da-consulta';
import { DESCRICAO_DO_PAPEL, ROTULO_DO_PAPEL } from './rotulos';
import type { PapeisEscolhidos } from './schema';

const FILTRO_DOS_ATIVOS = { busca: null, estado: 'ATIVO', limite: 100, deslocamento: 0 } as const;

/** Papéis personalizados que ainda podem ser atribuídos; a consulta é a mesma do seletor (cache único). */
export const usePapeisAtivos = () => useListaDePapeis(FILTRO_DOS_ATIVOS);

const GrupoDePersonalizados = ({
  valor,
  aoMudar,
  somenteLeitura,
}: {
  valor: readonly string[];
  aoMudar: (personalizados: readonly string[]) => void;
  somenteLeitura: boolean;
}) => {
  const { data, isPending, isError, error, refetch } = usePapeisAtivos();

  const alternar = (id: string, marcada: boolean): void => {
    aoMudar(marcada ? [...valor, id] : valor.filter((existente) => existente !== id));
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-md" disabled={somenteLeitura}>
      <legend className="text-label-md text-foreground">Papéis personalizados</legend>

      {isPending ? (
        <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando os papéis personalizados</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível carregar os papéis personalizados"
          aoTentarDeNovo={() => void refetch()}
        />
      ) : data.papeis.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          Este escritório ainda não tem papéis personalizados ativos.{' '}
          {somenteLeitura ? null : (
            <Button asChild variante="fantasma" tamanho="compacto">
              <Link href="/configuracoes/usuarios/papeis/novo">Criar papel personalizado</Link>
            </Button>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-md">
          {data.papeis.map((papel) => (
            <CaixaDeSelecao
              key={papel.id}
              rotulo={papel.nome}
              descricao={
                papel.descricao ?? `Baseado em ${ROTULO_DO_PAPEL[papel.papelBase]}.`
              }
              marcada={valor.includes(papel.id)}
              onMarcadaChange={(marcada) => alternar(papel.id, marcada)}
              disabled={somenteLeitura}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
};

export const SeletorDePapeis = ({
  valor,
  aoMudar,
  erro,
  somenteLeitura = false,
}: {
  valor: PapeisEscolhidos;
  aoMudar: (papeis: PapeisEscolhidos) => void;
  erro?: string | undefined;
  somenteLeitura?: boolean;
}) => {
  const alternarPadrao = (papel: PapelPadrao, marcada: boolean): void => {
    // Mantém a ordem do catálogo, não a do clique: o resumo e o envio ficam estáveis.
    aoMudar({
      ...valor,
      padrao: PAPEIS_PADRAO.filter((item) =>
        item === papel ? marcada : valor.padrao.includes(item),
      ),
    });
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-lg" disabled={somenteLeitura}>
      <legend className="text-label-md text-foreground">Papéis</legend>

      <p className="text-body-sm text-muted-foreground">
        As permissões se somam: com mais de um papel, vale tudo o que qualquer um deles concede.
      </p>

      <fieldset className="flex min-w-0 flex-col gap-md" disabled={somenteLeitura}>
        <legend className="text-label-md text-foreground">Papéis padrão</legend>

        <div className="flex flex-col gap-md">
          {PAPEIS_PADRAO.map((papel) => (
            <CaixaDeSelecao
              key={papel}
              rotulo={ROTULO_DO_PAPEL[papel]}
              descricao={DESCRICAO_DO_PAPEL[papel]}
              marcada={valor.padrao.includes(papel)}
              onMarcadaChange={(marcada) => alternarPadrao(papel, marcada)}
              disabled={somenteLeitura}
            />
          ))}
        </div>
      </fieldset>

      <GrupoDePersonalizados
        valor={valor.personalizados}
        aoMudar={(personalizados) => aoMudar({ ...valor, personalizados })}
        somenteLeitura={somenteLeitura}
      />

      {erro === undefined ? null : (
        <p role="alert" className="text-body-sm text-danger-foreground">
          {erro}
        </p>
      )}
    </fieldset>
  );
};
