import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/estados';
import { TrilhaDeAuditoria } from '@/features/auditoria/trilha-de-auditoria';

export const metadata = {
  title: 'Trilha de auditoria — ContaIA',
  description: 'Execuções de agentes e decisões imutáveis dentro da carteira autorizada.',
};

export default function PaginaDeAuditoria() {
  return <div className="mx-auto w-full max-w-[88rem]"><Suspense fallback={<Skeleton className="h-96 w-full"/>}><TrilhaDeAuditoria/></Suspense></div>;
}
