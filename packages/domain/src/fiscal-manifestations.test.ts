import { describe, expect, it } from 'vitest';
import { elegivelManifestacao, ordenarInboxManifestacao, validarJustificativaManifestacao, hashPayloadManifestacao } from './fiscal-manifestations.js';

describe('manifestação conclusiva', () => {
  it('normaliza e valida xJust entre 15 e 255 caracteres', () => {
    expect(validarJustificativaManifestacao('  Motivo formal suficiente  ')).toBe('Motivo formal suficiente');
    expect(validarJustificativaManifestacao('curto')).toBeNull();
    expect(validarJustificativaManifestacao('x'.repeat(256))).toBeNull();
  });
  it('ordena por prazo, risco, valor e chave estável', () => {
    const items = [{prazoRestanteMs:2,risco:1,totalCentavos:1n,chaveAcesso:'b'},{prazoRestanteMs:1,risco:1,totalCentavos:1n,chaveAcesso:'z'},{prazoRestanteMs:2,risco:2,totalCentavos:1n,chaveAcesso:'c'}];
    expect(ordenarInboxManifestacao(items).map(x=>x.chaveAcesso)).toEqual(['z','c','b']);
  });
  it('recusa documentos fora da elegibilidade fiscal', () => {
    const base={especie:'NFE_55',modelo:'55',estado:'PROCESSADO',destinatario:'123',cnpjEmpresa:'123',prazoVigente:true,jaManifestado:false,impeditivoConhecido:false,tipoProposto:'210200'};
    expect(elegivelManifestacao(base)).toBe(true);
    expect(elegivelManifestacao({...base,especie:'CTE'})).toBe(false);
    expect(elegivelManifestacao({...base,prazoVigente:false})).toBe(false);
    expect(elegivelManifestacao({...base,tipoProposto:'ABSTER_SE'})).toBe(false);
  });
  it('gera hash canônico independente da ordem das propriedades',()=>{
    expect(hashPayloadManifestacao({tipo:'210240',conteudo:{z:1,a:2}})).toBe(hashPayloadManifestacao({conteudo:{a:2,z:1},tipo:'210240'}));
  });
});
