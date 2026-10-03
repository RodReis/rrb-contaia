/**
 * Transições do cofre da empresa (SPEC-011 §3.3 a §3.5): decisões puras sobre o
 * que gravar. Quem executa — banco, Vault, transação — é o caso de uso; aqui só
 * se decide se a operação vale e qual é o próximo número de versão.
 *
 * Invariante: no máximo um vigente por empresa. O índice único parcial do banco é
 * a última defesa; estas funções são a primeira.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import { dataCivilEmSaoPaulo } from '../empresa/manutencao.js';
import { normalizarCnpj } from '../validadores/cnpj.js';
import type { ResultadoDaAvaliacao } from './avaliacao.js';

export type OperacaoDeIngestao = 'CADASTRO' | 'SUBSTITUICAO';

export type VersaoVigente = Readonly<{
  id: string;
  versao: number;
  responsavelId: string;
}>;

export type PlanoDeAtivacao = Readonly<{
  acao: OperacaoDeIngestao;
  /** Número funcional da nova versão (1, 2, 3…). */
  versao: number;
  /** Versão que deixa de ser vigente na mesma transação; nula no primeiro cadastro. */
  encerrarId: string | null;
}>;

/** Cadastro: a empresa não pode ter vigente — substituir é outra operação (outra chave). */
export const planejarCadastro = (
  vigente: VersaoVigente | null,
  ultimaVersao: number,
): PlanoDeAtivacao => {
  if (vigente !== null) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE,
      'A empresa já tem certificado vigente; envie-o como substituição.',
    );
  }

  return { acao: 'CADASTRO', versao: ultimaVersao + 1, encerrarId: null };
};

/** Substituição: exige vigente, que é encerrado pelo novo na mesma transação. */
export const planejarSubstituicao = (
  vigente: VersaoVigente | null,
  ultimaVersao: number,
): PlanoDeAtivacao => {
  if (vigente === null) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
      'A empresa não tem certificado vigente para substituir.',
    );
  }

  return { acao: 'SUBSTITUICAO', versao: ultimaVersao + 1, encerrarId: vigente.id };
};

/**
 * A operação do ticket foi decidida na emissão; entre a emissão e a ativação o estado
 * pode ter mudado (outro usuário cadastrou ou desativou). Divergência é recusa, nunca
 * conversão silenciosa de uma operação em outra.
 */
export const planejarAtivacao = (
  operacao: OperacaoDeIngestao,
  vigente: VersaoVigente | null,
  ultimaVersao: number,
): PlanoDeAtivacao =>
  operacao === 'CADASTRO'
    ? planejarCadastro(vigente, ultimaVersao)
    : planejarSubstituicao(vigente, ultimaVersao);

export const TAMANHO_MAXIMO_DO_MOTIVO = 500;

export type PlanoDeDesativacao = Readonly<{ encerrarId: string; motivo: string }>;

/** Desativação: vigente obrigatório e motivo não vazio (bloqueio no domínio, SPEC-011 §3.4/§7). */
export const planejarDesativacao = (
  vigente: VersaoVigente | null,
  motivo: string,
): PlanoDeDesativacao => {
  const texto = motivo.trim();

  if (texto.length === 0 || texto.length > TAMANHO_MAXIMO_DO_MOTIVO) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CERTIFICADO_MOTIVO_OBRIGATORIO,
      'Informe o motivo da desativação (até 500 caracteres).',
      [{ campo: 'motivo', codigo: CODIGOS_DE_ERRO.CERTIFICADO_MOTIVO_OBRIGATORIO }],
    );
  }

  if (vigente === null) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
      'A empresa não tem certificado vigente para desativar.',
    );
  }

  return { encerrarId: vigente.id, motivo: texto };
};

export type PlanoDeTrocaDeResponsavel = Readonly<{
  /** Falso quando o novo responsável já é o atual: nada a gravar (idempotente). */
  mudou: boolean;
  responsavelAnteriorId: string;
}>;

/**
 * Troca de responsável: sempre sobre o vigente, para quem é elegível. Escolher
 * o próprio responsável atual não gera evento.
 */
export const planejarTrocaDeResponsavel = (
  vigente: VersaoVigente | null,
  novoResponsavelId: string,
  novoElegivel: boolean,
): PlanoDeTrocaDeResponsavel => {
  if (vigente === null) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
      'A empresa não tem certificado vigente.',
    );
  }

  if (!novoElegivel) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO,
      'O responsável precisa ser administrador ou contador ativo com esta empresa na carteira.',
      [{ campo: 'responsavelId', codigo: CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO }],
    );
  }

  return {
    mudou: vigente.responsavelId !== novoResponsavelId,
    responsavelAnteriorId: vigente.responsavelId,
  };
};

/**
 * Reavaliação, na API, do que o cofre já conferiu no arquivo: o CNPJ do titular e a
 * vigência. O que depende do conteúdo do PKCS#12 (tipo, cadeia, chave) só o cofre vê
 * e é decidido por `avaliarCertificado`; aqui valem só os metadados que cruzam a fronteira.
 */
export const avaliarMetadadosDoCertificado = (
  metadados: Readonly<{ cnpjTitular: string; naoAntes: Date; naoDepois: Date }>,
  contexto: Readonly<{ cnpjDaEmpresa: string; agora: Date }>,
): ResultadoDaAvaliacao => {
  if (normalizarCnpj(metadados.cnpjTitular) !== normalizarCnpj(contexto.cnpjDaEmpresa)) {
    return { ok: false, codigo: 'CERTIFICADO_CNPJ_DIVERGENTE' };
  }

  const validoDe = dataCivilEmSaoPaulo(metadados.naoAntes);
  const validoAte = dataCivilEmSaoPaulo(metadados.naoDepois);
  const hoje = dataCivilEmSaoPaulo(contexto.agora);

  if (validoAte < hoje) {
    return { ok: false, codigo: 'CERTIFICADO_EXPIRADO' };
  }

  if (validoDe > hoje) {
    return { ok: false, codigo: 'CERTIFICADO_AINDA_NAO_VIGENTE' };
  }

  return { ok: true, validoDe, validoAte };
};
