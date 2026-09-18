# SPEC-020 / F20 — Classificação de risco e proposta de manifestação

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§2, 3, 5.2, 5.4, 10.1, 10.2, 12, 14, 15, 16 e Anexo A.1
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e delimitada — entrega configuração mínima, classificação híbrida e proposta auditável; inbox, HITL e transmissão ficam na F21 / SPEC-021
>
> **Ambiente:** Docker local, com modelos dublados ou locais e dados de teste; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #22

## 1. Objetivo

Analisar NF-e modelo 55 normalizada pela F18 e produzir uma proposta versionada, explicável e auditável para a futura manifestação conclusiva, usando sinais determinísticos e LLM somente na ambiguidade.

Sucesso significa obter `tipo_manifestacao`, confiança, justificativa, riscos e evidências sem transmitir ato fiscal, sem converter ausência de dados em certeza e sem misturar informações entre empresas.

## 2. Fronteira da fatia

Esta fatia entrega:

- configuração mínima por empresa de fornecedores aprovados e limite monetário;
- extração determinística de sinais do XML normalizado e do histórico de compras dos últimos 12 meses;
- classificação híbrida com fallback seguro;
- proposta de `210200`, `210220`, `210240` ou `ABSTER_SE`;
- persistência append-only das análises, versões, evidências e custos;
- reprocessamento idempotente por versão do classificador;
- painel técnico para configurar regras e inspecionar análises.

A F20 não cria inbox operacional, não aprova nem rejeita proposta, não coleta a justificativa formal de `210240`, não assina e não transmite manifestação conclusiva.

## 3. Comportamento esperado

### 3.1 Elegibilidade

É elegível a NF-e que cumulativamente:

- é modelo 55 e pertence à empresa destinatária;
- possui XML completo normalizado e hash válido pela F18;
- não está cancelada, denegada, impedida ou com inconsistência documental aberta;
- não possui manifestação conclusiva conhecida;
- ainda não possui análise vigente para a mesma versão do documento e do classificador.

CT-e, NFS-e, resumo `resNFe`, XML inválido, documento de outra empresa e NF-e já manifestada não são classificados. O motivo da inelegibilidade fica auditável.

### 3.2 Configuração mínima por empresa

`admin_escritorio` e `contador` da carteira podem manter:

- CNPJ e nome de exibição dos fornecedores aprovados;
- limite monetário por operação, armazenado em centavos;
- vigência da configuração;
- motivo da inclusão, alteração, arquivamento ou reativação.

`auxiliar` consulta, mas não altera a configuração. `auditor_readonly` possui somente leitura. Não há exclusão física; toda mudança gera nova versão e trilha.

Ausência de fornecedor aprovado ou limite configurado é dado ausente, não sinal automático de fraude. A análise informa a lacuna e reduz a confiança quando ela for relevante.

### 3.3 Entradas e sinais

O classificador recebe somente referências e dados sanitizados:

- emitente, CNPJ, valor total, itens, NCM, CFOP e datas da NF-e;
- recorrência, frequência, faixa de valores e última compra do emitente nos 12 meses anteriores;
- fornecedor aprovado e limite vigentes na data da análise;
- eventos, impedimentos e qualidade do parse disponíveis;
- versões das regras, do prompt, do schema e do modelo.

Regras determinísticas produzem sinais objetivos. O LLM recebe o conjunto mínimo necessário apenas quando regras não forem suficientes para uma proposta clara; nunca recebe segredo, certificado ou XML bruto sem necessidade.

### 3.4 Saída fechada

A saída validada por schema contém:

```json
{
  "tipo_manifestacao": "210200 | 210220 | 210240 | ABSTER_SE",
  "confianca": 0.0,
  "justificativa": "explicação curta e verificável",
  "riscos": [
    { "codigo": "RISCO_ESTAVEL", "severidade": "baixa | media | alta", "evidencias": ["referência"] }
  ],
  "evidencias": ["referências aos sinais usados"],
  "lacunas": ["dados ausentes relevantes"]
}
```

O score mede confiança na sugestão, não risco da nota:

- `confianca >= 0,85`: proposta pronta para futura revisão humana;
- `0,50 <= confianca < 0,85`: proposta com atenção;
- `confianca < 0,50`: alerta inconclusivo;
- conflito entre regras e LLM, falta de evidência rastreável ou schema inválido: `ABSTER_SE`.

Nenhuma faixa autoriza autoaprovação ou transmissão.

### 3.5 Semântica dos tipos

- `210200` indica evidências compatíveis com operação ocorrida como descrita;
- `210220` indica evidências compatíveis com operação não solicitada pela empresa;
- `210240` é sempre hipótese de participação reconhecida cuja operação pode não ter ocorrido ou se efetivado como descrita;
- `ABSTER_SE` indica que o sistema não possui base suficiente para recomendar um dos três atos.

A F20 nunca afirma como fato que uma operação não ocorreu. Para `210240`, a justificativa da proposta lista somente sinais e lacunas; o texto formal exigido pela Sefaz, com 15 a 255 caracteres, será informado e aprovado pelo humano na F21 / SPEC-021.

