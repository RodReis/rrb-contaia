import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { CentralDePendencias } from '@/features/pendencias/central-de-pendencias';

export const metadata = {
  title: 'Central de Pendências — ContaIA',
  description: 'Pendências cadastrais e documentais das empresas do escritório.',
};

export default function PaginaDePendencias() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <CentralDePendencias />
    </Suspense>
  );
}
