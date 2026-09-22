import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { PaginaDeHistorico } from '@/features/notificacoes/pagina-de-historico';

export const metadata = {
  title: 'Notificações — ContaIA',
  description: 'Histórico completo de notificações de pendências.',
};

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PaginaDeHistorico />
    </Suspense>
  );
}
