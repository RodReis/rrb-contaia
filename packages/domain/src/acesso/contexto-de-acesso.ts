/**
 * Contexto de acesso ao banco (SPEC-010 §3.1–§3.3, §7).
 *
 * Descreve QUEM acessa, EM QUE escritório e para QUE finalidade. O banco recebe
 * esse contexto dentro da transação e as políticas de RLS decidem a partir dele:
 * o papel define o que o usuário faz, a carteira define em quais empresas, e a
 * RLS impede que a persistência ultrapasse o recorte. Tudo aqui é cálculo puro.
 *
 * Fail-closed: contexto incompleto ou incoerente lança antes de qualquer consulta.
 * Controller e payload externo nunca montam este contexto — a aplicação o deriva
 * da sessão validada (humano) ou do trabalho validado (técnico).
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';

/**
 * - `COMUM`: só linhas do tenant cujas empresas estão na carteira ativa do usuário.
 * - `ADMIN_ACESSO`: gestão de usuários, papéis e carteiras (F7–F9). Lê o cadastro
 *   básico das empresas do tenant e escreve vínculos; nunca abre dado operacional
 *   de empresa fora da carteira.
 * - `LOCALIZACAO_BASICA_EMPRESA`: leitura do cadastro básico de uma empresa do
 *   tenant para compor o 403 da F9 e checar duplicidade de CNPJ. Somente leitura.
 */
export const FINALIDADES_HUMANAS = ['COMUM', 'ADMIN_ACESSO', 'LOCALIZACAO_BASICA_EMPRESA'] as const;
export const FINALIDADES_ADMINISTRATIVAS = ['ADMIN_ACESSO', 'LOCALIZACAO_BASICA_EMPRESA'] as const;

/**
 * Finalidade de job técnico: uma por tipo de trabalho, sempre presa a um tenant e
 * a uma empresa. Cada fatia que introduzir um worker acrescenta a sua aqui.
 */
export const FINALIDADES_TECNICAS = ['PROCESSAMENTO_DE_EMPRESA'] as const;

export type FinalidadeHumana = (typeof FINALIDADES_HUMANAS)[number];
export type FinalidadeAdministrativa = (typeof FINALIDADES_ADMINISTRATIVAS)[number];
export type FinalidadeTecnica = (typeof FINALIDADES_TECNICAS)[number];

export type ContextoHumano = Readonly<{
  origem: 'HUMANA';
  tenantId: string;
  usuarioId: string;
  finalidade: FinalidadeHumana;
  correlationId: string | null;
}>;

export type ContextoTecnico = Readonly<{
  origem: 'TECNICA';
  identidadeTecnica: string;
  finalidade: FinalidadeTecnica;
  tenantId: string;
  empresaId: string;
  correlationId: string;
}>;

export type ContextoDeAcesso = ContextoHumano | ContextoTecnico;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TAMANHO_MAXIMO_DE_TEXTO = 128;

const recusar = (motivo: string): never => {
  throw new ErroDeDominio(
    CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO,
    `Contexto de acesso inválido: ${motivo}.`,
  );
};

const exigirUuid = (valor: string, nome: string): string =>
  UUID.test(valor) ? valor : recusar(`${nome} ausente ou malformado`);

const exigirTexto = (valor: string, nome: string): string =>
  valor.trim().length > 0 && valor.length <= TAMANHO_MAXIMO_DE_TEXTO
    ? valor
    : recusar(`${nome} ausente ou longo demais`);

const ehFinalidadeHumana = (valor: string): valor is FinalidadeHumana =>
  (FINALIDADES_HUMANAS as readonly string[]).includes(valor);

const ehFinalidadeTecnica = (valor: string): valor is FinalidadeTecnica =>
  (FINALIDADES_TECNICAS as readonly string[]).includes(valor);

export type EntradaDoContextoHumano = Readonly<{
  tenantId: string;
  usuarioId: string;
  finalidade?: FinalidadeHumana;
  correlationId?: string | null;
}>;

