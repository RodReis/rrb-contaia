# SPEC-068 — Núcleo de contas a pagar e receber

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F68
> **Origem:** PRD §§3, 5.3, 6.2, 6.5, 7.1, 9.1, 10.3, 10.4, 12, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Entregar o núcleo de contas a pagar e receber por empresa, com títulos manuais e propostas idempotentes originadas de DF-e com cobrança estruturada e de guias ou apurações aprovadas. A fatia cobre parcelamento explícito, revisão humana, publicação, baixa manual total ou parcial e correção por eventos reversíveis.

A F68 cria a autoridade interna do título financeiro sem mover dinheiro, importar boleto ou CNAB, projetar aging ou fluxo de caixa, conciliar transações, contabilizar automaticamente ou produzir efeito bancário externo.

## 2. Resultado observável

Em `Financeiro -> Contas a pagar e receber`, o usuário pode:

- consultar títulos por empresa, direção, contraparte, vencimento, situação e origem;
- criar compromisso manual a pagar ou receber com uma ou mais parcelas;
- revisar propostas produzidas por DF-e ou obrigação tributária elegível;
- comparar valor e vencimento propostos com os dados da origem;
- justificar alteração de valor ou vencimento sem modificar a origem;
- publicar ou rejeitar uma proposta;
- registrar baixas manuais totais ou parciais com principal, juros, multa e desconto separados;
- consultar saldo nominal e saldo aberto por parcela e compromisso;
- estornar baixa, cancelar título publicado e acompanhar a trilha completa;
- navegar para o DF-e, guia ou apuração que originou a proposta.

Autorização fiscal ou existência de apuração, isoladamente, não comprovam cobrança. Nenhuma proposta é publicada sem revisão humana.

## 3. Dependências e autoridades

| Fonte | Autoridade consumida |
|---|---|
| F18/F30 e extensões aprovadas | conteúdo, situação e cobrança estruturada dos DF-e normalizados |
| F36 | DAS e DARE locais aprovados no recorte próprio |
| F37 | DARF locais aprovados de PIS/Pasep e Cofins |
| F38 | DARF locais aprovados de IRPJ e CSLL, inclusive quotas |
| F63–F66 | vencimento, exigibilidade, dependências e sucessão quando aplicáveis à obrigação de origem |
| F68 | compromisso, parcelas, publicação, baixas, saldo e histórico financeiro interno |

A capacidade de origem permanece autoridade para documento, tributo, valor calculado, vencimento oficial e situação fiscal. A F68 preserva snapshots e referências dessas informações; não as corrige nem substitui.

## 4. Elegibilidade das origens internas

### 4.1 DF-e

DF-e autorizado só produz proposta automática quando contiver evidência financeira estruturada suportada, como fatura, duplicata, parcela, meio ou condição de pagamento. Entrada ou saída fiscal não determina sozinha uma obrigação financeira.

Documento cancelado, denegado, devolvido, de ajuste, complementar, remessa, retorno, transferência, bonificação ou sem cobrança estruturada não produz proposta automática. Quando houver cobrança real não estruturada, o usuário cria título manual e pode referenciar o DF-e como evidência.

O mapeamento pagar/receber considera papel da empresa, finalidade, eventos e cobrança do documento. Ambiguidade não escolhe direção por padrão: fica `INDETERMINATE` e exige criação manual.

### 4.2 Guias e apurações

Somente saída aprovada pela capacidade de origem produz proposta a pagar. Rascunho, cálculo superado, resultado `INDETERMINATE`, obrigação `NOT_APPLICABLE`, guia cancelada ou dependência rígida ainda não satisfeita não publica proposta elegível.

Nova versão da origem não edita título publicado. Ela marca a referência como superada e abre revisão para cancelamento, substituição ou manutenção justificada.

## 5. Contrato conceitual

`FinancialCommitment` representa o compromisso a pagar ou receber, com tenant, empresa, direção, descrição, contraparte, moeda, valor nominal, origem, situação, datas e versão.

`FinancialInstallment` representa cada parcela, com sequência, valor nominal em centavos, vencimento civil, saldo aberto e situação próprios. A soma das parcelas deve ser exatamente igual ao valor nominal do compromisso.

`CounterpartySnapshot` preserva nome e CPF/CNPJ validados quando disponíveis, além de referência opcional à origem. A F68 não cria cadastro mestre de clientes ou fornecedores.

