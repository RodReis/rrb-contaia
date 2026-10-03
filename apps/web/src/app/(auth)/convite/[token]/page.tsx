/**
 * Aceite do convite (SPEC-007 §3.2). Página pública: a pessoa só tem o link.
 *
 * O token está na URL, então a página não pode vazar nem ser indexada:
 * `referrer: no-referrer` impede que ele vá em `Referer` para outro site, e o
 * `robots` mantém o link fora de buscadores.
 */
import { AlternarTema } from '@/components/layout/alternar-tema';
import { MarcaContaia } from '@/components/layout/marca';
import { Provedores } from '@/components/layout/provedores';
import { AceiteDeConvite } from '@/features/usuarios/aceite-de-convite';

export const metadata = {
  title: 'Convite — ContaIA',
  description: 'Defina a sua senha para acessar o ContaIA.',
  referrer: 'no-referrer' as const,
  robots: { index: false, follow: false },
};

export default async function PaginaDoConvite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <Provedores>
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="flex items-center justify-between border-b border-border px-lg py-md">
          <MarcaContaia />
          <AlternarTema />
        </header>

        <main className="mx-auto w-full max-w-[30rem] flex-1 px-lg py-xl">
          <AceiteDeConvite token={token} />
        </main>
      </div>
    </Provedores>
  );
}
