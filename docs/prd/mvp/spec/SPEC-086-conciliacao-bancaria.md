# SPEC-086 — Conciliação bancária assistida

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F86
> **Origem:** PRD §§3, 5.3, 6, 7.4, 7.5, 9.1, 10.4, 12, 13, 14, 15 e 16; Anexo C
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 12/10/2026
> **Issue:** pendente de criação no GitHub

---

## 1. Objetivo

Entregar a conciliação assistida de transações bancárias normalizadas pela F85 com parcelas e títulos financeiros da F68 e documentos fiscais disponíveis para a empresa. O sistema calcula candidatos por critérios determinísticos, concilia automaticamente apenas quando a evidência é inequívoca e mantém sugestões, empates e exceções sob revisão humana.

A conciliação aceita não baixa nem altera o título F68. Quando houver candidato financeiro, F86 pode criar proposta revisável de baixa vinculada à parcela, preservando o valor bancário e o financeiro mesmo quando divergirem. Publicação e baixa continuam sujeitas ao ciclo humano da F68. F86 não cria partidas contábeis, inicia pagamentos ou produz efeito bancário externo.

## 2. Resultado observável

Em `Financeiro → Conciliação`, usuário autorizado pode:

- consultar transações importadas da F85 por empresa, conta, período, situação e cobertura da origem;
- ver descrição normalizada, valores e datas de origem, candidatos e score por critério;
- aceitar ou rejeitar sugestão, escolher outro candidato elegível um para um e registrar o resultado;
- acompanhar conciliações automáticas, fila de revisão e exceções sem candidato elegível;
- navegar para a transação F85, parcela/título F68 ou documento que sustenta o candidato;
- revisar uma proposta de baixa criada em F68 sem confundir match com baixa efetivada.

O dado bancário permanece a autoridade da transação; F68 permanece a autoridade do compromisso, saldo e ciclo de baixa; a capacidade fiscal permanece a autoridade do documento fiscal. Conciliar não corrige nenhuma dessas origens.

## 3. Dependências e elegibilidade

| Fonte | Autoridade consumida |
|---|---|
| F85/SPEC-085 | conta e transação bancária normalizadas, identificador estável da origem, empresa, valores, datas, descrição, cobertura e versão importada |
| F68/SPEC-068 | compromissos e parcelas publicados, direção, contraparte, valor, vencimento, saldo em aberto e versão |
| Capacidades fiscais | documento fiscal, identificador, valor, data, contraparte e situação conforme sua origem |

- Transação e candidato devem pertencer à mesma empresa autorizada; candidatos de outra empresa ou tenant nunca entram no conjunto de busca.
- Somente candidato financeiro elegível e ainda não conciliado pode receber novo vínculo. Um match ocupa a transação e o candidato; uma segunda tentativa concorrente resulta em conflito revisável, sem duplicar vínculo nem proposta.
- Cada conciliação relaciona exatamente uma transação a exatamente um candidato. Parcelas múltiplas para uma transação ou transação múltipla para uma parcela ficam fora desta fatia.
- Transação sem candidato, com origem incompleta ou com dados insuficientes para pontuar não é descartada: permanece visível na fila de exceções com a causa observada.
- Reentrega da mesma transação F85 e reprocessamento da mesma versão de candidatos são idempotentes; versão ou conteúdo divergente sob a mesma identidade é conflito rastreável.

## 4. Motor de matching e decisões

O score segue o Anexo C do PRD, com pesos e subfaixas iniciais:

| Critério | Pontuação |
|---|---|
| Valor | 0,40 quando igual em centavos; 0,25 quando a diferença relativa para o candidato for inferior a 5% |
| Data | 0,25 no mesmo dia; 0,15 até 2 dias; 0,05 até 5 dias; caso contrário, zero |
| Descrição/contraparte | similaridade semântica normalizada multiplicada por 0,20 |
| Número do documento | 0,15 para igualdade; 0,10 para correspondência aproximada acima de 0,8; caso contrário, zero |

