# ADR-012 — Docker local até o último MVP; produção como etapa posterior

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI
- **Substitui:** [ADR-003](ADR-003-hospedagem-e-deploy.md) quanto a ambiente, hospedagem e momento do deploy

## Contexto

A ADR-003 antecipava Vercel e Railway durante o desenvolvimento dos MVPs e deixava aberto o risco de operar certificados sem KMS/HSM gerenciado. Isso misturava três provas diferentes: comportamento do produto, homologação de integrações externas e prontidão para produção. Também permitiria interpretar o fechamento de um MVP como autorização para usar empresa, certificado ou dado real.

## Decisão

- **MVP-1 a MVP-4:** desenvolvimento, integração, demonstração e homologação rodam exclusivamente em uma instância nova de **Docker Compose local**, com portas próprias do projeto.
- **Dados durante os MVPs:** somente seeds, fixtures anonimizadas e dublês contratuais. Certificados, XMLs, credenciais e dados de clientes reais são proibidos.
- **Integrações externas:** quando o critério exigir prova contra Sefaz, eSocial ou outro órgão, ela parte do ambiente local e usa exclusivamente o ambiente oficial de homologação/produção restrita e credenciais não produtivas. Indisponibilidade permanece `not_run`, nunca `pass`.
- **Produção:** começa somente depois do encerramento do MVP-4, como etapa própria. Antes de qualquer piloto real, exige decisão de hospedagem, KMS/HSM, região, object storage, backup/restore, observabilidade, migração, rollback e isolamento de rede.
- **Métricas reais:** metas que dependem de tráfego ou comportamento de produção não encerram fatias dos MVPs; durante os MVPs, são provadas por testes determinísticos de contrato, carga e cenários sintéticos. A validação real ocorre na etapa de produção.

## Consequências

- Nenhum MVP gera deploy em Vercel, Railway ou outro provedor.
- CI da `main` produz build e imagens verificáveis, mas não publica aplicação.
- Piloto real não é gate de MVP e não pode ser antecipado por conveniência.
- Requisitos de produção continuam no produto; foram **transferidos**, não descartados.
- A escolha do provedor produtivo fica deliberadamente aberta até o gate pós-MVP-4.

## Riscos

- Parte da latência, disponibilidade e comportamento de rede só poderá ser confirmada após o MVP-4.
- Integrações governamentais podem divergir entre homologação e produção; o gate produtivo deve repetir provas condicionais antes de liberar clientes.
- Docker local pode mascarar limites de infraestrutura. Testes de carga e contratos de observabilidade continuam obrigatórios, sem serem apresentados como prova de produção.

## Alternativas descartadas

- Deploy contínuo desde o MVP-1: anteciparia custo operacional e uso de segredo real antes da arquitetura produtiva estar decidida.
- Piloto real em Railway com cofre próprio: mantém o risco de KMS/HSM já identificado e contradiz a separação entre construção e produção.
