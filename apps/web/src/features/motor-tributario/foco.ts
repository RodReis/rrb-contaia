/**
 * Erro no envio: o foco vai para o primeiro campo inválido (FRONTEND.md §8, item 3). Os campos do
 * produto marcam `aria-invalid`, mas só depois do render que mostra o erro; por isso a busca espera
 * o próximo quadro.
 */
export const focarPrimeiroCampoInvalido = (formulario: HTMLFormElement | null): void => {
  if (formulario === null) {
    return;
  }

  requestAnimationFrame(() => {
    formulario.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
};
