# FORA-DE-ESCOPO.md — O que ficou de fora, por que, e o que traz de volta

> **Fonte única dos itens adiados ou excluídos.** Mantido pelo **Cowork**.
> **Não substitui backlog nem board remoto.** Um item aqui não é tarefa: é uma decisão registrada de **não fazer agora**.
> Fatiamento **não reduz escopo** ([`prd/mvp/README.md`](prd/mvp/README.md)): o que sai de um MVP entra aqui com destino e gatilho, ou não saiu.

---

## 1. Como usar

Cada linha declara quatro coisas: **o que**, **por que ficou fora**, **para onde vai** e **o que o traz de volta**. Linha sem gatilho é item esquecido disfarçado de decisão.

Entrar aqui exige registro correspondente em [`prd/mvp/RASTREABILIDADE.md`](prd/mvp/RASTREABILIDADE.md) — ausência na matriz bloqueia aprovação documental.

---

## 2. Excluídos do produto (PRD §1.5)

Não são "depois": são **não-objetivos declarados**.

| Item | Motivo | Destino | Gatilho de revisão |
|---|---|---|---|
| Emissão de NF-e em nome de clientes | Responsabilidade fiscal e superfície regulatória desproporcionais ao ganho no MVP | Fase posterior, **via parceiro** | Demanda recorrente de cliente pagante + parceiro homologado disponível |
| Captura automática de NFS-e de municípios fora do padrão nacional | Não existe interface única; seriam centenas de integrações municipais | Upload manual como via alternativa | Adesão do município ao padrão nacional |
| ERP de estoque ou produção | Outro produto, outro comprador | Fora | Nenhum previsto |

---

## 3. Adiados por fase (PRD §16)

| Item | Motivo | Destino | Gatilho |
|---|---|---|---|
| Billing, planos e preço (RF-08) | Não é pré-requisito para os MVPs anteriores | **MVP-4** | MVP-3 finalizado |
| Complemento do Bloco K, Lucro Real/não cumulatividade e entrega oficial das EFDs (RF-03) | F51/SPEC-051 entrega livros e fechamento fiscal; F52/SPEC-052 gera internamente a EFD ICMS/IPI; F53/SPEC-053 gera internamente a EFD-Contribuições; F54/SPEC-054 entrega estoque, inventário físico e Bloco H; F55/SPEC-055 entrega Bloco K restrito aos saldos e simplificado; F56/SPEC-056 entrega produção própria e consumo; F57/SPEC-057 entrega desmontagem e movimentação interna; F58/SPEC-058 entrega industrialização efetuada por terceiros; F59/SPEC-059 entrega reprocessamento e reparo no próprio estabelecimento, com correções das próprias origens; F60/SPEC-060 entrega correções de desmontagem e movimentação interna; F61/SPEC-061 entrega produção conjunta no próprio estabelecimento; F62/SPEC-062 entrega produção conjunta efetuada por terceiros, todas sem efeito externo | **MVP-2: correções de K300/K301/K302 somente sob fonte oficial e recorte próprios; Lucro Real/não cumulatividade; PVA, assinatura, transmissão, recibo e substituição oficial** | Fontes específicas e recorte aprovados |
| Complemento do motor de obrigações e Compliance (RF-03/RF-07) | F22 entrega agenda mínima, calendário útil, baixa e alertas D-3; F63/SPEC-063 amplia o catálogo e decide exigibilidade para Simples Nacional e Lucro Presumido de autopeças em Goiás somente nas saídas F36–F53; F64/SPEC-064 calcula penalidades e juros incorridos ou projetados e prioridade fixa por prazo; F65/SPEC-065 entrega dependências rígidas e sequência; F66/SPEC-066 entrega sucessão N:N e coexistência normativa de 2026 a 2033, sem implementar os destinos futuros | **MVP-2: capacidades geradoras futuras, demais obrigações, regimes, UFs, CNAEs e segmentos; ordenação por impacto, rascunhos e priorização do Compliance completo. MVP-4: apuração completa de IBS/CBS** | Fontes oficiais, recorte e capacidade geradora aprovados |
| Complemento da malha fiscal preventiva (RF-03 §6.4) | F67/SPEC-067 cruza EFD ICMS/IPI, EFD-Contribuições, DF-e e extrato local CSV/OFX, sem editar as fontes | **MVP-2: Open Finance sob o mesmo contrato bancário normalizado; conciliação multi-critério e Agente Conciliador; novas fontes, regimes, UFs, CNAEs, documentos e períodos em fatias próprias** | Capacidades e recortes correspondentes aprovados |
| Complemento de contas a pagar e receber (RF-04 §7.1) | F68/SPEC-068 entrega títulos, parcelamento e baixa manual; F69/SPEC-069 importa boleto de cobrança e arrecadação por PDF textual ou linha digitável; F70/SPEC-070 entrega o núcleo local de cobrança BB por CNAB 240/400; F71/SPEC-071 entrega o ciclo avançado BB 240/400 de vencimento, desconto, protesto, sustação e baixa de registro, atualizando somente o estado bancário observado e sem transmissão; F72/SPEC-072 entrega pagamentos locais BB CNAB 240 de boletos, tributos e convênios com código de barras, com origem F68/F69, remessa, retorno e proposta revisável de baixa; F73/SPEC-073 entrega manutenção local de pagamentos BB CNAB 240 originados F72, com alteração de data e valor revalidado F68/F69, cancelamento confirmado, cobertura por operação, aprovação segregada e proposta revisável de estorno vinculada à baixa F68; nova tentativa exige resolução financeira ou ausência comprovada de baixa; operação sem cobertura fica bloqueada e rastreada, sem cancelamento/reinclusão automático; F74/SPEC-074 cobre DARF comum, DARF Simples e GPS sem código de barras com guia externa validada, parcela F68 publicada, remessa/retorno locais e proposta revisável de baixa | **MVP-2: demais tributos CNAB sem código de barras; atualização de valores, juros, multa e desconto; pagamentos avulsos; complemento de manutenção BB por modalidade/operação sem cobertura comprovada (manual/contrato/fixtures aprovados; operação bloqueada, sem substituição automática por cancelamento e novo pagamento); transmissão bancária sob integração própria, com produção somente após MVP-4; validação CNAB de folha sem execução; sincronização financeiro-bancária; OCR financeiro, aging, fluxo 30/60/90, demais bancos, API Cora, emissão/consulta externa de boleto, cadastro mestre de contrapartes, recorrência e integração financeiro-contábil em fatias próprias** | Recortes, arquivos, manuais oficiais e contratos de origem aprovados |
| Open Finance, ITP, Pix, conciliação (RF-04) | F67/SPEC-067 antecipa somente o contrato bancário normalizado e a importação local CSV/OFX, sem consentimento, conexão, pagamento ou conciliação financeira | **MVP-2: fatias próprias de Open Finance, ITP, Pix e conciliação** | Recortes bancários, parceiros e critérios aprovados |
| Departamento pessoal e eSocial (RF-05) | Domínio inteiro, com risco de multa próprio | **Fase 3** | Fase 2 entregue |
| Portal do cliente white-label e Copiloto | Valor depende de já haver dado do cliente na plataforma | **Fase 3** | idem |
| Canal ativo WhatsApp/Telegram | Depende de conta oficial e de base com pendências reais | **Fase 3** | idem |
| API pública e Marketplace | O PRD ainda não define consumidores, operações, atores ou critérios de aceite | **MVP-4** | PI fechar as decisões registradas no documento do MVP-4 |
| Auditoria externa e certificação SOC 2 e ISO 27001 | Não é demonstrável em Docker local; o MVP-4 entrega controles e evidências preparatórias | **Gate de produção após o MVP-4** | Infraestrutura produtiva definida e auditoria externa contratada |
| Multi-agente colaborativo e predição de fluxo de caixa | Depende dos agentes individuais validados nos MVPs anteriores | **MVP-4** | MVP-3 finalizado e cenários locais dos agentes dentro dos critérios |
| Suporte a certificado **A3** | Não automatizável sem presença física do token | Fora | Mudança regulatória |
| Aplicativo mobile nativo | Web responsivo atende o uso do contador | Fora do MVP | Pesquisa mostrando uso móvel relevante |
| Multi-idioma na interface | Produto é da legislação brasileira | Fora | Nenhum previsto |

