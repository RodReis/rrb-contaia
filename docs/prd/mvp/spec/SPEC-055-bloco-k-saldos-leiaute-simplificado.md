# SPEC-055 — Bloco K de saldos e leiaute simplificado

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F55
> **Issue:** #69
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
> **Tamanho:** Médio
> **Estado:** aprovada pelo PI em 25/09/2026
> **Ambiente:** Docker local, sem produção ([ADR-012](../../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md))

---

## 1. Objetivo

Gerar internamente o Bloco K da EFD ICMS/IPI, nos leiautes restrito aos saldos de estoque e simplificado, para estabelecimento de autopeças em Goiás desde setembro de 2026 cuja obrigação esteja comprovada por pacote oficial vigente.

A F55 projeta os saldos aprovados e imutáveis da F54, determina a modalidade aplicável, reconcilia quantidades e propriedade/posse, produz arquivo canônico, manifesto e diagnóstico, exige revisão humana segregada e integra a revisão aprovada à EFD da F52.

O resultado é interno ao Docker local. Não executa PVA, assinatura, transmissão, recibo, substituição oficial, pagamento ou efeito perante o Fisco.

## 2. Resultado observável

O usuário acessa `Fiscal -> EFD ICMS/IPI -> Bloco K`, escolhe estabelecimento e competência e vê:

- enquadramento da obrigação, modalidade e evidências;
- posição de estoque que será escriturada, por item e indicador de propriedade/posse;
- reconciliação com a revisão aprovada da F54;
- correções de apontamento aplicáveis, sempre vinculadas à revisão de origem;
- bloqueios, divergências e cobertura normativa;
- prévia hierárquica dos registros e totalizadores;
- revisão segregada, histórico imutável e artefatos reproduzíveis;
- estado da integração com a revisão da EFD da F52.

Sem obrigação comprovada não há inferência. Cobertura ausente, conflitante ou insuficiente produz `INDETERMINATE`. Dispensa comprovada produz `NOT_APPLICABLE` com fundamento e evidência preservados.

## 3. Recorte

Entram:

- estabelecimentos de autopeças em Goiás cobertos pela F52 e pela F54;
- competências iguais ou posteriores a setembro de 2026;
- Lucro Presumido quando a obrigação estiver comprovada;
- Simples Nacional somente para registrar decisão `NOT_APPLICABLE` enquanto a dispensa estiver comprovada pelo pacote vigente;
- `K010 = 2`, leiaute restrito aos saldos de estoque;
- `K010 = 0`, leiaute simplificado;
- registros `K001`, `K010`, `K100`, `K200`, `K280` quando aplicável e `K990`;
- revisão original e nova revisão interna quando fonte ou regra mudar;
- integração com a EFD original ou retificadora interna da F52.

Não entram registros exclusivos do leiaute completo nem operação de produção.

## 4. Dependências e fontes de verdade

- F16 fornece o mecanismo de pacote normativo versionado.
- F18, F30 e F32 alimentam movimentos documentais da F54.
- F52 fornece o ciclo da EFD ICMS/IPI original ou retificadora interna.
- F54 é a única autoridade de posição, quantidade, propriedade/posse, unidade e revisão de estoque.

Arquivo externo não cria, substitui ou corrige saldo fiscal. Quando fornecido para conferência, ele é validado como `unknown`, comparado à F54 e pode somente produzir divergência auditável. A correção ocorre na origem F54 e gera nova revisão; nunca por sobrescrita dentro da F55.

A F55 não recalcula custo, não cria movimento de estoque e não altera inventário. Ela consome somente revisão F54 `APPROVED`, íntegra e não `STALE`.

## 5. Pacote normativo e aplicabilidade

O pacote oficial versionado fixa, no mínimo:

- fonte, ato, dispositivo, URL, data de consulta e hash;
- versão do Guia Prático e leiaute da EFD;
- vigência por competência;
- UF, atividade, regime e critérios de obrigatoriedade ou dispensa;
- modalidade permitida: `RESTRICTED_STOCK` ou `SIMPLIFIED`;
- registros, campos, cardinalidades, tabelas e validações aplicáveis;
- regras de propriedade/posse, participante, unidade e correção;
- prazo e relação com EFD original ou retificadora.

Resultado do enquadramento:

- `APPLICABLE`: obrigação e modalidade comprovadas;
- `NOT_APPLICABLE`: dispensa ou não incidência comprovada;
- `INDETERMINATE`: falta, ambiguidade, conflito, lacuna de vigência ou atividade/regime não coberto.

É proibido escolher modalidade por conveniência. Mudança de pacote não altera versão aprovada; marca a revisão e a EFD dependente como `STALE` e exige nova análise.

## 6. Fotografia e reconciliação

Cada tentativa fixa atomicamente:

- tenant, empresa, estabelecimento e competência;
- revisão F54, data/hora imutável da revisão e hash;
- pacote normativo, modalidade e evidências;
- itens, unidades, quantidades e propriedade/posse;
- participantes necessários para estoque em posse de terceiros;
- correções aplicáveis e revisões relacionadas;
- totalizadores e hash canônico da fotografia.

Para cada item, a reconciliação prova que a quantidade do `K200` corresponde à posição aprovada da F54 na data exigida pelo pacote. Diferença de unidade, posse, participante, item, quantidade ou data bloqueia a revisão com código estável.

Ausência de item não equivale a estoque zero. Zero explícito só é emitido quando permitido e sustentado pela fonte aprovada. A F55 não compensa divergências entre itens, localizações, estabelecimentos ou indicadores de propriedade.

## 7. Registros gerados

O gerador puro cobre:

- `K001`: abertura e indicador de movimento;
- `K010`: tipo de leiaute `0` ou `2` determinado pelo pacote;
- `K100`: período de apuração;
- `K200`: estoque escriturado por item, unidade, quantidade, propriedade/posse e participante quando aplicável;
- `K280`: correção de apontamento de estoque somente quando sustentada por nova revisão F54 e permitida pelo pacote;
- `K990`: totalização e encerramento.

`K280` nunca é usado para ocultar erro conhecido, ajustar saldo manualmente ou evitar correção na F54. A relação entre a revisão anterior, a nova revisão, a competência corrigida e a EFD retificadora interna permanece explícita.

O parser independente reabre os registros sem reutilizar o gerador e valida hierarquia, tipos, escalas, datas, códigos, cardinalidades, propriedade/posse, participantes, quantidades e totalizadores.

## 8. Artefatos e reprodução

Cada revisão produz:

- `bloco-k.txt`, canônico e ordenado;
- `manifesto.json`, com identidade, competência, modalidade, pacote, revisão F54, fontes, cobertura e hashes;
- `diagnostico.json`, com enquadramento, reconciliação, validações, bloqueios, divergências e resultado do parser.

O payload canônico inclui somente instante imutável de criação da revisão. Instante de download fica na auditoria e não altera bytes ou hash.

Mesma fotografia, pacote e versão do gerador produzem exatamente os mesmos bytes e hashes.

## 9. Ciclo de revisão

Estados:

- `DRAFT`: fotografia em preparação;
- `NOT_APPLICABLE`: dispensa ou não incidência comprovada;
- `INDETERMINATE`: regra, fonte ou cobertura ausente/conflitante;
- `READY_FOR_REVIEW`: fotografia, registros e artefatos congelados;
- `APPROVED`: revisão imutável aprovada por pessoa distinta;
- `REJECTED`: recusada com motivo;
- `STALE`: fonte, pacote ou dependência mudou;
- `SUPERSEDED`: nova revisão aprovada substituiu a anterior internamente.

Somente `READY_FOR_REVIEW` pode ir a `APPROVED` ou `REJECTED`. Preparador, autor da correção F54 ou importador da conferência externa não pode aprovar. `APPROVED` nunca volta a rascunho.