- Valores monetários são inteiros em centavos. Igualdade de valor significa igualdade exata em centavos; não se usa tolerância float inferior a um centavo.
- Diferença relativa é calculada com denominador positivo do candidato. Candidato sem valor positivo não recebe pontuação relativa por valor e não causa divisão por zero.
- `score ≥ 0,90`: conciliar automaticamente apenas se houver um único candidato no maior score. Registrar o candidato, score e composição da evidência e, para parcela F68, criar uma proposta revisável de baixa.
- `0,60 ≤ score < 0,90`: apresentar a melhor sugestão e até duas alternativas para decisão humana.
- `score < 0,60`, ausência de candidato, empate no maior score ou insuficiência de dados: enviar à fila de exceções/revisão humana. Empate nunca é desfeito por ordem incidental de banco ou identificador.
- Critérios de score e os limites iniciais são versionados e reproduzíveis. A revisão trimestral prevista no PRD usa evidência observada; não altera silenciosamente decisões históricas.
- O LLM pode explicar evidências e sugerir pontos de atenção ao revisor em casos ambíguos. Não altera score, não cria candidato e não decide nem executa conciliação.
- Se valores bancário e financeiro divergirem, o vínculo pode ser sugerido ou aceito conforme score e revisão; a proposta F68 preserva os dois valores observados, evidencia a diferença e exige revisão. F86 não calcula nem presume principal, juros, multa ou desconto.

## 5. Ciclo, autorização e auditoria

Estados observáveis: pendente de análise, sugestão, exceção, conciliada automaticamente, conciliada por revisão, rejeitada e conflito. A interface distingue a situação da conciliação da situação da proposta/baixa F68.

- `auxiliar` pode preparar ou submeter decisão para revisão; `gestor_financeiro` ou `admin_escritorio` revisam e decidem no escopo autorizado, preservada a segregação de preparação e aprovação da F68. `contador` e `auditor_readonly` consultam conforme as permissões existentes, sem decisão mutável.
- Aceite, rejeição, escolha manual de candidato, conciliação automática e criação de proposta registram ator/serviço, empresa, transação, candidato, versão, score, motivo quando informado, instante e `correlationId` em trilha append-only.
- Uma correção de conciliação preserva a decisão anterior e registra evento compensatório com autor e motivo; nunca apaga silenciosamente o vínculo auditável.
- Conciliar é vínculo interno assistido. Não publica título, registra baixa, cria lançamento contábil ou move dinheiro.

## 6. Invariantes globais tocados

| Invariante | Aplicação na F86 |
|---|---|
| I-1 | transações conciliadas, vínculos, propostas relacionadas e eventos carregam `tenant_id` e `empresa_id`, índices e RLS |
| I-2 | consulta sem contexto autorizado de tenant/empresa não retorna dados financeiros |
| I-3 | valores e diferenças financeiras usam centavos inteiros, sem float |
| I-4 | score e decisão automática são determinísticos; LLM não calcula nem decide |
| I-5 | proposta e baixa seguem as aprovações humanas registradas da F68 |
| I-6 | decisões e correções preservam trilha append-only |
| I-9 | reprocessamento e criação de propostas relacionadas não duplicam efeitos |
| I-11 | data bancária civil permanece sem fuso; timestamps exibem `America/Sao_Paulo` |
| I-12 | mesma transação, versões de candidatos e versão do motor reproduzem score e decisão |

## 7. Contrato de UI

Usar `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/` para conteúdo e hierarquia da área financeira. A tela da F86 oferece seleção de empresa/conta e período, resumo da fila, filtros, lista de transações, detalhe com candidatos e score discriminado, comparação de valores/datas, ação de revisar ou rejeitar e navegação para as origens. A proposta de baixa F68 aparece como etapa distinta e revisável.

