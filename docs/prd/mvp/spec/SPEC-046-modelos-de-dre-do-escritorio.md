# SPEC-046 / F46 — Modelos de DRE do escritório

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 6.2, 6.5, 7.1, 12, 14, 15 e 16; F39/SPEC-039 e F45/SPEC-045
>
> **Estado:** aprovada pelo PI em 25/09/2026
>
> **Tamanho:** Médio — biblioteca tenant-wide, versionamento, criação manual ou a partir de estrutura empresarial, aplicação unitária por cópia independente, auditoria e interface final
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #60

## 1. Objetivo

Entregar uma biblioteca de modelos de DRE no escopo do escritório contábil, para que estruturas aprovadas possam ser reutilizadas sem reconstrução manual em cada empresa. O modelo contém somente a estrutura gerencial da DRE; ao ser aplicado, cria um novo rascunho independente da F45 na empresa escolhida, sem copiar nem inferir vínculos com contas contábeis.

Sucesso significa que o escritório consegue manter e versionar vários modelos, originá-los manualmente ou de uma estrutura empresarial sanitizada, aplicar uma versão publicada em uma única empresa e obter uma cópia autônoma, rastreável e incompleta até o contador mapear explicitamente as contas da empresa.

## 2. Fronteira da fatia

Esta fatia entrega:

- biblioteca de modelos por tenant, sem `empresa_id`;
- criação manual de modelo;
- criação a partir de versão de DRE de empresa acessível, removendo todo dado empresarial;
- rascunho, validação, publicação e histórico de versões imutáveis;
- múltiplos modelos publicados coexistentes, sem modelo padrão automático;
- arquivamento e reativação da família do modelo;
- aplicação explícita de uma versão publicada em uma empresa por operação;
- criação de novo rascunho empresarial independente, sem vínculos contábeis;
- proveniência entre modelo, versão e rascunho criado;
- concorrência otimista, idempotência, RLS tenant-wide e auditoria append-only;
- interface final nos temas CLARO e ESCURO.

Não entrega aplicação em lote, propagação de atualização, vínculo automático de contas, consolidação multiempresa, orçamento, DFC, projeção de caixa, IA, escrituração, transmissão ou produção.

## 3. Identidade e conteúdo do modelo

- a unidade da biblioteca é o `tenant` do escritório;
- cada modelo possui identidade estável, nome, descrição opcional e estado `ACTIVE` ou `ARCHIVED`;
- nomes são obrigatórios; identidade e referências usam o identificador estável do modelo;
- arquivar impede novas versões e aplicações, mas preserva histórico e proveniência;
- reativar exige ação explícita e não altera nenhuma versão;
- não existe exclusão física nem reutilização silenciosa de identidade;
- vários modelos podem permanecer ativos e publicados ao mesmo tempo;
- nenhum modelo é padrão e nenhuma empresa recebe modelo automaticamente.

Cada versão carrega somente:

- árvore ordenada de linhas `DETAIL` e `SUBTOTAL`;
- código, título, tipo, ordem, nível visual e sinal de apresentação;
- componentes tipados `ADD` e `SUBTRACT` dos subtotais;
- indicação única da linha-base para análise vertical;
- metadados de versão e indicação não identificável da origem (`MANUAL` ou `COMPANY_VERSION`).

O modelo nunca carrega conta contábil, `empresa_id`, centro de custo, valor, saldo, movimento, competência, comparação, relatório, exportação ou snapshot de fechamento.

## 4. Ciclo de vida e versionamento

- versões usam `DRAFT`, `ACTIVE` e `SUPERSEDED`;
- uma família pode ter vários rascunhos, mas no máximo uma versão publicada ativa;
- criar ou clonar abre novo rascunho sem afetar a versão ativa;
- rascunho pode ser editado e descartado sem efeito sobre aplicações;
- publicar valida integralmente a estrutura e cria versão imutável, numerada de forma monotônica;
- a versão ativa anterior passa a `SUPERSEDED` na mesma transação;
- versões publicadas nunca são editadas, apagadas ou devolvidas a rascunho;
- aplicação já realizada preserva a versão de origem mesmo após substituição ou arquivamento;
- nova versão só aparece para aplicações futuras;
- concorrência usa `expectedRevision`; conflito falha sem mescla silenciosa.

Publicação não exige dupla aprovação. `admin_escritorio` e `contador` autorizados podem criar, editar e publicar modelos globais do tenant.

## 5. Origens do modelo

### 5.1 Criação manual

O usuário informa nome e descrição e recebe um rascunho vazio. Linhas, componentes e base de AV seguem integralmente as invariantes estruturais da F45.

### 5.2 Criação a partir de empresa

O usuário escolhe uma empresa acessível e uma versão existente de sua DRE. A operação copia apenas a estrutura permitida pelo §3 e registra a proveniência administrativa da origem.

