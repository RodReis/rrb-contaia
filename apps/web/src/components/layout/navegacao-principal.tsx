/**
 * Menu principal. Cada item aparece só para quem pode consultar a capacidade
 * correspondente (SPEC-007 §3.1) — mas esconder o item não é controle de acesso:
 * quem decide é a API, que recusa a rota de qualquer jeito (ARCHITECTURE.md §6).
 *
 * Enquanto a sessão carrega ou se ela falhar, só "Empresas" aparece: é o único
 * item que toda sessão válida tem, então a navegação nunca oferece o que o
 * usuário talvez não possa abrir.
 */
'use client';

import type { Capacidade } from '@contaia/domain';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';
import { useSessao } from '@/features/usuarios/queries';

const ITENS: ReadonlyArray<Readonly<{ href: string; rotulo: string; capacidade: Capacidade }>> = [
  { href: '/empresas', rotulo: 'Empresas', capacidade: 'EMPRESAS' },
  // O Histórico de Informações é área global do escritório, não de uma empresa
  // (SPEC-003 §3.6): o acesso é de menu, não de tela.
  { href: '/historico', rotulo: 'Histórico de Informações', capacidade: 'HISTORICO' },
  { href: '/configuracoes/usuarios', rotulo: 'Usuários e permissões', capacidade: 'USUARIOS' },
];

export const NavegacaoPrincipal = () => {
  const caminho = usePathname();
  const { data: sessao } = useSessao();

  const visiveis = ITENS.filter((item) =>
    sessao === undefined
      ? item.capacidade === 'EMPRESAS'
      : sessao.permissoes[item.capacidade].includes('consultar'),
  );

  return (
    <nav aria-label="Navegação principal">
      <ul className="flex flex-wrap items-center gap-xs">
        {visiveis.map((item) => {
          const atual = caminho === item.href || caminho.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={atual ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap rounded-md px-sm py-xs text-label-md transition-colors duration-fast ease-out',
                  'hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  atual ? 'bg-accent/40 text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