`FinancialSourceReference` preserva tipo, identificador e versão da origem, valor e vencimento originais, hash estável e vínculo para navegação.

`Settlement` registra baixa manual com data civil, principal, juros, multa e desconto em centavos, meio descritivo controlado, observação, autor e versão. Juros, multa e desconto são informados; a F68 não os calcula.

`FinancialReversal` registra estorno ou cancelamento com motivo, autor, instante e evento substituído, sem apagar o registro anterior.

## 6. Criação manual e contraparte

Título manual exige empresa, direção, descrição, moeda BRL, valor nominal positivo, uma ou mais parcelas e contraparte. Nome é obrigatório; CPF/CNPJ é opcional somente quando a natureza da contraparte não o possuir, com justificativa registrada.

CPF/CNPJ informado é validado e armazenado normalizado. Alteração de contraparte depois da publicação exige cancelamento e novo título; o snapshot histórico nunca acompanha silenciosamente mudança cadastral futura.

Possível duplicidade manual por empresa, direção, contraparte, valor e vencimento gera alerta e exige confirmação. Não bloqueia quando não houver chave inequívoca compartilhada.

## 7. Proposta idempotente e revisão

Cada origem e versão elegível produz no máximo uma proposta ativa por finalidade e parcela. Reprocessar a mesma versão retorna a mesma proposta; conteúdo diferente sob a mesma chave é conflito auditável.

A proposta nasce `DRAFT`, preserva valor e vencimento da origem e entra na fila de revisão. O revisor pode:

- aceitar a composição original;
- ajustar valor ou vencimento com motivo obrigatório;
- reorganizar parcelas quando a origem permitir, preservando os dados originais;
- rejeitar a proposta com motivo;
- publicar o título.

Alteração justificada cria `SourceOverride`, contendo campo, valor original, valor aprovado, motivo e aprovador. O override não volta para a capacidade de origem.

## 8. Parcelamento

Um compromisso contém uma ou mais parcelas explícitas. Cada parcela possui vencimento, valor, saldo e ciclo próprios; não é título independente sem vínculo com o compromisso.

Parcelas devem ter sequência única, valores positivos e soma exata. Arredondamento distribui centavos de forma determinística e declarada, sem float. Publicação atômica falha se qualquer parcela for inválida.

Inserir, remover, repartir ou consolidar parcelas só é permitido em rascunho. Depois da publicação, correção exige cancelamento do saldo não liquidado e novo compromisso relacionado.

## 9. Ciclo de vida

Estados persistidos do compromisso:

`DRAFT -> UNDER_REVIEW -> OPEN -> PARTIALLY_SETTLED -> SETTLED`

Transições alternativas:

- `DRAFT | UNDER_REVIEW -> REJECTED` para proposta de origem;
- `OPEN | PARTIALLY_SETTLED -> CANCELED` somente sobre saldo aberto, com motivo;
- estorno de baixa recalcula o estado a partir dos eventos válidos.

`OVERDUE` é condição derivada para parcela aberta com vencimento anterior à data civil informada na consulta; não substitui o estado persistido e não depende de relógio oculto em função de domínio.

Título publicado é imutável nos campos materiais. Cancelamento preserva parcelas, baixas e origem. Compromisso totalmente liquidado não é cancelado; primeiro se estornam as baixas aplicáveis.

## 10. Baixa manual e saldo

Baixa pode liquidar uma parcela total ou parcialmente. Principal deve ser positivo e não pode exceder o saldo aberto. Juros e multa aumentam o total efetivamente pago ou recebido; desconto reduz o total, sem reduzir silenciosamente o principal nominal.

Para uma baixa:

`valor_efetivo = principal + juros + multa - desconto`

O valor efetivo não pode ser negativo. Saldo nominal aberto reduz somente pelo principal e pelo desconto explicitamente aprovado para quitação. Se o desconto não quitar principal, o saldo remanescente continua aberto.

Múltiplas baixas são permitidas. Estorno cria evento compensatório, restaura o saldo correspondente e nunca apaga a baixa. F68 não cria movimento bancário, lançamento contábil ou comprovante externo.

## 11. Autorização e segregação

