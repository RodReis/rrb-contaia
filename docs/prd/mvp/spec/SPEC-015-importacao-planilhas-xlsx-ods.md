# SPEC-015 / F15 — Importação de planilhas XLSX/ODS

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.2, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Médio — acrescenta adaptadores XLSX/ODS, seleção de aba e cabeçalho, diagnósticos próprios de planilha e provas equivalentes nos dois domínios, reutilizando o pipeline, as regras e a interface das F13/F14
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #17

## 1. Objetivo

Permitir que o escritório importe e reimporte plano de contas e empregados por XLSX ou ODS, além do CSV já entregue pelas F13 e F14, sem criar regras diferentes por formato.

Sucesso significa o usuário autorizado conseguir selecionar uma planilha, escolher a aba e o cabeçalho quando necessário, mapear suas colunas e obter exatamente as mesmas validações, prévia, confirmação, aplicação, relatório, histórico, pendências e notificações do fluxo CSV correspondente.

## 2. Fronteira da fatia

Esta fatia entrega:

- XLSX e ODS como entradas do plano de contas da F13 e dos empregados da F14;
- modelos oficiais XLSX e ODS separados para cada domínio, preservando os modelos CSV;
- seleção de uma aba por tentativa;
- sugestão e escolha da linha de cabeçalho;
- adaptadores de formato para um contrato tabular normalizado comum;
- interpretação determinística de valores exibidos, datas, fórmulas, células mescladas e linhas ocultas;
- diagnósticos estruturais em tela, relatório, histórico e auditoria;
- equivalência funcional e visual entre CSV, XLSX e ODS.

A F15 não altera campos obrigatórios, chaves naturais, regras de reimportação, autorização, aceitação parcial, confirmação, cancelamento, idempotência de aplicação, pendências ou notificações definidas pelas F13 e F14.

## 3. Comportamento esperado

### 3.1 Pontos de acesso e formatos

XLSX e ODS aparecem nos mesmos pontos das importações CSV:

1. etapas de plano de contas e empregados no onboarding da empresa;
2. aba `Plano de contas` da empresa;
3. aba `Empregados` da empresa.

Cada ponto informa os formatos aceitos e oferece os modelos oficiais aplicáveis. CSV continua disponível sem regressão.

São aceitos exclusivamente arquivos `.csv`, `.xlsx` e `.ods`. Arquivos `.xls`, `.xlsm`, protegidos por senha ou criptografados são rejeitados com motivo explícito. Esses formatos são exclusões deliberadas, não complementos prometidos para outra fatia.

### 3.2 Limites

- tamanho máximo: 10 MB por arquivo;
- quantidade máxima: 10.000 linhas de dados na aba selecionada;
- linhas anteriores ao cabeçalho e linhas totalmente vazias são ignoradas e não entram no limite;
- somente uma aba é processada por tentativa;
- importar outra aba do mesmo arquivo exige nova tentativa.

O arquivo acima do limite é rejeitado antes da prévia. A implementação deve limitar também o trabalho de descompactação e parsing para impedir consumo descontrolado, sem criar um segundo limite funcional invisível ao usuário.

### 3.3 Seleção de aba

- arquivo com uma única aba utilizável a seleciona automaticamente;
- arquivo com várias abas exige escolha explícita antes do mapeamento;
- a tela mostra nome e posição da aba;
- aba vazia ou sem área tabular utilizável não pode avançar;
- abas não selecionadas não são lidas como dados nem combinadas silenciosamente;
- aba selecionada integra a identidade idempotente da tentativa.

### 3.4 Linha de cabeçalho

O sistema sugere a primeira linha preenchida da aba como cabeçalho. Antes do mapeamento, o usuário pode escolher outra linha.

- a linha escolhida precisa conter nomes de coluna utilizáveis;
- linhas anteriores são ignoradas e essa decisão aparece na prévia;
- cabeçalho com células mescladas bloqueia o mapeamento;
- cabeçalhos duplicados ou vazios recebem identificação inequívoca na interface para permitir o mapeamento sem escolher silenciosamente uma coluna;
- alterar o cabeçalho invalida mapeamento ou prévia anterior e exige nova validação;
- a linha escolhida integra a identidade idempotente da tentativa.

