# SPEC-088 — Iniciação Pix de DAS e FGTS via Open Finance

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F88
> **Issue:** [#119](https://github.com/RodReis/rrb-contaia/issues/119)
> **Estado:** aprovada pelo PI em 12/10/2026
> **Tamanho:** Grande
> **PRD:** §§3, 5.3, 7.2, 7.5, 9.1, 10.4, 12, 13.2, 14, 15 e 16

## 1. Resultado observável

Permitir que usuário financeiro autorizado inicie pagamento Pix de guia DAS ou FGTS já emitida, vinculada a uma parcela publicada e em aberto da F68. A empresa seleciona uma conta de origem Sicoob coberta pelo provedor e escolhe iniciar imediatamente ou solicitar agendamento para a data de vencimento da guia. O titular da conta ou representante autorizado confirma cada pagamento no ambiente bancário; o ContaIA não captura credenciais ou fatores de autenticação nem movimenta dinheiro sem essa confirmação.

O estado da iniciação permanece separado do estado financeiro da F68. Somente confirmação verificável do banco/provedor gera proposta revisável de baixa vinculada à parcela e à evidência externa. A F85 fornece a conexão de dados bancários, mas seu consentimento de compartilhamento não autoriza pagamento.

## 2. Elegibilidade, origem e autorização

- O usuário seleciona empresa, guia já emitida de DAS ou FGTS, parcela correspondente publicada e em aberto na F68, e conta de origem Sicoob autorizada para iniciação. F88 não emite nem consulta guias, não cria títulos e não aceita parcelas de outra empresa/tenant.
- A guia deve fornecer dados Pix legíveis por QR Code ou código copia-e-cola. A F88 valida os dados suportados pelo provedor e apresenta ao usuário o favorecido, valor e vencimento antes de encaminhar a ordem. Não há OCR nem edição silenciosa dos dados da guia.
- A ordem usa o valor e os dados de pagamento da guia como fonte de pagamento. Divergência com o compromisso F68 fica visível e não altera título, parcela ou saldo automaticamente.
- `gestor_financeiro` ou `admin_escritorio` pode preparar e iniciar a solicitação dentro da carteira autorizada. A aprovação/autenticação final é do titular ou representante autorizado no canal bancário, conforme o fluxo suportado pelo provedor.
- Cada pagamento exige autorização própria no fluxo ITP. Consentimento de compartilhamento de dados da F85 não substitui nem amplia autorização para movimentar a conta.
- A ordem pode ser imediata ou solicitada para a data de vencimento da guia. A modalidade só é apresentada como disponível quando coberta pela instituição, conta e provedor; cobertura ausente mantém a tentativa bloqueada e rastreável.

## 3. Acompanhamento, retomada e efeito na F68

- O sistema preserva a intenção antes do encaminhamento externo e associa empresa, parcela F68, guia, conta de origem, valor, modalidade/data solicitada e identificadores/correlação fornecidos pelo provedor.
- Estados de autorização, agendamento, processamento, confirmação, rejeição, falha e resultado incerto são exibidos separadamente do ciclo financeiro F68, seguindo a cobertura e os estados efetivamente retornados pelo provedor.
- Resposta ausente ou ambígua não é apresentada como sucesso. O sistema consulta/reconcilia o estado da mesma ordem antes de permitir nova tentativa; reenvio, webhook repetido ou processamento concorrente não cria pagamento ou proposta duplicada.
- Somente estado de pagamento confirmado por resposta autenticada/validada ou reconciliação verificável cria proposta revisável de baixa F68. A proposta preserva valor pago, parcela, evidência externa e correlação; não baixa o título automaticamente.
- Rejeição, cancelamento, expiração, falha, divergência ou indisponibilidade não altera F68. Estado não coberto pelo provedor permanece indeterminado, com diagnóstico e caminho de recuperação, sem inferir pagamento concluído.

## 4. Autorização, auditoria e invariantes globais tocados

- Tenant, empresa, carteira e papéis são verificados em leitura e escrita; conta de origem e parcela devem pertencer à empresa autorizada. Aplicam-se I-1 e I-2 de `docs/CONVENTION.md`.
- Valores de guias e ordens são representados em centavos inteiros, sem float (I-3). Datas de vencimento são civis; instantes de autorização, ordem e confirmação são exibidos em `America/Sao_Paulo` (I-11).
- A ação financeira externa requer autorização humana registrada no banco, sem credenciais ou fatores de autenticação no ContaIA (I-5). Papéis e alçadas internas seguem `docs/CONVENTION.md` §3.3.
- Intenção, autorização, resposta externa, retomada e proposta de baixa preservam trilha append-only e identidade de correlação (I-6). A iniciação tem idempotência por ordem/identidade externa, conta, empresa e tenant (I-9).
- Falha do provedor ou resultado incerto nunca dispara uma nova ordem sem reconciliação da anterior. Dados bancários e respostas externas são validados antes de atualizar estado.

## 5. Contrato de UI

Estender a área `Financeiro → Contas a Pagar & ITP`, usando a referência de conteúdo e hierarquia em `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/`. A tela permite selecionar guia DAS/FGTS existente, parcela F68 aberta, conta Sicoob coberta, revisar favorecido/valor/vencimento, escolher pagamento imediato ou agendado, encaminhar à autorização bancária e acompanhar ordem e proposta de baixa.

Cobrir carregando, ausência de guias ou parcelas elegíveis, conta sem cobertura, dados Pix inválidos, divergência com F68, autorização pendente/aprovada/rejeitada, agendada, confirmada, falha, resultado incerto, indisponibilidade, evento duplicado, proposta revisável e acesso negado. Implementar CLARO e ESCURO, responsividade, teclado, foco, semântica, contraste e zoom; comparar com o protótipo e cumprir `docs/FRONTEND.md` §20.1. Aplicar `frontend-design` e `impeccable`; incluir smoke ao vivo com Playwright.

## 6. Critérios de aceite

1. Usuário financeiro autorizado só inicia DAS ou FGTS com guia existente e parcela F68 publicada/em aberto da mesma empresa e tenant.
2. Favorecido, valor e vencimento da guia são apresentados antes da iniciação; dados inválidos, divergentes ou sem cobertura não geram ordem.
3. Pagamento imediato e agendamento para vencimento são oferecidos somente com cobertura comprovada para o provedor e conta Sicoob usados.
4. Cada iniciação exige autorização do titular/representante no banco; o consentimento de dados da F85 sozinho não permite pagamento, e o ContaIA não armazena autenticação bancária.
5. Falha, rejeição, resposta incerta ou indisponibilidade não aparece como pagamento concluído; recuperação reconcilia a ordem existente antes de qualquer reenvio.
6. Confirmação bancária válida gera exatamente uma proposta revisável de baixa F68 vinculada à parcela e evidência; nenhuma iniciação ou confirmação baixa o título automaticamente.
7. Webhook repetido, retry e concorrência não duplicam ordem, confirmação ou proposta; acesso cruzado entre tenant/empresa/carteira é negado.
8. Cobrir regras, banco, tela e E2E aplicáveis, estados e falhas, isolamento, idempotência, ambos os temas, responsividade e acessibilidade, com evidência rastreável por F88 conforme `docs/TESTING.md`.

## 7. Fora de escopo e dependências

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Emissão/consulta/atualização de DAS ou FGTS, OCR e cálculo de acréscimos | Capacidades tributárias ou trabalhistas próprias do MVP-2/MVP-3, com fonte e recorte aprovados. |
| Pagamento de boletos, outros tributos, outras guias, outros bancos e outros provedores | Fatias próprias do MVP-2 após recorte e cobertura aprovados. |
| Pix Automático, recorrência, pagamentos em lote, manutenção/cancelamento de ordem e transmissão produtiva | Fatias próprias do MVP-2; produção somente após MVP-4 e gate de infraestrutura. |
| Baixa automática F68, estorno automático e contabilização | F68 conserva a baixa sob revisão; demais efeitos exigem fatias e contratos próprios. |
| Provedor concreto e cobertura Sicoob ITP | Pré-requisito técnico para implementação: confirmar participação/capacidade ITP, cobertura da conta, leitura de QR/copia-e-cola, pagamento imediato, agendamento, autorização, consulta/reconciliação e notificações. Sem evidência, a prova bancária fica `not_run` e a operação não é declarada suportada. |

## 8. Decisões do PI e gate documental

PI aprovou em 12/10/2026: F88/SPEC-088 cobre somente iniciação Pix de guias DAS e FGTS já emitidas, vinculadas a parcelas publicadas e abertas da F68; reutiliza o agregador da F85 e começa por conta Sicoob, condicionado à cobertura ITP comprovada; permite solicitação imediata ou agendada para o vencimento; exige autorização do titular/representante no ambiente bancário; confirmação válida produz proposta revisável de baixa F68. Não inclui emissão/consulta de guia, baixa automática ou produção antes do gate posterior ao MVP-4.

Questões abertas: **Nenhuma**. A aprovação documental não comprova cobertura habilitada do provedor, execução bancária ou testes de aplicação.
