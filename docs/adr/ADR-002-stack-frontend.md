# ADR-002 — Stack do frontend web

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
O PRD §14 fixa Next.js + Tailwind + shadcn e proíbe componente nativo, mas não fixa versões nem as bibliotecas de dados, formulário e tabela. O MVP dura 3–4 meses; **Next.js 15 sai de suporte de segurança em 21/10/2026**, enquanto a linha 16 é LTS desde out/2025 (16.3.5 em 11/09/2026).

## Decisão
**Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui**, com **TanStack Query v5** (estado de servidor), **TanStack Table v8** (tabela), **React Hook Form + Zod v4** (formulário), **Sonner** (toast) e **Zustand** apenas para estado de UI global. Runtime **Node 24 LTS** (`CLAUDE.md`).

## Consequências
- O MVP nasce dentro da janela de suporte; não haverá card de migração de major durante o desenvolvimento.
- Tailwind v4 usa configuração CSS-first (`@theme`), coerente com os tokens em CSS custom properties do design system.
- Contrato detalhado em [`FRONTEND.md`](../FRONTEND.md).

## Riscos
- Next 16 traz Turbopack como build padrão e APIs assíncronas — estabilizados há ~11 meses, mas qualquer incompatibilidade de dependência é **bloqueio explícito**: documentar e ajustar a matriz, nunca degradar versão em silêncio (`CLAUDE.md`).

## Alternativas descartadas
- Next 15: fora de suporte durante o próprio MVP.
- Deixar a versão em aberto: travaria o Code no primeiro card de UI.