- `auxiliar`: cria e edita rascunho manual, prepara proposta e submete revisão; não publica, baixa, estorna nem cancela;
- `gestor_financeiro`: publica, rejeita, baixa, estorna e cancela dentro da carteira, desde que não tenha preparado a proposta originada automaticamente;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação entre preparação e aprovação;
- `contador`: consulta títulos, origens, baixas e histórico da carteira; não executa ato financeiro na F68;
- `auditor_readonly`: consulta e exporta evidência, sem mutação;
- `cliente_portal` e papéis sem permissão: acesso negado;
- `super-admin` local: mantém infraestrutura global, sem decidir título empresarial.

Publicação e baixa são ações humanas explícitas. Quem preparou uma proposta de origem não a publica. Título manual criado diretamente por `gestor_financeiro` ou `admin_escritorio` pode ser publicado pelo próprio autor, pois não é proposta de agente nem efeito externo.

## 12. Isolamento, concorrência e falhas

- tabelas transacionais carregam `tenant_id` e `empresa_id`, índices e RLS;
- toda consulta valida carteira no servidor;
- publicação, baixa, estorno e cancelamento usam versão otimista e retornam HTTP 409 em conflito;
- compromisso e parcelas publicam atomicamente;
- falha da origem não cria título parcial nem presume elegibilidade;
- reprocessamento idempotente não duplica proposta, parcela ou baixa;
- erro segue `application/problem+json` com código estável e `correlationId`;
- indisponibilidade preserva o último estado íntegro e permite retentativa segura.

## 13. Auditoria

Criação, alteração de rascunho, submissão, publicação, rejeição, override, baixa, estorno, cancelamento, exportação, navegação para origem e tentativa negada geram evento append-only.

Cada evento registra tenant, empresa, compromisso, parcela quando aplicável, autor, papel, instante, `correlationId`, valores anteriores e posteriores, motivo e referência de origem. Nenhum valor financeiro publicado é apagado fisicamente.

## 14. Invariantes globais tocados

| Invariante | Aplicação na F68 |
|---|---|
| I-1 | compromissos, parcelas, baixas e eventos carregam tenant e empresa, índices e RLS |
| I-2 | consulta sem contexto de empresa e carteira não retorna dado financeiro |
| I-3 | todos os valores monetários são inteiros em centavos; parcelamento fecha exatamente |
| I-4 | elegibilidade, saldo e estados são determinísticos; LLM não calcula nem publica |
| I-5 | publicação, baixa, estorno e cancelamento exigem ação humana registrada |
| I-6 | ciclo financeiro preserva eventos append-only e referência à origem |
| I-7 | título, parcela ou baixa publicados não são apagados nem editados silenciosamente |
| I-9 | propostas de origem, publicação e eventos financeiros são idempotentes |
| I-11 | vencimento e baixa são datas civis; timestamps exibem `America/Sao_Paulo` |
| I-12 | consulta com mesma data de referência e mesmos eventos reproduz saldo e condição |

## 15. Contrato de UI

A UI usa `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/` para conteúdo, hierarquia e densidade, limitada nesta fatia às áreas `Contas a Pagar & Aging` e `Contas a Receber & Pix BaaS`. Elementos de aging, Pix, Open Finance, conciliação e fluxo projetado aparecem somente como destinos indisponíveis, sem simular funcionalidade.

A tela apresenta resumo de aberto, vencido, parcialmente liquidado e liquidado; filtros; tabela de compromissos e parcelas; criação manual; fila de propostas; comparação com origem; editor de parcelas; detalhe; baixa; estorno; cancelamento e histórico.

Estados obrigatórios: carregando, vazio, rascunho, em revisão, aberto, parcialmente liquidado, liquidado, vencido derivado, rejeitado, cancelado, origem superada, override justificado, duplicidade possível, conflito, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco, semântica, contraste, máscaras de CPF/CNPJ, data e R$, confirmação destrutiva e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 16. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Manual | compromisso pagar/receber publica atomicamente com contraparte e parcelas válidas |
| DF-e | cobrança estruturada gera proposta idempotente; DF-e sem cobrança, cancelado ou ambíguo não gera |
| Tributário | somente guia/apuração aprovada e elegível gera proposta a pagar |
| Revisão | alteração de valor ou vencimento exige justificativa e preserva a origem |
| Parcelas | soma fecha o compromisso em centavos; cada parcela mantém saldo e situação próprios |
| Baixa | total, parcial, múltipla, juros, multa e desconto atualizam saldo sem float |
| Correção | estorno recompõe saldo; cancelamento preserva histórico e não apaga eventos |
| Autorização | auxiliar prepara; gestor/admin publicam e baixam; contador e auditor consultam |
| Banco de dados | RLS, carteira, atomicidade, idempotência, concorrência e append-only |
| UI | dois temas, quatro viewports, estados, teclado, foco, contraste e acabamento |

