# SPEC-021 / F21 — Inbox, aprovação e transmissão de manifestações

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§2, 3, 5.2, 10.1, 10.2, 12, 13.1, 14, 15, 16, 20.2 e Anexo A.1
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e atômica — a decisão humana só produz resultado operacional quando o evento chega a aceite ou reconciliação na Sefaz
>
> **Ambiente:** Docker local, com certificado, Signer, Sefaz e respostas dublados; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #23

## 1. Objetivo

Entregar a inbox operacional de NF-e modelo 55 e concluir, sob aprovação humana registrada, o fluxo de manifestação conclusiva até aceite ou reconciliação com a Sefaz.

Sucesso significa permitir que um usuário com alçada revise a proposta da F20, mantenha ou altere o tipo, rejeite sem transmitir ou aprove o payload fiscal exato, com assinatura, idempotência, protocolo e tratamento explícito de incerteza.

## 2. Fronteira da fatia

Esta fatia entrega:

- inbox de manifestações conclusivas pendentes;
- filtros, busca e priorização operacional;
- decisão individual para `210200`, `210220` e `210240`;
- troca do tipo sugerido e rejeição humana com feedback auditável;
- texto formal humano para `210240`;
- aprovação em lote exclusivamente de `210200` para uma única empresa;
- aprovação e outbox persistidas atomicamente;
- payload fiscal selado e identidade idempotente;
- assinatura pelo Signer da F12;
- transmissão, reconciliação, retry seguro, DLQ e protocolo Sefaz;
- interface final mestre–detalhe e histórico operacional.

A F21 não implementa agenda ou alertas D-3, dashboard multiempresa, manifestação de CT-e, delegação ao comprador, cancelamento de manifestação ou integração produtiva.

## 3. Comportamento esperado

### 3.1 Elegibilidade

É acionável a NF-e que cumulativamente:

- pertence ao tenant e à empresa em contexto;
- é modelo 55 completa, válida e coerente com o destinatário;
- possui proposta vigente da F20;
- não está cancelada, inutilizada ou impedida por evento conhecido;
- não possui manifestação conclusiva aceita ou reconciliada;
- permanece dentro do prazo conclusivo vigente.

CT-e, `resNFe`, XML inválido, documento de outra empresa e NF-e já manifestada não oferecem ação. Se a condição mudar enquanto a tela estiver aberta, a validação no servidor prevalece e a decisão não é transmitida.

### 3.2 Priorização e consulta

A ordenação padrão da inbox é:

1. menor prazo restante;
2. maior risco;
3. maior valor total;
4. chave de acesso como desempate estável.

Na referência normativa vigente na aprovação desta SPEC, o prazo conclusivo é de 90 dias contados da autorização da NF-e. O prazo pode ser exibido e usado na prioridade, mas não cria nesta fatia alerta D-3, notificação ou obrigação de agenda. Mudança normativa exige atualização versionada da regra, sem reescrever decisões históricas.

Filtros mínimos:

- empresa;
- estado operacional;
- tipo proposto;
- faixa de confiança;
- risco;
- prazo restante;
- emitente;
- faixa de valor.

A busca aceita chave de acesso, CNPJ e razão social. Filtros, ordenação, paginação e item selecionado permanecem representáveis na URL.

### 3.3 Alçada e decisão individual

Somente `contador` e `admin_escritorio`, dentro da carteira vigente da empresa, aprovam manifestação conclusiva. `auxiliar` pode consultar e preparar a revisão, mas não aprova nem transmite. `auditor_readonly` e `cliente_portal` nunca alteram o estado.

O aprovador pode:

- manter o tipo proposto pela F20;
- trocar o tipo, registrando motivo obrigatório;
- rejeitar a proposta sem gerar evento fiscal.

Uma única aprovação de usuário com alçada basta mesmo quando o tipo é alterado. A trilha preserva proposta original, decisão final, motivo, autor e instante.

### 3.4 Rejeição e feedback

Rejeitar encerra somente a versão analisada da proposta e nunca chama o Signer. O motivo estruturado é obrigatório:

- `TIPO_INCORRETO`;
- `DADOS_INSUFICIENTES`;
- `EXIGE_INVESTIGACAO`;
- `DOCUMENTO_NAO_ACIONAVEL`;
- `OUTRO`.

A nota é opcional, exceto em `OUTRO`, quando se torna obrigatória. O feedback é auditável e pode alimentar evolução posterior, mas não retreina nem recalibra automaticamente o classificador nesta fatia.

