import { WizardDeConvite } from '@/features/usuarios/wizard-de-convite';

export const metadata = {
  title: 'Convidar usuário — ContaIA',
  description: 'Convite por e-mail com papéis padrão, em duas etapas.',
};

export default function PaginaDeNovoConvite() {
  return <WizardDeConvite />;
}
