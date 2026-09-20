import { WizardDoEscritorio } from '@/features/escritorio/wizard';

export const metadata = {
  title: 'Cadastro do escritório — ContaIA',
  description: 'Conclusão do cadastro do escritório contábil.',
};

export default function PaginaDoEscritorio() {
  // O título e a descrição dependem do estado do cadastro, que só o cliente
  // conhece depois de carregar: ambos vivem dentro do componente.
  return <WizardDoEscritorio />;
}
