import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsearDocumentoFiscal } from '@contaia/shared/fiscal-document-parser';
import { criarDuble, type Duble } from '../../../infra/docker/dubles/servidor-mtls.mjs';
import { criarPki, emitirPfx, raizConfiavelEmPem } from '../../../scripts/gerar-pki-de-teste.mjs';
import { criarPkiMtls, emitirServidorDoDuble } from '../../../scripts/gerar-pki-mtls-de-teste.mjs';
import { consultarProcNFeNoDestino, transmitirCienciaNoDestino } from './dfe-ciencia-destino.js';

const CNPJ = '11222333000181';
const CHAVE = '35240112345678000195550010000000011000000019';
const pkiA1 = criarPki();
const pkiMtls = criarPkiMtls();
const certificadoServidor = emitirServidorDoDuble(pkiMtls, { dns: 'duble-dfe' });
const certificado = emitirPfx(pkiA1, { cnpj: CNPJ });
let servidor: Duble;
let porta = 0;

beforeAll(async () => {
  servidor = criarDuble({ nome: 'duble-dfe', certificadoPem: certificadoServidor.certificadoPem,
    chavePem: certificadoServidor.chavePem, caDosClientesPem: raizConfiavelEmPem(pkiA1) });
  porta = await servidor.ouvir(0, '127.0.0.1');
});
afterAll(async () => servidor.fechar());

const base = (chaveIdempotente: string) => ({
  destino: { host: '127.0.0.1', porta, servername: 'duble-dfe', caminho: '/v1/manifestacao' },
  pfx: certificado.pfx, senha: certificado.senha, caPem: pkiMtls.dubles.certificadoPem,
  cnpj: CNPJ, chaveAcesso: CHAVE, chaveIdempotente, tempoLimiteMs: 2_000,
});
const xmlAssinado = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe"><evento><infEvento Id="ID210210${CHAVE}01"><CNPJ>${CNPJ}</CNPJ><chNFe>${CHAVE}</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento></infEvento></evento><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"></Signature></envEvento>`;

describe('porta mTLS da Ciência e recuperação por chave', () => {
  it('classifica aceite oficial simulado e reutiliza a identidade em repetição', async () => {
    const first = await transmitirCienciaNoDestino({ ...base('ciencia-stable-001'), xml: xmlAssinado });
    const count = servidor.efeitos();
    const repeated = await transmitirCienciaNoDestino({ ...base('ciencia-stable-001'), xml: xmlAssinado });
    expect(first).toMatchObject({ tipo: 'ACEITO', codigo: '135', chaveAcesso: CHAVE, cnpj: CNPJ, tipoEvento: '210210', sequencia: 1, ambiente: 'HOMOLOGACAO' });
    expect(repeated.protocolo).toBe(first.protocolo);
    expect(servidor.efeitos()).toBe(count);
  });

  it('reconcilia duplicidade do mesmo evento por outra chave sem novo efeito', async () => {
    const first = await transmitirCienciaNoDestino({ ...base('ciencia-key-first'), xml: xmlAssinado });
    const count = servidor.efeitos();
    const duplicate = await transmitirCienciaNoDestino({ ...base('ciencia-key-retry'), xml: xmlAssinado });
    expect(duplicate).toMatchObject({ tipo: 'DUPLICIDADE', codigo: '573', protocolo: first.protocolo, chaveAcesso: CHAVE, cnpj: CNPJ });
    expect(servidor.efeitos()).toBe(count);
  });

  it('consulta procNFe por chave sem usar NSU e valida identidade no pipeline fiscal', async () => {
    await transmitirCienciaNoDestino({ ...base('ciencia-before-query'), xml: xmlAssinado });
    const recovered = await consultarProcNFeNoDestino({ ...base('recovery-key-001'), destino: { ...base('x').destino, caminho: '/v1/distribuicao-chave' } });
    expect(recovered.tipo).toBe('OBTIDO');
    const parsed = parsearDocumentoFiscal(Buffer.from(recovered.xmlCompleto ?? ''), 'NFE_55');
    expect(parsed.chaveAcesso).toBe(CHAVE);
    expect(parsed.destinatario).toBe(CNPJ);
  });
});