### 3.5 Contrato de células

O adaptador preserva, no mínimo:

- número original da linha;
- coluna original;
- nome e posição da aba;
- valor exibido;
- tipo nativo da célula;
- indicação de fórmula;
- indicação de mescla;
- indicação de linha oculta.

O valor exibido pela planilha alimenta a normalização para preservar máscaras e zeros visíveis. Datas nativas são convertidas em datas civis e depois submetidas às regras do domínio correspondente.

Nenhuma fórmula é executada. Fórmula em coluna mapeada rejeita somente a linha afetada, mesmo quando o arquivo contém um resultado calculado salvo.

Mescla no cabeçalho bloqueia o mapeamento. Mescla em coluna mapeada rejeita somente a linha afetada; o sistema não replica automaticamente o valor da primeira célula.

Linhas ocultas são processadas normalmente. A prévia informa quantas linhas ocultas foram encontradas para impedir importação silenciosa.

### 3.6 Normalização e equivalência

CSV, XLSX e ODS convergem para o mesmo contrato tabular antes das regras de domínio. Depois da normalização:

- plano de contas segue integralmente a SPEC-013;
- empregados seguem integralmente a SPEC-014;
- o formato não muda aceitação, rejeição, chave natural ou resultado aplicado;
- erro de uma linha não interrompe as demais;
- erro estrutural que impede leitura ou mapeamento rejeita o arquivo antes da prévia;
- erro de conteúdo pertence ao relatório e não vira falha técnica.

Para conteúdo semanticamente equivalente, os três formatos precisam produzir os mesmos totais, códigos de rejeição e alterações confirmadas.

### 3.7 Prévia, confirmação e aplicação

A prévia acrescenta aos dados já exigidos pelas F13/F14:

- formato do arquivo;
- aba selecionada;
- linha de cabeçalho;
- quantidade de linhas anteriores ignoradas;
- quantidade de linhas ocultas processadas;
- rejeições por fórmula ou mescla.

Nenhuma conta ou empregado muda antes da confirmação explícita. Confirmação, conflito de versão, cancelamento, aplicação transacional e tratamento de arquivados permanecem exatamente como no domínio correspondente.

### 3.8 Idempotência

A identidade da tentativa considera, no mínimo:

- tenant;
- empresa;
- domínio de importação;
- hash do arquivo;
- formato;
- aba selecionada;
- linha de cabeçalho;
- mapeamento confirmado.

Reenviar o mesmo conteúdo com a mesma configuração reutiliza o resultado terminal e não duplica tentativa aplicada, dado ou notificação. Alterar domínio, aba, cabeçalho ou mapeamento cria nova tentativa vinculada ao mesmo arquivo de origem.

### 3.9 Histórico, relatório e auditoria

O histórico continua com 15 tentativas por página, da mais recente para a mais antiga, e acrescenta:

- formato;
- aba e cabeçalho escolhidos;
- quantidade de linhas ignoradas antes do cabeçalho;
- quantidade de linhas ocultas;
- diagnósticos estruturais;
- indicação de resultado novo ou reutilizado.

O arquivo original é preservado no armazenamento local. O relatório completo continua disponível em CSV, independentemente do formato de entrada. A política produtiva de retenção permanece no gate posterior ao MVP-4.

### 3.10 Estados e falhas

Os estados das F13/F14 permanecem válidos. A interface acrescenta estados observáveis para:

- leitura da planilha;
- única aba selecionada automaticamente;
- múltiplas abas aguardando seleção;
- aba vazia ou inutilizável;
- cabeçalho sugerido, alterado ou inválido;
- arquivo protegido, criptografado, corrompido ou com formato incompatível;
- fórmulas e mesclas encontradas;
- linhas ocultas encontradas;
- limite excedido.

