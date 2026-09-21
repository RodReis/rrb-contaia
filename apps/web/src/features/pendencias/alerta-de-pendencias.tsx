/**
 * Alerta persistente de pendências abertas — cadastrais e documentais juntas
 * (SPEC-005 §2, Task 8).
 *
 * Decisão de design (protocolo `frontend-design` aplicado manualmente — ver
 * relatório da Task 8: a sessão interativa da skill não se aplica a um ajuste
 * pontual num design system já tokenizado): pendência aberta é tarefa que
 * pede ação, não erro nem bloqueio. Por isso o alerta reaproveita exatamente
 * o par `role="status"` + `border-warning bg-warning/10` já usado em
 * `atualizacao-pela-cnpja.tsx` para o mesmo tipo de aviso não-bloqueante — um
 * tom `critico`/danger indicaria falha do sistema, que não é o caso aqui.
 *
 * Monta apenas dentro do `Cabecalho` de `ManutencaoDaEmpresa`, nunca em
 * `pagina-da-empresa.tsx`: o ponto de montagem já garante que `CADASTRO_INCOMPLETO`
 * (exclusivo do wizard) nunca alcança este componente.
 */
'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { usePendenciasDaEmpresa } from './queries';

export const AlertaDePendencias = ({ empresaId }: { empresaId: string }) => {
  const { data } = usePendenciasDaEmpresa(empresaId);

  if (data === undefined || data.total === 0) {
    return null;
  }

  return (
    <p
      role="status"
      className="flex items-start gap-sm rounded-md border border-warning bg-warning/10 px-md py-sm text-body-sm text-foreground"
    >
      <AlertTriangle aria-hidden="true" className="mt-[0.125rem] size-icon-sm" />
      <span className="flex flex-1 flex-wrap items-center gap-x-sm gap-y-xs">
        <span>
          {data.total === 1 ? '1 pendência aberta.' : `${data.total} pendências abertas.`}
        </span>
        <Link
          href={`/pendencias?empresaId=${empresaId}`}
          className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
        >
          Ver pendências
        </Link>
      </span>
    </p>
  );
};
