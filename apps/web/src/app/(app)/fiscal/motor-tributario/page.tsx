import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { AreaDoMotor } from '@/features/motor-tributario/area-do-motor';

export const metadata = {
  title: 'Motor tributário — ContaIA',
  description: 'Catálogo global de regras tributárias versionadas e simulador determinístico, com dados de teste não oficiais.',
};

/**
 * Motor tributário base versionado (SPEC-016). Filtros, página, aba do simulador e o painel da regra
 * vivem na URL e são lidos por `useSearchParams`, que exige fronteira de Suspense no App Router.
 */
export default function PaginaDoMotorTributario() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AreaDoMotor />
    </Suspense>
  );
}
