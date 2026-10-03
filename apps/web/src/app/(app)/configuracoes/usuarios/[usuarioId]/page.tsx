import { EdicaoDeUsuario } from '@/features/usuarios/edicao-de-usuario';

export const metadata = {
  title: 'Usuário — ContaIA',
  description: 'Dados, papéis e situação de um usuário do escritório.',
};

export default async function PaginaDoUsuario({
  params,
}: {
  params: Promise<{ usuarioId: string }>;
}) {
  const { usuarioId } = await params;

  return <EdicaoDeUsuario usuarioId={usuarioId} />;
}
