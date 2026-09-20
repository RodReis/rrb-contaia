import { LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { AlternarTema } from '@/components/layout/alternar-tema';
import { Button } from '@/components/ui/button';
import { MarcaContaia } from '@/components/layout/marca';
import { Provedores } from '@/components/layout/provedores';
import { COOKIE_DE_SESSAO } from '@/lib/oidc';

/**
 * Shell da aplicação. A ausência de sessão manda para o acesso aqui por
 * conveniência de navegação — a decisão que vale é a do servidor da API, que
 * recusa a requisição sem token válido (ARCHITECTURE.md §6).
 */
export default async function LayoutDaAplicacao({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessao = (await cookies()).get(COOKIE_DE_SESSAO)?.value;

  if (sessao === undefined) {
    redirect('/acesso');
  }

  return (
    <Provedores>
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="flex items-center justify-between gap-md border-b border-border bg-card px-lg py-md">
          <MarcaContaia descricao="Escritório contábil" />
          <div className="flex items-center gap-xs">
            <AlternarTema />
            <Button asChild variante="fantasma" tamanho="compacto">
              <a href="/api/auth/sair">
                <LogOut aria-hidden="true" />
                Sair
              </a>
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[64rem] flex-1 px-lg py-xl">{children}</main>
      </div>
    </Provedores>
  );
}
