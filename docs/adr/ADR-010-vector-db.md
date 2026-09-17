# ADR-010 — Vector DB

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
O Agente Classificador e o Copiloto dependem de busca vetorial. O PRD §10.1 exige **namespace próprio por tenant — embeddings de clientes distintos nunca se misturam**. Isolamento é o requisito, não performance de busca.

## Decisão
**pgvector no próprio PostgreSQL**, nas mesmas tabelas sujeitas à RLS de dois níveis.

## Consequências
- O embedding herda `tenant_id`/`empresa_id` e a **mesma política de RLS** das tabelas transacionais: o isolamento é provado pelo mesmo teste, não por uma segunda implementação.
- Um banco a menos para operar, versionar e restaurar.
- Metadados da classificação (Anexo B.2 do PRD) ficam ao lado do vetor, sem sincronização entre sistemas.

## Riscos
- Em escala muito alta de vetores, a busca por similaridade compete com a carga transacional. Mitigação: índice HNSW, medição de latência e, se necessário, réplica de leitura — antes de considerar banco dedicado.

## Alternativas descartadas
- Qdrant self-hosted: busca superior em escala, mas isolamento reimplementado fora da RLS e mais um backup.
- Pinecone/Weaviate Cloud: dado contábil de cliente fora da infraestrutura própria.
