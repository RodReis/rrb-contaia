import { describe, expect, it } from 'vitest';
import { classificarFaixaDeConfianca, decidirPropostaDeManifestacao, valorMonetarioParaCentavos } from './policy.js';

describe('policy fiscal risk', () => {
  it.each([
    ['0', 0n],
    ['0.3', 30n],
    ['125.30', 12_530n],
    ['1000.1000000000', 100_010n],
  ])('converte valor decimal %s sem perda para centavos', (valor, esperado) => {
    expect(valorMonetarioParaCentavos(valor)).toBe(esperado);
  });

  it.each(['', '-1.00', '1,25', '1.001', 'Infinity', ' 1.00'])('recusa valor fora do formato fiscal exato: %s', (valor) => {
    expect(valorMonetarioParaCentavos(valor)).toBeNull();
  });

  it.each([
    [0, 'INCONCLUSIVA'],
    [0.4999, 'INCONCLUSIVA'],
    [0.5, 'ATENCAO'],
    [0.8499, 'ATENCAO'],
    [0.85, 'PRONTA_PARA_REVISAO'],
    [1, 'PRONTA_PARA_REVISAO'],
  ] as const)('classifica confiança %s sem confundi-la com risco', (confianca, faixa) => {
    expect(classificarFaixaDeConfianca(confianca)).toBe(faixa);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])('abstém para confiança inválida %s', (confianca) => {
    expect(classificarFaixaDeConfianca(confianca)).toBe('ABSTER_SE');
  });

  it('sugere confirmação apenas com fornecedor aprovado, limite respeitado e três compras dentro de 3x a média', () => {
    expect(decidirPropostaDeManifestacao({fornecedorAprovado:true,dentroDoLimite:true,valorEmCentavos:30_000n,comprasAnteriores12Meses:3,totalHistoricoEmCentavos:30_000n,conflito:false})).toMatchObject({tipo:'210200',confianca:0.85});
  });

  it('abstém quando fornecedor aprovado está ausente; ausência não vira desconhecimento', () => {
    expect(decidirPropostaDeManifestacao({fornecedorAprovado:false,dentroDoLimite:true,valorEmCentavos:10_000n,comprasAnteriores12Meses:4,totalHistoricoEmCentavos:40_000n,conflito:false})).toMatchObject({tipo:'ABSTER_SE',riscos:['FORNECEDOR_NAO_APROVADO']});
  });

  it('abstém quando o valor excede 3x a média histórica', () => {
    expect(decidirPropostaDeManifestacao({fornecedorAprovado:true,dentroDoLimite:true,valorEmCentavos:40_000n,comprasAnteriores12Meses:3,totalHistoricoEmCentavos:30_000n,conflito:false})).toMatchObject({tipo:'ABSTER_SE',riscos:['VALOR_ACIMA_DE_TRES_VEZES_A_MEDIA_HISTORICA']});
  });

  it.each([
    [{tipo:'NAO_SOLICITADA',referencias:['operacao:nao-solicitada:pedido-123']},'210220'],
    [{tipo:'PARTICIPACAO_SEM_REALIZACAO',referencias:['operacao:participacao-confirmada:entrega-123','operacao:nao-realizada:entrega-123']},'210240'],
  ] as const)('sugere %s apenas com evidência positiva referenciada', (evidencia,tipo) => {
    expect(decidirPropostaDeManifestacao({fornecedorAprovado:null,dentroDoLimite:null,valorEmCentavos:null,comprasAnteriores12Meses:null,totalHistoricoEmCentavos:null,evidenciaConclusiva:evidencia,conflito:false})).toMatchObject({tipo});
  });

  it('abstém diante de evidência conclusiva sem referência verificável', () => {
    expect(decidirPropostaDeManifestacao({fornecedorAprovado:true,dentroDoLimite:true,valorEmCentavos:10_000n,comprasAnteriores12Meses:3,totalHistoricoEmCentavos:30_000n,evidenciaConclusiva:{tipo:'NAO_SOLICITADA',referencias:[]},conflito:false})).toMatchObject({tipo:'ABSTER_SE',lacunas:expect.arrayContaining(['EVIDENCIA_CONCLUSIVA_SEM_REFERENCIA'])});
  });

  it('exige referências explícitas de participação e não realização para 210240', () => {
    expect(decidirPropostaDeManifestacao({fornecedorAprovado:null,dentroDoLimite:null,valorEmCentavos:null,comprasAnteriores12Meses:null,totalHistoricoEmCentavos:null,evidenciaConclusiva:{tipo:'PARTICIPACAO_SEM_REALIZACAO',referencias:['operacao:participacao-confirmada:entrega-123']},conflito:false})).toMatchObject({tipo:'ABSTER_SE',lacunas:['EVIDENCIA_CONCLUSIVA_SEM_REFERENCIA']});
  });

  it('abstém quando há conflito de sinais mesmo com fornecedor e valor compatíveis', () => {
    expect(decidirPropostaDeManifestacao({fornecedorAprovado:true,dentroDoLimite:true,valorEmCentavos:10_000n,comprasAnteriores12Meses:3,totalHistoricoEmCentavos:30_000n,conflito:true})).toMatchObject({tipo:'ABSTER_SE',riscos:['SINAIS_CONTRADITORIOS']});
  });
});
