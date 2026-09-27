# SPEC-069 — Importação de boletos por PDF e linha digitável

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F69
> **Origem:** PRD §§3, 5.3, 6.5, 7.1, 9.1, 10.4, 12, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Importar boleto de cobrança bancária ou de arrecadação por PDF textual, código de barras ou linha digitável, validar deterministicamente sua representação, preservar a evidência original e vinculá-lo a um título compatível da F68 ou criar proposta financeira revisável.

A F69 transforma o boleto em evidência financeira interna sem publicar título automaticamente, consultar banco, verificar registro externo, iniciar pagamento, liquidar parcela ou produzir efeito bancário, fiscal ou contábil.

## 2. Resultado observável

Em `Financeiro -> Importação de boletos`, o usuário pode:

- selecionar empresa e direção financeira, a pagar ou a receber;
- enviar um PDF com camada textual ou informar código de barras ou linha digitável;
- revisar banco ou segmento, valor, vencimento, pagador, beneficiário e contraparte extraídos;
- completar os dados obrigatórios que não estiverem codificados na entrada;
- visualizar falhas de formato, dígito verificador, multiplicidade ou divergência;
- vincular o boleto a um título F68 quando houver correspondência inequívoca;
- criar proposta revisável quando não existir título compatível;
- resolver pendência de boleto vencido, sem valor, sem vencimento ou com dados divergentes;
- consultar o PDF original, o hash, a representação canônica, o vínculo e a trilha de revisão.

Importar não significa pagar, baixar, registrar ou confirmar externamente o boleto.

## 3. Dependências e autoridades

| Fonte | Autoridade consumida |
|---|---|
| F2/F3 | empresa, CNPJ e situação cadastral |
| F7–F10 | usuário, papel, carteira, isolamento e RLS |
| F24 | auditoria append-only e evidência íntegra |
| F68 | compromisso, parcela, contraparte em snapshot, proposta, publicação e saldo financeiro |
| F69 | arquivo original, representação canônica, validação, extração e vínculo do boleto |

O boleto é autoridade somente para o conteúdo documental preservado. A F68 continua autoridade para existência, direção, publicação, parcelas, saldo e ciclo do compromisso financeiro. Divergência não altera silenciosamente nenhuma das fontes.

## 4. Entradas suportadas

### 4.1 Cobrança bancária

A F69 aceita código de barras de 44 dígitos e linha digitável de 47 dígitos, com conversão bidirecional canônica e validação dos campos e dígitos verificadores aplicáveis.

### 4.2 Arrecadação e convênio

A F69 aceita código de barras de 44 dígitos e linha digitável de 48 dígitos, preservando a identificação de segmento, referência de valor efetivo ou quantidade e algoritmos de dígito verificador indicados na própria representação.

### 4.3 PDF textual

O PDF precisa conter camada textual e exatamente um boleto inequívoco. A extração pode usar código de barras, linha digitável e texto circundante, mas só conclui quando existir uma representação canônica única e válida.

PDF escaneado, somente imagem, protegido, criptografado, corrompido ou com mais de um código candidato não é interpretado por aproximação. O usuário recebe pendência objetiva para informar a linha manualmente ou separar e reenviar um boleto por tentativa.

### 4.4 Entrada manual

Código ou linha informados manualmente exigem empresa, direção e contraparte no contexto. O usuário confirma pagador e beneficiário quando a representação não os contiver. Busca por valor e vencimento pode apresentar candidatos, mas nunca infere identidade nem escolhe título sozinha.

## 5. Validação determinística

A validação remove apenas caracteres de apresentação permitidos e rejeita letras, comprimento incorreto, dígito verificador inválido, conversão inconsistente ou estrutura incompatível com o tipo declarado.

Valor e vencimento codificados são extraídos quando a estrutura os fornecer. Fator de vencimento, segmentos e algoritmos seguem pacote técnico versionado, com fonte, versão, vigência, data de consulta e hash. Regra ausente, conflitante ou fora da cobertura produz `INDETERMINATE`, nunca uma interpretação provável.

