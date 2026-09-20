/**
 * Página inicial de acesso (SPEC-001 §5).
 *
 * Conteúdo, ordem e hierarquia vêm de `docs/telas/contaia_p_gina_inicial_acesso`
 * e da variante dark carbon. Divergência deliberada: o protótipo desenha um
 * formulário de e-mail e senha com abas Escritório/Empresa, mas a SPEC fixa
 * autenticação pelo Keycloak (ADR-011) e não há portal do cliente nesta fatia.
 * Campo de senha aqui seria fachada — quem autentica é o provedor de identidade.
 */
import { ArrowRight, FileCheck2, Landmark, Lock, ShieldCheck } from 'lucide-react';

import { AlternarTema } from '@/components/layout/alternar-tema';
import { Button } from '@/components/ui/button';
import { MarcaContaia } from '@/components/layout/marca';

export const metadata = {
  title: 'Acesso — ContaIA',
  description: 'Acesso seguro ao workspace corporativo do ContaIA.',
};

const CONFORMIDADES = [
  { icone: Landmark, rotulo: 'Lei Geral de Proteção de Dados (LGPD)' },
  { icone: ShieldCheck, rotulo: 'Marco Regulatório de Governança de IA' },
  { icone: FileCheck2, rotulo: 'eSocial Layout S-1.3 homologado' },
  { icone: FileCheck2, rotulo: 'EFD-Reinf 2026 ready' },
] as const;

export default function PaginaDeAcesso() {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-lg py-md">
        <MarcaContaia />
        <AlternarTema />
      </header>

      <div className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-xl px-lg py-xl desktop:flex-row desktop:items-start desktop:gap-xl desktop:py-[clamp(2rem,6vh,4.5rem)]">
        <section className="flex flex-1 flex-col gap-lg">
          <p className="flex items-center gap-xs text-label-sm uppercase text-muted-foreground">
            <span
              className="size-1.5 rounded-full bg-success-indicator motion-safe:animate-pulse"
              aria-hidden="true"
            />
            Infraestrutura de auditoria contábil em tempo real
          </p>

          <h1 className="max-w-[20ch] font-display text-headline-lg text-foreground desktop:text-display-lg">
            Orquestração contábil autônoma com determinismo legal e auditoria contínua
          </h1>

          <p className="max-w-prose text-body-md text-muted-foreground desktop:text-body-lg">
            Plataforma multiempresa desenhada para escritórios e corporações que gerenciam centenas
            de pessoas jurídicas sob malhas fiscais estaduais, municipais e federais. Segurança
            criptográfica ponta a ponta com paridade de razão contábil e zero tolerância a desvios.
          </p>

          <div className="flex flex-col gap-sm pt-sm">
            <p className="text-label-sm uppercase text-muted-foreground">
              Conformidade e protocolos normativos verificados
            </p>
            <ul className="flex flex-wrap gap-sm">
              {CONFORMIDADES.map(({ icone: Icone, rotulo }) => (
                <li
                  key={rotulo}
                  className="flex items-center gap-xs rounded-md border border-border bg-card px-md py-xs text-body-sm text-muted-foreground"
                >
                  <Icone className="size-icon-sm text-muted-foreground" aria-hidden="true" />
                  {rotulo}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="w-full desktop:max-w-[26rem]">
          <div className="flex flex-col gap-lg rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]">
            <div className="flex items-start justify-between gap-md">
              <div className="flex flex-col gap-xs">
                <h2 className="font-display text-headline-md text-foreground">Portal unificado</h2>
                <p className="text-body-sm text-muted-foreground">
                  Acesso seguro ao workspace corporativo
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-xs rounded-md bg-success px-sm py-xs font-mono text-code-xs text-success-foreground">
                <span
                  className="size-1.5 rounded-full bg-success-indicator"
                  aria-hidden="true"
                />
                mTLS ativo
              </span>
            </div>

            <div className="flex flex-col gap-sm rounded-md border border-border bg-secondary p-md">
              <p className="flex items-center gap-xs text-title-sm text-foreground">
                <Lock className="size-icon-sm" aria-hidden="true" />
                Autenticação corporativa
              </p>
              <p className="text-body-sm text-muted-foreground">
                A identificação é feita pelo provedor de identidade do escritório. Suas credenciais
                não trafegam por esta tela.
              </p>
            </div>

            <Button asChild className="w-full">
              <a href="/api/auth/entrar">
                Acessar painel unificado
                <ArrowRight aria-hidden="true" />
              </a>
            </Button>

            <p className="text-body-sm text-muted-foreground">
              O acesso é concedido pelo administrador do escritório. Não há cadastro público nesta
              versão.
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-border px-lg py-md">
        <p className="text-body-sm text-muted-foreground">
          ContaIA — infraestrutura auditável em tempo real, com trilha append-only e conformidade
          NBC TG.
        </p>
      </footer>
    </main>
  );
}