Falha técnica termina em `FALHA`, com `correlationId` e retry controlado. Arquivo ou configuração inválida termina em `REJEITADA` ou permanece impedido de avançar, conforme o estágio, sem HTTP 500.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | arquivo, seleção de aba/cabeçalho, staging, relatório e eventos permanecem vinculados obrigatoriamente a tenant e empresa sob RLS |
| `I-2` | leitura, prévia, histórico e download sem contexto de tenant não revelam arquivo, configuração ou resultado |
| `I-6` | seleção confirmada, parsing, rejeições, reuso e falhas integram a trilha append-only |
| `I-7` | arquivo e tentativa terminal não são apagados; nova configuração cria nova tentativa |
| `I-9` | mesmo conteúdo e mesma configuração não duplicam tentativa aplicada, conta, empregado ou notificação |
| `I-11` | datas nativas de planilha são normalizadas como datas civis; instantes da trilha usam UTC e exibição `America/Sao_Paulo` |

## 5. Contrato de interface

### 5.1 Referências concretas

- `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/screen.png`;
- `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/code.html`;
- navegação integrada em `docs/telas/prototipo/`;
- contratos específicos das interfaces nas SPEC-013 e SPEC-014.

A implementação preserva wizard, hierarquia, densidade, abas e fluxo aprovados. A F15 não cria uma terceira tela nem redesenha os domínios; adiciona controles de formato, aba, cabeçalho e diagnósticos no fluxo existente.

### 5.2 Composição adicional

1. formatos aceitos junto à área de upload;
2. downloads dos modelos CSV, XLSX e ODS do domínio atual;
3. seletor de aba quando houver mais de uma;
4. seletor da linha de cabeçalho com amostra da planilha;
5. resumo de linhas anteriores ignoradas e ocultas processadas;
6. mensagens acionáveis para fórmula, mescla, proteção, corrupção e incompatibilidade.

### 5.3 Estados obrigatórios

Além dos estados completos das F13/F14:

- arquivo XLSX/ODS selecionado;
- leitura em andamento;
- uma aba detectada;
- várias abas aguardando escolha;
- aba sem dados utilizáveis;
- cabeçalho sugerido;
- cabeçalho alterado;
- cabeçalho inválido ou mesclado;
- linhas ocultas sinalizadas;
- fórmula ou mescla rejeitada por linha;
- arquivo protegido ou criptografado;
- arquivo corrompido ou extensão incompatível com o conteúdo;
- limite de tamanho ou linhas excedido.

Toast não substitui o estado persistente da tela. Erro deve indicar como o usuário corrige o arquivo ou a seleção.

### 5.4 Responsividade e acessibilidade

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- upload, seletor de aba, seletor de cabeçalho, mapeamento, prévia e confirmação operáveis por teclado;
- foco visível e ordem previsível;
- diálogo devolve foco ao acionador;
- progresso de leitura e validação anunciado sem excesso;
- avisos não dependem somente de cor ou ícone;
- nomes longos de arquivo, aba e coluna não quebram a hierarquia;
- redução de movimento respeitada.

### 5.5 Prova visual obrigatória

A implementação usa `frontend-design` antes e durante a interface e `impeccable` no passe final. A PR prova comparação com a referência, CLARO/ESCURO, 768/1024/1440, estados, teclado, foco e acessibilidade conforme `FRONTEND.md` §20.1.

## 6. Arquitetura e contratos internos

### 6.1 Fluxo

```text
arquivo CSV | XLSX | ODS
  └─▶ adaptador do formato
       └─▶ contrato tabular normalizado
            ├─▶ pipeline do plano de contas — SPEC-013
            └─▶ pipeline de empregados — SPEC-014
```

O adaptador interpreta o arquivo, mas não decide regra de produto. Schema, normalização de domínio, validação, staging, autorização e aplicação transacional permanecem compartilhados.

### 6.2 Contratos mínimos

Além dos contratos das F13/F14, devem existir contratos tipados para:

- listar abas utilizáveis de uma tentativa;
- selecionar aba;
- obter amostra de linhas para escolher cabeçalho;
- selecionar cabeçalho;
- expor metadados e diagnósticos da planilha;
- invalidar prévia quando aba, cabeçalho ou mapeamento mudar.

Erro HTTP segue `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`.

### 6.3 Persistência e recuperação

Persistem, no mínimo:

