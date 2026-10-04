# RASTREABILIDADE.md — Matriz normativa de requisitos

> **Normativa.** Prova para onde foi cada requisito aprovado do PRD: **mantido, transferido, adiado ou excluído**.
> **Ausência na matriz bloqueia aprovação documental** — um requisito sem linha aqui não foi decidido, foi esquecido.
> Mantida pelo **Cowork**. Regras de governança em [`README.md`](README.md).

**Atualizada em:** 19/09/2026 · **Base:** PRD v3.1 (17/09/2026)

---

## 1. Como ler

| Coluna | Significado |
|---|---|
| **Requisito** | item do PRD, na sua numeração |
| **Prioridade** | como o PRD classifica |
| **Destino** | `Mantido` (fatia deste MVP) · `Transferido` (outro MVP) · `Adiado` · `Excluído` |
| **Onde** | MVP e fatia, ou a linha de [`../../FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) |
| **Fatia / SPEC** | par alocado no Índice de [`../../STATUS.md`](../../STATUS.md) |

`—` em **Fatia / SPEC** significa **fatiamento ainda não feito**, não requisito sem destino.

---

## 2. Matriz por requisito funcional

| Requisito | Prioridade | Destino | Onde | Fatia / SPEC |
|---|---|---|---|---|
| **RF-01** Multi-tenancy, clientes e cofre de certificados | P0 | Mantido | MVP-1 | — |
| RF-01 §4.1 Cadastro, consulta e edição do escritório | P0 | Mantido | MVP-1 | F1 / SPEC-001 |
| RF-01 §4.1 Arquivamento/ciclo de vida do tenant | P0 | Transferido | MVP-4, junto ao RF-08 e ao super-admin | — |
| RF-01 §4.1 Cadastro de empresas clientes (CRUD) | P0 | Mantido | MVP-1 | F2 / SPEC-002 · F3 / SPEC-003 · F4 / SPEC-004 · F5 / SPEC-005 · F6 / SPEC-006 |
| RF-01 §4.2 Onboarding com importação do plano de contas por CSV | P0 | Mantido | MVP-1 | F13 / SPEC-013 |
| RF-01 §4.2 Onboarding com importação de empregados por CSV | P0 | Mantido | MVP-1 | F14 / SPEC-014 |
| RF-01 §4.2 Onboarding com importação por XLSX/ODS | P0 | Mantido | MVP-1 | F15 / SPEC-015 |
| RF-01 §4.3 Usuários e papéis padrão | P0 | Mantido | MVP-1 | F7 / SPEC-007 |
| RF-01 §4.3 Papéis personalizados e permissões por módulo, funcionalidade e ação | P0 | Mantido | MVP-1 | F8 / SPEC-008 |
| RF-01 §4.3 Carteira/alçada | P0 | Mantido | MVP-1 | F9 / SPEC-009 |
| RF-01 §4.4 RLS de dois níveis | P0 | Mantido | MVP-1 | F10 / SPEC-010 |
| RF-01 §4.4 impersonation auditada | P0 | Transferido | MVP-4; caminho de serviço só é exercido após o super-admin existir | — |
| RF-01 §4.5 Cofre A1 | P0 | Mantido | MVP-1 | F11 / SPEC-011 |
| RF-01 §4.5 Signer isolado, assinatura e mTLS local | P0 | Mantido | MVP-1 | F12 / SPEC-012 |
| RF-01 §4.5 Procuração RFB/e-CAC | P0 | Mantido | MVP-1 | F25 / SPEC-025 |
| RF-01 §4.5 Cofre com KMS/HSM gerenciado | P0 | **Transferido** | Etapa de produção após o MVP-4 · [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §4 · [ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md) | — |
| **RF-02** Captura automática de documentos fiscais | P0 | Mantido | MVP-1 | F17 / SPEC-017 e capacidades posteriores do RF-02 |
| RF-02 §5.1 DF-e com fila por NSU e intermediário alternativo | P0 | Mantido | MVP-1 | F17 / SPEC-017; conectores externos no GATE do MVP-1 |
| RF-02 §5.2 Manifestação: ciência automática + análise, inbox e aprovação | P0 | Mantido | MVP-1 | F19 / SPEC-019 para Ciência automática; F20 / SPEC-020 para classificação e proposta; F21 / SPEC-021 para inbox, aprovação, transmissão e reconciliação |
| RF-02 §5.3 Parse, IBS/CBS, XML original com hash, idempotência | P0 | Mantido | MVP-1 e MVP-2 | F18 / SPEC-018 para NF-e 55 e CT-e; F30 / SPEC-030 para NFC-e 65 emitida em Goiás, layouts 3.10 e 4.00, autorização e cancelamento; NFS-e e demais eventos nas capacidades próprias |
| RF-02 §5.1 NFS-e de municípios fora do padrão nacional | — | **Excluído** | PRD §1.5 · [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §2 | — |
| **RF-03** Motor de regras tributárias (base) | P0 | Mantido | MVP-1 | F16 / SPEC-016 |
| RF-03 §6.1 Regras completas por regime e vigência | P1 | Mantido | MVP-2 | F26 / SPEC-026 inicia com Simples Nacional e Lucro Presumido em Goiás; F27 / SPEC-027 cobre ICMS-ST já retido em autopeças; F28 / SPEC-028 cobre responsabilidade e cálculo por MVA nas entradas históricas de autopeças até 28/02/2018; F29 / SPEC-029 cobre complemento e restituição nas vendas internas de autopeças entre 27/10/2016 e 28/02/2018; F30 / SPEC-030 inclui a base documental de NFC-e 65 em Goiás; F31 / SPEC-031 incorpora essa NFC-e ao cálculo histórico da F29 na mesma competência; F32 / SPEC-032 trata cancelamento posterior, devolução e estorno proporcional; F33 / SPEC-033 reconstrói o histórico aprovado em pacote auditável por regime; F34 / SPEC-034 aplica acréscimos por linha do tempo legal e fontes oficiais versionadas; F35 / SPEC-035 registra decisão interna sobre destinos futuros somente quando fundamento oficial aprovado comprovar elegibilidade; F36 / SPEC-036 inicia a apuração corrente para comércio de autopeças com DAS do Anexo I e ICMS próprio em Goiás; F37 / SPEC-037 cobre PIS/Pasep e Cofins cumulativos do Lucro Presumido para autopeças em 2026, incluindo transição CBS/IBS comprovada; F38 / SPEC-038 cobre IRPJ e CSLL trimestrais do Lucro Presumido para autopeças em 2026, com mudanças normativas por vigência, deduções comprovadas e quotas locais; demais métodos, exceções, segmentos e expansão permanecem em fatias próprias |
| RF-03 §6.2 Apurações, guias e partidas dobradas | P1 | Transferido | MVP-2 | F33 / SPEC-033 cobre a reconstrução histórica do principal, F34 / SPEC-034 calcula acréscimos legais para revisão interna e F35 / SPEC-035 formaliza a decisão segregada sobre destinos futuros; F36 / SPEC-036 entrega apuração mensal interna e rascunhos locais de DAS/DARE; F37 / SPEC-037 entrega apuração mensal interna e rascunhos locais separados de DARF para PIS/Pasep e Cofins; F38 / SPEC-038 entrega apuração trimestral interna de IRPJ/CSLL, quota única ou até três quotas e rascunhos locais separados; F39 / SPEC-039 entrega o catálogo operacional; F40 / SPEC-040 entrega lançamentos manuais balanceados; F41 / SPEC-041 gera rascunhos determinísticos para DF-e e apurações aprovadas, com rateio percentual e revisão humana; F42 / SPEC-042 entrega razão analítico e balancete por período; F43 / SPEC-043 fecha e reabre competências mensais com snapshot reproduzível; F44 / SPEC-044 entrega o saldo de abertura aprovado por empresa; F45 / SPEC-045 apresenta a DRE gerencial por empresa reconciliada com o razão; F47 / SPEC-047 entrega o plano referencial por empresa e exercício; F48 / SPEC-048 formaliza Diário e Razão internos por empresa; F49 / SPEC-049 gera o arquivo ECD interno nas formas G/R/A/B/Z; F50 / SPEC-050 gera a ECF interna completa original e retificadora no Leiaute 12; F51 / SPEC-051 entrega livros e fechamento fiscal no recorte aprovado; F53 / SPEC-053 inclui apuração de CPRB somente para autopeças sob cobertura oficial inequívoca e bloqueia resultado indeterminado |
| RF-03 §6.2 SPED Fiscal e SPED Contábil (ECD) | MVP-2 | Transferido | MVP-2 | F49 / SPEC-049 gera o arquivo ECD interno completo nas formas G/R/A/B/Z, com demonstrações, signatários e J800; F51 / SPEC-051 entrega os livros fiscais de entradas, saídas e apurações com fechamento e reabertura; F52 / SPEC-052 gera internamente a EFD ICMS/IPI completa por estabelecimento de Goiás desde setembro de 2026; F53 / SPEC-053 gera internamente a EFD-Contribuições completa centralizada na matriz para competências de 2026, no Lucro Presumido cumulativo, registra a dispensa do Simples e inclui CPRB de autopeças sob cobertura oficial; F54 / SPEC-054 entrega motor de estoque, inventário físico e Bloco H; F55 / SPEC-055 entrega Bloco K restrito aos saldos e simplificado; F56 / SPEC-056 importa estrutura, produção própria e consumo; F57 / SPEC-057 importa desmontagem e movimentação interna e gera K210/K215/K220; F58 / SPEC-058 importa industrialização efetuada por terceiros e gera K250/K255; F59 / SPEC-059 importa reprocessamento e reparo no próprio estabelecimento, acompanha operações entre competências e gera K260/K265 e correções K270/K275 de origem 4; F60 / SPEC-060 gera correções K270/K275 de origem 3 para K210/K215 e origem 5 para K220; F61 / SPEC-061 importa produção conjunta própria e gera K290/K291/K292; F62 / SPEC-062 importa produção conjunta efetuada por terceiros, reconcilia industrializador e NF-e modelo 55 e gera K300/K301/K302; PVA, assinatura, transmissão, recibo e substituição oficial permanecem em capacidades próprias |
| RF-03 §6.2 ECF, IRPJ/CSLL e recuperação da ECD | MVP-2 | Transferido | MVP-2 | F50 / SPEC-050 gera a ECF interna completa original e retificadora no Leiaute 12 para 2025 e situações especiais de 2026, com recuperação da ECD, blocos aplicáveis, e-Lalur/e-Lacs e bloqueio por impacto não revisado da Parte B; PVA, assinatura, transmissão, recibo oficial, demais regimes e produção permanecem em capacidades próprias |
| RF-03 §6.3 Agenda mínima, vencimentos e alertas D-3 | P1 | Mantido | MVP-1 | F22 / SPEC-022 |
| RF-03 §6.3 Motor completo por regime/UF/CNAE, pré-requisitos, penalidades, dependências e sucessão | P1 | Transferido | MVP-2 | F63 / SPEC-063 amplia a F22 com pacote oficial curado, calendário e exigibilidade para Simples Nacional e Lucro Presumido de autopeças em Goiás, limitado às obrigações já cobertas pelas F36 a F53; F64 / SPEC-064 acrescenta penalidades e juros incorridos ou projetados, memória reproduzível e prioridade fixa por prazo; F65 / SPEC-065 acrescenta grafo oficial curado de dependências rígidas, mapeamento temporal explícito e bloqueio de baixa/conclusão até a cadeia estar satisfeita; F66 / SPEC-066 acrescenta grafo N:N de sucessão, coexistência, simulação e reavaliação no cronograma 2026–2033, mantendo destinos sem implementação em `SEM_CAPACIDADE`; demais obrigações, capacidades geradoras e expansões permanecem em fatias próprias |
| RF-03 §6.4 Malha fiscal preventiva contínua | MVP-2 | Transferido | MVP-2 | F67 / SPEC-067 cruza continuamente EFD ICMS/IPI F52, EFD-Contribuições F53, DF-e normalizados e extrato local CSV/OFX antes do fechamento F51, com tolerância fiscal zero, vínculo bancário determinístico restrito, casos versionados, correção na origem e bloqueio por crítico ou cobertura `INDETERMINATE`; Open Finance e conciliação permanecem em fatias próprias |
| **RF-04** Gestão financeira integrada | P1 | Transferido | MVP-2 | F45 / SPEC-045 entrega DRE gerencial por empresa, com estrutura versionada, comparação e exportações; F46 / SPEC-046 entrega modelos reutilizáveis do escritório, versionados e aplicados individualmente como cópia independente sem vínculos contábeis automáticos; F68 / SPEC-068 entrega o núcleo de contas a pagar e receber com títulos manuais, propostas idempotentes, parcelamento e baixa manual; F69 / SPEC-069 importa boleto de cobrança e arrecadação por PDF textual ou linha digitável e o vincula a título compatível ou cria proposta revisável; F70 / SPEC-070 entrega o núcleo local de cobrança BB por CNAB 240/400, do registro à proposta revisável de baixa; F71 / SPEC-071 entrega o ciclo avançado BB 240/400 com alteração de vencimento, desconto, protesto, sustação e baixa de registro, sem alterar automaticamente a F68; F72 / SPEC-072 entrega pagamentos locais BB CNAB 240 de boletos, tributos e convênios com código de barras, com origem F68/F69, valor exato, data explícita, bloqueio de vencidos, segregação, tentativa única, reenvio após rejeição e proposta revisável de baixa por efetivação; F73/SPEC-073 entrega manutenção local de pagamentos BB CNAB 240 originados F72, com alteração de data e valor revalidado F68/F69, cancelamento confirmado, cobertura por operação, aprovação segregada e proposta revisável de estorno vinculada à baixa F68; nova tentativa exige resolução financeira ou ausência comprovada de baixa; operação sem cobertura fica bloqueada e rastreada, sem cancelamento/reinclusão automático; F74/SPEC-074 cobre DARF comum, DARF Simples e GPS sem código de barras com guia externa validada, parcela F68 publicada, bloqueio de vencidos, remessa/retorno locais e proposta revisável de baixa por efetivação; F75/SPEC-075 entrega validação local de DARF numerado externo DCTFWeb/SicalcWeb, com PDF textual ou entrada manual com anexo, conferência humana, vínculo único F68/F69 e integração ao segmento O da F72 somente sob cobertura específica comprovada; não emite guia, consulta RFB, transmite, calcula acréscimos ou distribui baixa entre parcelas; F76/SPEC-076 entrega validação local de folha mensal líquida externa CSV/JSON contra remessa BB CNAB 240 de crédito em conta corrente BB, por empresa/competência, com comparação individual exata por CPF, destino, valor e data, líquido zero sem pagamento e retornos com histórico/divergências; somente relatório, sem cálculo de folha, geração/transmissão, pagamento ou efeito F68; outras guias, emissão/consulta RFB, rateio de guia entre parcelas, OCR financeiro, cálculo de atualização de valores, avulsos, complementos de manutenção sem cobertura, demais bancos, complementos de validação de folha, aging, fluxo, Open Finance, ITP, Pix, conciliação e contabilização automática permanecem em fatias próprias; F77/SPEC-077 confere folha mensal em poupança BB CNAB 240 com referência v2 e tipo de conta explícito, mantendo v1 para corrente, modalidade única por conferência e apenas relatório; F78/SPEC-078 amplia a conferência para conta salário BB com tipo SALARY explícito, somente relatório e conclusão positiva condicionada a cobertura BB específica e fixtures compatíveis; F79/SPEC-079 confere lotes de modalidades mistas BB por empresa/competência com referência v2 e resultado global INDETERMINATE se faltar cobertura; F80/SPEC-080 confere tipos de conta distintos dentro do mesmo lote, com diagnóstico por empregado e conclusão positiva somente sob manual BB e fixtures intralote compatíveis; F81/SPEC-081 confere arquivo BB com empresas/competências diferentes entre lotes, manifesto de atribuição integral, relatório por par e conclusão positiva condicionada à integridade global e à cobertura BB específica; F82/SPEC-082 confere pagamentos divididos de um contrato por CPF com referência v3, parcelas explícitas, relatório de efetivação parcial e conclusão positiva condicionada à cobertura BB específica, sem efeito F68 |
| RF-04 §7.2 Open Finance e ITP | P1 | Transferido | MVP-2 | — |
| RF-04 §7.3 Pix via BaaS/PSP | P1 | Transferido | MVP-2 | — |
| RF-04 §7.4 Conciliação multi-critério | P1 | Transferido | MVP-2 | — |
| **RF-05** Departamento pessoal e eSocial | P2 | Transferido | MVP-3 | — |
| **RF-06** Dashboard multi-empresa (visão consolidada) | P0 | Mantido | MVP-1 | F23 / SPEC-023 para semáforo, KPIs operacionais e drill-down; caixa e eSocial no MVP-3 |
| RF-06 §9.2 Portal do cliente white-label | MVP-3 | Transferido | MVP-3 | — |
| RF-06 §9.2 Copiloto Contábil | MVP-3 | Transferido | MVP-3 | — |
| RF-06 §9.3 Canal ativo WhatsApp/Telegram | MVP-3 | Transferido | MVP-3 | — |
| **RF-07** Agente de Captura | P1 | Mantido | MVP-1 | F17 / SPEC-017 a F21 / SPEC-021 |
| RF-07 §10.5 Compliance inicial (agenda e alertas de vencimento) | P1 | Mantido | MVP-1 | F22 / SPEC-022 |
| RF-07 §§10.1, 10.2 e 10.5 Auditoria append-only e observabilidade dos agentes do MVP-1 | P1 | Mantido | MVP-1 | F24 / SPEC-024 |
| RF-07 §10.5 Compliance completo e rascunhos de entrega | P1 | Transferido | MVP-2 | — |
| RF-07 §10.3 Agente Classificador | P1 | Transferido | MVP-2 | — |
| RF-07 §10.4 Agente Conciliador | P1 | Transferido | MVP-2 | — |
| RF-07 §10.6 Agente DP | P2 | Transferido | MVP-3 | — |
| RF-07 §10.7 Copiloto Contábil | P2 | Transferido | MVP-3 | — |
| RF-07 §10.8 Agente Coletor Ativo | P2 | Transferido | MVP-3 | — |
| RF-07 §10.1 Multi-agente colaborativo | MVP-4 | Transferido | MVP-4 | — |
| **RF-08** Administração da plataforma | P3 | Transferido | MVP-4 | — |
| RF-08 §11.2 Saúde da aplicação (tenants ativos, DAU/MAU) | P3 | Transferido | MVP-2 (não depende de billing) | — |
| RF-08 §11.1 Planos e billing | P3 | Transferido | MVP-4 | — |
| Emissão de NF-e em nome do cliente | — | **Excluído** | PRD §1.5 | — |
| ERP de estoque ou produção | — | **Excluído** | PRD §1.5 | — |
| API pública e marketplace | MVP-4 | Transferido | MVP-4; SPECs bloqueadas até o PI definir os contratos de produto | — |
| Controles e evidências preparatórias para SOC 2 e ISO 27001 | MVP-4 | Transferido | MVP-4 | — |
| Auditoria externa e certificação SOC 2 e ISO 27001 | Produção | **Transferido** | Gate de produção após o MVP-4 | — |

---

## 3. Requisitos não-funcionais (PRD §12)

Não são fatia: são **critério de aceite transversal**, verificado em toda fatia a que se apliquem.

| RNF | Onde é provado |
|---|---|
| Disponibilidade 99,9% | desenho e teste de resiliência nos MVPs; medição real no gate de produção pós-MVP-4 |
| Performance (API p95 < 500ms, dashboard < 3s, 10.000 XMLs < 15min) | [`AUDIT.md`](../../AUDIT.md) §5, por fatia |
| Escalabilidade (1.000 empresas × 100 escritórios) | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §13 |
| Segurança (TLS 1.3, AES-256, KMS, chave por tenant) | implementação local com segredos de teste; KMS e prova real no gate de produção pós-MVP-4 ([ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)) |
| Auditoria append-only | MVP-1 · F24 / SPEC-024 · [`TESTING.md`](../../TESTING.md) anti-drift; auditoria global e impersonation no MVP-4 |
| Retenção ≥ 5 anos de XML | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §5.2 |
| Observabilidade em toda integração governamental | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §12 |
| DR/Backup (RPO ≤ 1h, RTO ≤ 4h, restore mensal) | contrato e ensaio local nos MVPs; prova da infraestrutura no gate de produção pós-MVP-4 ([ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)) |
| Privacidade e proteção de dados | **fora do contrato de produto** por decisão registrada (`CLAUDE.md`); não gera requisito nem controle técnico nesta matriz |

---

## 4. Estado

Todo requisito do PRD v3.1 tem destino declarado. **A coluna Fatia / SPEC só é preenchida quando o fatiamento acontecer** — é a próxima rodada do Cowork.

Nenhuma linha desta matriz é apagada. Requisito que muda de destino recebe a atualização na própria linha, com a data.