- conta e vínculo contábil são sempre removidos;
- valores, movimentos, centros de custo, períodos, relatórios, hashes e snapshots não atravessam a fronteira;
- identificador, nome empresarial, CNPJ e demais dados da empresa não integram o conteúdo publicado, seu hash ou a listagem da biblioteca;
- acesso à origem respeita tenant, carteira e autorização da F45;
- versão inexistente ou inacessível falha atomicamente;
- alteração posterior na empresa não modifica o rascunho nem o modelo publicado.

## 6. Validação estrutural

O modelo reutiliza as regras estruturais da F45:

- código de linha único por versão;
- árvore sem ciclo, órfão ou nível inválido;
- `DETAIL` sem fórmula e `SUBTOTAL` sem vínculo contábil;
- subtotal com componentes explícitos, sem duplicidade e referindo apenas linhas anteriores;
- operadores limitados a `ADD` e `SUBTRACT`;
- fórmula textual ou executável proibida;
- exatamente uma linha válida como base de AV;
- sinal de apresentação não altera valor de origem nem autoriza dupla contagem.

Como não há contas no modelo, cobertura contábil não participa da publicação. A cobertura será obrigatoriamente tratada no rascunho empresarial criado pela F45.

## 7. Aplicação em empresa

- somente versão `ACTIVE` de modelo não arquivado pode ser aplicada;
- cada comando escolhe exatamente uma empresa da carteira autorizada;
- a aplicação cria um novo rascunho de estrutura da F45, mesmo quando a empresa já possui versão ativa ou outros rascunhos;
- linhas, fórmulas, ordem, apresentação e base de AV são copiados integralmente;
- nenhum vínculo com conta é criado por código, nome, classe, similaridade, histórico ou IA;
- o rascunho nasce com cobertura pendente e só pode ser publicado após o mapeamento e a validação da F45;
- aplicar não publica, substitui, mescla nem arquiva estrutura empresarial;
- modelo e cópia passam a evoluir de forma independente;
- reaplicar a mesma ou outra versão é ação explícita e cria outro rascunho;
- uma chave idempotente impede duplicação causada pela repetição técnica do mesmo comando;
- sucesso retorna o identificador do rascunho empresarial e conduz o usuário ao editor da F45.

A proveniência preserva `templateId`, `templateVersion`, autor, instante UTC, empresa de destino, rascunho criado, chave idempotente e `correlationId`. Ela é informativa e auditável; não estabelece herança.

## 8. Autorização, isolamento e auditoria

- modelo e versão possuem `tenant_id` e ficam sob RLS;
- modelo não possui `empresa_id` porque é patrimônio reutilizável do escritório;
- consulta sem tenant válido retorna nada;
- outro tenant nunca lê, clona ou aplica o modelo;
- `admin_escritorio` e `contador` criam, editam, publicam, arquivam e reativam modelos;
- leitor autorizado consulta modelos e histórico, sem mutação;
- `contador` aplica somente em empresa de sua carteira; `admin_escritorio` aplica no tenant conforme sua alçada;
- criar de empresa exige acesso atual à empresa de origem;
- criação, edição, publicação, substituição, arquivamento, reativação e aplicação geram eventos append-only;
- auditoria registra identidade, hash estrutural e, em registro separado de proveniência com a mesma autorização da empresa de origem, a empresa e a versão copiadas; esses dados não integram a versão pública do modelo;
- mutação não aceita `tenant_id` livre informado pelo cliente.

## 9. Interface

`Contábil -> Modelos de DRE` abre a biblioteca tenant-wide. A direção visual reutiliza o editor estrutural da referência da F45:

- `docs/telas/contaia_relat_rios_gerenciais_avan_ados_dre_sint_tica_anal_tica_rf_04/code.html`;
- `docs/telas/contaia_relat_rios_gerenciais_avan_ados_dre_sint_tica_anal_tica_rf_04/screen.png`.

A interface contém:

- busca e filtros por estado;
- nome, versão ativa, tipo de origem sem identificação empresarial, atualização, autor e estado visíveis;
- ações para criar manualmente ou a partir de empresa;
- editor de árvore, subtotais e base de AV;
- validação antes da publicação com erros ligados à linha correspondente;
- histórico de versões somente leitura;
- aplicação com seleção de uma empresa acessível e confirmação do novo rascunho;
- aviso explícito de que contas não serão copiadas e deverão ser vinculadas na empresa;
- arquivamento com confirmação e reativação explícita;
- navegação direta ao rascunho empresarial após aplicação.

Estados obrigatórios:

- loading e atualização preservando o último resultado válido;
- biblioteca vazia;
- rascunho vazio, válido e inválido;
- publicação em andamento, concluída, falha e conflito de revisão;
- modelo ativo, arquivado e versão superada;
- empresa de origem sem estrutura elegível;
- nenhuma empresa disponível para aplicação;
- aplicação em andamento, concluída, repetida idempotentemente e falha;
- acesso negado e empresa fora da carteira.

Toast Sonner confirma operações, sem substituir estado persistente de tela e sem `alert`. Temas CLARO/ESCURO, responsividade, teclado, foco, contraste e anúncios seguem `docs/FRONTEND.md` §20.1. `frontend-design` é obrigatória antes e durante a implementação; `impeccable` é obrigatório no passe final.

## 10. Contratos públicos mínimos

```ts
type StatementTemplateStatus = 'ACTIVE' | 'ARCHIVED';
type StatementTemplateVersionStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
type StatementTemplateOrigin =
  | { type: 'MANUAL' }
  | { type: 'COMPANY_VERSION' };

interface StatementTemplateVersion {
  templateId: string;
  version: number;
  status: StatementTemplateVersionStatus;
  origin: StatementTemplateOrigin;
  lines: readonly StatementTemplateLine[];
  structuralHash: string;
  revision: number;
}

interface ApplyStatementTemplateCommand {
  templateId: string;
  templateVersion: number;
  companyId: string;
  expectedCompanyRevision: number;
  idempotencyKey: string;
}

interface ApplyStatementTemplateResult {
  companyStatementDraftId: string;
  templateId: string;
  templateVersion: number;
  created: boolean;
}
```

Operações necessárias:

- listar, consultar, criar, renomear, arquivar e reativar família de modelo;
- criar rascunho manual ou de versão empresarial sanitizada;
- manter linhas e componentes do rascunho;
- validar e publicar com `expectedRevision`;
- listar e consultar versões históricas sem edição;
- aplicar versão ativa em uma empresa com chave idempotente;
- consultar proveniência da aplicação a partir do modelo ou do rascunho empresarial.

Erros de domínio têm códigos estáveis, incluindo no mínimo:

- `STATEMENT_TEMPLATE_NOT_FOUND`;
- `STATEMENT_TEMPLATE_ARCHIVED`;
- `STATEMENT_TEMPLATE_INVALID`;
- `STATEMENT_TEMPLATE_VERSION_CONFLICT`;
- `STATEMENT_TEMPLATE_SOURCE_NOT_FOUND`;
- `STATEMENT_TEMPLATE_SOURCE_FORBIDDEN`;
- `STATEMENT_TEMPLATE_COMPANY_FORBIDDEN`;
- `STATEMENT_TEMPLATE_APPLICATION_CONFLICT`.

HTTP segue `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`. DTO externo é validado antes do domínio e nunca é entidade de persistência.

## 11. Persistência, concorrência e idempotência

- família, versões, linhas, componentes e aplicações são persistidos separadamente;
- versão publicada e sua estrutura são imutáveis;
- hash estrutural canônico inclui somente linhas, ordem, componentes, base de AV e apresentação; exclui versão, origem, proveniência e instantes operacionais;
- número de versão e troca `ACTIVE -> SUPERSEDED` são transacionais;
- publicação concorrente com revisão vencida retorna conflito;
- chave idempotente é única por tenant e intenção de aplicação;
- repetição com a mesma chave e mesmo conteúdo retorna o rascunho original;
- mesma chave com conteúdo divergente retorna conflito;
- falha de criação do rascunho não registra aplicação concluída;
- não existe propagação assíncrona nem atualização em lote nesta fatia.

## 12. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| I-1 | modelos são isolados por `tenant_id`; rascunho aplicado recebe `tenant_id` e `empresa_id` da empresa autorizada |
| I-2 | RLS impede consulta e aplicação cruzadas; carteira limita origem e destino do contador |
| I-4 | estrutura é copiada deterministicamente; nenhuma LLM cria fórmula ou vínculo contábil |
| I-6 | publicação, substituição, arquivamento, reativação e aplicação deixam trilha append-only |
| I-7 | versão publicada, proveniência e aplicação não são apagadas |
| I-11 | instantes são armazenados em UTC e exibidos em `America/Sao_Paulo` |
| I-12 | hash reproduz exatamente a estrutura publicada; cópia registra a versão usada |

## 13. Testes e evidências

### 13.1 Regras

- valida árvore, tipos, ordem, componentes, ciclos e base única de AV;
- publica nova versão e supera a anterior sem mutação histórica;
- impede publicar modelo arquivado ou estrutura inválida;
- sanitiza integralmente origem empresarial;
- cria cópia sem contas e sem herança;
- reaplicação intencional cria novo rascunho com outra chave;
- repetição técnica com a mesma chave retorna o mesmo resultado.

### 13.2 Banco

