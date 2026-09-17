# ADR-006 — Máscara e validação de dado brasileiro

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
CPF, CNPJ, telefone, CEP, moeda, data e chave de acesso aparecem em quase toda tela. O CNPJ passou a admitir formato alfanumérico. Validar documento fiscal errado é deixar entrar cadastro que a Sefaz vai rejeitar depois.

## Decisão
**Máscara com `react-imask`**, encapsulada no componente `InputMasked` ([`COMPONENTS.md`](../design-system/COMPONENTS.md) §1.3). **Validação por schemas Zod próprios**, com dígito verificador de CPF e CNPJ implementado no repositório, em `lib/validators/`, com teste de tabela.

## Consequências
- O estado guarda o valor cru (só dígitos); a máscara é apresentação.
- Uma única implementação de máscara no projeto — não se escreve máscara por tela.
- O validador é nosso: testável, auditável, sem surpresa de atualização de terceiro em regra fiscal.

## Riscos
- DV de CPF/CNPJ é trivial de implementar e fácil de implementar errado: cobertura obrigatória com válido, DV errado, dígitos repetidos, tamanho errado, alfanumérico, com e sem máscara.
- Colar valor formatado precisa funcionar — caso de teste explícito.

## Alternativas descartadas
- Biblioteca brasileira de validação de terceiro: menos código nosso, mais superfície de risco num cálculo trivial e crítico.
- Máscara manual sem biblioteca: caret, paste e retrocesso são exatamente onde máscara caseira falha.