---

## 4. Adiados por decisão de engenharia

| Item | Motivo | Destino | Gatilho | Origem |
|---|---|---|---|---|
| **Hospedagem e deploy produtivos** | Os MVPs provam o produto em Docker local; provedor não é escolhido antes de o produto estar completo | **Etapa de produção após o MVP-4** | MVP-4 encerrado e gate produtivo aberto | [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md) |
| **Cofre com KMS/HSM gerenciado** | Material real é proibido durante os MVPs; o cofre local usa somente segredo e certificado de teste | **Etapa de produção após o MVP-4, antes de qualquer piloto real** | Definição da infraestrutura produtiva | [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md) · R-01 |
| **Operação produtiva com escritório ou empresa** | Uso local de qualquer dado real necessário está autorizado; operação produtiva continua sendo outra etapa | **Etapa de produção após o MVP-4** | KMS/HSM, região, backup/restore, observabilidade e rollback aprovados | [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md) |
| Merge queue | Fluxo solo; só adicionaria rodada de CI | Quando houver autor concorrente | Fila de PRs esperando gate | [ADR-009](adr/ADR-009-ci-runner-e-merge-queue.md) |
| Vector DB dedicado | pgvector herda a RLS; isolamento provado pelo mesmo teste | Quando a busca competir com a carga transacional | Medição de latência, não impressão | [ADR-010](adr/ADR-010-vector-db.md) |
| Sharding da suíte de testes | Sem evidência de qual job é o caminho crítico | Quando o gate estourar 15 min por causa de um job medido | Registro em [`CI-PR.md`](CI-PR.md) §8 | `CLAUDE.md` |
| Runner self-hosted | Segredo e isolamento sob responsabilidade própria | — | Custo de CI virar problema medido | [ADR-009](adr/ADR-009-ci-runner-e-merge-queue.md) |

---

## 5. Registros não normativos

| Item | Papel | Efeito sobre produto |
|---|---|---|
| [`PRIVACIDADE.md`](PRIVACIDADE.md) | Registrar achados surgidos nas especificações, com contexto de MVP/SPEC/Fatia, para revisão após o MVP-4 | Nenhum até promoção explícita pelo PI |
| [`prd/histórico/Politica_Privacidade_LGPD_Compliance.md`](prd/histórico/Politica_Privacidade_LGPD_Compliance.md) | Insumo histórico para a mesma revisão | Nenhum durante os MVPs |

---

## Referências

- [`STATUS.md`](STATUS.md) · [`prd/mvp/README.md`](prd/mvp/README.md) · [`prd/mvp/RASTREABILIDADE.md`](prd/mvp/RASTREABILIDADE.md) · [`DECISIONS.md`](DECISIONS.md)
