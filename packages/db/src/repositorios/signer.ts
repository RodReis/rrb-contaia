/**
 * Repositório do Signer (SPEC-012 §3.5, §3.8, §3.11).
 *
 * Roda SEMPRE dentro de `comContexto` com contexto técnico da empresa (identidade `signer`): a RLS
 * limita cada leitura e escrita à empresa do trabalho. Nada aqui lê ou grava segredo, XML ou
 * resposta do destino — só metadados, hashes e códigos estáveis.
 */
import type { PoolClient } from 'pg';

export type FinalidadeDoSigner = 'DFE_TESTE' | 'ESOCIAL_TESTE';
export type TipoDeOperacao = 'ASSINATURA' | 'MTLS' | 'DIAGNOSTICO';
export type EstadoDaOperacaoPersistida = 'EM_ANDAMENTO' | 'CONCLUIDA' | 'RECUSADA' | 'FALHA_TRANSITORIA';

export type CertificadoParaUso = Readonly<{
  certificadoId: string;
  versao: number;
  estado: 'VIGENTE' | 'SUBSTITUIDO' | 'DESATIVADO';
  /** Datas civis `YYYY-MM-DD` (I-11). */
  validoDe: string;
  validoAte: string;
  /** UUID opaco da versão no Vault. */
  referenciaSegredo: string;
  /** SHA-256 hexadecimal do certificado: confere o que o Vault devolveu com o que foi cadastrado. */
  impressaoDigital: string;
  cnpjDaEmpresa: string;
}>;

/**
 * Última versão de certificado da empresa visível ao contexto. A RLS é o que impede contexto
 * cruzado: tenant e empresa que não casam não devolvem linha alguma (`null`).
 */
export const buscarCertificadoParaUso = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<CertificadoParaUso | null> => {
  const { rows } = await cliente.query<{
    id: string;
    versao: number;
    estado: CertificadoParaUso['estado'];
    valido_de: string;
    valido_ate: string;
    referencia_segredo: string;
    impressao_digital: string;
    cnpj: string;
  }>(
    `select c.id, c.versao, c.estado, c.valido_de::text as valido_de, c.valido_ate::text as valido_ate,
            c.referencia_segredo, c.impressao_digital, e.cnpj
       from app.empresa_certificado c
       join app.empresa e on e.id = c.empresa_id and e.tenant_id = c.tenant_id
      where c.empresa_id = $1
      order by c.versao desc
      limit 1`,
    [empresaId],
  );
  const linha = rows[0];

  return linha === undefined
    ? null
    : {
        certificadoId: linha.id,
        versao: linha.versao,
        estado: linha.estado,
        validoDe: linha.valido_de,
        validoAte: linha.valido_ate,
        referenciaSegredo: linha.referencia_segredo,
        impressaoDigital: linha.impressao_digital,
        cnpjDaEmpresa: linha.cnpj,
      };
};

export type OperacaoDoSigner = Readonly<{
  id: string;
  tenantId: string;
  empresaId: string;
  finalidade: FinalidadeDoSigner;
  tipo: TipoDeOperacao;
  hashConteudo: string;
  estado: EstadoDaOperacaoPersistida;
  resultadoCodigo: string | null;
  tentativas: number;
  certificadoId: string;
  referenciaSegredo: string;
}>;

/** Operação da chave protegida visível ao contexto (a mesma empresa); outra empresa não aparece. */
export const buscarOperacaoPorChave = async (
  cliente: PoolClient,
  chaveHmac: string,
): Promise<OperacaoDoSigner | null> => {
  const { rows } = await cliente.query<{
    id: string;
    tenant_id: string;
    empresa_id: string;
    finalidade: FinalidadeDoSigner;
    tipo: TipoDeOperacao;
    hash_conteudo: string;
    estado: EstadoDaOperacaoPersistida;
    resultado_codigo: string | null;
    tentativas: number;
    certificado_id: string;
    referencia_segredo: string;
  }>(
    `select id, tenant_id, empresa_id, finalidade, tipo, hash_conteudo, estado, resultado_codigo,
            tentativas, certificado_id, referencia_segredo
       from app.signer_operacao
      where chave_hmac = $1`,
    [chaveHmac],
  );
  const linha = rows[0];

  return linha === undefined
    ? null
    : {
        id: linha.id,
        tenantId: linha.tenant_id,
        empresaId: linha.empresa_id,
        finalidade: linha.finalidade,
        tipo: linha.tipo,
        hashConteudo: linha.hash_conteudo,
        estado: linha.estado,
        resultadoCodigo: linha.resultado_codigo,
        tentativas: linha.tentativas,
        certificadoId: linha.certificado_id,
        referenciaSegredo: linha.referencia_segredo,
      };
};

