import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { ListaDeEmpresas } from '@/features/empresa/lista-de-empresas';

export const metadata = {
  title: 'Empresas — ContaIA',
  description: 'Carteira de empresas clientes do escritório.',
};

/**
 * Listagem das empresas clientes (SPEC-002 §3.1). O filtro vive na URL e é lido
 * por `useSearchParams`, que exige fronteira de Suspense no App Router.
 */
export default function PaginaDeEmpresas() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ListaDeEmpresas />
    </Suspense>
  );
}