### 3.5 Texto formal de `210240`

Para Operação não Realizada, o aprovador redige o `xJust` completo com 15 a 255 caracteres. Evidências e riscos da F20 permanecem visíveis, mas agente e sistema não preenchem nem completam o texto formal.

O texto é validado antes da aprovação, preservado no payload selado e protegido contra alteração posterior. Espaços marginais são normalizados antes da contagem; texto vazio, genérico fora do limite ou alterado depois da aprovação não segue para assinatura.

### 3.6 Aprovação em lote

O lote aceita somente propostas cujo tipo final seja `210200` e pertencentes a uma única empresa. O filtro de empresa é obrigatório antes da seleção.

Antes de confirmar, a interface mostra:

- empresa e certificado aplicável;
- quantidade de NF-e;
- valor total em centavos formatado em reais;
- itens que se tornaram inelegíveis;
- aviso de que manifestação conclusiva é ato fiscal irreversível pelo fluxo normal.

Cada NF-e conserva decisão, payload, identidade idempotente, tentativa, resposta e protocolo próprios. Resultado parcial separa aceitas, incertas, rejeitadas e pendentes; o lote nunca transforma falha parcial em sucesso global.

### 3.7 Payload selado e idempotência

A aprovação sela, no mínimo:

- `tenant_id` e `empresa_id`;
- chave da NF-e;
- tipo do evento;
- sequência;
- ambiente e versão do leiaute;
- `xJust`, quando `210240`;
- proposta e versão da F20;
- aprovador, motivo de alteração e instante;
- hash canônico do payload.

A identidade lógica combina empresa, chave, tipo e sequência. Repetição, concorrência ou retry reutiliza a mesma manifestação lógica. Alterar tipo, sequência ou justificativa invalida a aprovação anterior e exige nova decisão humana antes de transmitir.

### 3.8 Estados

O fluxo observável admite:

`PENDENTE → EM_REVISAO → APROVADA → ENFILEIRADA → ASSINADA → TRANSMITIDA → ACEITA`

Estados terminais ou de intervenção:

- `REJEITADA_PELO_HUMANO`;
- `REJEITADA_SEFAZ`;
- `RESULTADO_INCERTO`;
- `FALHA_RETRY`;
- `DLQ`;
- `JA_MANIFESTADA`;
- `INELEGIVEL`.

Bloqueio de interface não é lock permanente. A decisão usa controle de concorrência; proposta ou elegibilidade alterada produz conflito explícito e exige recarregar.

### 3.9 Assinatura, transmissão e reconciliação

A decisão e a mensagem de outbox são gravadas na mesma transação. O worker envia ao Signer da F12 somente identificadores e o conteúdo necessário ao evento; segredo, senha e chave privada nunca trafegam no comando de domínio.

O resultado distingue:

- aceite com protocolo;
- duplicidade reconciliada com o mesmo evento lógico;
- rejeição definitiva com código e motivo sanitizados;
- falha transitória elegível a retry;
- resposta perdida ou inconclusiva.

Timeout ou resposta perdida entra em `RESULTADO_INCERTO`. Antes de qualquer reenvio, o sistema consulta ou reconcilia o evento. Nunca se retransmite por mera ausência de resposta.

Retry automático ocorre somente para falha transitória comprovada, com o payload selado e a mesma identidade. Erro de schema, alçada, certificado, prazo ou regra de negócio da Sefaz não recebe retry cego. Esgotamento leva à DLQ com ação operacional explícita.

## 4. Invariantes globais tocados

| Invariante | Aplicação na F21 |
|---|---|
| `I-1` | decisão, outbox, manifestação, protocolo e auditoria carregam `tenant_id` e `empresa_id`, com RLS e carteira |
| `I-2` | dinheiro permanece em centavos; lote soma sem float |
| `I-4` | LLM não aprova, assina, transmite nem altera o payload fiscal |
| `I-5` | todo evento conclusivo exige aprovação humana registrada; Ciência da Emissão continua sendo a única exceção automática |
| `I-6` | decisão, payload, tentativa, resposta e protocolo são append-only ou versionados |
| `I-7` | segredo, certificado, senha, chave privada e XML assinado não entram em logs |
| `I-8` | ato fiscal não usa atualização otimista e só aparece concluído após confirmação oficial |

## 5. Contrato de interface

### 5.1 Estrutura mestre–detalhe

