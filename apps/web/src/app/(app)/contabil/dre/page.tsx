import { Suspense } from "react";
import { Skeleton } from "@/components/ui/estados";
import { DreGerencialGlobal } from "@/features/dre-gerencial/dre-gerencial";

export default function PaginaDreGerencial() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-sm" aria-busy="true">
          <Skeleton className="h-10 w-full max-w-[36rem]" />
          <Skeleton className="h-72 w-full" />
        </div>
      }
    >
      <DreGerencialGlobal />
    </Suspense>
  );
}
