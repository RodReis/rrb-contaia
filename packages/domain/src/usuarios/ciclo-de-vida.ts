/**
 * Ciclo de vida do usuário do escritório (SPEC-007 §3.3).
 *
 *   CONVIDADO ──aceite──▶ ATIVO ──suspender──▶ SUSPENSO ──reativar──▶ ATIVO
 *   ATIVO | SUSPENSO ──arquivar──▶ ARQUIVADO ──novo convite──▶ CONVIDADO
 *
 * `CONVITE_EXPIRADO` não é estado persistido: é a apresentação de um
 * `CONVIDADO` cujo convite venceu, preservando cadastro e papéis para reenvio.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import { PAPEIS_PADRAO, ehPapelPadrao, type PapelPadrao } from './papeis.js';

export type EstadoDoUsuario = 'CONVIDADO' | 'ATIVO' | 'SUSPENSO' | 'ARQUIVADO';
export type SituacaoApresentada = EstadoDoUsuario | 'CONVITE_EXPIRADO';
export type Transicao =
  | 'ACEITAR'
  | 'SUSPENDER'
  | 'REATIVAR'
  | 'ARQUIVAR'
  | 'REENVIAR'
  | 'NOVO_CONVITE';

const TRANSICOES: Readonly<
  Record<EstadoDoUsuario, Readonly<Partial<Record<Transicao, EstadoDoUsuario>>>>
> = {
  CONVIDADO: { ACEITAR: 'ATIVO', REENVIAR: 'CONVIDADO' },
  ATIVO: { SUSPENDER: 'SUSPENSO', ARQUIVAR: 'ARQUIVADO' },
  SUSPENSO: { REATIVAR: 'ATIVO', ARQUIVAR: 'ARQUIVADO' },
  ARQUIVADO: { NOVO_CONVITE: 'CONVIDADO' },
};

export const transicionar = (estado: EstadoDoUsuario, transicao: Transicao): EstadoDoUsuario => {
  const destino = TRANSICOES[estado][transicao];

  if (destino === undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.TRANSICAO_DE_USUARIO_INVALIDA,
      `Transição ${transicao} não é permitida para usuário ${estado}.`,
    );
  }

  return destino;
};

export const situacaoApresentada = (
  usuario: Readonly<{ estado: EstadoDoUsuario; conviteExpiraEm: Date | null }>,
  agora: Date,
): SituacaoApresentada => {
  if (usuario.estado !== 'CONVIDADO') {
    return usuario.estado;
  }

  const convitePendente =
    usuario.conviteExpiraEm !== null && agora.getTime() < usuario.conviteExpiraEm.getTime();

  return convitePendente ? 'CONVIDADO' : 'CONVITE_EXPIRADO';
};

/** Ao menos um papel, todos do catálogo padrão, sem repetição (ordem preservada). */
export const validarPapeis = (papeis: readonly string[]): readonly PapelPadrao[] => {
  if (papeis.length === 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.PAPEL_OBRIGATORIO,
      'Selecione ao menos um papel para o usuário.',
    );
  }

  const validos: PapelPadrao[] = [];

  for (const papel of papeis) {
    if (!ehPapelPadrao(papel)) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.PAPEL_INVALIDO,
        `Papel inválido. Use um destes: ${PAPEIS_PADRAO.join(', ')}.`,
      );
    }

    if (!validos.includes(papel)) {
      validos.push(papel);
    }
  }

  return validos;
};

/** O escritório mantém ao menos um `admin_escritorio` ativo. */
export const podePerderAdministracao = (adminsAtivosRestantes: number): boolean =>
  adminsAtivosRestantes >= 1;
