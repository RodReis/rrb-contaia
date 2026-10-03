/**
 * Responsável pelo certificado (SPEC-011 §3.5): só administradores e contadores
 * ativos que têm a empresa na carteira. A lista vem da API, empresa a empresa;
 * a tela não decide quem é elegível.
 */
'use client';

import { PAPEIS_PADRAO } from '@contaia/domain';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ROTULO_DO_PAPEL } from '../usuarios/rotulos';
import { useResponsaveisElegiveis } from './queries';

const rotuloDoPapel = (papel: string): string => {
  const padrao = PAPEIS_PADRAO.find((candidato) => candidato === papel);

  return padrao === undefined ? papel : ROTULO_DO_PAPEL[padrao];
};

export const SelecaoDeResponsavel = ({
  empresaId,
  valor,
  aoMudar,
  aoSair,
  erro,
  rotulo = 'Responsável pelo certificado',
}: {
  empresaId: string | null;
  valor: string;
  aoMudar: (responsavelId: string) => void;
  aoSair?: () => void;
  erro?: string | undefined;
  rotulo?: string;
}) => {
  const { data, isPending, isError, refetch } = useResponsaveisElegiveis(empresaId);

  const semEmpresa = empresaId === null;
  const vazio = data !== undefined && data.length === 0;

  // Só vale o responsável que consta entre os elegíveis carregados. Um padrão que deixou de
  // ser elegível (saiu da carteira, ficou inativo) é descartado: a pessoa escolhe de novo.
  const elegivel = data?.some((responsavel) => responsavel.id === valor) === true;

  useEffect(() => {
    if (data !== undefined && valor !== '' && !elegivel) {
      aoMudar('');
    }
  }, [data, valor, elegivel, aoMudar]);

  const ajuda = semEmpresa
    ? 'Escolha a empresa para ver quem pode responder pelo certificado.'
    : vazio
      ? 'Nenhum administrador ou contador ativo tem esta empresa na carteira. Peça a um administrador para atribuí-la a alguém.'
      : 'Recebe os alertas de vencimento. Administrador ou contador ativo, com a empresa na carteira.';

  return (
    <div className="flex w-full flex-col gap-xs">
      {/* A `key` remonta o Select quando as opções chegam: o Radix sincroniza um <select> nativo
          e zera o valor que não encontra opção correspondente — o que acontece se o valor padrão
          entra antes da lista de elegíveis. Montado já com as opções, o valor se mantém. */}
      <Select
        key={`${empresaId ?? 'sem-empresa'}-${data === undefined ? 'carregando' : 'pronto'}`}
        rotulo={rotulo}
        obrigatorio
        opcoes={(data ?? []).map((responsavel) => ({
          valor: responsavel.id,
          rotulo: `${responsavel.nome} · ${rotuloDoPapel(responsavel.papel)}`,
        }))}
        valor={elegivel ? valor : undefined}
        onValorChange={aoMudar}
        {...(aoSair === undefined ? {} : { onBlur: aoSair })}
        disabled={semEmpresa || isPending || isError || vazio}
        placeholder={semEmpresa ? 'Escolha a empresa antes' : isPending ? 'Carregando…' : 'Selecione'}
        erro={erro}
        ajuda={ajuda}
      />

      {isError ? (
        <div className="flex flex-wrap items-center gap-sm">
          <p role="alert" className="text-body-sm text-danger-foreground">
            Não foi possível carregar os responsáveis.
          </p>
          <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
    </div>
  );
};
