# REVIEW.md — Instruções de revisão

> **Prioridade máxima.** Estas instruções entram nos agentes do pipeline de revisão acima de qualquer heurística padrão.
> Elas definem **o que é sinalizado, com qual gravidade e como o achado é relatado**.

---

## 1. Postura

- **Revisar o diff completo contra a base**, inclusive arquivos já commitados na branch (`CLAUDE.md`).
- **Achado precisa ser verificável.** Arquivo, linha e um cenário concreto de falha: entrada, estado, resultado errado. "Parece frágil" não é achado.
- **Sem elogio, sem resumo do que o código faz.** A revisão relata problema.
- **Deduplicar** achados já registrados em rodada anterior da mesma PR.
- **Não reescrever a PR.** A revisão aponta; a correção é do autor, no mesmo branch.
- **Preferência de estilo não é achado.** Formatação é do Prettier; nomenclatura só vira achado quando induz erro.
- **Máximo de ruído aceitável: zero.** Uma lista de 30 achados P3 esconde o P0.

---

## 2. Gravidade

| Nível | Significado | Efeito |
|---|---|---|
| **P0** | Vazamento entre tenants, perda ou corrupção de dado fiscal, segredo exposto, ato jurídico executado sem aprovação humana, quebra de append-only | **Bloqueia. Para tudo.** |
| **P1** | Resultado fiscal/contábil incorreto, quebra de contrato de API, migration irreversível sem plano, ausência da prova exigida pela SPEC, regressão de acessibilidade que impede uso por teclado | **Bloqueia** |
| **P2** | Defeito de comportamento em caminho não crítico, regressão de performance acima do orçamento, ausência de teste de regressão em `[FIX]`, débito que vai custar caro | Registrar; corrigir nesta PR ou abrir `[FIX]` com link |
| **P3** | Melhoria opcional, simplificação, clareza | Informativo. Não bloqueia, não exige resposta |

**P0 e P1 bloqueiam o merge** (`CLAUDE.md`). Rebaixar gravidade para desbloquear é violação de processo.

---

## 3. O que sempre se verifica — por ordem de risco

### 3.1 Isolamento e segurança (P0)

- [ ] Toda tabela transacional nova tem `tenant_id` **e** `empresa_id`, `NOT NULL`, indexados, com RLS habilitada.
- [ ] Nenhuma consulta escapa do contexto de RLS (query crua, role de serviço usada por conveniência, `SET LOCAL` esquecido).
- [ ] Chave de cache (Redis, TanStack Query) inclui o escopo de tenant e empresa.
- [ ] Impersonation usa a role de serviço dedicada e gera log de auditoria.
- [ ] Nenhum segredo, `.env`, certificado, senha de A1 ou chave privada no diff.
- [ ] Chave privada do A1 não atravessa nada além do Signer e do cofre.
- [ ] Dado enviado a LLM de terceiro está pseudonimizado.
- [ ] Nenhum log com CPF, CNPJ, valor ou conteúdo de documento fiscal.
- [ ] Autorização verificada no servidor; a UI reflete permissão, não a implementa.

### 3.2 Correção fiscal e contábil (P1)

- [ ] Nenhum float no caminho de dinheiro; centavos inteiros de ponta a ponta.
- [ ] Cálculo sai do motor de regras versionado — **LLM não calcula**.
- [ ] Regra aplicada respeita vigência; período fechado não é alterado.
- [ ] Lançamento contábil tem contrapartida válida; correção é por estorno, nunca por edição ou exclusão.
- [ ] Manifestação de Confirmação, Desconhecimento e Operação não Realizada exige aprovação humana registrada.
- [ ] Idempotência garantida onde há efeito externo (NSU, chave de acesso, envio de evento, geração de guia).
- [ ] Prazo e data usam data civil e fuso `America/Sao_Paulo` corretamente.

### 3.3 Aderência ao contrato (P1)

- [ ] Não contradiz PRD, [`CONVENTION.md`](CONVENTION.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) ou ADR aceita — e, se contradiz, é `[FIX]` ou emenda do PI, não interpretação.
- [ ] Não cria regra de produto que não existe em documento nenhum.
- [ ] Caso de uso controla a transação; controller valida e delega; DTO não é entidade de persistência.
- [ ] Função de cálculo é pura: sem banco, sem rede, sem relógio.
- [ ] Erro de domínio tem código estável; resposta HTTP em `application/problem+json` com `type`, `title`, `status`, `code`, `correlationId`.
- [ ] UI segue [`FRONTEND.md`](FRONTEND.md) e [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md).