export type NovaOperacao = Readonly<{
  tenantId: string;
  empresaId: string;
  finalidade: FinalidadeDoSigner;
  tipo: TipoDeOperacao;
  chaveHmac: string;
  hashConteudo: string;
  certificadoId: string;
  referenciaSegredo: string;
  identidadeTecnica: string;
  usuarioOriginadorId: string | null;
  correlationId: string;
}>;

/** A chave protegida é única globalmente: a colisão entre escopos chega como `23505`. */
export const criarOperacao = async (cliente: PoolClient, operacao: NovaOperacao): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.signer_operacao
       (tenant_id, empresa_id, finalidade, tipo, chave_hmac, hash_conteudo, certificado_id,
        referencia_segredo, identidade_tecnica, usuario_originador_id, correlation_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      operacao.tenantId,
      operacao.empresaId,
      operacao.finalidade,
      operacao.tipo,
      operacao.chaveHmac,
      operacao.hashConteudo,
      operacao.certificadoId,
      operacao.referenciaSegredo,
      operacao.identidadeTecnica,
      operacao.usuarioOriginadorId,
      operacao.correlationId,
    ],
  );

  return (rows[0] as { id: string }).id;
};

/** Falha transitória volta a EM_ANDAMENTO na MESMA operação, com a tentativa seguinte. */
export const reabrirOperacao = async (cliente: PoolClient, operacaoId: string): Promise<void> => {
  await cliente.query(
    `update app.signer_operacao
        set estado = 'EM_ANDAMENTO', resultado_codigo = null, finalizado_em = null, tentativas = tentativas + 1
      where id = $1 and estado = 'FALHA_TRANSITORIA'`,
    [operacaoId],
  );
};

export type DesfechoDaOperacao = Readonly<{
  estado: Exclude<EstadoDaOperacaoPersistida, 'EM_ANDAMENTO'>;
  /** Obrigatório fora de CONCLUIDA; o banco exige. */
  codigo: string | null;
}>;

export const finalizarOperacao = async (
  cliente: PoolClient,
  operacaoId: string,
  desfecho: DesfechoDaOperacao,
): Promise<void> => {
  await cliente.query(
    `update app.signer_operacao
        set estado = $2, resultado_codigo = $3, finalizado_em = now()
      where id = $1`,
    [operacaoId, desfecho.estado, desfecho.codigo],
  );
};

export type EventoDoSigner = Readonly<{
  tenantId: string;
  empresaId: string;
  operacaoId: string | null;
  finalidade: FinalidadeDoSigner;
  referenciaSegredo: string | null;
  identidadeTecnica: string;
  usuarioOriginadorId: string | null;
  hashConteudo: string | null;
  chaveHmac: string | null;
  iniciadoEm: Date;
  finalizadoEm: Date;
  latenciaMs: number;
  resultado: 'SUCESSO' | 'FALHA' | 'RECUSA';
  codigo: string | null;
  correlationId: string;
  reutilizado: boolean;
  origemDiagnostico: 'AUTOMATICO' | 'MANUAL' | null;
}>;

export const registrarEventoDoSigner = async (cliente: PoolClient, evento: EventoDoSigner): Promise<void> => {
  await cliente.query(
    `insert into app.signer_evento
       (tenant_id, empresa_id, operacao_id, finalidade, referencia_segredo, identidade_tecnica,
        usuario_originador_id, hash_conteudo, chave_hmac, iniciado_em, finalizado_em, latencia_ms,
        resultado, codigo, correlation_id, reutilizado, origem_diagnostico)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      evento.tenantId,
      evento.empresaId,
      evento.operacaoId,
      evento.finalidade,
      evento.referenciaSegredo,
      evento.identidadeTecnica,
      evento.usuarioOriginadorId,
      evento.hashConteudo,
      evento.chaveHmac,
      evento.iniciadoEm,
      evento.finalizadoEm,
      evento.latenciaMs,
      evento.resultado,
      evento.codigo,
      evento.correlationId,
      evento.reutilizado,
      evento.origemDiagnostico,
    ],
  );
};
