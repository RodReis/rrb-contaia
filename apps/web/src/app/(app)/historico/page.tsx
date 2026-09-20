import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { HistoricoDeInformacoes } from '@/features/historico/historico-de-informacoes';

export const metadata = {
  title: 'Histórico de Informações — ContaIA',
  description: 'Eventos auditáveis das empresas do escritório, somente leitura.',
};

export default function PaginaDoHistorico() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <HistoricoDeInformacoes />
    </Suspense>
  );
}
