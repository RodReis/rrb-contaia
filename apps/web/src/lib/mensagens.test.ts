import { CODIGOS_DE_ERRO } from '@contaia/domain';
import { describe, expect, it } from 'vitest';

import { mensagemDoCodigo } from './mensagens';

const GENERICA = 'Não foi possível concluir a operação. Tente de novo em instantes.';

describe('mensagens de usuários e convite (SPEC-007 §6)', () => {
  const codigos = [
    'EMAIL_JA_UTILIZADO',
    'EMAIL_IMUTAVEL',
    'PAPEL_OBRIGATORIO',
    'PAPEL_INVALIDO',
    'ULTIMO_ADMIN',
    'USUARIO_NAO_ENCONTRADO',
    'USUARIO_ARQUIVADO_USE_NOVO_CONVITE',
    'TRANSICAO_DE_USUARIO_INVALIDA',
    'CONVITE_INVALIDO',
    'SENHA_FRACA',
    'IDENTIDADE_INDISPONIVEL',
    'SEM_ALCADA',
    'SEM_AUTORIZACAO',
  ] as const;

  it.each(codigos)('%s tem mensagem própria, não a genérica', (codigo) => {
    const mensagem = mensagemDoCodigo(CODIGOS_DE_ERRO[codigo]);

    expect(mensagem).not.toBe(GENERICA);
    expect(mensagem.length).toBeGreaterThan(10);
  });

  it('e-mail repetido não revela de quem é', () => {
    expect(mensagemDoCodigo(CODIGOS_DE_ERRO.EMAIL_JA_UTILIZADO)).not.toMatch(/escritório|outro/i);
  });

  it('convite inválido não diz o motivo e orienta pedir novo link', () => {
    const mensagem = mensagemDoCodigo(CODIGOS_DE_ERRO.CONVITE_INVALIDO);

    expect(mensagem).toMatch(/novo link/i);
    expect(mensagem).not.toMatch(/expirou|usado|invalidado/i);
  });

  it('código desconhecido continua genérico', () => {
    expect(mensagemDoCodigo('NAO_EXISTE')).toBe(GENERICA);
  });
});

describe('mensagens da importação do plano de contas (SPEC-013)', () => {
  const codigos = [
    'TENTATIVA_NAO_ENCONTRADA',
    'ESTADO_INVALIDO_PARA_ACAO',
    'FILA_INDISPONIVEL',
    'FALHA_TECNICA',
    'ARQUIVO_VAZIO',
    'ARQUIVO_ACIMA_DO_LIMITE',
    'CABECALHO_INVALIDO',
    'MAPEAMENTO_INCOMPLETO',
  ] as const;

  it.each(codigos)('%s tem mensagem própria, não a genérica', (codigo) => {
    const mensagem = mensagemDoCodigo(CODIGOS_DE_ERRO[codigo]);

    expect(mensagem).not.toBe(GENERICA);
    expect(mensagem.length).toBeGreaterThan(10);
  });

  it('falha técnica diz que nada foi alterado e que é preciso um novo envio (a tentativa termina em FALHA)', () => {
    const mensagem = mensagemDoCodigo(CODIGOS_DE_ERRO.FALHA_TECNICA);

    expect(mensagem).toMatch(/Nenhuma conta foi alterada/u);
    expect(mensagem).toMatch(/envie o arquivo de novo/iu);
    expect(mensagem).not.toMatch(/confirme de novo|tente de novo/iu);
  });

  it('arquivo acima do limite informa 10 MB e 10.000 linhas', () => {
    const mensagem = mensagemDoCodigo(CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE);

    expect(mensagem).toMatch(/10 MB/u);
    expect(mensagem).toMatch(/10\.000 linhas/u);
  });
});