- formato detectado;
- aba escolhida e sua posição;
- linha de cabeçalho;
- metadados relevantes de parsing;
- configuração idempotente;
- eventos append-only de leitura, seleção, validação, reuso e falha.

O worker pode repetir leitura e validação sem duplicar staging terminal. Retry usa backoff e teto de tentativas. Conteúdo compactado malicioso, expansão descontrolada ou estrutura inválida falha de modo limitado e auditável.

## 7. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| XLSX/ODS acima de 10 MB | rejeição com limite explícito |
| Mais de 10.000 linhas de dados | rejeição com limite explícito |
| Várias abas | exige seleção; nenhuma é escolhida silenciosamente |
| Aba vazia | impede avançar e permite escolher outra aba |
| Cabeçalho incorreto | usuário escolhe outra linha antes do mapeamento |
| Mescla no cabeçalho | bloqueia mapeamento com orientação acionável |
| Fórmula em coluna mapeada | rejeita somente a linha afetada |
| Mescla em coluna mapeada | rejeita somente a linha afetada |
| Linha oculta | processa e contabiliza na prévia |
| Arquivo protegido, criptografado ou corrompido | rejeição estrutural, sem prévia aplicável |
| Extensão diferente do conteúdo | rejeição com código estável |
| Mesmo arquivo e configuração | reutiliza resultado sem duplicar dado ou notificação |
| Mudança de aba, cabeçalho ou mapeamento | cria nova tentativa vinculada ao mesmo original |
| Falha do parser/worker | tentativa `FALHA`, retry controlado e correlação visível |

## 8. Stack, comandos e estrutura