LLM não lê código, não corrige dígito, não escolhe tipo, não calcula vencimento e não decide vínculo.

## 6. Evidência e extração

`PaymentSlipEvidence` preserva tenant, empresa, direção, tipo, origem da entrada, representação canônica, hash estável, situação e autoria.

`PaymentSlipArtifact` preserva o PDF original imutável, seu hash, tamanho, tipo de mídia e referência de armazenamento local. Entrada manual não inventa arquivo: preserva a representação canônica e o evento de autoria.

`PaymentSlipExtraction` preserva versão do extrator, pacote técnico, campos extraídos, origem de cada campo, avisos e resultado da validação. Nova versão cria nova extração vinculada; não reescreve a anterior.

Dados declarados pelo usuário, extraídos do documento e existentes na F68 permanecem identificáveis e comparáveis. Correção cria nova revisão ou declaração auditada, nunca alteração invisível da evidência.

## 7. Identidade e idempotência

A identidade documental considera tenant, empresa, direção, tipo e representação canônica. Reimportar a mesma identidade retorna a evidência existente e não duplica arquivo lógico, vínculo ou proposta.

Mesmo código sob empresa ou direção diferente não é fundido automaticamente. Mesmo PDF com representação canônica diferente é conflito. Arquivo diferente com a mesma representação é anexado como ocorrência auditável da evidência existente, sem gerar novo efeito financeiro.

Conteúdo divergente sob a mesma chave idempotente retorna conflito HTTP 409 com código estável e `correlationId`.

## 8. Correspondência com a F68

A correspondência determinística considera, quando disponíveis, empresa, direção, contraparte, CPF/CNPJ, valor, vencimento e referência documental. Somente um candidato compatível e sem divergência material pode ser vinculado após confirmação humana.

Os resultados possíveis são:

- `UNIQUE_MATCH`: um título ou parcela compatível, apresentado para confirmação e vínculo;
- `NO_MATCH`: nenhuma correspondência; cria proposta F68 revisável com os dados disponíveis;
- `MULTIPLE_MATCHES`: mais de um candidato; permanece pendente até escolha humana justificada;
- `CONFLICT`: identidade, direção, valor ou vencimento contradiz o candidato; permanece pendente;
- `INDETERMINATE`: dados ou regra insuficientes; não cria nem vincula obrigação.

Correspondência não publica título. Quando `NO_MATCH`, a proposta segue o ciclo e a segregação da F68. Quando houver escolha entre candidatos, a decisão e o motivo ficam auditados.

## 9. Valor, vencimento e exceções

Boleto vencido ou sem valor codificado pode ser preservado, mas fica pendente. A F69 não calcula valor atualizado, juros, multa, desconto, encargos ou nova data.

Valor ou vencimento ausente precisa ser informado e confirmado antes de criar proposta. Valor ou vencimento divergente de título existente não sobrescreve a F68: a tela apresenta ambos e exige resolução justificada.

Vencimento é data civil. A condição de vencido é derivada da data de referência recebida pela função de domínio, sem relógio oculto.

## 10. Ciclo da importação

Estados persistidos da evidência:

`RECEIVED -> VALIDATING -> PENDING_REVIEW -> LINKED | PROPOSAL_CREATED`

Transições alternativas:

- `RECEIVED | VALIDATING -> INVALID` para estrutura ou arquivo inválido;
- `PENDING_REVIEW -> REJECTED` com motivo;
- nova extração ou correção gera revisão relacionada, sem apagar a anterior.

Falha de extração não cria proposta parcial. Vínculo e criação de proposta são atômicos e idempotentes.

## 11. Autorização e segregação

- `auxiliar`: importa, completa dados e prepara revisão dentro da carteira; não confirma vínculo nem cria proposta final;
- `gestor_financeiro`: revisa, confirma vínculo, cria ou rejeita proposta dentro da carteira, desde que não tenha preparado a importação;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação entre preparação e aprovação;
- `contador`: consulta evidência, extração, vínculo e histórico; não executa ação financeira na F69;
- `auditor_readonly`: consulta e exporta evidência, sem mutação;
- `cliente_portal` e papéis sem permissão: acesso negado;
- `super-admin` local: mantém infraestrutura, sem decidir boleto empresarial.

