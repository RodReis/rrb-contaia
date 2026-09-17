# LANDSCAPE.md — Cenário competitivo

> **Documento datado.** Serve para uma coisa: **não reconstruir o que já existe de graça** e não subestimar o que já é commodity.
> **Não é contrato e não altera escopo.** Mudança de escopo por causa daqui passa pelo PI, com ADR e rastreabilidade.

**Levantado em:** 17/09/2026 · **Revisar:** a cada fecho de fase, ou quando um gatilho do §6 disparar.

---

## 1. As três camadas do mercado

O mercado brasileiro não é um bloco. São três camadas com dinâmicas diferentes, e o ContaIA atravessa as três — o que é a oportunidade e o risco.

| Camada | Quem ocupa | Característica |
|---|---|---|
| **Sistema contábil de escritório** | Domínio (Thomson Reuters), Alterdata, Questor, Mastermaq, Sage, Contmatic | Incumbentes com décadas de base instalada, escrituração completa e forte custo de troca |
| **Captura e guarda de XML** | Qive (ex-Arquivei), Nuvem Fiscal, Focus NFe, PlugNotas, Fiscal.io, Avalara | **Commodity.** Preço por CNPJ, API madura, vários deles vendem como infraestrutura |
| **Contabilidade como serviço** | Contabilizei, Agilize e similares | Não vendem software: vendem o serviço, com software próprio por dentro |

---

## 2. O que já é commodity — e não se reconstrói para vender

- **Download de XML da Sefaz por DF-e, manifestação e guarda.** Existe pronto, barato, com API. O PRD já trata intermediário homologado como **via alternativa** (§5.1) — a decisão certa: é infraestrutura, não diferencial.
- **Emissão de documento fiscal.** Fora do escopo por decisão (PRD §1.5), e corretamente: é um mercado próprio, já saturado de APIs.
- **Consulta de CNPJ e situação cadastral.**
- **Boleto, Pix e CNAB.** BaaS e PSP resolvem.

**Consequência prática:** vender "captura automática de XML" como diferencial em 2026 é chegar tarde. O diferencial é **o que acontece depois que o XML chega**.

---

## 3. O que os incumbentes já fazem bem

Subestimar isto é o erro caro:

- Escrituração fiscal e contábil completa, com SPED, ECD e obrigações acessórias de décadas de manutenção regulatória.
- Folha e eSocial maduros, com histórico de rejeição já mapeado.
- Rede de contadores, treinamento, suporte e integração com ERPs do cliente final.
- Atualização legal contínua — a parte mais cara e menos glamorosa do produto.

**Custo de troca é o fosso real.** Escritório não troca de sistema contábil por uma tela melhor: troca por migração assistida e por dor operacional grande o bastante.

---

## 4. Onde o ContaIA tem chance real

Cruzando o que é commodity com o que os incumbentes fazem mal:

1. **Painel multi-empresa priorizado por risco financeiro.** O incumbente mostra lista; o PRD promete semáforo e alerta ordenado por multa iminente (§9). Isso é produto, não estética.
2. **Procedência de IA explícita.** Distinguir, sem clicar, o que a máquina propôs do que o humano conferiu ([`PATTERNS.md`](design-system/PATTERNS.md) §4). Ninguém no mercado tradicional resolve isso — e é o que torna IA utilizável num domínio com responsabilidade legal.
3. **Malha preventiva contínua**, cruzando SPED × DF-e × extrato **antes** do fechamento, no lugar do relatório estático de fim de mês (PRD §6.4).
4. **Cobrança ativa do cliente** em D-2 por WhatsApp, em vez de portal passivo (PRD §10.8). A dor operacional número um do escritório é documento que não chega.
5. **Reforma Tributária como janela.** Documentos já circulam com campos de IBS/CBS desde 03/08/2026, e o cronograma até 2033 obriga todo mundo a reescrever motor de regras. **Sistema legado com regra fiscal cravada no código sofre; motor versionado por vigência, não.** É a única janela em anos em que custo de troca cai para todo o mercado ao mesmo tempo.

---

## 5. O que já morreu — ou nunca pegou

- **"Contabilidade 100% automática, sem contador."** Esbarra em responsabilidade técnica: quem assina é o profissional com CRC. Produto que promete substituir o contador vende para quem não decide a compra.
- **Classificação contábil por regras DE/PARA construídas à mão.** Centenas de regras por cliente, que quebram a cada fornecedor novo. O PRD já substitui por auto-tagging vetorial com histórico do próprio cliente (§10.3) — decisão certa.
- **Portal passivo de documentos.** Existe em todo sistema e não resolve: o cliente não entra. Daí o canal ativo.
- **Chatbot genérico sobre legislação, sem fonte.** Alucinação em norma fiscal destrói confiança na primeira resposta errada. Daí a exigência de citação e verificador (§10.7).

---

## 6. Gatilhos que obrigam a revisar este documento

| Gatilho | O que muda |
|---|---|
| Incumbente lançar procedência de IA/HITL visível no painel | O diferencial nº 2 vira paridade — reavaliar posicionamento |
| Provedor de captura lançar camada de classificação e conciliação por IA | Concorrência sobe uma camada; nº 1 e nº 3 ficam mais críticos |
| Mudança de cronograma da Reforma Tributária | A janela do §4.5 se desloca |
| Regulação de IA aprovada com exigência de revisão humana | **Reforça** a arquitetura HITL já escolhida |
| Sefaz ou padrão nacional de NFS-e ampliar cobertura municipal | Muda a conversa de cobertura com o cliente |
| Entrada de fintech/BaaS oferecendo Open Finance + conciliação a escritórios | Ataca o RF-04 pela lateral |

---

## 7. Como usar isto

- **Antes de especificar uma fatia**, perguntar: isso é commodity que se compra, ou é um dos cinco pontos do §4?
- Commodity: **integrar, não construir** — e registrar em [`FORA-DE-ESCOPO.md`](FORA-DE-ESCOPO.md).
- Diferencial: **construir com prova** — critério de aceite mensurável no PRD.

---

## Fontes e leitura

Levantamento qualitativo a partir de material público dos fornecedores e de comparativos de mercado consultados em 17/09/2026. Nenhum número de participação de mercado é afirmado aqui — quando for necessário, deve vir de fonte primária datada.

- [Thomson Reuters — Soluções Domínio](https://www.dominiosistemas.com.br/)
- [Qive (ex-Arquivei)](https://qive.com.br/)
- [Nuvem Fiscal](https://nuvemfiscal.com.br/) · [Avalara — captura de documentos fiscais](https://www.avalara.com/br/pt/solucoes/captura-de-documentos-fiscais.html)
- [Comparativo de sistemas contábeis 2026 — Ledware](https://www.ledware.com.br/2026/04/28/comparativo-sistemas-contabeis-escritorios-2026-dominio-alterdata-mastermaq-ledcontabil/)
