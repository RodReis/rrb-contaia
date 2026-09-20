/**
 * Dublê da CNPJá para o E2E.
 *
 * Dublar a consulta só no navegador não basta: quando o usuário confirma a
 * aplicação, é o **servidor** quem consulta a fonte de novo, e uma interceptação
 * no navegador não alcança essa chamada — o E2E acabou gravando o retorno da
 * CNPJá real. Substituir o endpoint pelo `CNPJA_URL` cobre os dois caminhos,
 * que é o que torna a prova determinística (CI-PR.md §5).
 *
 * Responde no formato bruto do provedor, e não no da nossa rota: assim o
 * adaptador continua sendo exercitado de verdade.
 */
import { createServer } from 'node:http';

const PORTA = Number(process.env['CNPJA_DUBLE_PORTA'] ?? '15310');

/**
 * Um verbete por CNPJ que as suítes usam. O dublê substitui o provedor para o
 * processo inteiro da API, então precisa atender todas elas — CNPJ ausente aqui
 * responde 404 e muda o caminho que a suíte exercita.
 */
const RESPOSTAS = {
  // SPEC-002: cadastro e ativação a partir da consulta.
  '19131243000197': {
    taxId: '19131243000197',
    company: {
      name: 'INSTITUTO NACIONAL DE TECNOLOGIA LTDA',
      simples: { optant: false },
      simei: { optant: false },
    },
    alias: 'Instituto Tecnologia',
    status: { text: 'Ativa' },
    mainActivity: { id: 6201501 },
    sideActivities: [{ id: 6202300 }],
    phones: [{ area: '11', number: '33224455' }],
    emails: [{ address: 'contato@instituto.example' }],
    address: {
      zip: '01310100',
      street: 'Avenida Paulista',
      number: '1000',
      district: 'Bela Vista',
      city: 'Sao Paulo',
      state: 'SP',
    },
  },
  '45242914000105': {
    taxId: '45242914000105',
    company: {
      name: 'MANUTENCAO COMERCIO DE ALIMENTOS E BEBIDAS LTDA',
      simples: { optant: true },
      simei: { optant: false },
    },
    alias: 'Manutencao Alimentos',
    status: { text: 'Ativa' },
    mainActivity: { id: 4721102 },
    sideActivities: [],
    phones: [],
    emails: [],
    address: {
      zip: '74000000',
      street: 'Rua Um',
      number: '10',
      district: 'Centro',
      city: 'Goiania',
      state: 'GO',
    },
  },
};

const servidor = createServer((requisicao, resposta) => {
  const cnpj = (requisicao.url ?? '').split('/').pop()?.split('?')[0] ?? '';
  const corpo = RESPOSTAS[cnpj];

  if (corpo === undefined) {
    resposta.writeHead(404, { 'content-type': 'application/json' });
    resposta.end(JSON.stringify({ message: 'not found' }));

    return;
  }

  resposta.writeHead(200, { 'content-type': 'application/json' });
  resposta.end(JSON.stringify(corpo));
});

servidor.listen(PORTA, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[duble-cnpja] ouvindo em http://127.0.0.1:${PORTA}`);
});