Cobrir carregando, vazio, sem resultados de filtro, transação sem candidato, sugestão, empate, exceção, conciliada automaticamente, decisão humana, divergência de valor, proposta F68 pendente/rejeitada/publicada, transação já conciliada, conflito, cobertura Open Finance parcial/desatualizada, erro recuperável e acesso negado. Implementar CLARO/ESCURO e provar 375/768/1280/1536 px, teclado, foco, semântica, contraste, zoom, comparação visual e E2E conforme `docs/FRONTEND.md` §20.1. Aplicar `frontend-design` e `impeccable`; incluir smoke ao vivo com Playwright.

## 8. Critérios de aceite

1. Transação F85 importada entra na fila da empresa/conta correta e fica disponível para conciliação em até 24 horas, conforme PRD §7.5.
2. O motor produz score reproduzível segundo os pesos e subfaixas do Anexo C, usando centavos inteiros e datas civis.
3. Único candidato com score `≥ 0,90` é conciliado automaticamente; empate no topo não é automatizado.
4. Score entre `0,60` e `0,90` exibe sugestão e até duas alternativas; score abaixo de `0,60` ou sem candidato segue para exceção.
5. Decisão humana pode aceitar/rejeitar ou escolher candidato elegível; cada ação respeita papel, empresa, segregação e auditoria.
6. Match com parcela F68 cria no máximo uma proposta de baixa revisável e vinculada; não baixa nem publica o título. Divergência conserva os dois valores e não presume juros/desconto.
7. Reentregas, concorrência e retries não duplicam transação conciliada, vínculo ou proposta; disputa retorna conflito recuperável.
8. Registro, filtros, agregados e exportações respeitam tenant, carteira e empresa; nenhuma evidência de empresa não autorizada vaza.
9. O LLM não muda score ou decisão; indisponibilidade do LLM não bloqueia o motor determinístico.
10. Provar matching igual/divergente, datas nas faixas, documento exato/aproximado, sem candidato, empate, reentrega, conflito, RLS e papéis, além de regras, banco, tela e E2E aplicáveis; registrar evidência rastreável por F86/issue conforme `docs/TESTING.md`.
11. Acompanhar meta do PRD de precisão automática ≥99%, cobertura automática ≥70% no primeiro mês e ≥85% em seis meses, e processamento abaixo de 500 ms por transação. São métricas observadas, não justificativa para relaxar o limiar nem critério de resultado simulado em CI.

## 9. Fora de escopo e destinos

| Fora desta fatia | Destino |
|---|---|
| Consentimento, conexão, coleta e normalização Open Finance | F85/SPEC-085 |
| Malha preventiva SPED × DF-e × extrato para bloqueio do fechamento | F67/SPEC-067 |
| Títulos, ciclo de baixa, cálculo de juros/desconto e publicação financeira | F68/SPEC-068 |
| ITP, agendamento ou execução de pagamentos | Fatia própria do MVP-2; autorização final permanece no banco |
| Cobrança Pix e baixa por webhook | Fatia própria do MVP-2 |
| Match de uma transação para vários candidatos ou vice-versa | Nova fatia do MVP-2 com regra de composição aprovada |
| Lançamento/partida contábil automática | Fatia própria do MVP-2 |
| Conciliação com instituições além das cobertas pela F85 | Nova fatia após aprovação de instituição e cobertura |

## 10. Decisões do PI e gate documental

PI aprovou em 12/10/2026: F86/SPEC-086 trata conciliação bancária; correspondência um para um; score `≥ 0,90` automatiza somente quando houver candidato único no maior score; empate vai à revisão; um match financeiro pode criar proposta de baixa revisável F68, sem baixa automática; valores divergentes permanecem explicitamente preservados para revisão; LLM apenas explica/sugere, sem alterar score ou decidir. A convenção e o PRD contêm menção divergente ao corte estrito `> 0,90`; para F86 prevalece o corte inclusivo aprovado pelo PI e registrado nesta SPEC. Questões de produto abertas: **nenhuma**.
