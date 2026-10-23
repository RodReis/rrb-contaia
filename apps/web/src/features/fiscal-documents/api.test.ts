import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ler } from '../importacao/api';
import { listarDocumentosFiscais } from './api';

vi.mock('../importacao/api',()=>({ler:vi.fn()}));

describe('listarDocumentosFiscais',()=>{
  beforeEach(()=>vi.mocked(ler).mockResolvedValue({pagina:1,temProximaPagina:false,itens:[{
    id:'01a168ba-5762-7f92-671d-fbf6095602b5',especie:'NFE_55',chave_acesso:'3333…3333',hash_sha256:'b'.repeat(64),emitido_em:'2017-01-15T02:00:00.000Z',
    emitente:null,destinatario:null,total:null,estado:'PROCESSADO',versao_layout:'4.00',criado_em:'2026-10-23T12:25:57.687Z',nsu:null,capturado_em:null,atividade_em:null,origens:0,
  }]}));

  it('aceita identificador persistido em formato UUID sem exigir bits RFC de variante',async()=>{
    const result=await listarDocumentosFiscais('01a168ba-5762-7f92-671d-fbf6095602b5',1,'TODOS');
    expect(result.itens[0]?.id).toBe('01a168ba-5762-7f92-671d-fbf6095602b5');
  });
});
