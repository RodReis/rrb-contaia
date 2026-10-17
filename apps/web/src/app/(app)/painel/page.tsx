import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/estados';
import { Dashboard } from '@/features/dashboard/dashboard';

export const metadata = { title: 'Dashboard da carteira — ContaIA', description: 'Saúde operacional das empresas da carteira, com motivos e acesso aos fluxos de origem.' };
export default function PaginaDoPainel() { return <div className="mx-auto w-full max-w-[88rem]"><Suspense fallback={<div className="space-y-lg"><Skeleton className="h-20"/><Skeleton className="h-32"/><Skeleton className="h-96"/></div>}><Dashboard/></Suspense></div>; }
