# Schemas oficiais NF-e/NFC-e

Arquivos extraídos sem alteração dos pacotes oficiais do Portal Nacional da NF-e. A origem é a página "Esquemas XML NF-e" do Portal Nacional, consultada em 21/10/2026. Os ZIPs foram baixados e conferidos pelo SHA-256 abaixo; os hashes identificam os pacotes de origem, não arquivos individuais.

| Layout | Pacote oficial | Publicação | SHA-256 do ZIP |
|---|---|---|---|
| 3.10 | Pacote de Liberação 8i2 (CFOP EXTERNO) | 13/04/2016 | `4089e22ea8ce88d56d33c36bda41f4f8ef517992cd93b197d22f83b84624fb30` |
| 4.00 | Pacote de Liberação 010f, NT 2025.002 v1.50 e NT 2026.007 v1.00 | 31/08/2026 | `b8589490a58a09a993a80e6ac4d7ed10f20892061ecfc56719337098d4b95998` |

O diretório 3.10 mantém os XSDs de `nfeProc` do pacote 8i2. O diretório 4.00 mantém os XSDs correntes do documento `NFe`; o pacote corrente não inclui wrapper `nfeProc`, então o protocolo é validado pela estrutura do pacote e pela coerência com o documento interno. Atualizações futuras devem ser adicionadas em diretório de versão novo, sem substituir os arquivos usados por tentativas anteriores.

Fonte: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=YIi+H8VETH0=