### 3.6 Idempotência, versão e reprocessamento

A identidade da análise usa tenant, empresa, documento, versão do documento e versão do classificador. Repetição ou concorrência reutiliza a mesma análise lógica.

Mudança nas regras da empresa, no classificador ou correção do documento pode solicitar reprocessamento. O resultado cria nova versão, preserva a anterior e informa por que ela deixou de ser vigente. Proposta consumida pela futura fila HITL não é alterada retroativamente.

### 3.7 Falhas e fallback

- indisponibilidade, timeout ou limite de custo do LLM aciona fallback determinístico;
- se as regras não sustentarem proposta, o resultado é `ABSTER_SE`;
- resposta inválida ou fora do schema é descartada e auditada, nunca corrigida por inferência silenciosa;
- erro transitório recebe no máximo três tentativas exponenciais;
- exaustão vai para DLQ e admite retomada técnica preservando tentativas;
- texto externo do XML é dado não confiável e não pode alterar instruções, ferramentas ou schema.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | configurações, análises, propostas, evidências e execuções carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | consulta, configuração e reprocessamento exigem empresa dentro da carteira |
| `I-4` | LLM não calcula tributo nem altera dado fiscal; apenas interpreta sinais para propor manifestação |
| `I-5` | proposta nunca executa ato jurídico; aprovação humana permanece obrigatória para os três tipos conclusivos |
| `I-6` | configuração, análise, tentativa, saída e mudança de vigência geram trilha append-only |
| `I-7` | análise e configuração são arquivadas/versionadas, nunca apagadas fisicamente |
| `I-9` | classificação e reprocessamento são idempotentes por identidade versionada |
| `I-11` | datas civis do documento são preservadas; instantes técnicos usam UTC e exibição `America/Sao_Paulo` |

## 5. Contrato de interface

### 5.1 Configuração

O painel permite listar, incluir, alterar, arquivar e reativar fornecedores aprovados e definir o limite monetário vigente. A interface mostra autor, vigência, motivo e versão, com confirmação antes de alteração efetiva.

### 5.2 Inspeção da análise

O detalhe documental mostra:

- tipo sugerido ou abstenção, sempre em linguagem não conclusiva;
- confiança numérica e faixa textual;
- riscos separados da confiança;
- justificativa, evidências, lacunas e histórico de versões;
- regras, prompt, schema e modelo utilizados;
- custo, duração, fallback, tentativas e `correlationId`;
- ação de reprocessamento técnico quando elegível.

Não existem botões de aprovar, rejeitar, manifestar ou transmitir.

### 5.3 Estados e prova visual

Estados obrigatórios: sem configuração, aguardando análise, analisando, proposta pronta, atenção, inconclusiva, abstenção, fallback determinístico, retry, DLQ, inelegível e acesso negado.

- temas CLARO e ESCURO completos;
- viewports de 768, 1024 e 1440 px;
- foco visível, navegação por teclado e mensagens que não dependem apenas de cor;
- valores, CNPJ, datas e feedback seguem `FRONTEND.md`;
- `frontend-design`, `gstack:design-review` e `impeccable` são obrigatórias conforme `FRONTEND.md` §20.1.

A referência concreta é `docs/telas/contaia_triagem_de_captura_df_e_inbox_de_manifesta_o_rf_02/`, limitada à densidade, filtros e inspeção. Botões de manifestação, aprovação em lote e os prazos incorretos de 30/45 dias do protótipo não são contrato.

## 6. Arquitetura e contratos públicos

```text
NF-e normalizada F18 ─▶ sinais determinísticos ─┬─▶ proposta validada ─▶ persistência versionada
                                                │
                                                └─▶ LLM na ambiguidade
                                                         │
                                              fallback determinístico / abstenção
```

O domínio não conhece provedor de modelo. A porta de classificação recebe contexto sanitizado e devolve saída estruturada; o adaptador valida schema, custo e limites antes de publicar resultado.

Endpoints mínimos:

```text
GET    /companies/:companyId/fiscal-risk-settings
PUT    /companies/:companyId/fiscal-risk-settings
GET    /companies/:companyId/approved-suppliers
POST   /companies/:companyId/approved-suppliers
PATCH  /companies/:companyId/approved-suppliers/:supplierId
GET    /companies/:companyId/fiscal-documents/:documentId/risk-analyses
GET    /companies/:companyId/fiscal-documents/:documentId/risk-analyses/:analysisId
POST   /companies/:companyId/fiscal-documents/:documentId/risk-analyses/reprocessing
```

Erros usam `application/problem+json`. Códigos estáveis mínimos:

- `FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE`;
- `FISCAL_RISK_CONFIGURATION_INVALID`;
- `FISCAL_RISK_OUTPUT_INVALID`;
- `FISCAL_RISK_EVIDENCE_INSUFFICIENT`;
- `FISCAL_RISK_PROVIDER_UNAVAILABLE`;
- `FISCAL_RISK_RETRY_EXHAUSTED`;
- `FISCAL_RISK_REPROCESS_ALREADY_QUEUED`;
- `FISCAL_RISK_ACCESS_DENIED`.

