# SPEC-047 / F47 — Plano referencial contábil por empresa

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 4.2, 6.2, 6.5, 12, 14, 15 e 16; F39/SPEC-039
>
> **Estado:** aprovada pelo PI em 25/09/2026
>
> **Tamanho:** Grande — pacote oficial versionado, mapeamento por empresa e exercício, vínculo-base com exceções por centro, CSV atômico, histórico, auditoria e interface final; livros e geração da ECD permanecem separados
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #61

## 1. Objetivo

Entregar o plano referencial contábil por empresa e exercício, vinculando as contas analíticas da F39/SPEC-039 ao pacote oficial aplicável. O usuário autorizado mantém um vínculo-base por conta, acrescenta exceções explícitas por centro de custo quando necessário e publica versões imutáveis prontas para consumo pelas futuras fatias de livros e ECD.

Sucesso significa que o escritório consegue selecionar um pacote oficial cuja cobertura esteja comprovada, concluir o DE-PARA manualmente ou por CSV, justificar contas não aplicáveis, atingir cobertura integral, publicar uma versão reproduzível e consultar seu histórico sem gerar livro, arquivo ECD, transmissão ou efeito no razão.

## 2. Fronteira da fatia

Esta fatia entrega:

- catálogo local de pacotes oficiais curados, versionados e imutáveis;
- origem, data da fonte, cobertura declarada, hash e vigência de cada pacote;
- configuração por empresa e exercício civil;
- aplicabilidade explícita para Lucro Presumido e configuração opcional para Simples Nacional;
- rascunho, validação, publicação, substituição e histórico de versões;
- vínculo-base de conta contábil para conta referencial;
- exceção opcional por combinação de conta e centro de custo;
- fotografia dos códigos de centros ativos da F39 usados pela versão;
- marcação `NOT_APPLICABLE` com justificativa e revisão humana;
- edição manual e importação CSV com prévia atômica;
- cobertura de todas as contas analíticas ativas elegíveis;
- RLS, carteira, concorrência otimista e auditoria append-only;
- interface final nos temas CLARO e ESCURO.

Não entrega sugestão automática, inferência por IA, livros Diário/Razão formais, arquivo ECD, validação no PVA, assinatura, transmissão, ECF, SPED Fiscal, efeito em lançamentos, alteração do razão ou declaração automática de obrigação legal.

## 3. Pacote oficial referencial

Cada pacote oficial possui:

- identificador e versão interna imutáveis;
- órgão e documento de origem;
- URL oficial de origem;
- leiaute e revisão declarados pela fonte;
- ano-calendário e situações especiais expressamente cobertos;
- instante de obtenção e hash SHA-256 do arquivo bruto;
- conjunto normalizado de contas referenciais com código, descrição, natureza, hierarquia, vigência e estado;
- hash canônico do conteúdo normalizado;
- estado `AVAILABLE`, `SUPERSEDED` ou `REVOKED`.

A fonte inicial é a tabela oficial da ECF leiaute 12, atualização de 07/09/2026, restrita à cobertura declarada de ano-calendário 2025 e situações especiais de 2026. Ela não autoriza publicação para o ano-calendário ordinário de 2026.

- pacote sem origem oficial, hash ou cobertura explícita não fica disponível;
- revisão oficial nova cria outro pacote e não altera o anterior;
- pacote superado continua consultável e reproduz versões já publicadas;
- revogação impede novas publicações, sem apagar versões empresariais existentes;
- o sistema nunca estende vigência, regime ou situação por semelhança;
- ausência de pacote aplicável produz `INDETERMINATE`, nunca seleção automática da versão mais próxima;
- importação e curadoria de pacote são processo interno versionado, não edição livre do usuário da empresa.

## 4. Aplicabilidade por regime e exercício

A configuração pertence a uma empresa e a um exercício civil:

