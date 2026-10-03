import { EdicaoDePapel } from '@/features/papeis/edicao-de-papel';

export const metadata = {
  title: 'Papel — ContaIA',
  description: 'Resumo, permissões e ciclo de vida de um papel personalizado.',
};

export default async function PaginaDoPapel({ params }: { params: Promise<{ papelId: string }> }) {
  const { papelId } = await params;

  return <EdicaoDePapel papelId={papelId} />;
}
