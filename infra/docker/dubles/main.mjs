/** Ponto de entrada do contêiner do dublê. Cada efeito novo sai como uma linha JSON no stdout. */
import { readFileSync } from 'node:fs';

import { lerConfiguracaoDoDuble } from './configuracao.mjs';
import { criarDuble } from './servidor-mtls.mjs';

const configuracao = lerConfiguracaoDoDuble(process.env);

const duble = criarDuble({
  nome: configuracao.nome,
  certificadoPem: readFileSync(configuracao.arquivoDoCertificado, 'utf8'),
  chavePem: readFileSync(configuracao.arquivoDaChave, 'utf8'),
  caDosClientesPem: readFileSync(configuracao.arquivoDaCaDosClientes, 'utf8'),
  registrarEfeito: (efeito) => console.log(JSON.stringify({ evento: 'efeito', ...efeito })),
});

const porta = await duble.ouvir(configuracao.porta, '0.0.0.0');

console.log(JSON.stringify({ evento: 'ouvindo', duble: configuracao.nome, porta }));

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    void duble.fechar().then(() => process.exit(0));
  });
}