### 8.1 Comandos obrigatórios

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
pnpm docker:up
pnpm docker:ps
```

### 8.2 Fronteiras esperadas

```text
apps/web/                seleção de formato, aba, cabeçalho e diagnósticos
apps/api/                autorização, configuração e consultas da tentativa
apps/workers/            adaptadores e parsing limitado
packages/shared/         contrato tabular, schemas e códigos de erro
packages/domain/         regras puras já compartilhadas pelas F13/F14
infra/db/                metadados, RLS, idempotência e append-only
tests/e2e/               equivalência e jornadas dos dois domínios
```

A biblioteca concreta de parsing é decisão técnica do Code, que deve verificar documentação atual e compatibilidade com Node 24 antes de adicioná-la.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Equivalência | conteúdo equivalente em CSV, XLSX e ODS gera mesmos totais, rejeições e aplicação |
| Planilha | uma/várias abas, aba vazia, cabeçalho alternativo, linhas anteriores e vazias |
| Células | valor exibido, zero inicial, data nativa, fórmula, mescla e linha oculta |
| Segurança do parser | protegido, criptografado, corrompido, extensão falsa e expansão limitada |
| Idempotência | mesma configuração reutiliza; aba, cabeçalho ou mapeamento diferente cria tentativa nova |
| Domínios | plano de contas mantém SPEC-013; empregados mantêm SPEC-014 |
| Banco | RLS, isolamento, configuração idempotente e trilha append-only |
| Fila | retry, teto, retomada e ausência de duplicação |
| Permissões | mesmas decisões das F13/F14 por domínio e carteira |
| Tela | referência, estados adicionais, CLARO/ESCURO, 768/1024/1440, teclado e foco |
| E2E | uma jornada XLSX e uma ODS por domínio, incluindo aceitação parcial e confirmação |

## 10. Critérios de aceite verificáveis

- [ ] Plano de contas e empregados aceitam XLSX e ODS nos mesmos pontos do CSV.
- [ ] Cada domínio oferece modelos oficiais CSV, XLSX e ODS.
- [ ] Arquivo com várias abas exige seleção e processa somente uma por tentativa.
- [ ] Cabeçalho é sugerido e pode ser alterado antes do mapeamento.
- [ ] Valor exibido e data nativa são normalizados de modo determinístico.
- [ ] Fórmula e mescla em coluna mapeada rejeitam somente a linha afetada.
- [ ] Mescla no cabeçalho bloqueia o mapeamento.
- [ ] Linhas ocultas são importadas e contabilizadas na prévia.
- [ ] XLS, XLSM e arquivo protegido, criptografado ou corrompido são rejeitados com motivo.
- [ ] Limites de 10 MB e 10.000 linhas são provados.
- [ ] CSV, XLSX e ODS semanticamente equivalentes produzem o mesmo resultado.
- [ ] Reenvio idêntico não duplica tentativa aplicada, dados ou notificações.
- [ ] Mudança de domínio, aba, cabeçalho ou mapeamento cria nova tentativa auditável.
- [ ] Plano de contas preserva integralmente comportamento, permissões e aceite da SPEC-013.
- [ ] Empregados preservam integralmente comportamento, permissões e aceite da SPEC-014.
- [ ] API e banco negam outro tenant, empresa fora da carteira e ação sem permissão.
- [ ] Falha e retry do parser não deixam staging ou aplicação duplicados.
- [ ] Prova visual cobre referência, estados adicionais, CLARO/ESCURO, 768/1024/1440, teclado, foco e passe `impeccable`.
- [ ] Jornadas E2E completas rodam no Docker local nos dois domínios e formatos.

## 11. Limites e proibições

- não aceitar XLS, XLSM ou arquivo protegido/criptografado;
- não executar fórmulas, macros ou conteúdo ativo;
- não combinar abas;
- não escolher silenciosamente uma aba quando houver várias;
- não replicar automaticamente células mescladas;
- não ignorar silenciosamente linha oculta;
- não criar validação de negócio diferente por formato;
- não alterar campos, chaves, permissões ou aplicação das F13/F14;
- não aplicar dados antes da confirmação explícita;
- não misturar arquivo, staging, relatório ou histórico entre tenants ou empresas;
- não afirmar retenção, escala ou infraestrutura produtiva.

## 12. Fora de escopo e destino do complemento

| Item | Decisão ou destino obrigatório |
|---|---|
| Cargo, salário, vínculo detalhado, dependentes, edição e ciclo cadastral de empregado | MVP-3 · futuras fatias de cadastro de empregados e DP, conforme SPEC-014 |
| Folha, regras legais, guias, eSocial e Agente DP | MVP-3 · fatias de DP/eSocial e agente, conforme SPEC-014 |
| Centros de custo, edição manual completa, vetorização, RAG e classificação automática | permanecem fora da F13 e seguem os destinos definidos pelo PRD e futuras fatias aplicáveis |
| Retenção, escala e object storage produtivos | gate de Produção após o MVP-4 |
| XLS, XLSM, macros e arquivos protegidos/criptografados | excluídos deliberadamente; não há complemento futuro comprometido |

## 13. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Abrangência | plano de contas e empregados |
| Relação com CSV | ampliar formatos e reutilizar integralmente F13/F14 |
| Abas | automática quando única; escolha do usuário quando múltiplas |
| Cabeçalho | sugerir primeira linha preenchida e permitir escolha |
| Fórmulas | rejeitar somente a linha quando estiverem em coluna mapeada |
| Limites | 10 MB e 10 mil linhas de dados |
| Modelos | XLSX e ODS separados por domínio, preservando CSV |
| Linhas ocultas | processar e sinalizar |
| Células mescladas | bloquear cabeçalho; rejeitar linha quando em coluna mapeada |
| Outros formatos | rejeitar XLS, XLSM e protegidos, sem fatia futura prometida |
| Semântica da célula | usar valor exibido; data nativa vira data civil |
| Arquitetura | adaptadores por formato para contrato tabular normalizado |
| Relatório | permanece CSV |

**Questões abertas:** nenhuma.

## 14. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §3 |
| Aceite verificável | §§9–10 |
| Invariantes tocados | §4 |
| Fora de escopo | §§11–12 |
| Dúvidas resolvidas | §13; nenhuma aberta |
| Destino do complemento | §12 |
| Contrato de UI | §5, com referências, estados, temas, viewports e provas |

## 15. Aprovação

Fronteira, leitura de planilhas, equivalência, interface, arquitetura, provas e destinos aprovados pelo PI em 18/09/2026. A implementação deve seguir esta SPEC sem criar regra adicional; lacuna material volta ao PI.
