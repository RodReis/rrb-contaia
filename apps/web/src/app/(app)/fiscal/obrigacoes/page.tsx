import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { AgendaDeObrigacoes } from '@/features/obligations/agenda-de-obrigacoes';

export const metadata = {
  title: 'Agenda de obrigações — ContaIA',
  description: 'Agenda fiscal por empresa com vencimentos e alertas D-3.',
};

export default function PaginaDaAgenda() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AgendaDeObrigacoes />
    </Suspense>
  );
}
