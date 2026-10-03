/**
 * Lote recusado (SPEC-009 §6): `422` lista cada item inválido e nada é aplicado.
 * O erro de campo não vira toast — a pessoa precisa ver quais itens falharam
 * para corrigir a seleção —, então a lista fica visível no próprio formulário.
 */
import { TriangleAlert } from 'lucide-react';

import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';

/** `campo` chega como `usuarios.<id>` ou `empresas.<id>`; `nomes` traduz o id para o que a tela mostrou. */
export const descreverProblemasDoLote = (
  erro: unknown,
  nomes: ReadonlyMap<string, string>,
): readonly string[] | null => {
  if (!(erro instanceof ErroDaApi)) {
    return null;
  }

  const campos = erro.problema.campos ?? [];

  if (campos.length === 0) {
    return null;
  }

  return campos.map(({ campo, codigo }) => {
    const id = campo.split('.')[1] ?? '';
    const nome = nomes.get(id);

    return `${nome ?? 'Seleção'}: ${mensagemDoCodigo(codigo)}`;
  });
};

export const ProblemasDoLote = ({ problemas }: { problemas: readonly string[] }) => (
  <div
    role="alert"
    className="flex gap-sm rounded-md border border-border bg-danger p-md text-danger-foreground"
  >
    <TriangleAlert aria-hidden="true" className="mt-xs size-4 shrink-0" />
    <div className="flex flex-col gap-xs">
      <p className="text-title-sm">Nada foi salvo: há itens inválidos na seleção.</p>
      <ul className="flex flex-col gap-xs text-body-sm">
        {problemas.map((problema) => (
          <li key={problema} className="break-words">
            {problema}
          </li>
        ))}
      </ul>
      <p className="text-body-sm">Ajuste a seleção e tente de novo; a operação vale inteira ou não vale.</p>
    </div>
  </div>
);