A referência concreta é `docs/telas/contaia_triagem_de_captura_df_e_inbox_de_manifesta_o_rf_02/`, com correções obrigatórias desta SPEC e do design system.

Em 1024 e 1440 px, a fila priorizada fica à esquerda e o detalhe à direita. O detalhe reúne documento, proposta, confiança, riscos, evidências, lacunas, histórico, decisão e transmissão. Em 768 px, o detalhe é empilhado após o item selecionado, com retorno claro à posição da fila.

O protótipo não autoriza:

- prazos antigos de 30/45 dias;
- CT-e selecionável para manifestação de NF-e;
- lote dos três tipos;
- ação otimista ou conclusão antes da Sefaz;
- delegação ao comprador;
- afirmação jurídica gerada pelo agente.

### 5.2 Decisão e confirmação

A ação individual apresenta o payload final antes da confirmação. Trocar o tipo revela o motivo obrigatório. Selecionar `210240` revela campo, contador e validação do `xJust`.

Depois da confirmação, a linha mostra progresso real: aguardando fila, assinando, transmitindo, reconciliando, aceita, rejeitada ou intervenção necessária. Não existe sucesso provisório.

A rejeição humana confirma que nenhum evento será enviado. O lote possui resumo próprio e retorno item a item.

### 5.3 Estados e acessibilidade

A tela cobre `loading`, vazio, erro, dados parciais, conflito, indisponibilidade do Signer, resultado incerto, falha parcial do lote, DLQ e sucesso confirmado.

Toda informação por cor possui texto, ícone e motivo. Seleção, filtros, modal, tabs e ações funcionam por teclado, têm foco visível e nomes acessíveis. Erros ficam associados ao campo e são anunciados; Toast Sonner complementa, mas não substitui, o estado persistente.

Temas CLARO e ESCURO e viewports de 768, 1024 e 1440 px são obrigatórios. A implementação usa `frontend-design` antes/durante e `impeccable` no acabamento, conforme `docs/FRONTEND.md` §20.1.

## 6. Arquitetura e contratos públicos

### 6.1 Unidades

- **Inbox de manifestação:** consulta elegibilidade, prioridade e estado sem executar ato fiscal.
- **Decisão HITL:** valida alçada, versão, tipo, motivo e `xJust`; sela o payload.
- **Outbox fiscal:** publica a decisão aprovada exatamente uma vez por identidade lógica.
- **Orquestrador:** coordena Signer, envio, retry e DLQ sem conhecer segredo.
- **Reconciliador:** transforma resposta, duplicidade ou consulta posterior em resultado oficial.
- **Auditoria:** preserva toda transição e vínculo causal em storage append-only.

### 6.2 Comandos e resultados

O comando individual contém identidade da proposta, versão esperada, decisão final, motivo de troca, `xJust` opcional e `correlationId`. O comando em lote contém empresa e decisões individuais; não existe payload fiscal agregado.

O resultado por item contém estado, tipo, tentativa, categoria de resposta, código oficial sanitizado, protocolo opcional, instante, possibilidade de retry e `correlationId`.

Respostas HTTP de validação, alçada, conflito ou indisponibilidade seguem `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`.

### 6.3 Observabilidade

Métricas mínimas cobrem idade e volume da inbox, decisões por tipo, rejeições humanas por motivo, trocas de tipo, latência até fila/assinatura/aceite, aceites, duplicidades reconciliadas, rejeições por código, resultados incertos, retries, DLQ e falhas parciais de lote.

Logs estruturados carregam identificadores opacos e `correlationId`; não carregam XML fiscal integral, XML assinado, `xJust` em claro quando desnecessário, certificado ou segredo.

## 7. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | elegibilidade, ordenação, alçada, troca, rejeição, `xJust`, lote e invalidação do payload |
| Banco | decisão/outbox atômicas, append-only, concorrência, idempotência, RLS e carteira |
| Integração | Signer e Sefaz dublados: aceite, rejeição, duplicidade, timeout, reconciliação, retry e DLQ |
| Tela | mestre–detalhe, filtros na URL, confirmação, progresso e estados nos dois temas e três viewports |
| E2E | decisão individual dos três tipos, rejeição sem Signer e lote parcial de `210200` |
| Segurança | aprovação fora da carteira negada; nenhum segredo ou XML assinado em logs |
| Acessibilidade | teclado, foco, nomes, anúncios de erro e informação não dependente de cor |
| Performance | inbox paginada e operações assíncronas dentro dos RNFs aplicáveis do PRD |
| Contrafactual | CT-e não manifesta; score não aprova; lote não mistura empresa; timeout não retransmite |