Uma revisão `NOT_APPLICABLE` preserva fundamento, pacote e evidência, mas não gera registros com conteúdo inventado. Uma decisão `INDETERMINATE` bloqueia aprovação e integração.

## 10. Integração com a F52

A F52 consome somente revisão F55 `APPROVED`, íntegra, aplicável e não `STALE`. A inclusão respeita estabelecimento, competência, pacote e natureza original ou retificadora da EFD.

Quando a decisão for `NOT_APPLICABLE`, a F52 preserva o diagnóstico da dispensa e aplica o comportamento estrutural exigido pelo pacote, sem fabricar saldos.

Mudança retroativa na F54 ou no pacote preserva os artefatos anteriores, marca Bloco K e EFD dependente como `STALE` e exige nova revisão. Não há recálculo nem retificação externa automática.

## 11. Autorização, isolamento e auditoria

Todas as consultas e mutações aplicam tenant, empresa, estabelecimento e carteira. RLS protege enquadramentos, fotografias, reconciliações, revisões e artefatos.

Eventos append-only incluem enquadramento, dispensa, fotografia, conferência externa, divergência, geração, parser, bloqueio, envio para revisão, rejeição, aprovação, desatualização, supersessão, integração e download.

Concorrência usa versão otimista. Congelamento, aprovação, supersessão e integração à revisão da F52 são atômicos.

## 12. Contratos de domínio

```ts
type EfdBlockKLayout = "RESTRICTED_STOCK" | "SIMPLIFIED";

type EfdBlockKApplicability =
  | "APPLICABLE"
  | "NOT_APPLICABLE"
  | "INDETERMINATE";

type EfdBlockKRevisionState =
  | "DRAFT"
  | "NOT_APPLICABLE"
  | "INDETERMINATE"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "STALE"
  | "SUPERSEDED";

type EfdBlockKRecordCode =
  | "K001"
  | "K010"
  | "K100"
  | "K200"
  | "K280"
  | "K990";
```

Dados externos entram como `unknown` e só passam aos contratos após validação.

Códigos estáveis incluem:

- `EFD_BLOCK_K_RULESET_MISSING`;
- `EFD_BLOCK_K_APPLICABILITY_INDETERMINATE`;
- `EFD_BLOCK_K_LAYOUT_UNSUPPORTED`;
- `EFD_BLOCK_K_STOCK_REVISION_MISSING`;
- `EFD_BLOCK_K_STOCK_REVISION_STALE`;
- `EFD_BLOCK_K_RECONCILIATION_FAILED`;
- `EFD_BLOCK_K_OWNERSHIP_MISMATCH`;
- `EFD_BLOCK_K_PARTICIPANT_MISSING`;
- `EFD_BLOCK_K_CORRECTION_UNSUPPORTED`;
- `EFD_BLOCK_K_REVIEWER_CONFLICT`;
- `EFD_BLOCK_K_HASH_MISMATCH`.

## 13. Contrato de interface

