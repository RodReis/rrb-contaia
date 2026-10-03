import { describe, expect, it } from 'vitest';

import { permissoesDosPapeisPadrao } from '../papeis/papeis-padrao.js';
import type { PapelPadrao } from '../usuarios/papeis.js';
import {
  acoesDoCofre,
  ehResponsavelElegivel,
  podeMutarCofre,
  situacaoDoResponsavel,
} from './autorizacao.js';

describe('podeMutarCofre', () => {
  it('só admin_escritorio e contador mutam (SPEC-011 §3.2)', () => {
    expect(podeMutarCofre(['admin_escritorio'])).toBe(true);
    expect(podeMutarCofre(['contador'])).toBe(true);
    expect(podeMutarCofre(['auxiliar', 'contador'])).toBe(true);
    expect(podeMutarCofre(['auxiliar'])).toBe(false);
    expect(podeMutarCofre(['auditor_readonly'])).toBe(false);
    expect(podeMutarCofre([])).toBe(false);
  });
});

describe('situacaoDoResponsavel', () => {
  const base = { estado: 'ATIVO', papeis: ['contador'] as PapelPadrao[], vinculoAtivo: true };

  it('ativo, com papel e carteira é elegível', () => {
    expect(situacaoDoResponsavel(base)).toBe('ATIVO');
    expect(ehResponsavelElegivel(base)).toBe(true);
  });

  it.each(['SUSPENSO', 'ARQUIVADO', 'CONVIDADO'])('usuário %s é inativo', (estado) => {
    expect(situacaoDoResponsavel({ ...base, estado })).toBe('INATIVO');
    expect(ehResponsavelElegivel({ ...base, estado })).toBe(false);
  });

  it('perdeu o papel que muta: deixa de ser elegível', () => {
    expect(situacaoDoResponsavel({ ...base, papeis: ['auxiliar'] })).toBe('INATIVO');
  });

  it('perdeu a carteira: fora da carteira', () => {
    expect(situacaoDoResponsavel({ ...base, vinculoAtivo: false })).toBe('FORA_DA_CARTEIRA');
  });
});

describe('acoesDoCofre', () => {
  const todas = permissoesDosPapeisPadrao(['admin_escritorio']);
  const contexto = {
    papeis: ['admin_escritorio'] as PapelPadrao[],
    permissoes: todas,
    temVigente: false,
    empresaArquivada: false,
  };

  it('sem vigente só se pode cadastrar', () => {
    expect(acoesDoCofre(contexto)).toEqual(['CADASTRAR']);
  });

  it('com vigente: substituir, trocar responsável e desativar', () => {
    expect(acoesDoCofre({ ...contexto, temVigente: true })).toEqual([
      'SUBSTITUIR',
      'TROCAR_RESPONSAVEL',
      'DESATIVAR',
    ]);
  });

  it('exige a chave do catálogo além do papel', () => {
    expect(
      acoesDoCofre({
        ...contexto,
        temVigente: true,
        permissoes: ['certificados.cofre.consultar', 'certificados.cofre.substituir'],
      }),
    ).toEqual(['SUBSTITUIR']);
  });

  it('papel sem poder de mutação não recebe ação, mesmo com todas as chaves', () => {
    expect(acoesDoCofre({ ...contexto, papeis: ['auxiliar'], temVigente: true })).toEqual([]);
  });

  it('empresa arquivada é só consulta', () => {
    expect(acoesDoCofre({ ...contexto, empresaArquivada: true, temVigente: true })).toEqual([]);
  });
});