Quem preparou uma importação não confirma seu vínculo nem cria a proposta correspondente.

## 12. Isolamento, concorrência e falhas

- entidades carregam `tenant_id` e `empresa_id`, índices e RLS;
- toda consulta valida empresa e carteira no servidor;
- revisão usa versão otimista e retorna HTTP 409 em conflito;
- arquivo, extração e evidência são persistidos atomicamente ou permanecem sem efeito financeiro;
- retentativa segura não duplica evidência, proposta ou vínculo;
- falha preserva o último estado íntegro e permite reprocessamento explícito;
- erro segue `application/problem+json` com código estável e `correlationId`.

## 13. Auditoria

Upload, entrada manual, validação, extração, declaração do usuário, reprocessamento, vínculo, seleção entre candidatos, criação de proposta, rejeição, consulta do original, exportação e tentativa negada geram evento append-only.

Cada evento registra tenant, empresa, evidência, autor, papel, instante, `correlationId`, versão, resultado, motivo e referências F68. Arquivo, extração e decisão não são apagados fisicamente.

## 14. Invariantes globais tocados

| Invariante | Aplicação na F69 |
|---|---|
| I-1 | evidência, arquivo, extração, vínculo e eventos carregam tenant e empresa, índices e RLS |
| I-2 | consulta sem empresa e carteira não retorna documento financeiro |
| I-3 | valor é inteiro em centavos; nenhuma leitura usa float |
| I-4 | validação, conversão, vencimento e correspondência são determinísticos; LLM não decide |
| I-5 | vínculo, escolha entre candidatos e criação de proposta exigem revisão humana segregada |
| I-6 | evidência, extrações e decisões preservam histórico append-only |
| I-7 | PDF, representação, extração e vínculo confirmados não são apagados nem reescritos |
| I-9 | importação, reprocessamento, vínculo e proposta são idempotentes |
| I-11 | vencimento é data civil; timestamps exibem `America/Sao_Paulo` |
| I-12 | mesma entrada, pacote técnico e data de referência reproduzem validação e candidatos |

## 15. Contrato de UI

A UI usa `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/` para conteúdo, hierarquia e densidade, limitada nesta fatia à entrada documental e integração com `Contas a Pagar & Aging` e `Contas a Receber & Pix BaaS`. Aging, Pix, Open Finance, conciliação e pagamento aparecem somente como destinos indisponíveis.

A tela apresenta seleção de empresa e direção, abas PDF e linha digitável, área de upload, entrada formatada, pré-visualização, validações, comparação entre extraído/declarado/F68, candidatos, resolução de pendências, confirmação de vínculo, criação de proposta e histórico.

Estados obrigatórios: carregando, vazio, enviando, validando, válido, inválido, PDF sem texto, múltiplos códigos, vencido, sem valor, sem vencimento, candidato único, nenhum candidato, múltiplos candidatos, conflito, `INDETERMINATE`, vinculado, proposta criada, rejeitado, erro recuperável, conflito de versão e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco, semântica, contraste, máscara legível sem alterar a representação canônica, confirmação e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 16. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Cobrança | código 44 e linha 47 convertem entre si, validam dígitos e extraem campos reproduzíveis |
| Arrecadação | código 44 e linha 48 validam segmento, referência e dígitos aplicáveis |
| PDF | um boleto textual válido gera original com hash e extração versionada |
| Multiplicidade | PDF com zero ou mais de um código não escolhe por aproximação nem cria proposta |
| Manual | linha exige empresa, direção e contraparte explícitas quando não codificadas |
| Exceções | vencido, sem valor ou sem vencimento fica pendente e não recebe cálculo inventado |
| Correspondência | candidato único pode ser vinculado; zero cria proposta; múltiplos ou conflito exigem decisão |
| Idempotência | reimportação não duplica evidência, vínculo ou proposta |
| Autorização | auxiliar prepara; gestor/admin revisam; contador e auditor consultam |
| Banco de dados | RLS, carteira, atomicidade, concorrência e append-only são provados |
| UI | dois temas, quatro viewports, estados, teclado, foco, contraste e acabamento |
| Efeito | nenhuma entrada publica título, baixa parcela, paga boleto ou cria efeito externo |