- Lucro Presumido: o usuário seleciona somente pacote cuja cobertura oficial inclua o exercício ou a situação especial informada;
- Simples Nacional: a configuração é opcional e nunca declara obrigação de ECD ou ECF;
- outro regime não entra nesta fatia;
- obrigação, dispensa ou entrega facultativa não é inferida por regime, CNAE, porte, movimento ou histórico;
- aplicabilidade sem evidência suficiente fica `INDETERMINATE` e bloqueia publicação;
- situação especial exige tipo e período compatíveis com a cobertura declarada do pacote.

O ano-calendário ordinário de 2026 permanece `INDETERMINATE` até existir pacote oficial aplicável. A interface explica a falta de cobertura e não oferece contorno manual.

## 5. Ciclo de vida e versionamento

Cada empresa pode possuir vários rascunhos e versões históricas por exercício:

- estados de versão: `DRAFT`, `PUBLISHED` e `SUPERSEDED`;
- criar rascunho fixa empresa, exercício, regime, situação aplicável e pacote oficial;
- esses campos não mudam no rascunho; correção exige novo rascunho;
- rascunho aceita edição manual, importação CSV e descarte explícito;
- publicação valida pacote, cobertura, natureza, duplicidade, justificativas e autorização;
- publicação cria versão imutável e monotônica por empresa e exercício;
- a versão publicada anterior passa a `SUPERSEDED` na mesma transação;
- substituição permanece permitida com competências mensais fechadas porque não altera lançamentos, razão nem snapshots da F43;
- versão anterior, seus vínculos, justificativas, centros fotografados e hashes permanecem íntegros;
- não existe exclusão física nem retorno de versão publicada a rascunho;
- concorrência usa `expectedRevision`; conflito falha sem mescla silenciosa.

## 6. Mapeamento de contas e centros

### 6.1 Cobertura elegível

Toda conta analítica ativa da F39 no momento da publicação entra na cobertura. Conta sintética, incompleta ou arquivada não recebe vínculo publicável.

Cada conta elegível possui exatamente uma decisão-base:

- `MAPPED`, com um código referencial válido no pacote; ou
- `NOT_APPLICABLE`, com justificativa obrigatória, autor e revisão humana registrada.

Não existe estado implícito. Conta elegível sem decisão mantém a versão incompleta. `NOT_APPLICABLE` não é inferido por classe, código, nome, ausência de movimento ou regime.

### 6.2 Vínculo-base e exceção por centro

- o vínculo-base aplica-se à conta quando a classificação independe de centro de custo;
- uma exceção pode substituir o vínculo-base para um par conta analítica + centro analítico ativo;
- cada par conta/centro aponta para no máximo uma conta referencial;
- a exceção não altera o cadastro da conta nem do centro na F39;
- a versão fotografa código e identidade dos centros usados, reutilizando o código imutável da F39;
- não existe alias específico de ECD nesta fatia;
- centro sintético ou arquivado não pode receber exceção nova;
- duas exceções para o mesmo par são rejeitadas;
- ausência de exceção usa a decisão-base da conta.

O modelo representa o registro I051 do leiaute 9 sem gerar o arquivo: uma conta pode manter classificação geral e variar por centro, mas cada combinação resolve para no máximo uma referência.

### 6.3 Compatibilidade

- conta referencial precisa pertencer ao pacote fixado no rascunho;
- conta referencial arquivada, revogada ou fora da vigência não pode ser selecionada;
- natureza contábil da F39 e natureza oficial precisam ser compatíveis;
- divergência de natureza bloqueia validação e publicação;
- o sistema não corrige classe da F39 nem altera natureza oficial para fazer o vínculo caber;
- código inexistente ou ambíguo mantém pendência explícita.

## 7. Edição manual e importação CSV

### 7.1 Edição manual

O usuário pesquisa por código, nome, classe, estado de cobertura e centro. A seleção exibe descrição, hierarquia, natureza, pacote e vigência antes de confirmar.

