# SPEC-056 — Produção própria e consumo no Bloco K completo

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F56
> **Issue:** #70
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 25/09/2026
> **Ambiente:** Docker local, sem produção ([ADR-012](../../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md))

---

## 1. Objetivo

Importar de forma atômica a evidência fiscal de produção própria e consumo de estabelecimentos industriais ou equiparados de autopeças em Goiás, reconciliá-la com o estoque aprovado da F54 e gerar internamente a parcela aplicável do Bloco K completo, com `K010=1`, para competências iguais ou posteriores a setembro de 2026.

A F56 cobre estrutura de consumo específico padronizado, produção própria, consumo realizado e correções vinculadas a essas origens. Ela produz arquivo canônico, manifesto, diagnóstico e parser independente, exige revisão humana segregada e integra a revisão aprovada à EFD da F52.

O resultado é interno ao Docker local. A F56 não opera fábrica, não mantém ordem de produção, não corrige a fonte importada e não executa PVA, assinatura, transmissão, recibo ou efeito perante o Fisco.

## 2. Resultado observável

O usuário acessa `Fiscal -> EFD ICMS/IPI -> Bloco K`, seleciona estabelecimento e competência e pode:

- consultar aplicabilidade, modalidade completa, pacote e evidências;
- importar pacote CSV ou JSON com manifesto, estrutura e apontamentos;
- visualizar prévia atômica com todos os erros por arquivo e linha;
- comparar consumo padronizado e realizado sem transformar o desvio em bloqueio automático;
- conferir conversões de unidade e reconciliação sem tolerância com a F54;
- inspecionar árvore dos registros, totalizadores, bloqueios e cobertura;
- enviar a revisão congelada para aprovação segregada;
- reproduzir e baixar TXT, manifesto e diagnóstico;
- consultar histórico imutável e integração com a EFD da F52.

Sem obrigação comprovada não há inferência. Cobertura ausente, conflitante ou insuficiente resulta em `INDETERMINATE`. Dispensa comprovada resulta em `NOT_APPLICABLE`.

## 3. Recorte

Entram:

- estabelecimento industrial ou equiparado de autopeças em Goiás coberto pelas F52 e F54;
- competências iguais ou posteriores a setembro de 2026;
- Lucro Presumido quando a obrigação do leiaute completo estiver comprovada;
- Simples Nacional somente para registrar `NOT_APPLICABLE` enquanto a dispensa estiver comprovada;
- importação fiscal de estrutura `0210`, produção própria `K230`, consumo `K235` e correções `K270/K275` dessas origens;
- registros compartilhados `K001`, `K010=1`, `K100`, `K200`, `K280` aplicável e `K990`;
- EFD original ou retificadora interna da F52.

Não entram desmontagem, movimentação interna, industrialização por terceiros, reparo/reprocessamento ou produção conjunta. Se o manifesto declarar qualquer dessas operações, a revisão é bloqueada por cobertura insuficiente; a F56 nunca as omite silenciosamente.

## 4. Dependências e fontes de verdade

- F16 fornece o mecanismo de pacote normativo versionado.
- F52 fornece o ciclo da EFD ICMS/IPI original ou retificadora interna.
- F54 é a única autoridade de item, posição, quantidade, propriedade/posse, unidade de estoque e revisão.
- F55 fornece o ciclo comum do Bloco K, saldos `K200`, correções `K280`, artefatos e integração.
- O sistema externo é a autoridade dos apontamentos e da estrutura produtiva importados.

A ContaIA não mantém ERP, ficha técnica operacional, ordem, planejamento, execução ou chão de fábrica. Erro de apontamento é corrigido no sistema de origem e reimportado em novo pacote integral; nenhuma linha importada pode ser editada na ContaIA.

## 5. Pacote normativo e aplicabilidade

O pacote oficial versionado fixa, no mínimo, fonte, ato, dispositivo, URL, data de consulta, hash, versão do Guia Prático, leiaute, vigência, UF, atividade, regime, obrigatoriedade ou dispensa, registros, campos, cardinalidades, tabelas, escalas, regras de correção e relação com EFD original ou retificadora.

