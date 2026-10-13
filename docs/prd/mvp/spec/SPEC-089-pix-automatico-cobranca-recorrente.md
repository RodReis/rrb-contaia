# SPEC-089 — Pix Automático para cobrança recorrente F68

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F89
> **Issue:** [#121](https://github.com/RodReis/rrb-contaia/issues/121)
> **Estado:** aprovada pelo PI em 13/10/2026
> **Tamanho:** Grande
> **PRD:** §§3, 5.3, 7.3, 7.5, 9.1, 10.4, 12, 13.2, 14, 15 e 16

## 1. Resultado observável

Permitir que usuário financeiro autorizado ofereça Pix Automático para cobranças recorrentes representadas por parcelas publicadas e abertas da F68. O pagador concede a autorização uma única vez no ambiente do seu prestador de serviços de pagamento. O sistema acompanha a autorização e as cobranças, envia instruções somente para parcelas vinculadas e registra cada recebimento confirmado como baixa automática idempotente na F68.

A autorização do pagador, o agendamento e a liquidação são estados distintos. O ContaIA não captura credenciais ou fatores de autenticação do pagador e não considera autorização como pagamento liquidado. A F68 permanece autoridade para títulos, parcelas e saldos; o PSP é autoridade para autorização e eventos Pix observados.

## 2. Elegibilidade e vínculo financeiro

- O usuário seleciona empresa, título e parcelas a receber já publicadas e abertas na F68. Recorrência, parcela e instrução de pagamento ficam vinculadas à mesma empresa e tenant; cruzamento é rejeitado.
- `gestor_financeiro` ou `admin_escritorio` pode administrar cobranças dentro da carteira autorizada, respeitando as permissões existentes da F68. A SPEC não concede alçada financeira nova.
- A recorrência referencia as parcelas F68 que serão cobradas. Valor e vencimento vêm da parcela; a integração valida compatibilidade com a recorrência e com a autorização antes de enviar qualquer instrução. As periodicidades admitidas seguem a norma vigente do Pix Automático: semanal, mensal, trimestral, semestral ou anual.
- A autorização é concedida pelo pagador ao PSP pagador, em jornada suportada e confirmada por esse PSP. O ContaIA exibe o estado observado e os parâmetros autorizados; não presume autorização concluída.
- A interface permite criar, acompanhar, pausar e cancelar a permissão de envio de cobranças pelo recebedor. Recusa ou revogação feita pelo pagador no banco deve ser refletida antes de novas cobranças. Alterar parâmetros incompatíveis com a recorrência autorizada exige encerrar a recorrência anterior e obter nova autorização. Encerramento ou revogação bloqueia instruções futuras.
- Uma parcela só pode ter uma instrução Pix Automático efetiva por ciclo. Cobranças concorrentes, cobranças já pagas ou parcelas fechadas não geram nova instrução.

## 3. Cobrança, confirmação e baixa

- A F89 usa o Sicoob como PSP inicial, condicionado a comprovação da cobertura Pix Automático para a cooperativa e conta habilitadas. A F87 não comprova essa cobertura: seus recursos de Pix Cobrança não são evidência de suporte a Pix Automático.
- A instrução é enviada conforme o calendário da recorrência e o vencimento da parcela, usando valor em centavos inteiros. Frequência, datas, limites, antecedência de envio e demais parâmetros seguem o contrato oficial vigente do Pix Automático e a cobertura comprovada do Sicoob. O valor enviado nunca pode exceder o limite máximo autorizado pelo pagador.
- Uma resposta incerta de criação ou envio é consultada/reconciliada com a origem antes de qualquer repetição. A F89 não repete automaticamente uma cobrança recusada ou sem confirmação; a parcela permanece aberta e o motivo observado fica disponível para ação explícita do usuário.
- Somente liquidação confirmada e correlacionada ao PSP gera baixa automática na F68. Autorização concedida, instrução aceita ou pagamento agendado não é liquidação.
- Cada baixa guarda empresa, tenant, parcela, valor, instante, identificadores externos, origem, ator/serviço e `correlationId`. Reentrega, retry técnico, concorrência ou reconciliação não duplicam baixa.
- Pagamento parcial baixa somente o valor recebido e mantém saldo remanescente aberto. Valor recebido acima do saldo disponível não baixa acima do saldo; o excedente permanece como exceção vinculada à evidência, sem rateio ou devolução automática, seguindo o contrato da F87.
- Rejeição, ausência de saldo, cancelamento, expiração, falha ou estado inconclusivo não são apresentados como pagamento confirmado nem alteram saldo F68. Recuperação consulta o PSP antes de permitir nova ação.

## 4. Autorização, auditoria e invariantes

- Toda recorrência, autorização, instrução, notificação, liquidação, baixa e exceção carrega tenant e empresa e respeita RLS, carteira e papéis da F68.
- Eventos e comandos externos são dados não confiáveis até validação. Segredos e fatores de autenticação nunca são expostos ao navegador.
- Estados da autorização, da recorrência, da instrução de cobrança e da parcela F68 são mantidos separadamente e com histórico append-only.
- Datas de vencimento são civis; instantes são persistidos com fuso explícito e exibidos em `America/Sao_Paulo`.
- Cada instrução usa o valor exato da parcela F68. Se esse valor superar o limite máximo autorizado pelo pagador, a cobrança é bloqueada; o usuário deve obter nova autorização antes de enviar uma cobrança com limite diferente.

## 5. Contrato de UI

Estender `Financeiro → Contas a Receber & Pix BaaS`, usando conteúdo e hierarquia da tela financeira em `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/`. A tela permite selecionar parcelas F68, revisar parâmetros da recorrência e instruções, encaminhar a autorização ao banco, acompanhar estados e administrar pausa/cancelamento.

Cobrir carregando, sem parcelas elegíveis, divergência de calendário/valor, autorização pendente/aprovada/recusada/revogada, recorrência ativa/pausada/cancelada, instrução enviada/agendada/liquidada/recusada, baixa integral/parcial, excedente, duplicidade, estado incerto, indisponibilidade e acesso negado. Implementar CLARO e ESCURO, responsividade, teclado, foco, semântica, contraste, zoom, comparação com protótipo e E2E conforme `docs/FRONTEND.md` §20.1. Aplicar `frontend-design` e `impeccable`; incluir smoke ao vivo com Playwright.

## 6. Critérios de aceite

1. Usuário autorizado cria uma recorrência apenas para parcelas F68 publicadas e elegíveis da empresa selecionada; tenant ou empresa diferente é sempre rejeitado.
2. O pagador concede, recusa ou revoga autorização no ambiente do PSP; o ContaIA mostra o estado confirmado e bloqueia novas instruções quando a permissão não estiver ativa.
3. Usuário autorizado consegue acompanhar, pausar e cancelar a permissão de envio; cancelamento/revogação bloqueia instruções futuras conforme o contrato vigente.
4. Instrução só é enviada para parcela aberta, ainda não cobrada no ciclo e compatível com os parâmetros autorizados e a cobertura do PSP.
5. Autorização e agendamento não baixam parcela. Liquidação confirmada e correlacionada cria baixa F68 automática e idempotente.
6. Pagamento parcial não excede o recebido; excedente não baixa acima do saldo, não é rateado nem devolvido automaticamente e permanece rastreável.
7. Recusa, falta de confirmação, erro, cancelamento e resposta incerta não geram baixa nem retry automático; a retomada consulta o PSP antes de nova ação explícita.
8. Eventos repetidos, fora de ordem, tardios, inválidos, inconsistentes ou de outra empresa não alteram indevidamente a F68 e permitem diagnóstico/recuperação.
9. Provar regras, banco, tela, E2E aplicável, isolamento/RLS, papéis, autorização/revogação, idempotência, concorrência, liquidação integral/parcial/excedente, falha e retomada; registrar evidência rastreável por F89 conforme `docs/TESTING.md`.
10. Cobertura positiva exige documentação atual, contrato e fixtures compatíveis com a cooperativa Sicoob habilitada. Sem essa evidência, prova bancária é `not_run`, nunca `pass` ou capacidade presumida.

## 7. Fora de escopo e dependências

| Fora desta fatia | Destino |
|---|---|
| Criação, alteração ou baixa de títulos/parcelas fora do ciclo existente da F68 | F68 ou fatia própria do MVP-2 |
| Pagamentos de saída, Pix Automático como débito iniciado pelo escritório, Pix Agendado recorrente e outras modalidades | F88 ou fatias próprias; autorização de saída permanece no PSP pagador |
| Outros PSPs, API multi-provedor e transmissão produtiva | Fatias próprias após recorte e cobertura aprovados; produção somente após MVP-4 e gate de infraestrutura |
| Juros, multa, desconto, renegociação, cobrança de valor divergente e política de tolerância | Capacidades próprias com regra aprovada; não calcular nem inferir nesta fatia |
| Devolução, MED e contabilização automática | Fluxos próprios; nenhum efeito contábil automático nesta fatia |

Antes da implementação, confirmar no contrato e na documentação oficial vigente do Sicoob suporte para criação/alteração/cancelamento da recorrência, jornadas de autorização, envio de instruções, consulta/reconciliação, notificações e confirmação de liquidação. A cobertura deve ser comprovada por cooperativa e conta; não se infere a partir da F87 nem da cobertura ITP da F88.

## 8. Decisões do PI e gate documental

PI aprovou em 13/10/2026: F89/SPEC-089 cobre Pix Automático para recebíveis recorrentes vinculados a parcelas existentes e abertas da F68; inicia pelo Sicoob sob cobertura comprovada; confirmação de liquidação gera baixa automática idempotente; falha não dispara retry automático; ciclo de vida inclui criação, acompanhamento, pausa, cancelamento e substituição da recorrência com nova autorização quando parâmetros precisarem mudar; revogação do pagador bloqueia cobranças futuras. Cada cobrança usa o valor exato da parcela e, se superar o limite autorizado, exige nova autorização. Questões de produto abertas: **nenhuma**.

Decisão do PI em 13/10/2026: parcelas podem variar de valor; cada cobrança usa exatamente o valor da parcela F68. Se ultrapassar o limite autorizado, deve ser bloqueada até que o pagador conceda nova autorização. Questões de produto abertas: **nenhuma**.

**Referências oficiais:** [Banco Central — Pix Automático](https://www.bcb.gov.br/estabilidadefinanceira/pix-automatico), [Banco Central — Pix Automático para recebedores](https://www.bcb.gov.br/estabilidadefinanceira/pix-automatico-recebedores), [Instrução Normativa BCB nº 513/2024, versão vigente](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=513&tipo=Instru%C3%A7%C3%A3o+Normativa+BCB).