Alterar decisão-base ou exceção modifica somente o rascunho. Versão publicada é somente leitura.

### 7.2 CSV

O CSV identifica conta por código imutável da F39, centro opcional por seu código imutável e decisão `MAPPED` ou `NOT_APPLICABLE`.

- `MAPPED` exige código referencial;
- `NOT_APPLICABLE` exige justificativa e proíbe código referencial;
- linha de conta sem centro altera a decisão-base;
- linha com centro cria ou substitui a exceção daquele par no rascunho;
- conta, centro ou referência desconhecidos são erros por linha;
- duplicidade lógica no arquivo é erro;
- arquivo é validado integralmente antes da aplicação;
- prévia informa criações, alterações, itens sem mudança, erros e cobertura resultante;
- confirmar aplica tudo em uma transação; qualquer divergência posterior à prévia cancela o lote inteiro;
- repetir a mesma importação no mesmo estado não duplica vínculos;
- o arquivo não cria conta, centro, pacote nem referência.

## 8. Publicação e cobertura

Publicação exige cumulativamente:

- pacote oficial ainda utilizável e aplicável ao recorte declarado;
- 100% das contas analíticas ativas com decisão-base explícita;
- justificativa presente em todo `NOT_APPLICABLE`;
- todas as exceções com conta, centro e referência válidos;
- compatibilidade de natureza;
- nenhuma conta incompleta da F39 no conjunto elegível;
- revisão atual sem conflito concorrente;
- autorização do usuário e empresa na carteira.

A cobertura apresenta total elegível, mapeadas, não aplicáveis justificadas, pendentes, exceções por centro e erros bloqueantes. Percentual de cobertura não substitui a lista nominal.

Publicar registra hash canônico do pacote, decisões-base, exceções, justificativas e fotografia dos centros. Ordem de linhas, instante de download e metadados visuais não alteram o hash.

## 9. Autorização, isolamento e auditoria

- pacote oficial é catálogo global somente leitura; configuração empresarial possui `tenant_id` e `empresa_id` sob RLS;
- consulta sem tenant retorna nada;
- `admin_escritorio` mantém e publica em empresas do tenant;
- `contador` mantém e publica somente em empresa da carteira ativa;
- `auxiliar` e `auditor_readonly` consultam conforme alçada, sem mutação;
- demais papéis são negados por padrão;
- mutações não aceitam `tenant_id` ou empresa livre fora do contexto autorizado;
- criação, importação, validação, publicação, substituição, descarte e tentativa negada relevante geram auditoria append-only;
- auditoria registra autor, empresa, exercício, pacote, revisão, hashes, contagem, instante UTC e `correlationId`;
- nenhum evento de auditoria autoriza transmissão ou afirma obrigação legal.

## 10. Interface

A mesma tela é acessada por:

- `Empresa -> Estrutura contábil -> Plano referencial`;
- `Contábil -> Plano referencial`, com seleção prévia de empresa acessível.

A direção visual parte de:

- `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/code.html`, para plano de contas, pendências e importação;
- `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/code.html`, para cobertura, conformidade e contexto de ECD.

