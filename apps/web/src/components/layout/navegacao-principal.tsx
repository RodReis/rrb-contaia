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

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';
import { CONSULTA_DO_COFRE, concede } from '@/features/cofre/permissoes';
import { CONSULTA_DO_MOTOR } from '@/features/motor-tributario/permissoes';
import { useSessao } from '@/features/usuarios/queries';

type ItemDoMenu = Readonly<{
  href: string;
  rotulo: string;
  /** O item aparece para quem tem todas estas permissões: as mesmas que a API exige da rota. */
  consultas: readonly string[];
  /** Restringe itens cujo acesso depende do papel efetivo, além da permissão genérica. */
  papeisPermitidos?: readonly string[];
}>;

const ITENS: readonly ItemDoMenu[] = [
  { href: '/painel', rotulo: 'Dashboard', consultas: ['empresas.cadastro.consultar'] },
  { href: '/empresas', rotulo: 'Empresas', consultas: ['empresas.cadastro.consultar'] },
  { href: '/contabil/estrutura-contabil', rotulo: 'Estrutura contábil', consultas: ['contabil.estrutura_contabil.consultar'] },
  { href: '/contabil/lancamentos', rotulo: 'Lançamentos', consultas: ['contabil.lancamentos.consultar'] },
  { href: '/contabil/lancamentos', rotulo: 'Lançamentos', consultas: ['contabil.lancamentos.consultar'] },
  // O Histórico de Informações é área global do escritório, não de uma empresa
  // (SPEC-003 §3.6): o acesso é de menu, não de tela. A API exige o histórico global e o
  // cadastral (SPEC-008 §3.2); oferecer o item só com um deles abriria uma tela negada.
  {
    href: '/historico',
    rotulo: 'Histórico de Informações',
    consultas: ['historico.global.consultar', 'empresas.historico.consultar'],
  },
  {
    href: '/auditoria',
    rotulo: 'Trilha de auditoria',
    consultas: ['historico.global.consultar'],
    papeisPermitidos: ['admin_escritorio', 'auditor_readonly'],
  },
  // A carteira é de qualquer usuário ativo: sem permissão de catálogo, só a própria lista.
  { href: '/carteira', rotulo: 'Minha carteira', consultas: [] },
  // Cofre local de certificados A1 (SPEC-011): quem consulta o catálogo `certificados.cofre`.
  { href: '/configuracoes/cofre', rotulo: 'Cofre de certificados', consultas: [CONSULTA_DO_COFRE] },
  // Motor tributário (SPEC-016): quem consulta as regras publicadas. O super-admin da plataforma não
  // tem sessão de escritório e abre a rota direto; a API decide cada comando.
  { href: '/fiscal/motor-tributario', rotulo: 'Motor tributário', consultas: [CONSULTA_DO_MOTOR] },
  { href: '/fiscal/obrigacoes', rotulo: 'Agenda de obrigações', consultas: ['obrigacoes.agenda.consultar'] },
  {
    href: '/configuracoes/usuarios',
    rotulo: 'Usuários e permissões',
    consultas: ['usuarios.usuarios_e_papeis.consultar'],
  },
];

export const NavegacaoPrincipal = () => {
  const caminho = usePathname();
  const { data: sessao } = useSessao();

  const visiveis = ITENS.filter((item) =>
    sessao === undefined
      ? item.href === '/empresas' || item.href === '/carteira'
      : item.consultas.every((chave) => concede(sessao, chave)) &&
        (item.papeisPermitidos === undefined ||
          sessao.papeis.some((papel) => item.papeisPermitidos?.includes(papel))),
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
