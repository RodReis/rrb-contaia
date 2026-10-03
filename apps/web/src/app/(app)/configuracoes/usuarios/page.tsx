import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { AreaDeUsuarios } from '@/features/usuarios/area-de-usuarios';

export const metadata = {
  title: 'Usuários e permissões — ContaIA',
  description: 'Usuários do escritório, convites e papéis padrão.',
};

/**
 * Usuários e papéis padrão (SPEC-007). A aba e os filtros vivem na URL e são
 * lidos por `useSearchParams`, que exige fronteira de Suspense no App Router.
 */
export default function PaginaDeUsuarios() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AreaDeUsuarios />
    </Suspense>
  );
}
