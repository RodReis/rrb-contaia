import { WizardDaEmpresa } from '@/features/empresa/wizard';

export const metadata = {
  title: 'Cadastro da empresa — ContaIA',
  description: 'Wizard de cadastro e ativação da empresa cliente.',
};

export default async function PaginaDoCadastroDaEmpresa({
  params,
}: {
  params: Promise<{ empresaId: string }>;
}) {
  const { empresaId } = await params;

  return <WizardDaEmpresa empresaId={empresaId} />;
}
