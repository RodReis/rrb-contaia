# SPEC-075 — Validação de DARF numerado e integração com pagamentos BB

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F75
> **Issue:** [#89](https://github.com/RodReis/rrb-contaia/issues/89), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 9.1, 10.4, 12, 13.2, 14, 15 e 16; recorte aprovado pelo PI em 30/09/2026
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 30/09/2026

## 1. Objetivo e comportamento observável

Receber, conferir e validar localmente DARF numerado emitido externamente pela DCTFWeb ou SicalcWeb, preservar sua evidência e vincular uma guia a uma única parcela a pagar F68 e ao documento F69 correspondente. Encaminhar somente documentos elegíveis ao fluxo de pagamentos BB CNAB 240 da F72, sem duplicar remessa, retorno ou proposta de baixa.

Em Financeiro, o usuário seleciona empresa, anexa a guia, declara a origem DCTFWeb/SicalcWeb, confere os campos, confirma o vínculo e consulta cobertura bancária, impedimentos e histórico. Conferência local não autentica o documento na Receita nem comprova exigibilidade, declaração transmitida ou quitação.

A fatia é Grande porque reúne validação documental específica, vínculo versionado e integração com o fluxo financeiro existente, incluindo provas negativas e UI. Não é uma nova implementação do ciclo bancário.

## 2. Entradas, autoridades e vínculo

Aceitar PDF textual com pré-preenchimento ou entrada estruturada manual com guia externa anexada e legível. Em ambos os caminhos, conferência e confirmação humanas são obrigatórias. Não executar OCR nem preencher silenciosamente campos desconhecidos.

Preservar original, hash, origem declarada, número do documento, contribuinte, vencimento, valor, representação de pagamento e demais campos obrigatórios comprovados pelo modelo oficial. Preservar competência/período e composição tributária quando presentes, sem recalcular ou inferir uma receita única para guia composta. Não identificar origem apenas pelo nome do arquivo.

F68 permanece autoridade para título, parcela, publicação, saldo e baixa. F69 permanece autoridade para representação canônica de arrecadação, dígitos verificadores, evidência e vínculo documental. F75 acrescenta a conferência específica do DARF numerado e suas referências versionadas, sem criar título, guia oficial ou segunda representação canônica. Uma importação já existente na F69 deve ser reutilizada por referência, preservando sua evidência.

Exigir parcela F68 publicada, a pagar, com saldo positivo, e documento F69 validado e confirmado para a mesma empresa/parcela. Valor validado da guia = valor validado F69 = saldo aberto F68, em centavos. Contribuinte, empresa e documento precisam ter correspondência resolvida deterministicamente segundo os contratos existentes; caso não comprovado fica bloqueado, sem inferir equivalência matriz/filial.

Guia ilegível, número obrigatório ausente, identidade divergente, campo obrigatório desconhecido, valor divergente, duplicidade inequívoca, origem superada ou guia vencida impedem elegibilidade. Não substituir automaticamente documento ou vínculo, nem alterar saldo F68 para acomodar a guia.

## 3. Cobertura oficial e integração F72

Fontes oficiais iniciais consultadas em 30/09/2026:
- [RFB — Perguntas e Respostas DCTFWeb, fevereiro/2025](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/DCTFWeb/arquivos/perguntas-e-respostas-dctfweb-2025-04-28.pdf), incluindo DARF numerado, composição e distinção de guias SicalcWeb.
- [BB — Arquivo de Pagamentos, Particularidades CNAB 240, julho/2019](https://bb.com.br/docs/pub/emp/empl/dwn/PgtVer03BB.pdf).

Esses documentos não comprovam habilitação operacional irrestrita de DARF numerado em qualquer perfil BB. Manter cobertura versionada por origem/modelo documental e por modalidade bancária, perfil, versão, segmento e ocorrência, com URL, título, versão, consulta, hash, vigência identificada e fixtures aprovadas. Evidência ausente, contraditória ou incompatível resulta em INDETERMINATE: registrar causa e bloquear o encaminhamento/operação afetada.

Usar exclusivamente o canal de tributos com código de barras da F72, segmento O, quando sua cobertura específica estiver comprovada. Não adaptar DARF numerado ao segmento N da F74, nem usar número do documento como substituto do código de barras. Guia sem representação coberta permanece bloqueada.

A interface interna entrega à F72 as referências e versões F75/F69/F68 e o resultado da elegibilidade. Preparação e geração revalidam esse resultado no servidor. Mudança de guia, campos, vínculo, parcela ou cobertura exige nova conferência e aprovação; arquivo já gerado permanece imutável, com divergência auditável.

Herdar da F72 data civil explícita por item, bloqueio de pagamento posterior ao vencimento, segregação de preparação/aprovação, snapshot congelado, reserva única de tentativa, geração transacional e idempotente, manifesto, download estável, retorno determinístico e reenvio somente após rejeição confirmada. A validação F75 não contorna reservas já existentes na F72.

Aceitação/agendamento não baixam F68. Somente efetivação correspondente gera proposta idempotente de baixa para confirmação humana segregada na F68. Rejeitar proposta não apaga o fato bancário nem libera nova tentativa. Não criar liquidação própria na F75.

## 4. Invariantes globais tocados

| Invariante de CONVENTION.md §2 | Aplicação |
|---|---|
| I-1 e I-2 | Evidências, validações e vínculos com tenant/empresa; RLS, carteira e contexto obrigatórios no servidor; sem contexto não retorna dados |
| I-3 | Comparações de guia, documento e saldo exclusivamente em centavos inteiros |
| I-4 | Sem cálculo por LLM; extração e validação não apuram nem atualizam tributos |
| I-5 | Conferência humana registrada; aprovação e confirmação financeira herdadas de F72/F68 |
| I-6 e I-7 | Original e revisões preservados; trilha append-only; não apagar evidência financeira |
| I-8 | Pacotes documentais/técnicos respeitam sua vigência comprovada, sem presumir validade pela data de consulta |
| I-9 | Integração local idempotente e reserva compartilhada F72; não produzir efeito externo nesta fatia |
| I-11 | Vencimento/data solicitada como datas civis; instantes auditáveis e exibição America/Sao_Paulo |
| I-12 | Não recalcular nem alterar períodos fechados; consumo de referências preservadas |

Registrar importação, conferência, vínculo, bloqueio, revisão e encaminhamento com ator, tenant, empresa, instante, correlationId, origens, versões e resultado. Erros com código estável e application/problem+json conforme o contrato existente. I-10 não é acionado: sem certificado, cofre ou assinatura nesta fatia.

## 5. Interface

Ampliar o detalhe documental na gestão financeira. Referências concretas de conteúdo/fluxo: docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/code.html e screen.png; protótipo navegável em docs/telas/prototipo/index.html. Contratos de aparência/comportamento: docs/FRONTEND.md, docs/DESIGN-SYSTEM.md e docs/design-system/.

Exibir origem DCTFWeb/SicalcWeb, número do DARF, original, campos/composição presentes, comparação guia–F69–F68, vínculo único, conferência, cobertura, impedimentos e histórico; acesso aos artefatos/retornos/propostas no fluxo F72 existente. Não apresentar validação local como autenticação oficial.

Provar CLARO/ESCURO, 375/768/1280/1536 px, teclado, foco, contraste, zoom e estados vazio, carregando, erro, guia ilegível, divergente, vencida, duplicada, origem superada, pendente de conferência, validada, INDETERMINATE e acesso negado; estados bancários permanecem F72. Aplicar frontend-design antes/durante a implementação, impeccable no acabamento e protocolo completo FRONTEND.md §20.1.

## 6. Critérios de aceite e provas

1. DCTFWeb e SicalcWeb: fixtures aprovadas por modelo/origem, extração textual e preenchimento manual com anexo, conferência obrigatória e preservação de original/hash/campos/composição.
2. Guia–F69–F68: vínculo a uma única parcela publicada; identidade e valor exatos; divergências e campos desconhecidos bloqueados sem corrigir fontes.
3. Bloqueios: guia ilegível, vencida, origem superada, duplicidade, ausência de representação coberta e cobertura INDETERMINATE; não gerar segmento N como alternativa.
4. Integração: encaminhamento por referência/versão para F72; mudança de origem invalida elegibilidade; concorrência e nova importação não burlam reserva nem duplicam documento/pagamento.
5. Retorno: rejeição, agendamento, efetivação e conflito segundo F72; agendamento sem baixa, efetivação com proposta única, confirmação segregada e rejeição da proposta sem liberar nova tentativa.
6. RLS/carteira, consulta sem contexto, auditoria append-only e papéis conforme contratos F68/F69/F72.
7. Regras, banco, tela, E2E e prova visual dos dois temas conforme docs/TESTING.md, com evidência por SPEC/issue. Ausência de manual/fixture compatível é not_run para a modalidade afetada, nunca PASS.

## 7. Fora de escopo e destino dos complementos

| O que não entra | Destino nominal e gatilho |
|---|---|
| Emissão, consulta/autenticação RFB, transmissão DCTFWeb, compensação ou ajuste SISTAD | MVP-2: integração tributária RFB/DCTFWeb própria; contrato, fonte e aprovação do PI |
| DARF numerado sem código de barras e outras guias | MVP-2: complementos de pagamentos tributários BB; modalidade/canal e cobertura oficial aprovados |
| Distribuição de uma guia entre várias parcelas | MVP-2: rateio financeiro de guia composta; contrato de distribuição e baixas aprovado |
| OCR | MVP-2: OCR financeiro; cobertura e revisão aprovadas |
| Juros, multa, desconto e atualização | MVP-2: atualização financeira de guias; fontes e regras aprovadas |
| Títulos avulsos e origens adicionais | MVP-2: origens financeiras; contrato aprovado |
| Transmissão/consulta bancária, outros bancos | MVP-2: integração bancária própria; contrato/parceiro aprovado; produção após MVP-4 e gate |
| Conciliação e contabilização automática | MVP-2: conciliação e integração financeiro-contábil; contratos aprovados |

## 8. Decisões do PI e gate documental

PI aprovou em 30/09/2026: validação específica e integração F72; origem externa DCTFWeb e SicalcWeb; PDF textual ou entrada manual com anexo e conferência; vínculo único F68/F69; valores exatos; cobertura específica obrigatória; sem emissão, consulta RFB, OCR, acréscimos, transmissão ou rateio entre parcelas. Desenvolvimento e homologação em Docker local, sem produção durante MVPs 1–4.

Questões abertas: **Nenhuma**. Conferência documental: identidade, comportamento, aceite enumerado, invariantes I-n, fora de escopo com destinos, decisões do PI e UI com referências concretas presentes. A aprovação documental não comprova implementação, cobertura bancária habilitada ou testes de aplicação executados.