O protótipo é referência de conteúdo e fluxo, não contrato. A tela final segue `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

A interface contém:

- empresa, exercício, regime, situação e pacote fixados no cabeçalho do rascunho;
- alerta visível para configuração opcional do Simples Nacional;
- estado `INDETERMINATE` com a evidência oficial ausente;
- indicadores de cobertura e lista nominal de pendências;
- grade hierárquica de contas com decisão-base e exceções expansíveis por centro;
- busca do plano referencial com natureza e vigência;
- edição manual, importação CSV, prévia, confirmação e relatório de erros;
- validação pré-publicação com caminhos de correção;
- confirmação de publicação ou substituição;
- histórico imutável com comparação entre versões;
- origem oficial, revisão e hashes consultáveis.

Estados obrigatórios:

- loading inicial e atualização preservando o último estado válido;
- sem rascunho, rascunho vazio, parcial, válido e inválido;
- pacote disponível, superado, revogado, incompatível e ausente;
- `INDETERMINATE` para cobertura oficial insuficiente;
- CSV selecionado, analisando, prévia válida, prévia inválida, aplicando e falha;
- publicação em andamento, concluída, conflito e falha;
- versão publicada, superada e histórico vazio;
- acesso negado e empresa fora da carteira.

Toast Sonner confirma operações, sem `alert` e sem substituir o estado persistente. Temas CLARO/ESCURO, viewports 768/1024/1440, teclado, foco, contraste e anúncios seguem `docs/FRONTEND.md` §20.1. `frontend-design` é obrigatória antes e durante a implementação; `impeccable` é obrigatório no passe final.

## 11. Contratos públicos mínimos

```ts
type ReferencePackageStatus = 'AVAILABLE' | 'SUPERSEDED' | 'REVOKED';
type ReferenceMappingStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
type ReferenceDecision =
  | { type: 'MAPPED'; referenceAccountCode: string }
  | { type: 'NOT_APPLICABLE'; reason: string };
type MappingApplicability = 'APPLICABLE' | 'OPTIONAL' | 'INDETERMINATE';

interface ReferencePackage {
  referencePackageId: string;
  layout: string;
  revision: string;
  coveredCalendarYears: readonly number[];
  coveredSpecialSituations: readonly string[];
  sourceUrl: string;
  sourceSha256: string;
  canonicalSha256: string;
  status: ReferencePackageStatus;
}

interface ReferenceMappingEntry {
  accountId: string;
  costCenterId: string | null;
  decision: ReferenceDecision;
}

interface ReferenceMappingVersion {
  mappingId: string;
  companyId: string;
  calendarYear: number;
  referencePackageId: string;
  applicability: MappingApplicability;
  version: number | null;
  status: ReferenceMappingStatus;
  entries: readonly ReferenceMappingEntry[];
  canonicalSha256: string | null;
  revision: number;
}
```

Operações necessárias:

- listar e consultar pacotes e contas referenciais;
- consultar aplicabilidade por empresa, exercício e situação;
- criar, consultar e descartar rascunho;
- manter decisão-base e exceção por centro;
- criar prévia CSV e aplicá-la atomicamente;
- validar cobertura e listar pendências;
- publicar ou substituir com `expectedRevision`;
- listar e consultar versões históricas e auditoria.

Erros de domínio incluem no mínimo:

- `REFERENCE_PACKAGE_NOT_FOUND`;
- `REFERENCE_PACKAGE_NOT_APPLICABLE`;
- `REFERENCE_PACKAGE_REVOKED`;
- `REFERENCE_MAPPING_INDETERMINATE`;
- `REFERENCE_MAPPING_INCOMPLETE`;
- `REFERENCE_ACCOUNT_NATURE_MISMATCH`;
- `REFERENCE_MAPPING_DUPLICATE_PAIR`;
- `REFERENCE_MAPPING_VERSION_CONFLICT`;
- `REFERENCE_MAPPING_CSV_INVALID`;
- `REFERENCE_MAPPING_FORBIDDEN`.

HTTP segue `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`. DTO externo é validado antes do domínio e nunca é entidade de persistência.

## 12. Persistência, concorrência e reprodução

- pacote, contas referenciais, família empresarial, rascunhos, versões, decisões, exceções e importações são persistidos separadamente;
- versão publicada e pacote consumido são imutáveis;
- número da versão e troca `PUBLISHED -> SUPERSEDED` são transacionais;
- publicação concorrente com revisão vencida retorna conflito;
- prévia CSV guarda hash do arquivo, revisão esperada e resumo, sem aplicar linhas;
- confirmação valida novamente pacote, revisão e catálogos F39 antes da transação;
- hash canônico ordena por identidade estável de conta e centro e inclui decisão, justificativa, pacote e exercício;
- alteração posterior de nome na F39 não reescreve versão publicada;
- alteração incompatível da estrutura F39 aparece como pendência em novo rascunho;
- nenhuma operação desta fatia grava lançamento, razão, fechamento ou arquivo oficial.

## 13. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| I-1 | configuração, versões e importações empresariais têm `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 | pacote é somente leitura; dados empresariais não aparecem sem tenant, empresa e carteira autorizados |
| I-4 | compatibilidade, cobertura e hashes são determinísticos; LLM não escolhe conta referencial |
| I-6 | publicação, substituição, importação e decisões deixam trilha append-only |
| I-7 | versão publicada, justificativa e proveniência não são apagadas |
| I-8 | pacote é aplicado somente à vigência e situação declaradas pela fonte oficial |
| I-11 | exercício é data civil sem fuso; instantes são UTC e exibidos em `America/Sao_Paulo` |
| I-12 | versão publicada fixa pacote e conteúdo canônico para reprodução futura |

