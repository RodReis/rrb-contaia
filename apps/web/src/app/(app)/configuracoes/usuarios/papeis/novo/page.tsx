import { WizardDePapel } from '@/features/papeis/wizard-de-papel';

export const metadata = {
  title: 'Criar papel — ContaIA',
  description: 'Papel personalizado a partir de um papel padrão, em três etapas.',
};

export default function PaginaDeNovoPapel() {
  return <WizardDePapel />;
}
