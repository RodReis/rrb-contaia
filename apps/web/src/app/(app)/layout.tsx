import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { AlternarTema } from '@/components/layout/alternar-tema';
import { Button } from '@/components/ui/button';
import { MarcaContaia } from '@/components/layout/marca';
import { Provedores } from '@/components/layout/provedores';
import { SinoDeNotificacoes } from '@/features/notificacoes/sino-de-notificacoes';
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
        {/* `flex-wrap` no cabeçalho: abaixo de 768px a marca, o menu e as ações
            não cabem numa linha, e sem quebrar elas empurravam o "Sair" para
            fora da tela e criavam rolagem horizontal. */}
        <header className="flex flex-wrap items-center justify-between gap-sm border-b border-border bg-card px-lg py-md">
          <div className="flex flex-1 flex-wrap items-center gap-sm tablet:gap-lg">
            <MarcaContaia descricao="Escritório contábil" />
            {/* O Histórico de Informações é área global do escritório, não de
                uma empresa (SPEC-003 §3.6): o acesso é de menu, não de tela. */}
            <nav aria-label="Navegação principal">
              <ul className="flex flex-wrap items-center gap-xs">
                {[
                  { href: '/empresas', rotulo: 'Empresas' },
                  { href: '/historico', rotulo: 'Histórico de Informações' },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="block whitespace-nowrap rounded-md px-sm py-xs text-label-md text-muted-foreground transition-colors duration-fast ease-out hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.rotulo}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-xs">
            <AlternarTema />
            <SinoDeNotificacoes />
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
