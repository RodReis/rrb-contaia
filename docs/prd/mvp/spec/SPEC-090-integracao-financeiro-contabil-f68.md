# SPEC-090 — Integração financeiro-contábil de títulos e baixas F68

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F90
> **Issue:** [#122](https://github.com/RodReis/rrb-contaia/issues/122)
> **Estado:** aprovada pelo PI em 13/10/2026
> **Tamanho:** Grande — eventos financeiros, prevenção de duplicidade, regras contábeis, histórico e revisão
> **PRD:** §§3, 5.3, 6.2, 6.5, 7.1, 12, 13.2, 14, 15 e 16
> **Ambiente:** Docker local; produção somente após o MVP-4

## 1. Resultado observável

Integrar a publicação de títulos e cada baixa da F68 ao ciclo contábil, produzindo rascunhos balanceados da F40 para revisão humana. Cancelamentos e estornos financeiros também entram no ciclo de correção contábil. A integração não efetiva lançamentos automaticamente nem altera títulos, baixas ou eventos da F68.

O usuário contábil vê, por empresa, o fato financeiro, sua origem, o reconhecimento já existente, a regra aplicada, o rascunho ou a pendência e o estado do lançamento. Uma execução repetida não cria lançamentos duplicados.

## 2. Origem, reconhecimento e prevenção de duplicidade

- A F68 é autoridade para título, parcela, baixa, saldo e reversão. A F40 é autoridade para o lançamento; a F41 fornece o contrato de regras versionadas e geração determinística. A F90 preserva referências e versões entre esses domínios.
- Título manual publicado pode gerar rascunho de reconhecimento, se houver regra contábil publicada, única, vigente e válida para o fato financeiro.
- Título originado de DF-e ou apuração coberto pela F41 vincula o reconhecimento dessa origem. A F90 não gera outro reconhecimento do mesmo fato; gera somente os eventos financeiros ainda não contabilizados, como cada baixa.
- Se o vínculo entre título e reconhecimento F41 estiver ausente, ambíguo, superado ou divergente, o resultado é pendência para revisão. Não se presume que um rascunho F41 seja lançamento efetivado nem se cria reconhecimento paralelo enquanto a duplicidade não estiver resolvida.
- Cada baixa, inclusive a parcial, é um fato distinto. Principal, juros, multa e desconto permanecem componentes separados segundo os valores registrados na F68; a F90 não os calcula nem os distribui implicitamente.
- Um evento financeiro não pode ser associado a lançamento de outra empresa, tenant ou origem incompatível. Vínculos e decisões de revisão ficam auditáveis.

## 3. Regras, rascunhos e revisão

- A F90 estende o motor determinístico da F41 com as famílias de eventos financeiros aprovadas nesta SPEC: publicação de título, baixa e correção por cancelamento ou estorno. Reutiliza regras versionadas por empresa, vigência explícita, seleção de regra única, simulação, pendências e idempotência.
- A geração usa apenas dados estruturados e persistidos do evento F68 e da regra aplicável. O resultado precisa validar contas analíticas, centros de custo, competência, data civil, centavos e equilíbrio pelas F39/F40. Ausência, ambiguidade ou configuração inválida não produz rascunho efetivável.
- A baixa F68 pode ter somente um meio descritivo, sem conta bancária identificada. Se não existir contrapartida de caixa/banco inequívoca, a F90 apresenta pendência; o contador escolhe uma conta válida da mesma empresa antes da efetivação. Não se usa uma conta padrão presumida.
- O rascunho F40 permanece revisável. O contador autorizado confere as partidas e executa a efetivação explícita pela F40, com todas as revalidações de permissão, competência e balanceamento existentes. Ajuste manual preserva o vínculo ao evento e o histórico da regra originalmente aplicada.
- Alteração de regra publicada cria nova versão; não reescreve rascunhos ou lançamentos anteriores. Reprocessamento da mesma identidade, versão do evento e versão da regra retorna o resultado existente ou uma pendência de conflito, sem segundo lançamento.

## 4. Correção e competência

- Cancelamento de título e estorno de baixa na F68 nunca apagam a contabilização anterior. A F90 relaciona a reversão financeira ao rascunho ou lançamento correspondente e apresenta a correção contábil para revisão.
- Rascunho ainda não efetivado e superado por reversão não pode ser efetivado. Se houver lançamento `POSTED`, a correção segue as regras de cancelamento ou estorno da F40 e as restrições de competência da F43, com autoria e motivo; não ocorre automaticamente.
- Evento com competência fechada ou data contábil inválida vira pendência explícita. A F90 não reabre competência, não move o fato para outro período por conta própria e não força lançamento em período fechado.
- A sequência de revisão mostra se o reconhecimento e a baixa estão pendentes, em rascunho, efetivados ou corrigidos. A F90 não confunde baixa financeira com lançamento contábil efetivado.

## 5. Histórico e idempotência

- Ao ativar a integração, títulos e baixas F68 já existentes são examinados por empresa e evento, com progresso recuperável e sem mutar a origem. Eventos elegíveis produzem os mesmos rascunhos ou pendências que eventos novos, sempre sujeitos a revisão.
- A carga histórica consulta vínculos F41/F40 e estados de competência antes de gerar. Lançamento já associado, origem ambígua ou competência fechada gera vínculo confirmado ou pendência, conforme a evidência; nunca um lançamento adicional por suposição.
- Reexecução, concorrência e retomada não duplicam rascunho, vínculo, correção ou pendência ativa do mesmo fato. Falha parcial não registra sucesso contábil sem o rascunho ou vínculo correspondente.
- O histórico de tentativa, regra, versão, revisor, decisão e `correlationId` é append-only e segregado por tenant, empresa e carteira.

## 6. Interface e autorização

Em `Contábil → Automatização`, a fila separa eventos financeiros aptos, rascunhos gerados e pendências de vínculo, regra, conta ou competência. O detalhe abre o título/baixa F68, a origem documental quando houver, a simulação das partidas e o lançamento F40 vinculado. A tela usa `docs/telas/` para conteúdo e fluxo, e `docs/FRONTEND.md` e `docs/DESIGN-SYSTEM.md` para os temas CLARO e ESCURO, estados, responsividade e acessibilidade.

Papéis com permissão contábil nas F40/F41 configuram regras, revisam e efetivam dentro da carteira autorizada. Papéis financeiros da F68 podem consultar o estado contábil dos próprios fatos, sem receber permissão de efetivação. Toda operação revalida tenant, empresa, carteira e papel; acesso negado não revela dados de outra empresa.

## 7. Aceite e provas

| Cenário | Resultado exigido |
|---|---|
| Título manual publicado com regra válida | Um rascunho balanceado F40, revisável e rastreado |
| Título de DF-e/apuração já tratado pela F41 | Reconhecimento vinculado sem segundo rascunho; baixa segue como fato próprio |
| Baixa parcial, nova baixa e estorno | Fatos distintos, valores exatos em centavos e correções referenciadas, sem mutação da F68 |
| Falta ou ambiguidade de regra, vínculo ou conta | Pendência visível; nenhum lançamento efetivado por inferência |
| Competência fechada ou rascunho superado | Bloqueio de efetivação e diagnóstico rastreável |
| Histórico, retry e concorrência | Resultado idempotente por evento/versão, sem duplicidade |
| Autorização e isolamento | RLS, carteira, papéis e trilha append-only verificados |
| Interface | Jornada completa em CLARO/ESCURO, responsiva, acessível e com estados de erro/vazio |

Testes de regras cobrem seleção, balanceamento, componentes da baixa, vínculo e reversões; testes de banco cobrem isolamento, concorrência, idempotência e histórico; testes de tela e E2E cobrem revisão e efetivação explícita. Evidências seguem `docs/TESTING.md` por SPEC e issue.

## 8. Complementos e fronteiras

- Movimentação bancária, confirmação Pix, ITP e conciliação continuam nas F85–F89; a F90 consome apenas fatos financeiros confirmados na F68.
- Cadastro mestre de contrapartes, recorrência financeira fora do Pix Automático e demais provedores continuam em fatias próprias do MVP-2, conforme `docs/FORA-DE-ESCOPO.md`.
- Geração e integração financeiro-contábil de folha permanecem em fatias próprias do MVP-2; cálculo de folha pertence ao MVP-3.
- A F90 não substitui classificação assistida, Agente Classificador, ECD/ECF, transmissão, reabertura de competência ou produção.

## 9. Decisões do PI

| Questão | Decisão |
|---|---|
| Eventos da F68 | Publicação de título, cada baixa e respectivas reversões |
| Efetivação | Rascunho com revisão humana; sem `POSTED` automático |
| Origem já reconhecida pela F41 | Vincular reconhecimento e contabilizar apenas fatos ainda não registrados |
| Histórico anterior à F90 | Processar com idempotência, revisão e respeito à competência |
| Conta de caixa/banco ausente | Contador informa conta válida antes da efetivação |
