import { WizardDoEscritorio } from '@/features/escritorio/wizard';

export const metadata = {
  title: 'Cadastro do escritório — ContaIA',
  description: 'Conclusão do cadastro do escritório contábil.',
};

export default function PaginaDoEscritorio() {
  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-headline-lg text-foreground">Cadastro do escritório</h1>
        <p className="max-w-prose text-body-md text-muted-foreground">
          Conclua as cinco etapas para liberar o acesso às áreas operacionais. O progresso é salvo
          a cada etapa e pode ser retomado depois.
        </p>
      </header>

      <WizardDoEscritorio />
    </div>
  );
}