## 17. Provas exigidas

- testes parametrizados de formatos, conversões e dígitos verificadores de cobrança e arrecadação;
- testes de fator de vencimento, valor ausente, vencido, caracteres inválidos e cobertura `INDETERMINATE`;
- testes de PDF textual válido, sem texto, protegido, corrompido, sem código e com múltiplos códigos;
- testes de hash, extração versionada, idempotência, conflito e reprocessamento;
- testes de correspondência para candidato único, nenhum, múltiplos, contraparte divergente, valor e vencimento divergentes;
- testes de banco para RLS, carteira, segregação, atomicidade, concorrência e auditoria;
- E2E de PDF até vínculo e de linha manual até proposta F68, sem publicação automática;
- prova visual nos dois temas e quatro viewports.

## 18. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| OCR de PDF escaneado ou imagem | fatia própria de captura documental financeira no MVP-2 |
| Mais de um boleto por tentativa | importações individuais da própria F69; lote fica na fatia de CNAB |
| Consulta, registro ou confirmação externa do boleto | fatia própria de integração bancária no MVP-2 |
| CNAB 240/400 para boletos e folha | fatia própria de CNAB no MVP-2 |
| Aging e fluxo de caixa 30/60/90 | fatia própria de aging e fluxo projetado no MVP-2 |
| Atualização de boleto, juros, multa e desconto | fatia própria de atualização financeira no MVP-2 |
| Open Finance, contas, saldos e webhooks | fatia própria de Open Finance no MVP-2 |
| ITP, pagamento e autorização final no banco | fatia própria de ITP no MVP-2 |
| QR Code, boleto híbrido, cobrança e baixa Pix | fatia própria de Pix via PSP/BaaS no MVP-2 |
| Auto-match probabilístico, embeddings e LLM | fatia própria de conciliação e Agente Conciliador no MVP-2 |
| Baixa financeira e lançamento contábil automáticos | fatias próprias de conciliação e integração financeiro-contábil no MVP-2 |
| Produção, storage externo ou credenciais bancárias reais | etapa de produção posterior ao MVP-4 |

## 19. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F69/SPEC-069? | importação de boleto por PDF e linha digitável |
| Qual efeito financeiro? | vincular título compatível ou criar proposta revisável; nunca publicar automaticamente |
| Quais tipos? | cobrança bancária e arrecadação/convênio; Pix fica fora |
| Qual PDF? | somente PDF com camada textual; linha manual cobre documento escaneado sem OCR |
| Quais direções? | contas a pagar e a receber |
| Como tratar linha sem identidade? | empresa, direção e contraparte são contexto obrigatório |
| O original é preservado? | sim; PDF imutável com hash e extração versionada |
| Como tratar vencido ou sem valor? | importar como pendência, sem calcular atualização |
| Quantos boletos por PDF? | exatamente um por tentativa; multiplicidade não é escolhida pelo parser |
| Há questões abertas? | Nenhuma |

## 20. Gate de conformidade documental

- **Identidade:** F69/SPEC-069, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** importação, validação, evidência, correspondência, vínculo e proposta são observáveis.
- **Aceite:** regras, arquivos, integração F68, banco, autorização, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1 a I-7, I-9, I-11 e I-12 aplicáveis estão declarados.
- **Limites:** não há OCR, CNAB, Pix, pagamento, baixa, atualização ou efeito externo.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade e MVP obrigatórios.
- **UI:** referência, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Grande; validação, evidência, vínculo/proposta e UI formam uma vertical observável e não devem ser partidos por camada.

## 21. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