A tela parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` para conteúdo, fluxo, hierarquia e densidade. Não copia indicadores fictícios, transmissão ou recibos do protótipo.

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, a interface apresenta:

- seletor de estabelecimento e competência;
- card de aplicabilidade, modalidade, vigência e evidências;
- tabela de itens com unidade, quantidade, propriedade/posse, participante, origem F54 e estado de reconciliação;
- agrupamento separado das correções `K280`;
- painel de bloqueios e divergências;
- prévia hierárquica e totalizadores;
- ações de gerar, enviar para revisão, rejeitar, aprovar, reproduzir e baixar;
- histórico de versões e vínculo com a EFD da F52.

Estados obrigatórios: carregando, vazio, erro, `NOT_APPLICABLE`, `INDETERMINATE`, divergência, pronto para revisão, rejeitado, aprovado, `STALE` e supersedido.

Temas CLARO e ESCURO são obrigatórios nos viewports de 768, 1024 e 1440 px, além do mobile funcional previsto em `FRONTEND.md`. Teclado, foco visível, contraste, leitor de tela e movimento reduzido são provados. Mensagens usam Toast Sonner; nunca `alert`.

A implementação usa obrigatoriamente `frontend-design` antes e durante a construção e `impeccable` no acabamento, com comparação visual e provas de `FRONTEND.md` §20.1.

## 14. Invariantes globais tocados

| Invariante | Aplicação na F55 |
|---|---|
| I-1 | fotografias, revisões e artefatos carregam `tenant_id` e `empresa_id`, além do estabelecimento |
| I-2 | consulta sem contexto de tenant não retorna enquadramento, saldo, revisão ou artefato |
| I-3 | quantidades usam decimal exato; float é proibido |
| I-4 | aplicabilidade, modalidade e registros são determinísticos; LLM não decide nem calcula |
| I-5 | aprovação exige pessoa distinta do preparador ou autor da correção de origem |
| I-6 | revisões e auditoria são append-only; correção cria nova revisão |
| I-7 | artefato aprovado não é apagado; torna-se `STALE` ou `SUPERSEDED` |
| I-8 | pacote é selecionado pela vigência da competência |
| I-9 | fotografia, geração, parser e integração são idempotentes |
| I-11 | competência e datas fiscais são civis; instantes usam UTC e exibição aprovada |
| I-12 | mesma fotografia e pacote reproduzem exatamente bytes, totalizadores e hashes |

## 15. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Aplicabilidade | obrigado, dispensado, pacote ausente, conflito, vigência e atividade não coberta |
| Modalidade | `K010=2`, `K010=0`, modalidade indevida e registro exclusivo do completo rejeitado |
| Registros | K001/K010/K100/K200/K280/K990, hierarquia, cardinalidade, ordenação e totalização |
| Reconciliação | igualdade F54, unidade divergente, posse, participante, item ausente e zero explícito |
| Correção | revisão F54 nova, K280 aplicável, correção não sustentada, `STALE` e retificadora interna |
| Artefatos | parser independente, manifesto, diagnóstico, bytes e hashes reproduzíveis |
| Banco | RLS, carteira, estabelecimento, concorrência, idempotência e append-only |
| Contrafactuais | sem saldo importado, ajuste manual, produção, leiaute completo, PVA ou transmissão |
| Tela | CLARO/ESCURO, viewports, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | F54 aprovada -> enquadramento -> geração -> revisão -> aprovação -> integração F52 |

## 16. Critérios de aceite

- [ ] Obrigação, dispensa e modalidade decorrem de pacote oficial versionado e evidenciado.
- [ ] Falta ou conflito de cobertura resulta em `INDETERMINATE`, sem inferência fiscal.
- [ ] Simples Nacional dispensado resulta em `NOT_APPLICABLE` com fundamento preservado.
- [ ] Somente `K010=2` e `K010=0` são aceitos nesta fatia.
- [ ] K001, K010, K100, K200, K280 aplicável e K990 passam pelo parser independente.
- [ ] K200 reconcilia integralmente com revisão F54 aprovada, íntegra e não `STALE`.
- [ ] Conferência externa nunca cria, substitui ou corrige saldo da F54.
- [ ] K280 exige nova revisão F54, fundamento aplicável e vínculo com a competência corrigida.
- [ ] Artefatos canônicos são idempotentes e reproduzíveis por hash.
- [ ] Aprovação é segregada e preserva histórico imutável.
- [ ] Alteração de fonte ou pacote propaga `STALE` ao Bloco K e à EFD dependente.
- [ ] A F52 consome somente revisão aprovada, aplicável, íntegra e atual.
- [ ] RLS, carteira, concorrência e auditoria possuem provas positivas e negativas.
- [ ] Interface final comprova temas, responsividade, estados, acessibilidade e acabamento.
- [ ] Nenhum fluxo opera produção, gera leiaute completo ou executa efeito externo.

## 17. Fora de escopo e destinos

| Item | Destino obrigatório |
|---|---|
| Leiaute completo; apontamentos de produção, consumo, desmontagem, movimentação interna, terceiros, reparo e produção conjunta | próxima fatia de importação fiscal de apontamentos e Bloco K completo do MVP-2 |
| ERP, ordem, planejamento, execução ou chão de fábrica | excluído pelo PRD §1.5; a fatia completa apenas importará evidência fiscal de sistema externo |
| Lote, validade e número de série | fatia própria de rastreabilidade avançada de estoque do MVP-2 |
| Integração genérica com ERP/WMS externo | fatia própria de integrações de estoque do MVP-2 |
| Atividades diferentes de autopeças ou estabelecimentos fora de Goiás | fatias próprias de expansão por atividade e UF do MVP-2 |
| Períodos anteriores a setembro/2026 ou novos leiautes | fatia própria de expansão temporal e normativa do MVP-2 |
| Lucro Real e tratamentos federais adicionais | fatia própria de expansão de regimes do MVP-2 |
| PVA e validação no programa oficial | fatia própria de validação oficial da EFD ICMS/IPI do MVP-2 |
| Assinatura, transmissão, recibo e substituição oficial | fatia própria de entrega oficial da EFD ICMS/IPI do MVP-2 |
| Malha SPED x DF-e x extrato | fatia própria de malha preventiva após as fontes financeiras do MVP-2 |

## 18. Dúvidas resolvidas

- Identidade: F55/SPEC-055.
- Capacidade: Bloco K, não gestão operacional de produção.
- Fatiamento: F55 cobre saldos restritos e simplificado; o leiaute completo terá nova F/SPEC.
- Fonte: a revisão aprovada da F54 é a única autoridade de estoque.
- Conferência externa: somente compara e aponta divergência; nunca sobrescreve a F54.
- Recorte: estabelecimentos de autopeças em Goiás desde setembro/2026, alinhados à F52/F54.
- Regimes: Lucro Presumido quando obrigado; Simples Nacional registra dispensa comprovada.
- Modalidades: `K010=2` e `K010=0`.
- Correção: K280 depende de nova revisão F54 e não ajusta saldo por conta própria.
- Aprovação: revisão humana segregada.
- Interface: central da EFD ICMS/IPI com tela final nos dois temas.
- Questões abertas: **Nenhuma**.

## 19. Gate de conformidade documental

- **Identidade:** F55/SPEC-055, MVP-2, issue #69 e origem no PRD declarados.
- **Comportamento:** enquadramento, reconciliação, geração, revisão e integração são observáveis.
- **Aceite:** critérios verificáveis cobrem regras, banco, artefatos, tela e E2E.
- **Invariantes:** I-1 a I-9, I-11 e I-12 estão aplicados explicitamente.
- **Limites:** não há produção, leiaute completo, PVA, transmissão ou efeito externo.
- **Destinos:** todo complemento aponta capacidade nomeada ou exclusão normativa existente.
- **UI:** caminho, referência, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Médio; o leiaute completo foi separado para evitar fatia `Enorme`.

## 20. Referências normativas consultadas

- SPED, Guia Prático EFD ICMS/IPI versão 3.2.2: <https://sped.rfb.gov.br/arquivo/download/8112>;
- Secretaria da Economia de Goiás, Guia Prático EFD ICMS/IPI versão 3.1.8: <https://goias.gov.br/economia/wp-content/uploads/sites/45/2025/06/Guia-Pratico-EFD-Versao-3.1.8.pdf>;
- CONFAZ, Ajuste SINIEF 02/2009 e alterações: <https://www.confaz.fazenda.gov.br/legislacao/ajustes/2009/AJ_002_09>.

## 21. Aprovação

Recorte aprovado pelo PI em 25/09/2026 para criação da issue, commit e push direto na `main`.