As provas usam Docker local, fixtures e dublês determinísticos. Integração produtiva, certificado real e métricas reais permanecem `not_run` até os gates próprios.

## 8. Critérios de aceite verificáveis

- [ ] Somente NF-e modelo 55 elegível oferece manifestação conclusiva.
- [ ] Inbox ordena por prazo, risco, valor e desempate estável.
- [ ] Somente `contador` e `admin_escritorio` com carteira vigente aprovam.
- [ ] Manter ou trocar o tipo preserva proposta original e decisão final.
- [ ] Troca de tipo exige motivo e uma única alçada humana autorizada basta.
- [ ] Rejeição exige categoria, não chama o Signer e registra feedback auditável.
- [ ] `210240` exige `xJust` humano válido de 15 a 255 caracteres.
- [ ] Lote aceita somente `210200` de uma única empresa e retorna estado por item.
- [ ] Aprovação e outbox são atômicas; payload aprovado é selado por hash.
- [ ] Mudança de tipo, sequência ou justificativa exige nova aprovação.
- [ ] Retry reutiliza identidade e payload; resultado incerto reconcilia antes de reenviar.
- [ ] Conclusão exige protocolo aceito ou duplicidade reconciliada com o mesmo evento.
- [ ] Segredos, certificado, chave privada e XML assinado não aparecem em logs.
- [ ] Interface não usa atualização otimista e representa falhas parciais explicitamente.
- [ ] UI final existe nos dois temas e três viewports com prova visual e acessibilidade.
- [ ] Testes de regras, banco, integração, tela e E2E publicam evidência vinculada à SPEC-021 e à issue.

## 9. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Agenda do prazo e alertas D-3 | MVP-1 · F22 / SPEC-022 |
| Compliance inicial no fluxo de alertas | MVP-1 · F22 / SPEC-022; Compliance completo no MVP-2 |
| Dashboard multiempresa e drill-down | MVP-1 · F23 / SPEC-023 |
| Auditoria/observabilidade transversal dos agentes | MVP-1 · capacidade própria posterior; a trilha específica da F21 entra agora |
| Manifestação ou eventos de CT-e | não pertencem ao contrato atual; exigem decisão e capacidade próprias |
| Delegação ao comprador | fora desta fatia; não aprovada como requisito do MVP-1 |
| Cancelamento de manifestação | fora desta fatia; exige regra de produto e suporte oficial próprios |
| Aprendizado automático com feedback | MVP-2 · evolução dos agentes/classificadores |
| Certificado, Sefaz e operação produtivos | gate de produção após o MVP-4 |

## 10. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Fronteira | F21 inclui inbox, aprovação, assinatura, transmissão e reconciliação |
| Lote | somente `210200`, restrito a uma empresa |
| Discordância | aprovador pode trocar o tipo com motivo ou rejeitar sem transmitir |
| `210240` | texto formal integralmente humano, sem rascunho do agente |
| Duplo controle | uma alçada autorizada basta mesmo com troca de tipo |
| Rejeição | categoria obrigatória e nota opcional; `OUTRO` exige nota |
| Prioridade | prazo, depois risco, valor e desempate estável |
| Interface | mestre–detalhe persistente; empilhamento em 768 px |
| Arquitetura | workflow assíncrono durável com outbox e reconciliação |
| Ambiente | Docker local; integração produtiva fica no gate posterior ao MVP-4 |

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
| Contrato de UI | §5, com referência, correções, estados, temas, viewports e provas |

## 12. Referências normativas

- PRD v3.1 §5.2, §10.1, §10.2 e Anexo A.1: manifestação, HITL e proposta do Agente de Captura.
- `docs/CONVENTION.md` §§3.3 e 4: alçada, estados e invariantes de manifestação.
- Portal Nacional da NF-e, Nota Técnica 2020.001 v1.60: eventos de Manifestação do Destinatário e prazo conclusivo vigente.
- Schemas oficiais de Manifestação do Destinatário: `210200`, `210220`, `210240` e `xJust` de 15 a 255 caracteres para `210240`.

## 13. Aprovação

Fronteira atômica, elegibilidade, alçada, decisão, rejeição, lote, justificativa humana, workflow, idempotência, reconciliação, interface, provas e destinos aprovados pelo PI em 18/09/2026.