## 17. Provas exigidas

- testes de regras para soma de parcelas, transições, saldo, baixa, desconto, estorno e condição de vencido;
- testes negativos para valor zero/negativo, baixa acima do saldo, parcela inconsistente e transição proibida;
- testes de elegibilidade para DF-e com e sem cobrança estruturada, cancelamento, devolução, remessa e ambiguidade;
- integração com F36–F38 e F63–F66 para aprovação, vigência, dependência e origem superada;
- testes de banco para RLS, carteira, segregação, atomicidade, idempotência, concorrência e auditoria;
- testes de autorização por papel e tentativa fora da carteira;
- E2E de título manual e de proposta interna até publicação, baixa parcial, quitação e estorno;
- prova visual nos dois temas e quatro viewports.

## 18. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Importação de boleto PDF e linha digitável | fatia própria de importação de boletos no MVP-2 |
| CNAB 240/400 para boletos e folha | fatia própria de CNAB no MVP-2 |
| Aging e fluxo de caixa 30/60/90 | fatia própria de aging e fluxo projetado no MVP-2 |
| Cadastro mestre e deduplicação de clientes/fornecedores | fatia própria de contrapartes financeiras no MVP-2 |
| Recorrência automática de títulos | fatia própria de recorrência financeira no MVP-2 |
| Open Finance, consentimento, contas, saldos e webhooks | fatia própria de Open Finance no MVP-2 |
| ITP e autorização final no banco | fatia própria de ITP no MVP-2 |
| Cobrança e baixa Pix | fatia própria de Pix via PSP/BaaS no MVP-2 |
| Auto-match, pesos, embeddings, LLM e fila financeira | fatia própria de conciliação multi-critério e Agente Conciliador no MVP-2 |
| Lançamento contábil automático de título ou baixa | fatia própria de integração financeiro-contábil no MVP-2 |
| Edição de DF-e, guia ou apuração | capacidade de origem correspondente |
| Pagamento, transmissão, protocolo ou efeito externo | capacidades próprias; produção após o MVP-4 |

## 19. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F68/SPEC-068? | núcleo de contas a pagar e receber |
| Quais origens internas entram? | DF-e com cobrança estruturada e guias/apurações aprovadas |
| A origem publica automaticamente? | não; produz rascunho idempotente com revisão humana |
| Valor ou prazo da origem pode mudar? | sim, somente no título e com justificativa, preservando o original |
| Como representar contraparte? | snapshot de nome e CPF/CNPJ, sem cadastro mestre nesta fatia |
| Há parcelamento? | sim; parcelas explícitas com vencimento, saldo e situação próprios |
| Qual baixa entra? | manual total ou parcial, com múltiplos eventos |
| Como tratar juros, multa e desconto? | campos separados, informados e auditados, sem cálculo automático |
| Como corrigir? | cancelamento e estorno por eventos reversíveis; nunca edição destrutiva |
| Quem executa? | gestor financeiro e admin; auxiliar prepara; contador consulta |
| Todo DF-e autorizado gera título? | não; somente cobrança estruturada suportada |
| Qual tamanho? | Grande, mantendo núcleo, origens, baixa e UI na mesma vertical |
| Há questões abertas? | Nenhuma |

## 20. Gate de conformidade documental

- **Identidade:** F68/SPEC-068, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** título, proposta, revisão, parcela, baixa, estorno e cancelamento são observáveis.
- **Aceite:** regras, integrações, banco, autorização, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1 a I-7, I-9, I-11 e I-12 aplicáveis estão declarados.
- **Limites:** não há boleto, CNAB, aging, fluxo, Open Finance, Pix, conciliação ou efeito externo.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade e MVP obrigatórios.
- **UI:** referência, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Grande; núcleo, origens internas, baixa e prova vertical permanecem atômicos.

## 21. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