/** Contexto de requisição autenticada: `COMUM` salvo pedido explícito do caso de uso. */
export const contextoHumano = (entrada: EntradaDoContextoHumano): ContextoHumano => {
  const finalidade: string = entrada.finalidade ?? 'COMUM';

  if (!ehFinalidadeHumana(finalidade)) {
    return recusar('finalidade não é humana');
  }

  return {
    origem: 'HUMANA',
    tenantId: exigirUuid(entrada.tenantId, 'tenant'),
    usuarioId: exigirUuid(entrada.usuarioId, 'usuário'),
    finalidade,
    correlationId:
      entrada.correlationId === undefined || entrada.correlationId === null
        ? null
        : exigirTexto(entrada.correlationId, 'correlationId'),
  };
};

export type EntradaDoContextoTecnico = Readonly<{
  identidadeTecnica: string;
  finalidade: FinalidadeTecnica;
  tenantId: string;
  empresaId: string;
  correlationId: string;
}>;

/** Contexto de job: não simula usuário, não recebe carteira e não tem bypass. */
export const contextoTecnico = (entrada: EntradaDoContextoTecnico): ContextoTecnico => {
  if (!ehFinalidadeTecnica(entrada.finalidade)) {
    return recusar('finalidade não é técnica');
  }

  return {
    origem: 'TECNICA',
    identidadeTecnica: exigirTexto(entrada.identidadeTecnica, 'identidade técnica'),
    finalidade: entrada.finalidade,
    tenantId: exigirUuid(entrada.tenantId, 'tenant'),
    empresaId: exigirUuid(entrada.empresaId, 'empresa'),
    correlationId: exigirTexto(entrada.correlationId, 'correlationId'),
  };
};

/**
 * Nova finalidade para um trecho da MESMA transação (ex.: criar empresa e
 * autoatribuí-la). Só o contexto humano muda de finalidade; job técnico não.
 */
export const trocarFinalidade = (
  contexto: ContextoDeAcesso,
  finalidade: FinalidadeHumana,
): ContextoHumano => {
  if (contexto.origem !== 'HUMANA') {
    return recusar('job técnico não troca de finalidade');
  }

  return contextoHumano({
    tenantId: contexto.tenantId,
    usuarioId: contexto.usuarioId,
    finalidade,
    correlationId: contexto.correlationId,
  });
};

/** Variáveis de sessão que a transação grava com `set_config(..., true)` (= `SET LOCAL`). */
export type ParametrosDeSessao = Readonly<{
  'app.tenant_id': string;
  'app.origem': 'HUMANA' | 'TECNICA';
  'app.usuario_id': string;
  'app.empresa_id': string;
  'app.finalidade': string;
  'app.identidade_tecnica': string;
  'app.correlation_id': string;
  /** Empresa que a transação está criando; só o caso de uso a preenche, depois do INSERT. */
  'app.empresa_em_criacao': string;
}>;

/**
 * Sempre as oito variáveis, com vazio onde não se aplica: a transação sobrescreve
 * qualquer valor que uma etapa anterior tenha deixado, sem depender do reset do fim.
 */
export const parametrosDeSessao = (contexto: ContextoDeAcesso): ParametrosDeSessao => {
  if (contexto.origem === 'HUMANA') {
    return {
      'app.tenant_id': contexto.tenantId,
      'app.origem': 'HUMANA',
      'app.usuario_id': contexto.usuarioId,
      'app.empresa_id': '',
      'app.finalidade': contexto.finalidade,
      'app.identidade_tecnica': '',
      'app.correlation_id': contexto.correlationId ?? '',
      'app.empresa_em_criacao': '',
    };
  }

  return {
    'app.tenant_id': contexto.tenantId,
    'app.origem': 'TECNICA',
    'app.usuario_id': '',
    'app.empresa_id': contexto.empresaId,
    'app.finalidade': contexto.finalidade,
    'app.identidade_tecnica': contexto.identidadeTecnica,
    'app.correlation_id': contexto.correlationId,
    'app.empresa_em_criacao': '',
  };
};