Resultado:

- `APPLICABLE`: obrigação de `K010=1` comprovada e cenário integralmente coberto;
- `NOT_APPLICABLE`: dispensa ou não incidência comprovada;
- `INDETERMINATE`: falta, ambiguidade, conflito, lacuna de vigência ou cenário sem cobertura.

Mudança normativa preserva revisões anteriores, marca a revisão e a EFD dependente como `STALE` e exige nova análise.

## 6. Contrato da importação

O usuário envia um pacote em CSV ou JSON canônico. Ambos representam o mesmo schema versionado e produzem a mesma fotografia quando semanticamente equivalentes.

O pacote contém obrigatoriamente:

- manifesto com tenant, empresa, estabelecimento, competência, sistema e versão de origem, instante imutável da extração, versão do schema, contagens, totais e hash;
- itens e unidades referenciados;
- estrutura versionada de consumo específico padronizado para `0210`;
- ordens ou períodos de produção própria necessários ao `K230`;
- consumos efetivos vinculados necessários ao `K235`;
- correções de períodos anteriores `K270/K275`, quando existentes;
- declaração explícita de existência ou ausência das operações especiais fora da F56.

Dados externos entram como `unknown`. Schema, manifesto, hash, chaves, datas, vínculos, unidades, quantidades, cardinalidades, contagens e totais são validados antes de criar uma revisão utilizável.

## 7. Atomicidade, idempotência e versões

A importação é atômica. A prévia apresenta todos os erros encontrados, mas nenhuma linha é aceita isoladamente e nenhuma revisão pode seguir enquanto o pacote inteiro não estiver válido e reconciliado.

A identidade usa tenant, empresa, estabelecimento, competência, sistema de origem, versão do schema e hash do pacote. Reenvio do mesmo pacote reutiliza o mesmo resultado lógico. Pacote diferente cria nova revisão append-only; nunca sobrescreve a anterior.

Arquivo rejeitado preserva hash, manifesto e diagnóstico para auditoria, sem se tornar fonte fiscal aprovada.

## 8. Unidades, conversões e precisão

A quantidade é reconciliada na unidade canônica de estoque da F54. Conversão só é aceita quando existir fator explícito, positivo, versionado, vigente e previamente aprovado para o item e o par de unidades.

Fator ausente, zero, negativo, conflitante ou fora da vigência bloqueia todo o pacote. O cálculo usa decimal exato; float é proibido. A precisão interna é preservada e o arredondamento ocorre somente na serialização, conforme o pacote oficial.

Após a conversão, qualquer diferença com a F54 bloqueia a revisão. Não existe tolerância configurável, compensação entre itens nem ajuste automático.

## 9. Consumo padronizado e realizado

A estrutura `0210` e o consumo realizado `K235` vêm no mesmo pacote, com suas próprias versões e vínculos ao produto.

Diferença entre consumo padronizado e realizado gera diagnóstico auditável por produto e insumo, mas não bloqueia isoladamente. Bloqueiam a revisão: vínculo ausente, item desconhecido, unidade inválida, quantidade inválida, estrutura fora da vigência, duplicidade incompatível ou falta de reconciliação com a F54.

A ContaIA não cria limite operacional de perda nem infere causa industrial.

## 10. Reconciliação e completude

O manifesto comprova que o pacote representa toda a produção própria e o consumo da competência para o estabelecimento. Contagens, totais e hash devem corresponder ao conteúdo.

A reconciliação prova, sem tolerância:

- produto produzido e insumos consumidos existentes na F54;
- unidade canônica ou conversão aprovada;
- efeito quantitativo compatível com os movimentos imutáveis da F54;
- datas dentro da competência ou correção explicitamente vinculada a período anterior;
- saldo `K200` e correção `K280` coerentes com a revisão F54;
- ausência comprovada de operação especial não suportada.

Ausência de linha não equivale a zero. Completude não pode ser declarada apenas por aprovação humana sem manifesto técnico correspondente.

## 11. Registros e artefatos

O gerador puro cobre `0210`, `K001`, `K010=1`, `K100`, `K200`, `K230`, `K235`, `K270`, `K275`, `K280` aplicável e `K990`.

