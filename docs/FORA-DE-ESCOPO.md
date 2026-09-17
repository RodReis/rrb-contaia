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
| Billing, planos e preço (RF-08) | Não é pré-requisito para provar o produto; onboarding do MVP é assistido | **Fase 4** | Primeiro cliente pagante fora do círculo de validação |
| Escrituração completa, SPED Fiscal e ECD (RF-03) | Depende do motor de regras e do razão estabilizados | **Fase 2** | MVP homologado |
| Open Finance, ITP, Pix, conciliação (RF-04) | Depende de lançamento contábil existindo | **Fase 2** | idem |
| Departamento pessoal e eSocial (RF-05) | Domínio inteiro, com risco de multa próprio | **Fase 3** | Fase 2 entregue |
| Portal do cliente white-label e Copiloto | Valor depende de já haver dado do cliente na plataforma | **Fase 3** | idem |
| Canal ativo WhatsApp/Telegram | Depende de conta oficial e de base com pendências reais | **Fase 3** | idem |
| API pública e marketplace | Sem contrato estável não há API pública | **Fase 4** | Contrato interno estável por um trimestre |
| Certificações SOC 2 e ISO 27001 | Processo caro e longo; sem base de clientes, não paga | **Fase 4** | Exigência de cliente enterprise |
| Multi-agente colaborativo e predição de fluxo de caixa | Depende dos agentes individuais medidos em produção | **Fase 4** | Métricas dos agentes dentro do alvo (PRD §17.2) |
| Suporte a certificado **A3** | Não automatizável sem presença física do token | Fora | Mudança regulatória |
| Aplicativo mobile nativo | Web responsivo atende o uso do contador | Fora do MVP | Pesquisa mostrando uso móvel relevante |
| Multi-idioma na interface | Produto é da legislação brasileira | Fora | Nenhum previsto |

---

## 4. Adiados por decisão de engenharia

| Item | Motivo | Destino | Gatilho | Origem |
|---|---|---|---|---|
| **Cofre com KMS/HSM gerenciado** | Railway não oferece; MVP usa cofre próprio em rede privada. **PRD §4.5 não cumprido integralmente** | **Fase 2, antes de escala de base** | Primeira base de clientes reais | [ADR-003](adr/ADR-003-hospedagem-e-deploy.md) · R-01 |
| Merge queue | Fluxo solo; só adicionaria rodada de CI | Quando houver autor concorrente | Fila de PRs esperando gate | [ADR-009](adr/ADR-009-ci-runner-e-merge-queue.md) |
| Vector DB dedicado | pgvector herda a RLS; isolamento provado pelo mesmo teste | Quando a busca competir com a carga transacional | Medição de latência, não impressão | [ADR-010](adr/ADR-010-vector-db.md) |
| Sharding da suíte de testes | Sem evidência de qual job é o caminho crítico | Quando o gate estourar 15 min por causa de um job medido | Registro em [`CI-PR.md`](CI-PR.md) §8 | `CLAUDE.md` |
| Runner self-hosted | Segredo e isolamento sob responsabilidade própria | — | Custo de CI virar problema medido | [ADR-009](adr/ADR-009-ci-runner-e-merge-queue.md) |

---

## 5. Documentos deliberadamente não escritos

| Item | Motivo |
|---|---|
| `docs/PRIVACIDADE.md` | Redigi-lo seria **criar regra jurídica sem autorização**. O material existente está em `prd/histórico/Politica_Privacidade_LGPD_Compliance.md` — documento **autônomo e sem efeito sobre produto** (`CLAUDE.md`). Só o PI decide se, quando e com que conteúdo ele volta. |

---

## Referências

- [`STATUS.md`](STATUS.md) · [`prd/mvp/README.md`](prd/mvp/README.md) · [`prd/mvp/RASTREABILIDADE.md`](prd/mvp/RASTREABILIDADE.md) · [`DECISIONS.md`](DECISIONS.md)
