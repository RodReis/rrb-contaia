/**
 * Seção "Aba" da planilha (SPEC-015 §3.3, §5.2 item 3): a aba única (ou a única com dados) é dita por
 * texto, sem pedir escolha; com várias, a escolha é explícita e a aba sem dados aparece marcada. Aba
 * vazia ou que sumiu fica como erro no próprio seletor; outra falha da leitura dela, como painel.
 */
'use client';

import type { InspecaoDePlanilha } from '@contaia/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { Select } from '@/components/ui/select';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { rotuloDaAba } from './apresentacao-da-planilha';
import { FalhaDaLeitura, LendoPlanilha, problemaDa } from './estados-da-planilha';

export const LEITURA_DEMORADA =
  'Abas, cabeçalho e as primeiras linhas aparecem aqui. Uma planilha grande pode levar até um minuto e meio; nada foi enviado para validação ainda.';

const CODIGOS_DA_ABA: readonly string[] = ['ABA_SEM_DADOS', 'ABA_INEXISTENTE'];

/** Grupo de uma decisão da planilha (aba, linha do cabeçalho), com o título no peso das irmãs. */
export const Bloco = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <fieldset className="flex min-w-0 flex-col gap-sm">
    <legend className="mb-xs text-title-md text-foreground">{titulo}</legend>
    {children}
  </fieldset>
);

export const SecaoDaAba = ({
  inspecao,
  abaEscolhida,
  daAbaEscolhida,
  enviando,
  aoEscolher,
  aoTrocar,
}: {
  /** A leitura geral (sem aba pedida). */
  inspecao: InspecaoDePlanilha;
  abaEscolhida: number | null;
  daAbaEscolhida: UseQueryResult<InspecaoDePlanilha>;
  enviando: boolean;
  aoEscolher: (valor: string) => void;
  aoTrocar: () => void;
}) => {
  if (inspecao.abaSelecionada !== null) {
    const texto =
      inspecao.abas.length === 1
        ? `Aba única: ${rotuloDaAba(inspecao.abaSelecionada)}`
        : `Única aba com dados: ${rotuloDaAba(inspecao.abaSelecionada)}`;

    return (
      <Bloco titulo="Aba">
        <p title={texto} className="truncate text-body-md text-foreground">
          {texto}
        </p>
        {inspecao.abas.length > 1 ? (
          <p className="text-body-sm text-muted-foreground">As demais abas estão vazias e não são lidas.</p>
        ) : null}
      </Bloco>
    );
  }

  const problema = daAbaEscolhida.isError ? problemaDa(daAbaEscolhida.error) : null;
  const erroDaAba = problema !== null && CODIGOS_DA_ABA.includes(problema.code) ? mensagemDoCodigo(problema.code) : undefined;

  return (
    <Bloco titulo="Aba">
      {/* Largura em valor explícito: `max-w-md` resolveria pela escala de espaçamento do tema e o
          seletor colapsaria (lib/larguras-do-tema.test.ts). */}
      <div className="w-full tablet:max-w-[28rem]">
        <Select
          rotulo="Aba da planilha"
          obrigatorio
          placeholder="Escolha a aba"
          opcoes={inspecao.abas.map((opcao) => ({
            valor: String(opcao.posicao),
            rotulo: `${rotuloDaAba(opcao)}${opcao.utilizavel ? '' : ' — sem dados'}`,
          }))}
          valor={abaEscolhida === null ? undefined : String(abaEscolhida)}
          onValorChange={aoEscolher}
          erro={erroDaAba}
          ajuda={`A planilha tem ${inspecao.abas.length} abas. Escolha a que tem os dados: só ela é lida.`}
          disabled={enviando}
        />
      </div>
      {daAbaEscolhida.isFetching ? <LendoPlanilha titulo="Lendo a aba escolhida" descricao={LEITURA_DEMORADA} /> : null}
      {problema !== null && erroDaAba === undefined ? (
        <FalhaDaLeitura erro={daAbaEscolhida.error} aoTentar={() => void daAbaEscolhida.refetch()} aoTrocar={aoTrocar} />
      ) : null}
    </Bloco>
  );
};
