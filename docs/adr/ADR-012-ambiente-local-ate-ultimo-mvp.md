# ADR-012 — Docker local até o último MVP; produção como etapa posterior

- **Status:** Aceita, emendada pelo PI · **Data:** 17/09/2026 · **Decisor:** PI
- **Substitui:** [ADR-003](ADR-003-hospedagem-e-deploy.md) quanto a ambiente, hospedagem e momento do deploy

## Contexto

A ADR-003 antecipava Vercel e Railway durante o desenvolvimento dos MVPs e misturava três provas diferentes: comportamento do produto, homologação de integrações externas e prontidão para produção.

## Decisão

- **MVP-1 a MVP-4:** desenvolvimento, integração, demonstração e homologação rodam exclusivamente em uma instância nova de **Docker Compose local**, com portas próprias do projeto.
- **Dados durante os MVPs:** no ambiente local, está previamente autorizado o uso de qualquer dado real necessário. Seeds, fixtures e dublês continuam disponíveis conforme a necessidade da prova.
- **Integrações externas:** quando o critério exigir prova contra provedor, Sefaz, eSocial ou outro órgão, ela parte do ambiente local. Indisponibilidade permanece `not_run`, nunca `pass`.
- **Produção:** começa somente depois do encerramento do MVP-4, como etapa própria. Antes de qualquer piloto real, exige decisão de hospedagem, KMS/HSM, região, object storage, backup/restore, observabilidade, migração, rollback e isolamento de rede.
- **Métricas de produção:** metas que dependem de tráfego ou comportamento produtivo não encerram fatias dos MVPs; durante os MVPs, são provadas no ambiente local. A validação produtiva ocorre na etapa de produção.

## Consequências

- Nenhum MVP gera deploy em Vercel, Railway ou outro provedor.
- CI da `main` produz build e imagens verificáveis, mas não publica aplicação.
- Operação produtiva não é gate de MVP e não pode ser antecipada por conveniência.
- Requisitos de produção continuam no produto; foram **transferidos**, não descartados.
- A escolha do provedor produtivo fica deliberadamente aberta até o gate pós-MVP-4.

## Riscos

- Parte da latência, disponibilidade e comportamento de rede só poderá ser confirmada após o MVP-4.
- Integrações governamentais podem divergir entre homologação e produção; o gate produtivo deve repetir provas condicionais antes de liberar clientes.
- Docker local pode mascarar limites de infraestrutura. Testes de carga e contratos de observabilidade continuam obrigatórios, sem serem apresentados como prova de produção.

## Alternativas descartadas

- Deploy contínuo desde o MVP-1: anteciparia custo operacional antes da arquitetura produtiva estar decidida.
- Piloto real em Railway com cofre próprio: mantém o risco de KMS/HSM já identificado e contradiz a separação entre construção e produção.
