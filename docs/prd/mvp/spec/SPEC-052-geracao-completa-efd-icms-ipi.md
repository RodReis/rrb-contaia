# SPEC-052 — Geração completa da EFD ICMS/IPI

> **Fatia:** F52
> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Issue:** [#66](https://github.com/RodReis/rrb-contaia/issues/66)
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.2, 6.4, 6.5, 12, 14, 15 e 16
> **Dependências:** F16, F18, F24, F26–F36 e F51
> **Ambiente:** Docker local, sem produção ([ADR-012](../../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md))
> **Estado:** aprovada pelo PI em 25/09/2026

## 1. Objetivo

Gerar internamente, por estabelecimento e competência, o arquivo completo da EFD ICMS/IPI aplicável ao comércio de autopeças em Goiás, a partir dos livros fiscais fechados da F51.

Sucesso significa produzir uma versão original ou retificadora imutável, revisada por pessoa distinta, estrutural e aritmeticamente validada, reconciliada com as fontes aprovadas e acompanhada de TXT, manifesto e diagnóstico reproduzíveis. A fatia não executa PVA, assinatura, transmissão, substituição oficial nem qualquer efeito externo.

## 2. Fronteira e exceção de tamanho

A F52 entrega:

- enquadramento manual evidenciado por estabelecimento;
- seleção do pacote normativo vigente para a competência;
- geração dos blocos e registros aplicáveis ao perfil e às fontes cobertas;
- arquivo original e retificador internos;
- parser independente e reconciliação com os livros fechados;
- revisão humana segregada;
- TXT, manifesto JSON e diagnóstico JSON reproduzíveis;
- interface final em `Fiscal -> EFD ICMS/IPI`.

O PI aprovou expressamente esta fatia como exceção `Enorme`. A exceção vale somente para F52 e não altera a régua geral de decomposição.

Não entram Bloco K, inventário/Bloco H, PVA, assinatura, transmissão, recibo, substituição oficial, pagamento, produção ou expansão de UF, atividade, regime, período, documento ou tratamento tributário.

## 3. Recorte tributário obrigatório

### 3.1 Estabelecimento, atividade e período

- estabelecimento autorizado em Goiás, com inscrição estadual;
- comércio de autopeças adquiridas para revenda;
- competências mensais a partir de `2026-09`;
- exatamente uma EFD por estabelecimento, competência, finalidade e versão;
- livros da F51 em estado `CLOSED`, íntegros e não `STALE`.

### 3.2 Regimes

- `LUCRO_PRESUMIDO`, conforme ICMS próprio e tratamentos aprovados nas F26–F36;
- `SIMPLES_NACIONAL`, somente quando evidência específica comprovar obrigatoriedade da EFD para o estabelecimento e a vigência;
- as trilhas são incompatíveis e não compartilham totalizadores, regras ou pressupostos;
- o regime, isoladamente, nunca comprova obrigação, perfil ou conteúdo exigível.

### 3.3 ICMS e IPI

O ICMS usa exclusivamente documentos, eventos, livros e apurações aprovados nas capacidades de origem. Informação de IPI só entra quando o enquadramento evidenciado indicar contribuinte ou equiparado e houver fonte coberta para todos os registros obrigatórios.

Se o IPI ou qualquer tratamento obrigatório for aplicável sem fonte íntegra, o resultado é `INDETERMINATE`; a F52 não presume ausência, valor zero ou não incidência.

## 4. Enquadramento evidenciado

Cada estabelecimento mantém versões imutáveis de enquadramento com:

- obrigatoriedade da EFD;
- data inicial e final de vigência, quando houver;
- perfil `A`, `B` ou `C`;
- condição relativa ao IPI;
- referência oficial, data da consulta e anexo comprobatório;
- justificativa, autor e revisão humana;
- hash do conteúdo e instante imutável de criação da revisão.

O cadastro é manual e local. Não há consulta automática ao ambiente nacional ou à Sefaz. Uma revisão só pode ser aprovada por contador ou administrador e não pode sobrepor vigência já aprovada para o mesmo estabelecimento.

Enquadramento ausente, vencido, conflitante, fora da competência ou sem evidência torna a geração `INDETERMINATE`.

## 5. Pacote normativo e vigência

O gerador seleciona exatamente um pacote oficial versionado compatível com a competência, o estabelecimento e o perfil. O pacote contém, com proveniência e hash:

- leiaute nacional e Guia Prático da EFD ICMS/IPI;
- tabelas e regras nacionais vigentes;
- guia, tabelas, códigos de ajuste e orientações de Goiás;
- regras de obrigatoriedade, cardinalidade e validação por registro/campo;
- data inicial e final de vigência;
- fixtures oficiais ou sintéticas aprovadas para verificação.

Pacote ausente, ambíguo, `STALE`, incompatível ou fora da vigência bloqueia a geração. Atualizar o pacote não altera versões aprovadas; gera nova revisão e marca rascunhos dependentes como `STALE`.

## 6. Cobertura de blocos e registros

A versão inclui todos os blocos e registros aplicáveis segundo pacote, perfil, enquadramento e fontes cobertas, incluindo, quando exigidos:

- Bloco 0: abertura, identificação e referências;
- Blocos B, C e D: documentos e operações fiscais cobertos;
- Bloco E: apuração do ICMS e do IPI aplicável;
- Bloco G: controle de crédito do ativo quando houver fonte aprovada;
- Bloco 1: outras informações exigidas e cobertas;
- Bloco 9: controle, totalização e encerramento.

Ausência legitimamente não aplicável é registrada no manifesto com fundamento no pacote e no enquadramento. Registro aplicável sem fonte, cobertura ou decisão aprovada bloqueia a versão como `INDETERMINATE`.

Bloco H e inventário ficam na fatia própria de estoque e Livro Registro de Inventário. Bloco K fica em fatia própria de produção e controle de estoque. A F52 não cria cadastros, movimentações ou valores para preencher esses blocos.

## 7. Fontes e reconciliação

A geração fotografa por identificador, versão e hash:

- estabelecimento e cadastro fiscal aprovados;
- enquadramento evidenciado da seção 4;
- pacote normativo da seção 5;
- livros fechados da F51;
- NF-e modelo 55 e NFC-e modelo 65 normalizadas, com eventos posteriores;
- apurações e revisões aprovadas das F26–F36;
- declarações e ajustes manuais já aprovados nas capacidades de origem.

Documento, total ou ajuste não é corrigido dentro da F52. Divergência retorna ao produtor da informação e bloqueia a aprovação da EFD.

A reconciliação comprova, por bloco e registro:

- documentos presentes, ausentes, cancelados e devolvidos;
- bases, créditos, débitos, ajustes, estornos e saldos;
- correspondência com entradas, saídas e apuração da F51;
- contagens, totalizadores e encerramento;
- ausência de duplicação ou omissão silenciosa.

## 8. Finalidade e versões

### 8.1 Original

A primeira versão aprovada da competência tem finalidade `ORIGINAL`. Nova geração anterior à aprovação substitui somente o rascunho, preservando auditoria. Depois da aprovação, qualquer correção exige versão `RETIFICADORA`.

### 8.2 Retificadora

A retificadora exige:

- referência à versão aprovada anterior;
- justificativa obrigatória;
- nova fotografia de fontes e novo hash;
- diagnóstico das diferenças por bloco, registro e total;
- nova revisão segregada.

A aprovação interna da retificadora marca a versão anterior como `SUPERSEDED`, sem afirmar que houve substituição perante o Fisco. Não há prazo, autorização ou protocolo oficial nesta fatia.

## 9. Estados e transições

- `DRAFT`: geração em preparação;
- `INDETERMINATE`: falta ou conflito de fonte, enquadramento, pacote ou regra aplicável;
- `READY_FOR_REVIEW`: validações locais passaram e artefatos foram congelados;
- `APPROVED`: segunda pessoa aprovou a versão imutável;
- `REJECTED`: revisão recusada com motivo;
- `STALE`: fonte ou pacote fotografado mudou ou perdeu compatibilidade;
- `SUPERSEDED`: versão aprovada substituída por retificadora interna posterior.

Somente `READY_FOR_REVIEW` pode ir a `APPROVED` ou `REJECTED`. `INDETERMINATE`, `STALE`, `REJECTED` e `SUPERSEDED` não liberam artefato para uso externo.

## 10. Geração, parser e artefatos

O gerador puro recebe somente fontes fotografadas, pacote e instante explícito. Mesmos insumos produzem os mesmos registros, ordem, totais e hash lógico.

Um parser independente reabre o TXT e valida:

- codificação, delimitadores, hierarquia e ordem;
- tipo, tamanho e formato de campos;
- tabelas, chaves e referências;
- obrigatoriedade, cardinalidade e perfil;
- contagens, totalizadores e encerramento;
- reconciliação com o manifesto e as fontes.

Cada versão congelada produz:

- `efd-icms-ipi.txt` canônico;
- `manifesto.json` com identidade, finalidade, perfil, pacote, fontes, cobertura e hash;
- `diagnostico.json` com validações, reconciliações, bloqueios e diferenças da retificadora.

O hash lógico exclui instante de download e inclui somente conteúdo imutável, inclusive `revisionCreatedAtUtc` da versão.

## 11. Aprovação segregada

- auxiliar pode preparar e consultar, conforme carteira;
- contador e administrador podem preparar, revisar e aprovar;
- quem preparou ou alterou a versão não pode aprová-la;
- aprovação exige confirmação explícita do perfil, finalidade, pacote, cobertura e diagnósticos;
- tentativa negada é auditada.

Não existe autoaprovação, aprovação em lote nem exceção por ausência de segundo revisor.

## 12. Autorização, isolamento e auditoria

Todas as consultas e mutações aplicam tenant, empresa, estabelecimento e carteira. RLS protege configurações, versões, artefatos e auditoria.

Eventos append-only incluem criação, geração, bloqueio, congelamento, revisão, rejeição, aprovação, desatualização, supersessão e download, com ator, papel, correlação, origem, antes/depois, motivo e hashes.

Chave idempotente mínima: `tenantId + companyId + establishmentId + competence + purpose + sourceSetHash + rulesetHash`.

Concorrência usa versão otimista. Aprovação e supersessão são atômicas; não pode haver duas versões aprovadas ativas para a mesma finalidade e competência.

## 13. Contrato de interface

A F52 cria `Fiscal -> EFD ICMS/IPI`, como tela própria ligada à Escrituração Fiscal da F51.

A tela oferece:

- seleção de empresa, estabelecimento e competência;
- resumo do enquadramento, perfil, finalidade e pacote;
- estado da competência e das fontes;
- cobertura por bloco, com aplicável, não aplicável, bloqueado ou concluído;
- reconciliação e diagnósticos acionáveis;
- comparação da retificadora com a versão anterior;
- histórico imutável de versões e revisões;
- ações de gerar, congelar, revisar, aprovar, rejeitar e baixar artefatos conforme papel/estado.

O conteúdo parte da central de escrituração/SPED em `docs/telas/`, sem copiar transmissão, recibos, indicadores fictícios ou ações fora da fatia. Aparência e comportamento obedecem `FRONTEND.md`, `DESIGN-SYSTEM.md` e `docs/design-system/`.

Temas CLARO e ESCURO são obrigatórios, com responsividade, teclado, foco visível, contraste, leitor de tela, movimento reduzido e estados de carregamento, vazio, bloqueio, erro, sucesso e desatualização. Mensagens usam Toast Sonner; nunca `alert`.

## 14. Invariantes

| ID | Invariante |
|---|---|
| I-1 | tenant, empresa e estabelecimento nunca se misturam |
| I-2 | competência anterior a `2026-09` não é elegível |
| I-3 | somente livro F51 `CLOSED` e não `STALE` alimenta a geração |
| I-4 | Simples Nacional exige enquadramento específico comprovado |
| I-5 | perfil A/B/C vem da evidência do estabelecimento, nunca do regime |
| I-6 | exatamente um pacote vigente e compatível governa a versão |
| I-7 | registro obrigatório sem fonte íntegra produz `INDETERMINATE` |
| I-8 | versão aprovada é imutável e reproduzível |
| I-9 | retificadora referencia versão anterior e não implica substituição oficial |
| I-10 | preparador não aprova a mesma versão |
| I-11 | TXT, manifesto e diagnóstico compartilham o mesmo hash lógico |
| I-12 | nenhum fluxo executa PVA, assinatura, transmissão, recibo ou pagamento |
| I-13 | Blocos H e K não são preenchidos nesta fatia |

## 15. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | vigência, finalidade, perfis A/B/C, original/retificadora, aplicabilidade e `INDETERMINATE` |
| Regimes | Lucro Presumido válido; Simples com e sem evidência específica |
| Fontes | livro aberto, fechado, `STALE`, hashes divergentes, documento ausente e ajuste incompatível |
| Gerador | determinismo, ordem, campos, tabelas, contagens e totalizadores |
| Parser | rejeição independente de hierarquia, formato, referência, cardinalidade e soma inválidos |
| Aprovação | segregação positiva e negativa, rejeição, imutabilidade e supersessão atômica |
| Banco | RLS, carteira, idempotência, concorrência e append-only |
| Artefatos | TXT, manifesto e diagnóstico coincidem em fontes, cobertura, totais e hash |
| Contrafactuais | sem Blocos H/K, PVA, assinatura, transmissão, recibo, pagamento ou produção |
| Tela | CLARO/ESCURO, viewports, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | F51 fechada -> enquadramento -> geração -> bloqueios -> revisão segregada -> aprovação -> retificadora |

## 16. Critérios de aceite

- [ ] Geração limitada a estabelecimento de Goiás, comércio de autopeças e competência desde `2026-09`.
- [ ] Lucro Presumido e Simples Nacional permanecem em trilhas distintas.
- [ ] Simples só gera arquivo com obrigatoriedade e perfil evidenciados.
- [ ] Todos os blocos e registros aplicáveis e cobertos são gerados conforme pacote vigente.
- [ ] Registro obrigatório sem fonte ou decisão aprovada bloqueia com `INDETERMINATE`.
- [ ] TXT passa pelo parser independente e reconcilia integralmente com F51 e fontes fotografadas.
- [ ] Original e retificadora são imutáveis, vinculadas e reproduzíveis.
- [ ] Preparador e aprovador são pessoas distintas.
- [ ] TXT, manifesto e diagnóstico compartilham o mesmo hash lógico.
- [ ] RLS, carteira, auditoria, idempotência e concorrência possuem provas positivas e negativas.
- [ ] Interface final comprova temas, responsividade, estados e acessibilidade.
- [ ] Nenhum fluxo implementa Blocos H/K, PVA, assinatura, transmissão, recibo, pagamento ou produção.

## 17. Fora de escopo e destinos

| Item | Destino obrigatório |
|---|---|
| EFD-Contribuições | F53/SPEC-053, fatia própria do MVP-2 |
| Inventário, estoque, movimentação, valoração e Bloco H | fatia própria de estoque e Livro Registro de Inventário do MVP-2 |
| Produção, consumo específico padronizado e Bloco K | fatia própria de produção/estoque do MVP-2 |
| PVA e validação no programa oficial | fatia própria de validação oficial da EFD ICMS/IPI no MVP-2 |
| Assinatura, transmissão, recibo e substituição oficial | fatia própria de entrega oficial da EFD ICMS/IPI no MVP-2 |
| Expansão de UF, atividade, regime, período, documento ou tratamento | fatias próprias de expansão tributária do MVP-2 |
| Correção de documento, livro ou apuração de origem | capacidades produtoras F18 e F26–F51 |
| Malha SPED x DF-e x extrato | fatia própria de malha preventiva, após F52/F53 e fontes financeiras |

## 18. Dúvidas resolvidas

- Regimes: Lucro Presumido e Simples Nacional em trilhas distintas.
- Período: competências desde setembro de 2026.
- Cobertura: blocos aplicáveis completos, condicionados a fontes aprovadas.
- Finalidades: original e retificadora internas.
- Enquadramento: cadastro manual evidenciado por estabelecimento.
- Perfil: A/B/C conforme evidência; nunca fixado pelo sistema.
- Alçada: revisão segregada obrigatória.
- Interface: tela própria em `Fiscal -> EFD ICMS/IPI`.
- Tamanho: exceção `Enorme` expressamente aprovada e restrita à F52.
- Questões abertas: **Nenhuma**.

## 19. Gate de conformidade documental

- **Identidade:** F52/SPEC-052, MVP-2, issue #66 e origem no PRD declarados.
- **Comportamento:** enquadramento, pacote, geração, parser, revisão e versões são observáveis.
- **Aceite:** critérios verificáveis cobrem regras, banco, artefatos, tela e E2E.
- **Invariantes:** isolamento, vigência, evidência, determinismo e segregação estão explícitos.
- **Limites:** não há PVA, assinatura, transmissão, recibo, pagamento ou produção.
- **Destinos:** todos os complementos têm capacidade futura nomeada.
- **UI:** tela final, temas, estados, acessibilidade e responsividade fazem parte da fatia.
- **Tamanho:** exceção `Enorme` aprovada somente para F52.

## 20. Aprovação

Recorte aprovado pelo PI em 25/09/2026 para criação da issue e publicação documental na `main`.
