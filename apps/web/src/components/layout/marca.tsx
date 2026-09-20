import { Hexagon } from 'lucide-react';

/** Marca do produto. O logo do escritório é dado de tenant, não da aplicação. */
export const MarcaContaia = ({ descricao }: { descricao?: string }) => (
  <div className="flex items-center gap-sm">
    <span
      className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
      aria-hidden="true"
    >
      <Hexagon className="size-icon-md" />
    </span>
    <span className="flex flex-col leading-none">
      <span className="font-display text-title-md text-foreground">ContaIA</span>
      {descricao !== undefined ? (
        <span className="text-label-sm uppercase text-muted-foreground">{descricao}</span>
      ) : null}
    </span>
  </div>
);