### 3.4 Prova (P1/P2)

- [ ] Todas as categorias aplicáveis de [`TESTING.md`](TESTING.md) rodaram, com artefato.
- [ ] `[FIX]` traz teste de regressão, ou o motivo documentado da ausência.
- [ ] Nenhum `not_run` sem motivo; nenhum `pass` sem execução no SHA atual.
- [ ] Teste novo prova comportamento, não implementação.
- [ ] Teste pulado, `only`, `skip` esquecido ou asserção vazia: P1.

### 3.5 Tipagem e clean code (P2)

- [ ] Sem `any`, `as` supressor, `@ts-ignore`, `!`; dado externo entra como `unknown` e é validado.
- [ ] Nome revela intenção; função faz uma coisa; efeito colateral é explícito.
- [ ] Sem duplicação relevante de regra — **e sem abstração criada para dois usos parecidos** que na verdade divergem.
- [ ] Sem código morto, `TODO` órfão, `console.log`, bloco comentado.
- [ ] Complexidade justificada: aninhamento profundo e condicional longa viram função nomeada.
- [ ] Dependência nova justificada na PR.

### 3.6 Operação (P2)

- [ ] Migration reversível ou com plano de rollback; sem lock longo em tabela grande.
- [ ] Índice criado para o padrão de consulta introduzido.
- [ ] Erro de integração tem retry com backoff, limite e alerta.
- [ ] Nada de N+1 em listagem; paginação no servidor acima de 100 linhas.
- [ ] Observabilidade: operação nova emite métrica/trace com `correlationId`.

### 3.7 Escopo (P2)

- [ ] Uma finalidade por PR; sem arquivo tocado fora do escopo sem justificativa.
- [ ] Refactor grande não embrulhado com feature.

---

## 4. Formato do achado

```
[P<n>] <arquivo>:<linha> — <problema em uma frase>
Cenário: <entrada/estado concreto> → <resultado errado>
Contrato: <PRD §x | CONVENTION §y | ADR-00n | FRONTEND §z>   (quando houver)
Sugestão: <direção, não patch>
```

Exemplo:

```
[P0] apps/api/src/documentos/documento.repository.ts:84 — consulta usa a role de serviço
Cenário: usuário do tenant A pede /documentos; a role ignora RLS e a consulta
         retorna documentos do tenant B presentes na mesma página.
Contrato: PRD §4.4; CONVENTION §3.1
Sugestão: usar a conexão de request com SET LOCAL app.tenant_id/app.empresa_id.
```

Sem cenário concreto, o achado não é relatado.

---

## 5. O que não é achado

- Preferência de formatação, ordem de import, aspas, ponto e vírgula.
- Renomear por gosto.
- "Faltou comentário" — código claro dispensa; comentário explica **porquê**, não o quê.
- Sugerir biblioteca que substituiria código funcionando, sem problema concreto.
- Pedir teste de getter, DTO ou configuração.
- Reabrir decisão já registrada em ADR. Discordar de ADR é proposta de nova ADR ao PI, não achado de revisão.
- Exigir aprovador humano extra num fluxo solo, ou novo aceite de produto já dado (`CLAUDE.md`).

---

## 6. Quando a revisão para e pergunta ao PI

Os dois casos de `CLAUDE.md`, sem terceiro:

1. **Decisão de produto que não existe em documento nenhum** e escolher seria criar regra.
2. **Problema técnico da spec** — inexequível, ou contradiz [`ARCHITECTURE.md`](ARCHITECTURE.md), [`CONVENTION.md`](CONVENTION.md) ou uma ADR.

Documento faltando não bloqueia. Falta de spec não bloqueia. ADR ausente não bloqueia.

---

## 7. Saída da revisão

1. Achados ordenados por gravidade, P0 primeiro.
2. Declaração explícita: **existe P0/P1 aberto?** Sim bloqueia; não libera para o gate.
3. Lista do que foi verificado e **não** pôde ser verificado no ambiente (vira `not_run` na PR).
4. Nada além disso — sem resumo do diff, sem elogio.

---

## Referências

- [`PRS.md`](PRS.md) · [`TESTING.md`](TESTING.md) · [`CI-PR.md`](CI-PR.md) · [`AUDIT.md`](AUDIT.md) · [`CONVENTION.md`](CONVENTION.md) · [`FRONTEND.md`](FRONTEND.md)