## 7. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | elegibilidade, fornecedor aprovado, limite, histórico de 12 meses, faixas e abstenção |
| Schema | quatro saídas permitidas, confiança limitada, riscos/evidências tipados e rejeição de campo inválido |
| Híbrido | caso claro sem LLM, ambiguidade com LLM e conflito convertido em abstenção |
| Segurança | prompt injection no XML não altera instruções; segredo sentinela não chega ao modelo nem ao log |
| Idempotência | repetição, concorrência, mudança de versão e reprocessamento preservando histórico |
| Banco | RLS, append-only, dinheiro em centavos, vigência e arquivamento sem exclusão |
| Autorização | contador/admin configuram; auxiliar e auditor somente consultam; outra carteira é negada |
| Resiliência | timeout, saída inválida, três tentativas, fallback, DLQ e retomada |
| Tela | todos os estados, configuração, detalhe, temas, viewports, teclado e foco |
| E2E | `NF-e parseada → sinais → classificação → proposta persistida`, integralmente em Docker local |
| Contrafactual | CT-e não classifica; dado ausente não vira fraude; score alto não transmite; `210240` não vira fato |

## 8. Critérios de aceite verificáveis

- [ ] Somente NF-e 55 completa, válida e ainda não manifestada entra na classificação.
- [ ] Fornecedores aprovados e limite são versionados por empresa, sem exclusão física e com dinheiro em centavos.
- [ ] Ausência de configuração aparece como lacuna e não é tratada automaticamente como fraude.
- [ ] Histórico usa somente os 12 meses anteriores da mesma empresa.
- [ ] Regras resolvem casos objetivos e LLM é chamado somente na ambiguidade.
- [ ] Toda saída obedece ao schema fechado ou resulta em `ABSTER_SE`.
- [ ] Confiança e risco são conceitos distintos na API, persistência e interface.
- [ ] `210240` é apresentado como hipótese e não contém justificativa formal pronta para transmissão.
- [ ] Nenhum score cria aprovação, assinatura ou transmissão.
- [ ] Repetição e concorrência não duplicam análise; nova versão preserva o resultado anterior.
- [ ] Falha do modelo usa fallback seguro; falta de evidência não gera sugestão silenciosa.
- [ ] Prompt injection, conteúdo externo e saída inválida não alteram ferramentas nem schema.
- [ ] Painel mostra configuração e análise nos dois temas e três viewports, sem ações de manifestação.
- [ ] RLS e carteira impedem leitura, configuração e reprocessamento entre empresas indevidas.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-020 e à issue.

## 9. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Inbox, filtros operacionais e priorização HITL | MVP-1 · F21 / SPEC-021 |
| Aprovação, rejeição, ação em lote e feedback humano | MVP-1 · F21 / SPEC-021 |
| Justificativa formal de `210240`, assinatura, transmissão, reconciliação, retry e protocolo Sefaz | MVP-1 · F21 / SPEC-021 |
| Agenda do prazo conclusivo e alertas D-3 | MVP-1 · capacidade de agenda mínima e alertas D-3 a numerar |
| Aprendizado automático com feedback e recalibração produtiva | MVP-2 · evolução dos agentes/classificadores |
| Classificação contábil, CFOP, conta e centro de custo | MVP-2 · Agente Classificador do PRD §10.3 |
| Provedor externo real, calibração e métricas produtivas | gates posteriores aplicáveis; produção somente após o MVP-4 |

## 10. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Decomposição | F20 classifica e propõe; inbox, HITL e transmissão ficam na F21 / SPEC-021 |
| Motor | híbrido: regras determinísticas e LLM somente na ambiguidade, com fallback seguro |
| Regras do cliente | configuração mínima de fornecedores aprovados e limite entra na F20 |
| Tipos | pode sugerir `210200`, `210220`, `210240` ou abster-se |
| Score | mede confiança da sugestão; risco é estrutura separada |
| `210240` | pode ser hipótese sugerida, mas a justificativa formal é humana e posterior |
| Automação | nenhum resultado aprova ou transmite manifestação conclusiva |
| Ambiente | Docker local; provedor real e produção ficam nos gates próprios |

**Questões abertas:** nenhuma.

## 11. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §§3 e 5 |
| Aceite verificável | §§7–8 |
| Invariantes tocados | §4 |
| Fora de escopo | §9 |
| Dúvidas resolvidas | §10; nenhuma aberta |
| Destino do complemento | §9 |
| Contrato de UI | §5, com referência concreta, estados, temas, viewports e provas |

## 12. Referências normativas

- PRD v3.1 §5.2 e §10.2: política HITL, faixas de confiança e contrato do Agente de Captura.
- Portal Nacional da NF-e, Nota Técnica 2020.001 v1.60: prazo conclusivo de 90 dias desde 01/06/2026.
- Schemas oficiais de Manifestação do Destinatário: tipos `210200`, `210220`, `210240` e justificativa de 15 a 255 caracteres exclusiva de `210240`.

## 13. Aprovação

Fronteira, configuração mínima, motor híbrido, tipos sugeridos, semântica do score, abstenção, fallback, interface, provas e destinos aprovados pelo PI em 18/09/2026.
