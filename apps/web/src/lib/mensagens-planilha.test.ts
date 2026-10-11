/** Códigos da importação de planilhas (SPEC-015 §3.10): cada um com frase própria e acionável. */
import { CODIGOS_DE_ERRO_DE_PLANILHA } from '@contaia/shared';
import { describe, expect, it } from 'vitest';

import { mensagemDoCodigo } from './mensagens';

const GENERICA = 'Não foi possível concluir a operação. Tente de novo em instantes.';

describe('mensagens da importação de planilhas', () => {
  it.each(CODIGOS_DE_ERRO_DE_PLANILHA)('%s tem mensagem própria, sem detalhe interno', (codigo) => {
    const mensagem = mensagemDoCodigo(codigo);

    expect(mensagem).not.toBe(GENERICA);
    expect(mensagem).not.toMatch(/stack|zip|xml|ssf|saxes|processo filho/iu);
  });

  it('planilha sem aba utilizável diz o que conferir', () => {
    expect(mensagemDoCodigo('PLANILHA_SEM_ABA_UTILIZAVEL')).toMatch(/envie de novo/u);
  });
});
