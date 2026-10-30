import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/estados';
import { SaldosAberturaGlobal } from '@/features/saldos-abertura/saldos-abertura';

export default function PaginaSaldosAbertura(){return <Suspense fallback={<div className="flex flex-col gap-sm" aria-busy="true"><Skeleton className="h-10 w-full max-w-[36rem]"/><Skeleton className="h-72 w-full"/></div>}><SaldosAberturaGlobal/></Suspense>;}
