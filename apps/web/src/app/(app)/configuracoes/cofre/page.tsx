import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { AreaDoCofre } from '@/features/cofre/area-do-cofre';

export const metadata = {
  title: 'Cofre de certificados — ContaIA',
  description: 'Certificados digitais A1 das empresas do escritório, guardados no cofre local.',
};

/**
 * Cofre de certificados A1 (SPEC-011). Busca, filtro, ordem, página e a empresa do
 * detalhe vivem na URL e são lidos por `useSearchParams`, que exige fronteira de
 * Suspense no App Router.
 */
export default function PaginaDoCofre() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AreaDoCofre />
    </Suspense>
  );
}
