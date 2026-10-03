import { PaginaDeGestaoDaCarteira } from '@/features/carteira/pagina-de-gestao';

export const metadata = {
  title: 'Gerenciar carteira — ContaIA',
  description: 'Empresas atribuídas a um colaborador do escritório.',
};

export default async function PaginaDeGestao({
  params,
}: {
  params: Promise<{ usuarioId: string }>;
}) {
  const { usuarioId } = await params;

  return <PaginaDeGestaoDaCarteira usuarioId={usuarioId} />;
}
