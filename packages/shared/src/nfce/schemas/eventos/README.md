# Schemas do evento de cancelamento NFC-e

Artefatos obtidos do diretório oficial do Portal Fiscal SVRS em 21/10/2026:
<https://dfe-portal.svrs.rs.gov.br/Schemas/PRNFE/>. O portal lista o schema de
cancelamento `e110111_v1.00.xsd` com atualização em 04/07/2025, além dos schemas
de leiaute e processamento do evento.

| Arquivo | SHA-256 |
|---|---|
| `e110111_v1.00.xsd` | `24DC2C8008013E6CFB7ED00CD45BD9A06E702D25D17B574AE828ECE4B189A74A` |
| `leiauteEvento_v1.00.xsd` | `96E00E3072502EEA960DC8AE449D75630D87F591A00D2C0872EA4BC62DFA1E71` |
| `leiauteSRE_v1.00.xsd` | `87F1CF19D820CD949EABF87BE11345FFB76DBCDD6A8A2DAA43C5BDE85FE333B2` |
| `procEventoNFe_v1.00.xsd` | `D04AB2BE295BE24CA76AE7CE2E6CB25851530772D11F78A3C7BA6D6E5175A9EB` |
| `tiposBasico_v1.03.xsd` | `BCE65C0C6100E33C8C3A33D59CA59CEDEC81903AB7E1CF8951234FF9FDCB9CA5` |
| `xmldsig-core-schema_v1.01.xsd` | `F56744A5F51C03F027DE13F39F869307091781A9EF1D91B1EBE14719CE28E1AC` |

O worker valida o envelope `procEventoNFe` com os schemas do processamento, a
estrutura de `detEvento` com `e110111`, e a assinatura XMLDSig sobre `infEvento`.