## 14. Testes e evidências

### 14.1 Regras

- aceita pacote somente dentro da cobertura oficial;
- mantém 2026 ordinário `INDETERMINATE` sem pacote aplicável;
- exige decisão-base para toda conta analítica ativa;
- valida `NOT_APPLICABLE` com justificativa;
- resolve vínculo-base e exceção por centro sem duplicidade;
- rejeita natureza divergente, referência inexistente e centro inelegível;
- publica nova versão e preserva a anterior;
- permite substituição sem alterar competência fechada.

### 14.2 Banco

- RLS positiva e negativa entre tenants e empresas;
- carteira do contador e leitura dos demais papéis;
- unicidade de versão publicada e do par conta/centro;
- concorrência real de publicação e importação;
- imutabilidade do pacote e da versão publicada;
- transação atômica de CSV e troca de versão;
- auditoria append-only e hash reproduzível.

### 14.3 API e CSV

- valida DTOs, papéis, carteira e `expectedRevision`;
- prévia não altera rascunho;
- erros por linha impedem aplicação parcial;
- repetição não duplica vínculo;
- alteração entre prévia e confirmação cancela o lote;
- retorna `application/problem+json` com códigos estáveis;
- nunca aceita tenant, empresa, pacote ou centro fora do contexto válido.

### 14.4 Tela e E2E

- cria rascunho aplicável e exibe indisponibilidade `INDETERMINATE`;
- mantém decisões manualmente e por CSV;
- abre e resolve exceção por centro;
- bloqueia publicação incompleta e orienta a correção;
- publica, substitui e consulta histórico imutável;
- prova Simples Nacional como configuração opcional sem declarar obrigação;
- cobre loading, vazio, erro, conflito, acesso negado e empresa fora da carteira;
- prova temas CLARO/ESCURO, 768/1024/1440, teclado, foco, contraste e anúncios;
- compara capturas com as duas referências e registra correções de débito do protótipo.

Comandos obrigatórios:

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

## 15. Critérios de aceite

- [ ] Pacotes oficiais preservam origem, cobertura, revisão, arquivo bruto e hashes sem extrapolar vigência.
- [ ] Ano-calendário ordinário de 2026 permanece `INDETERMINATE` enquanto não houver pacote oficial aplicável.
- [ ] Lucro Presumido usa somente pacote compatível; Simples Nacional permite configuração opcional sem inferir obrigação.
- [ ] Toda conta analítica ativa possui decisão-base mapeada ou não aplicável com justificativa antes da publicação.
- [ ] Vínculo-base aceita exceção por centro e cada par conta/centro resolve para no máximo uma referência compatível.
- [ ] Centros reutilizam os códigos imutáveis da F39 e não recebem alias ECD.
- [ ] Edição manual e CSV produzem a mesma regra; prévia é sem efeito e aplicação é atômica.
- [ ] Versões publicadas são imutáveis, monotônicas e preservadas após substituição.
- [ ] Substituir mapeamento não altera lançamentos, razão nem competência fechada.
- [ ] Admin e contador mantêm e publicam conforme tenant e carteira; demais papéis respeitam leitura ou negação.
- [ ] RLS e auditoria impedem vazamento e preservam toda decisão relevante.
- [ ] Nenhuma operação gera livro, arquivo, validação, assinatura ou transmissão ECD.
- [ ] UI final segue as referências concretas, os dois temas e todas as provas de `FRONTEND.md` §20.1.
- [ ] Relatórios de regras, banco, API, tela e E2E ficam rastreáveis à SPEC-047 e à issue correspondente.

