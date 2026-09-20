import { PaginaDaEmpresa } from '@/features/empresa/pagina-da-empresa';

export const metadata = {
  title: 'Empresa — ContaIA',
  description: 'Cadastro, manutenção e arquivamento da empresa cliente.',
};

export default async function PaginaDaEmpresaCliente({
  params,
}: {
  params: Promise<{ empresaId: string }>;
}) {
  const { empresaId } = await params;

  return <PaginaDaEmpresa empresaId={empresaId} />;
}
