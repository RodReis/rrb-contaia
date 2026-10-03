/**
 * Identidade e ciclo de vida do papel personalizado (SPEC-008 §3.1 e §3.5).
 *
 *   ATIVO ──arquivar (sem usuários vinculados)──▶ ARQUIVADO ──reativar (revisão)──▶ ATIVO
 *
 * Papel nunca é excluído fisicamente.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio, ErroDeValidacao } from '../erros.js';

export type EstadoDoPapel = 'ATIVO' | 'ARQUIVADO';
export type TransicaoDoPapel = 'ARQUIVAR' | 'REATIVAR';

export const TAMANHO_MAXIMO_DO_NOME = 80;
export const TAMANHO_MAXIMO_DA_DESCRICAO = 300;

/** Chave de unicidade no tenant: sem diferenciar maiúsculas, minúsculas e espaços nas pontas. */
export const normalizarNomeDoPapel = (nome: string): string =>
  nome.trim().replace(/\s+/g, ' ').toLowerCase();

export type DadosDoPapel = Readonly<{ nome: string; descricao: string | null }>;

export const validarDadosDoPapel = (entrada: Readonly<{ nome: unknown; descricao?: unknown }>): DadosDoPapel => {
  const nome = typeof entrada.nome === 'string' ? entrada.nome.trim().replace(/\s+/g, ' ') : '';
  const descricao =
    typeof entrada.descricao === 'string' && entrada.descricao.trim() !== ''
      ? entrada.descricao.trim()
      : null;

  const invalidos = [
    ...(nome === '' || nome.length > TAMANHO_MAXIMO_DO_NOME
      ? [{ campo: 'nome', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO }]
      : []),
    ...(descricao !== null && descricao.length > TAMANHO_MAXIMO_DA_DESCRICAO
      ? [{ campo: 'descricao', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO }]
      : []),
  ];

  if (invalidos.length > 0) {
    throw new ErroDeValidacao(invalidos);
  }

  return { nome, descricao };
};

const TRANSICOES: Readonly<
  Record<EstadoDoPapel, Readonly<Partial<Record<TransicaoDoPapel, EstadoDoPapel>>>>
> = {
  ATIVO: { ARQUIVAR: 'ARQUIVADO' },
  ARQUIVADO: { REATIVAR: 'ATIVO' },
};

export const transicionarPapel = (
  estado: EstadoDoPapel,
  transicao: TransicaoDoPapel,
): EstadoDoPapel => {
  const destino = TRANSICOES[estado][transicao];

  if (destino === undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.TRANSICAO_DE_PAPEL_INVALIDA,
      `Transição ${transicao} não é permitida para papel ${estado}.`,
    );
  }

  return destino;
};

/** Papel atribuído a qualquer usuário não pode ser arquivado (§3.5). */
export const garantirPapelSemVinculos = (usuariosVinculados: number): void => {
  if (usuariosVinculados > 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.PAPEL_EM_USO,
      'Remova ou substitua o papel nos usuários vinculados antes de arquivar.',
    );
  }
};
