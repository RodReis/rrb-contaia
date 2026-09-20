'use client';

import type { FieldErrors } from 'react-hook-form';

/**
 * Resumo acessível dos erros da etapa. Aparece acima de três erros
 * (PATTERNS.md §6) e é anunciado por `aria-live` (SPEC-001 §5).
 */
export const ResumoDeErros = ({ erros }: { erros: FieldErrors }) => {
  const mensagens = Object.entries(erros)
    .map(([campo, erro]) => ({ campo, mensagem: (erro as { message?: string })?.message }))
    .filter((item): item is { campo: string; mensagem: string } => item.mensagem !== undefined);

  return (
    <div aria-live="polite">
      {mensagens.length > 3 ? (
        <div
          role="alert"
          className="flex flex-col gap-xs rounded-md border border-danger-indicator/40 bg-danger px-md py-md"
        >
          <p className="text-title-sm text-danger-foreground">
            {mensagens.length} campos precisam de correção
          </p>
          <ul className="list-inside list-disc text-body-sm text-danger-foreground/90">
            {mensagens.map((item) => (
              <li key={item.campo}>{item.mensagem}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
