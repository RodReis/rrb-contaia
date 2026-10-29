import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/estados';
import { RazaoContabilGlobal } from '@/features/razao-contabil/razao-contabil';

export default function PaginaRazaoContabil() {
  return <Suspense fallback={<div className="flex flex-col gap-sm" aria-busy="true"><Skeleton className="h-10 w-full max-w-[36rem]"/><Skeleton className="h-72 w-full"/></div>}><RazaoContabilGlobal/></Suspense>;
}