- RLS positiva e negativa entre tenants;
- autorização de origem e destino por carteira;
- unicidade de versão ativa e monotonicidade do número;
- concorrência real de publicação e aplicação;
- imutabilidade de versão publicada e auditoria append-only;
- transação atômica entre aplicação e criação do rascunho;
- hash idêntico para estrutura canônica idêntica.

### 13.3 API

- valida DTOs, papéis, carteira, `expectedRevision` e idempotência;
- retorna `application/problem+json` com códigos estáveis;
- nunca aceita `tenant_id` ou empresa fora do contexto autorizado;
- não expõe dados empresariais na biblioteca;
- aplicação retorna o rascunho correto sem publicar estrutura da empresa.

### 13.4 Tela e E2E

- cria modelo manual e a partir de empresa;
- edita, valida, publica e consulta histórico;
- arquiva, bloqueia aplicação e reativa;
- aplica em uma empresa e navega ao rascunho incompleto;
- comprova que nenhum vínculo contábil foi copiado;
- cobre vazio, loading, erro, conflito, acesso negado e repetição idempotente;
- prova temas CLARO/ESCURO, viewports obrigatórios, teclado, foco, contraste e anúncios;
- compara capturas com a direção visual da DRE e registra correções do protótipo.

## 14. Critérios de aceite

- [ ] Escritório mantém vários modelos tenant-wide sem modelo padrão automático.
- [ ] Modelo nasce manualmente ou de versão empresarial sanitizada, sem qualquer vínculo ou dado financeiro da empresa.
- [ ] Versões publicadas são imutáveis, monotônicas e preservadas após substituição ou arquivamento.
- [ ] Admin e contador mantêm e publicam modelos; aplicação pelo contador respeita sua carteira.
- [ ] Aplicação unitária cria novo rascunho independente da F45 e não altera estrutura existente.
- [ ] Rascunho aplicado nasce sem vínculos contábeis e depende de mapeamento explícito antes da publicação.
- [ ] Nova versão ou arquivamento do modelo não modifica cópia já criada.
- [ ] Idempotência impede rascunho duplicado por repetição técnica e permite reaplicação intencional com nova chave.
- [ ] RLS e autorização impedem leitura, origem ou destino fora do tenant e da carteira.
- [ ] Auditoria preserva versão de origem, destino, autor, instante e rascunho criado.
- [ ] UI final segue a referência concreta, os dois temas e todas as provas de `FRONTEND.md` §20.1.
- [ ] Relatórios de regras, banco, API, tela e E2E ficam rastreáveis à SPEC-046 e à issue correspondente.

## 15. Fora de escopo e destino obrigatório

| Complemento | Destino obrigatório |
|---|---|
| Aplicação em lote ou para carteira inteira, com relatório por empresa | fatia própria de distribuição em lote do MVP-2 |
| Sugestão ou vínculo automático de contas por código, classe, histórico ou IA | fatia própria de mapeamento assistido do MVP-2, com revisão humana |
| Propagação de nova versão para empresas já configuradas | fatia própria de migração assistida de estruturas do MVP-2 |
| Modelo padrão aplicado automaticamente | fatia própria de automação do onboarding contábil do MVP-2 |
| Consolidação de DRE entre empresas | fatia própria de relatórios multiempresa do MVP-2 |
| Orçamento e realizado × orçado | fatia própria de planejamento financeiro do MVP-2 |
| DFC, fluxo projetado e indicadores financeiros | fatias próprias do RF-04 no MVP-2 |
| Exportação do modelo como XLSX/JSON intercambiável | fatia própria de interoperabilidade do MVP-2 |
| Produção | gate de Produção posterior ao MVP-4 |

## 16. Dúvidas resolvidas pelo PI

- O modelo copia a estrutura sem vínculos contábeis.
- O ciclo de vida possui rascunho e versões publicadas imutáveis.
- A aplicação ocorre em uma empresa por operação.
- O modelo pode nascer manualmente ou de uma versão empresarial sanitizada.
- `admin_escritorio` e `contador` podem manter e publicar modelos globais.
- Vários modelos ativos coexistem; nenhum é padrão automático.
- Aplicar sempre cria novo rascunho empresarial e não substitui estrutura existente.
- Nova versão nunca se propaga para cópias já criadas.
- Reaplicação é explícita e gera novo rascunho; repetição técnica é idempotente.
- Questões abertas: **Nenhuma**.

## 17. Gate de conformidade

| Verificação | Evidência |
|---|---|
| Identidade | cabeçalho e §§1–2 |
| Comportamento observável | §§3–9 |
| Aceite verificável | §§13–14 |
| Invariantes | §12 |
| Fora de escopo | §15, com destinos nomeados |
| Dúvidas resolvidas | §16, sem questão aberta |
| Contratos públicos | §§10–11 |
| UI | §9, com referência concreta, estados, temas, viewports e skills obrigatórias |