## 16. Fora de escopo e destino obrigatório

| Complemento | Destino obrigatório |
|---|---|
| Livros Diário e Razão formais, termos e numeração legal | fatia própria de livros contábeis do MVP-2 |
| Geração dos registros e do arquivo ECD | fatia própria de geração da ECD do MVP-2 |
| Validação em PVA, assinatura, transmissão, recibo e substituição oficial | fatias próprias de validação e entrega da ECD no MVP-2 |
| Plano referencial para outros regimes e entidades | fatias próprias de expansão referencial do MVP-2 |
| Pacote aplicável ao ano-calendário ordinário de 2026 | atualização oficial versionada nesta capacidade quando publicada; sem inferência até lá |
| Sugestão de vínculo por código, classe, histórico, similaridade ou IA | fatia própria de mapeamento assistido do MVP-2, com revisão humana |
| Atualização automática de pacotes por rede | fatia própria de sincronização de tabelas oficiais do MVP-2 |
| Importação XLSX/ODS do DE-PARA | fatia própria de interoperabilidade do MVP-2 |
| ECF e recuperação de ECD pela ECF | fatia própria de ECF do MVP-2 |
| SPED Fiscal | fatia própria de SPED Fiscal do MVP-2 |
| Produção | gate de Produção posterior ao MVP-4 |

## 17. Dúvidas resolvidas pelo PI

- F47 cobre o plano referencial contábil antes dos livros e da geração ECD.
- Contas recebem vínculo-base; combinações conta-centro podem sobrescrever a referência.
- Cada par conta/centro aponta para no máximo uma conta referencial.
- Centros reutilizam o código imutável da F39 e não recebem alias ECD.
- Pacotes oficiais são curados por vigência, origem e hash.
- A entrada ocorre manualmente e por CSV atômico, sem sugestões.
- Publicação exige 100% das contas analíticas ativas com decisão explícita.
- Versões valem por exercício e podem ser substituídas sem reabrir competência mensal.
- `admin_escritorio` e `contador` mantêm e publicam conforme alçada.
- A mesma tela possui entrada pela empresa e pelo módulo Contábil.
- Lucro Presumido e Simples Nacional entram; no Simples a configuração é opcional e não afirma obrigação.
- O pacote inicial cobre somente ano-calendário 2025 e situações especiais de 2026; 2026 ordinário fica `INDETERMINATE`.
- Questões abertas: **Nenhuma**.

## 18. Gate de conformidade

| Verificação | Evidência |
|---|---|
| Identidade | cabeçalho e §§1–2 |
| Comportamento observável | §§3–10 |
| Aceite verificável | §§14–15 |
| Invariantes | §13 |
| Fora de escopo | §16, com destinos nomeados |
| Dúvidas resolvidas | §17, sem questão aberta |
| Contratos públicos | §§11–12 |
| UI | §10, com referências concretas, estados, temas, viewports e skills obrigatórias |

## 19. Aprovação

Fronteira, pacote oficial, recorte por regime e exercício, modelo conta/centro, cobertura, ciclo de vida, autorização, interface, provas e destinos aprovados pelo PI em 25/09/2026. A implementação deve seguir esta SPEC sem inferir obrigação fiscal, vigência ou compatibilidade ausente; lacuna material volta ao PI.
