/** Modelo oficial para download: cabeçalho fixo, `;`, CRLF e duas linhas de exemplo válidas. */
export const MODELO_CSV_DE_EMPREGADOS = [
  'cpf;nome;matricula;data_nascimento;data_admissao',
  '529.982.247-25;Maria da Silva;00123;15/03/1990;01/02/2015',
  '111.444.777-35;João de Souza;00124;22/11/1985;10/06/2018',
  '',
].join('\r\n');