`K270/K275` só corrigem apontamentos de produção própria ou consumo cobertos pela F56. `K280` segue a F55 e nunca serve para esconder origem desconhecida ou evitar correção da F54.

Cada revisão produz:

- `bloco-k.txt`, canônico e ordenado;
- `manifesto.json`, com identidades, fontes, versões, cobertura e hashes;
- `diagnostico.json`, com validações, reconciliação, desvios, bloqueios e resultado do parser.

O parser independente não reutiliza o gerador e valida hierarquia, tipos, escalas, datas, códigos, cardinalidades, vínculos, quantidades, totalizadores e cobertura. Mesmas entradas e versões produzem os mesmos bytes e hashes.

## 12. Ciclo de revisão e integração

Estados:

- `DRAFT`;
- `NOT_APPLICABLE`;
- `INDETERMINATE`;
- `READY_FOR_REVIEW`;
- `APPROVED`;
- `REJECTED`;
- `STALE`;
- `SUPERSEDED`.

Somente `READY_FOR_REVIEW` pode seguir para `APPROVED` ou `REJECTED`. Importador, preparador ou autor da conversão utilizada não pode aprovar. A aprovação cabe a `contador` ou `admin_escritorio` distinto e dentro da carteira.

A F52 consome somente revisão F56 `APPROVED`, íntegra, aplicável e não `STALE`. Nova fonte, estrutura, conversão, revisão F54 ou pacote marca a F56, a composição do Bloco K e a EFD dependente como `STALE`. Não há recálculo nem retificação externa automática.

## 13. Contratos de domínio

```ts
type EfdBlockKCompleteInputFormat = "CSV" | "JSON";

type EfdBlockKCompleteRecordCode =
  | "0210"
  | "K001"
  | "K010"
  | "K100"
  | "K200"
  | "K230"
  | "K235"
  | "K270"
  | "K275"
  | "K280"
  | "K990";

type EfdBlockKCompleteRevisionState =
  | "DRAFT"
  | "NOT_APPLICABLE"
  | "INDETERMINATE"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "STALE"
  | "SUPERSEDED";
```

Códigos estáveis incluem:

- `EFD_BLOCK_K_COMPLETE_RULESET_MISSING`;
- `EFD_BLOCK_K_COMPLETE_APPLICABILITY_INDETERMINATE`;
- `EFD_BLOCK_K_COMPLETE_MANIFEST_MISMATCH`;
- `EFD_BLOCK_K_COMPLETE_SCHEMA_INVALID`;
- `EFD_BLOCK_K_COMPLETE_UNSUPPORTED_OPERATION`;
- `EFD_BLOCK_K_COMPLETE_CONVERSION_MISSING`;
- `EFD_BLOCK_K_COMPLETE_CONVERSION_INVALID`;
- `EFD_BLOCK_K_COMPLETE_RECONCILIATION_FAILED`;
- `EFD_BLOCK_K_COMPLETE_SOURCE_INCOMPLETE`;
- `EFD_BLOCK_K_COMPLETE_REVIEWER_CONFLICT`;
- `EFD_BLOCK_K_COMPLETE_HASH_MISMATCH`.

## 14. Contrato de interface

