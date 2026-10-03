/**
 * Seleção dos papéis padrão (SPEC-007 §3.1): ao menos um é obrigatório e as
 * permissões se somam. Um grupo (`fieldset`) com legenda, para o leitor de tela
 * anunciar "Papéis, grupo" e cada caixa com a descrição do que o papel faz.
 */
'use client';

import { PAPEIS_PADRAO } from '@contaia/domain';
import type { PapelPadrao } from '@contaia/domain';

import { CaixaDeSelecao } from '@/components/ui/caixa-de-selecao';
import { DESCRICAO_DO_PAPEL, ROTULO_DO_PAPEL } from './rotulos';

export const SeletorDePapeis = ({
  valor,
  aoMudar,
  erro,
  somenteLeitura = false,
}: {
  valor: readonly PapelPadrao[];
  aoMudar: (papeis: readonly PapelPadrao[]) => void;
  erro?: string | undefined;
  somenteLeitura?: boolean;
}) => {
  const alternar = (papel: PapelPadrao, marcada: boolean): void => {
    // Mantém a ordem do catálogo, não a do clique: o resumo e o envio ficam estáveis.
    aoMudar(PAPEIS_PADRAO.filter((item) => (item === papel ? marcada : valor.includes(item))));
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-md" disabled={somenteLeitura}>
      <legend className="text-label-md text-foreground">Papéis</legend>

      <p className="text-body-sm text-muted-foreground">
        As permissões se somam: com mais de um papel, vale tudo o que qualquer um deles concede.
      </p>

      <div className="flex flex-col gap-md">
        {PAPEIS_PADRAO.map((papel) => (
          <CaixaDeSelecao
            key={papel}
            rotulo={ROTULO_DO_PAPEL[papel]}
            descricao={DESCRICAO_DO_PAPEL[papel]}
            marcada={valor.includes(papel)}
            onMarcadaChange={(marcada) => alternar(papel, marcada)}
            disabled={somenteLeitura}
          />
        ))}
      </div>

      {erro === undefined ? null : (
        <p role="alert" className="text-body-sm text-danger-foreground">
          {erro}
        </p>
      )}
    </fieldset>
  );
};