A tela parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` para conteúdo, fluxo, hierarquia e densidade, sem copiar transmissão, recibo ou indicadores fictícios.

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, apresenta:

- seletor de estabelecimento e competência;
- aplicabilidade, modalidade, vigência e evidências;
- upload CSV/JSON, manifesto e andamento da validação;
- prévia atômica com erros por arquivo e linha;
- tabelas de estrutura, produção, consumo, conversões e correções;
- comparação entre padrão e realizado;
- reconciliação com a F54 e operações não suportadas;
- árvore dos registros, totalizadores, revisão e artefatos;
- histórico e vínculo com a F52.

Estados obrigatórios: carregando, vazio, upload, validando, inválido, divergência, operação não suportada, `NOT_APPLICABLE`, `INDETERMINATE`, pronto para revisão, rejeitado, aprovado, `STALE` e supersedido.

Temas CLARO e ESCURO, viewports 768, 1024 e 1440 px, mobile funcional, teclado, foco visível, contraste, leitor de tela e movimento reduzido são obrigatórios. Mensagens usam Toast Sonner. A implementação usa `frontend-design` e finaliza com `impeccable`, comprovando `FRONTEND.md` §20.1.

## 15. Invariantes globais tocados

| Invariante | Aplicação na F56 |
|---|---|
| I-1 | pacotes, estruturas, apontamentos, conversões, revisões e artefatos carregam tenant e empresa |
| I-2 | consulta sem contexto de tenant não retorna importação, revisão ou artefato |
| I-3 | quantidades e conversões usam decimal exato; float é proibido |
| I-4 | aplicabilidade, validação, reconciliação e geração são determinísticas; LLM não calcula |
| I-5 | aprovação exige pessoa distinta do importador, preparador e autor da conversão |
| I-6 | pacotes, revisões e auditoria são append-only |
| I-7 | revisão aprovada não é apagada; torna-se `STALE` ou `SUPERSEDED` |
| I-8 | pacote e conversão são selecionados pela vigência da competência |
| I-9 | importação, geração, parser e integração são idempotentes |
| I-11 | competência e datas fiscais são civis; instantes imutáveis ficam em UTC |
| I-12 | mesmas entradas e versões reproduzem bytes, totalizadores e hashes |

## 16. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Aplicabilidade | obrigado, dispensado, pacote ausente, conflito, vigência, atividade e regime não cobertos |
| Importação | CSV/JSON equivalentes, manifesto, hash, schema, múltiplos erros, atomicidade e reenvio idempotente |
| Estrutura/produção | 0210, K230/K235, produção concluída/em andamento, vínculos, datas e cardinalidades |
| Conversão | fator vigente, ausente, zero, negativo, conflitante, decimal exato e arredondamento final |
| Reconciliação | igualdade F54, qualquer divergência bloqueante, ausência não tratada como zero e sem compensação |
| Desvio | padrão diferente do realizado gera diagnóstico sem bloquear quando o estoque reconcilia |
| Correção | K270/K275 suportados, K280 coerente, origem desconhecida bloqueada e revisão anterior preservada |
| Cobertura | terceiros, desmontagem, K220, reparo ou produção conjunta declarados bloqueiam a revisão |
| Artefatos | parser independente, TXT, manifesto, diagnóstico e hashes reproduzíveis |
| Banco | RLS, carteira, concorrência, append-only, `STALE` e supersessão |
| Tela | temas, viewports, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | pacote -> prévia -> reconciliação -> revisão -> aprovação -> TXT/parser/hash -> F52 |

## 17. Critérios de aceite

- [ ] Obrigação, dispensa e `K010=1` decorrem de pacote oficial versionado.
- [ ] CSV e JSON equivalentes produzem a mesma fotografia canônica.
- [ ] Manifesto comprova estabelecimento, competência, origem, completude, totais e hash.
- [ ] Qualquer erro impede atomicamente a criação de revisão utilizável.
- [ ] Correção ocorre somente na origem e por nova importação integral; não há edição manual.
- [ ] Estrutura `0210`, produção `K230` e consumo `K235` são vinculados e versionados.
- [ ] Desvio padrão x realizado é auditado, mas não bloqueia isoladamente.
- [ ] Conversão exige fator explícito, aprovado, vigente e decimal exato.
- [ ] Qualquer divergência com a F54 bloqueia sem tolerância configurável.
- [ ] Operação especial declarada bloqueia por cobertura insuficiente.
- [ ] Registros e artefatos passam por parser independente e são reproduzíveis.
- [ ] Aprovação é segregada e a F52 consome somente revisão aprovada e atual.
- [ ] RLS, carteira, concorrência, auditoria e idempotência possuem provas positivas e negativas.
- [ ] Interface final comprova temas, responsividade, estados, acessibilidade e acabamento.
- [ ] Nenhum fluxo opera produção, executa PVA ou causa efeito externo.

## 18. Fora de escopo e destinos

| Item | Destino obrigatório |
|---|---|
| Desmontagem K210/K215, movimentação K220, terceiros K250/K255, reparo K260/K265 e produção conjunta K290–K302 | próxima capacidade de operações especiais e conclusão do Bloco K completo do MVP-2, sem F/SPEC reservada antecipadamente |
| ERP, ficha técnica operacional, ordem, planejamento, execução ou chão de fábrica | excluído pelo PRD §1.5; a F56 importa somente evidência fiscal externa |
| Integração genérica com ERP/WMS | capacidade própria de integrações de estoque do MVP-2 |
| Lote, validade e número de série | capacidade própria de rastreabilidade avançada de estoque do MVP-2 |
| Atividades diferentes de autopeças, outras UFs ou períodos anteriores a setembro/2026 | capacidades próprias de expansão do MVP-2 |
| Lucro Real e tratamentos federais adicionais | capacidade própria de expansão de regimes do MVP-2 |
| PVA e validação no programa oficial | capacidade própria de validação oficial da EFD ICMS/IPI do MVP-2 |
| Assinatura, transmissão, recibo e substituição oficial | capacidade própria de entrega oficial da EFD ICMS/IPI do MVP-2 |
| Malha SPED x DF-e x extrato | capacidade de malha preventiva após as fontes financeiras do MVP-2 |

## 19. Dúvidas resolvidas

- Identidade: F56/SPEC-056.
- Capacidade: produção própria e consumo no leiaute completo, não ERP industrial.
- Fatiamento: operações especiais concluem o Bloco K em capacidade posterior sem número reservado.
- Recorte: industrial ou equiparado de autopeças em Goiás desde setembro/2026.
- Regimes: Lucro Presumido quando obrigado; Simples registra dispensa comprovada.
- Entrada: CSV e JSON canônicos com manifesto obrigatório.
- Atomicidade: qualquer erro rejeita o pacote inteiro, exibindo todos os diagnósticos.
- Correção: somente no sistema de origem e por reimportação integral.
- Unidades: conversão apenas por fator versionado, vigente e aprovado.
- Reconciliação: sem tolerância configurável ou ajuste automático.
- Estrutura: 0210 padronizado e consumo realizado vêm no mesmo pacote.
- Desvio: diagnóstico auditável, não bloqueio isolado.
- Aprovação: revisão humana segregada.
- Questões abertas: **Nenhuma**.

## 20. Gate de conformidade documental

- **Identidade:** F56/SPEC-056, MVP-2, issue #70 e origem declarados.
- **Comportamento:** importação, validação, reconciliação, geração, revisão e integração são observáveis.
- **Aceite:** regras, banco, artefatos, tela e E2E possuem provas verificáveis.
- **Invariantes:** I-1 a I-9, I-11 e I-12 estão aplicados.
- **Limites:** não há ERP, operação industrial, operações especiais, PVA, transmissão ou efeito externo.
- **Destinos:** todo complemento aponta capacidade nomeada ou exclusão normativa.
- **UI:** caminho, referência, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Grande, justificado pela entrega vertical única de produção própria e consumo; operações especiais foram separadas para evitar fatia `Enorme`.

## 21. Referências normativas consultadas

- SPED, Guia Prático EFD ICMS/IPI versão 3.2.2: <https://sped.rfb.gov.br/arquivo/download/8112>;
- SPED, Nota Técnica EFD ICMS/IPI 2023.001: <https://sped.rfb.gov.br/estatico/58/D2445B5D1B5990C883F9F0F424E978C1A13038/Nota%20T%C3%A9cnica%20EFD%20ICMS%20IPI%202023.001%20v1.0.pdf>;
- SPED, Perguntas Frequentes EFD ICMS/IPI versão 7.6: <https://sped.rfb.gov.br/estatico/65/44ECDD5A583D746E8D94B169DD436079AB64E8/Perguntas%20Frequentes%20-%207.6.pdf>;
- CONFAZ, Ajuste SINIEF 02/2009 e alterações: <https://www.confaz.fazenda.gov.br/legislacao/ajustes/2009/AJ_002_09>.

## 22. Aprovação

Recorte aprovado pelo PI em 25/09/2026 para criação da issue, commit e push direto na `main`.
