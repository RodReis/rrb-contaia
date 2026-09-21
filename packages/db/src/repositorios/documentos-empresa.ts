/**
 * Repositório dos documentos da empresa (SPEC-004): exigências, versões de
 * arquivo e eventos documentais.
 *
 * Como nas fatias anteriores, recebe o cliente da transação aberta pelo caso de
 * uso e filtra `tenant_id` no SQL além da RLS — a política é rede de segurança,
 * não autorização.
 */
import type { CodigoDoChecklist, EstadoDoDocumento } from '@contaia/domain';
import type { PoolClient } from 'pg';

// -- Exigências --------------------------------------------------------------

export type ExigenciaPersistida = Readonly<{
  id: string;
  codigo: CodigoDoChecklist | null;
  nome: string;
  descricao: string | null;
  dataLimite: string | null;
  estado: EstadoDoDocumento;
  justificativa: string | null;
  aplicavel: boolean;
  versao: number;
}>;

type LinhaDaExigencia = {
  id: string;
  codigo: CodigoDoChecklist | null;
  nome: string;
  descricao: string | null;
  data_limite: string | null;
  estado: EstadoDoDocumento;
  justificativa: string | null;
  aplicavel: boolean;
  versao: number;
};

const COLUNAS_DA_EXIGENCIA = `id, codigo, nome, descricao,
       to_char(data_limite, 'YYYY-MM-DD') as data_limite,
       estado, justificativa, aplicavel, versao`;

const paraExigenciaPersistida = (linha: LinhaDaExigencia): ExigenciaPersistida => ({
  id: linha.id,
  codigo: linha.codigo,
  nome: linha.nome,
  descricao: linha.descricao,
  dataLimite: linha.data_limite,
  estado: linha.estado,
  justificativa: linha.justificativa,
  aplicavel: linha.aplicavel,
  versao: linha.versao,
});

/**
 * Exigências ativas da empresa.
 *
 * O checklist padrão vem primeiro, **na ordem da SPEC-004 §2.1**, e não por
 * `criado_em`: o semeio grava as sete na mesma transação, onde `now()` é o
 * início dela e empata em todas — a ordem sairia arbitrária. As específicas do
 * escritório vêm depois, por nome.
 */
export const listarExigencias = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<readonly ExigenciaPersistida[]> => {
  const { rows } = await cliente.query<LinhaDaExigencia>(
    `select ${COLUNAS_DA_EXIGENCIA} from app.empresa_exigencia_documental
      where tenant_id = $1 and empresa_id = $2 and situacao = 'ativo'
      order by (codigo is null),
               array_position(array[
                 'CONTRATO_SOCIAL', 'CARTAO_CNPJ', 'INSCRICAO_ESTADUAL',
                 'INSCRICAO_MUNICIPAL', 'ALVARA_DE_FUNCIONAMENTO',
                 'DOCUMENTO_DO_RESPONSAVEL', 'COMPROVANTE_DE_ENDERECO'
               ], codigo),
               nome`,
    [tenantId, empresaId],
  );

  return rows.map(paraExigenciaPersistida);
};

export const carregarExigencia = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  exigenciaId: string,
): Promise<ExigenciaPersistida | null> => {
  const { rows } = await cliente.query<LinhaDaExigencia>(
    `select ${COLUNAS_DA_EXIGENCIA} from app.empresa_exigencia_documental
      where tenant_id = $1 and empresa_id = $2 and id = $3 and situacao = 'ativo'`,
    [tenantId, empresaId, exigenciaId],
  );

  const linha = rows[0];
  return linha === undefined ? null : paraExigenciaPersistida(linha);
};

export type NovaExigencia = Readonly<{
  codigo: CodigoDoChecklist | null;
  nome: string;
  descricao: string | null;
  dataLimite: string | null;
  aplicavel: boolean;
}>;

export const inserirExigencia = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  exigencia: NovaExigencia,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.empresa_exigencia_documental
       (tenant_id, empresa_id, codigo, nome, descricao, data_limite, aplicavel)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      tenantId,
      empresaId,
      exigencia.codigo,
      exigencia.nome,
      exigencia.descricao,
      exigencia.dataLimite,
      exigencia.aplicavel,
    ],
  );

  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error('insert de exigência documental não devolveu id');
  }

  return id;
};

/**
 * Aplica o novo estado da exigência com compare-and-swap na `versao`: se a
 * linha mudou entre a leitura e a gravação, nada é escrito e o caso de uso
 * transforma isso em conflito explícito. Análise concorrente não sobrescreve em
 * silêncio (SPEC-004 §5).
 */
export const definirEstadoDaExigencia = async (
  cliente: PoolClient,
  tenantId: string,
  exigenciaId: string,
  entrada: Readonly<{
    estado: EstadoDoDocumento;
    justificativa: string | null;
    versaoEsperada: number;
  }>,
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `update app.empresa_exigencia_documental
        set estado = $3, justificativa = $4,
            atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and id = $2 and versao = $5 and situacao = 'ativo'`,
    [
      tenantId,
      exigenciaId,
      entrada.estado,
      entrada.justificativa,
      entrada.versaoEsperada,
    ],
  );

  return rowCount === 1;
};

/**
 * Reconciliação da aplicabilidade quando o cadastro muda na F3 (§2.2): marca a
 * exigência como inaplicável sem apagar nada. As versões enviadas continuam.
 */
export const definirAplicabilidade = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  codigo: CodigoDoChecklist,
  aplicavel: boolean,
): Promise<void> => {
  await cliente.query(
    `update app.empresa_exigencia_documental
        set aplicavel = $4, atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and empresa_id = $2 and codigo = $3
        and situacao = 'ativo' and aplicavel <> $4`,
    [tenantId, empresaId, codigo, aplicavel],
  );
};

// -- Versões -----------------------------------------------------------------

export type VersaoPersistida = Readonly<{
  id: string;
  exigenciaId: string;
  numero: number;
  chaveStorage: string;
  nomeOriginal: string;
  tipoConteudo: string;
  tamanhoBytes: number;
  validade: string | null;
  vigente: boolean;
  enviadoPor: string;
  criadoEm: string;
}>;

type LinhaDaVersao = {
  id: string;
  exigencia_id: string;
  numero: number;
  chave_storage: string;
  nome_original: string;
  tipo_conteudo: string;
  tamanho_bytes: string;
  validade: string | null;
  vigente: boolean;
  enviado_por: string;
  criado_em: Date;
};

const COLUNAS_DA_VERSAO = `id, exigencia_id, numero, chave_storage, nome_original,
       tipo_conteudo, tamanho_bytes,
       to_char(validade, 'YYYY-MM-DD') as validade,
       vigente, enviado_por, criado_em`;

const paraVersaoPersistida = (linha: LinhaDaVersao): VersaoPersistida => ({
  id: linha.id,
  exigenciaId: linha.exigencia_id,
  numero: linha.numero,
  chaveStorage: linha.chave_storage,
  nomeOriginal: linha.nome_original,
  tipoConteudo: linha.tipo_conteudo,
  // `bigint` chega como texto no driver: converter aqui evita string vazando
  // para o contrato da API.
  tamanhoBytes: Number(linha.tamanho_bytes),
  validade: linha.validade,
  vigente: linha.vigente,
  enviadoPor: linha.enviado_por,
  criadoEm: linha.criado_em.toISOString(),
});

/** Versões da exigência, da mais recente para a mais antiga. */
export const listarVersoes = async (
  cliente: PoolClient,
  tenantId: string,
  exigenciaId: string,
): Promise<readonly VersaoPersistida[]> => {
  const { rows } = await cliente.query<LinhaDaVersao>(
    `select ${COLUNAS_DA_VERSAO} from app.empresa_documento_versao
      where tenant_id = $1 and exigencia_id = $2
      order by numero desc`,
    [tenantId, exigenciaId],
  );

  return rows.map(paraVersaoPersistida);
};

export const carregarVersao = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  versaoId: string,
): Promise<VersaoPersistida | null> => {
  const { rows } = await cliente.query<LinhaDaVersao>(
    `select ${COLUNAS_DA_VERSAO} from app.empresa_documento_versao
      where tenant_id = $1 and empresa_id = $2 and id = $3`,
    [tenantId, empresaId, versaoId],
  );

  const linha = rows[0];
  return linha === undefined ? null : paraVersaoPersistida(linha);
};

export const carregarVersaoVigente = async (
  cliente: PoolClient,
  tenantId: string,
  exigenciaId: string,
): Promise<VersaoPersistida | null> => {
  const { rows } = await cliente.query<LinhaDaVersao>(
    `select ${COLUNAS_DA_VERSAO} from app.empresa_documento_versao
      where tenant_id = $1 and exigencia_id = $2 and vigente`,
    [tenantId, exigenciaId],
  );

  const linha = rows[0];
  return linha === undefined ? null : paraVersaoPersistida(linha);
};

/** Arquiva a versão vigente da exigência, se houver. */
export const arquivarVersaoVigente = async (
  cliente: PoolClient,
  tenantId: string,
  exigenciaId: string,
): Promise<void> => {
  await cliente.query(
    `update app.empresa_documento_versao set vigente = false
      where tenant_id = $1 and exigencia_id = $2 and vigente`,
    [tenantId, exigenciaId],
  );
};

export type NovaVersao = Readonly<{
  exigenciaId: string;
  chaveStorage: string;
  nomeOriginal: string;
  tipoConteudo: string;
  tamanhoBytes: number;
  validade: string | null;
  enviadoPor: string;
}>;

/**
 * Insere a nova versão vigente. O `numero` vem do próprio banco, a partir do
 * maior já gravado na exigência: calcular na aplicação abriria corrida entre
 * dois envios simultâneos, e o índice único no par (exigência, número) recusaria
 * o segundo com erro opaco.
 *
 * Quem chama precisa ter arquivado a versão vigente antes, na mesma transação —
 * o índice parcial único garante que o esquecimento vire erro, não segundo
 * arquivo vigente.
 */
export const inserirVersao = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  versao: NovaVersao,
): Promise<VersaoPersistida> => {
  const { rows } = await cliente.query<LinhaDaVersao>(
    `insert into app.empresa_documento_versao
       (tenant_id, empresa_id, exigencia_id, numero, chave_storage, nome_original,
        tipo_conteudo, tamanho_bytes, validade, enviado_por)
     select $1, $2, $3,
            coalesce(max(numero), 0) + 1,
            $4, $5, $6, $7, $8::date, $9
       from app.empresa_documento_versao
      where tenant_id = $1 and exigencia_id = $3
     returning ${COLUNAS_DA_VERSAO}`,
    [
      tenantId,
      empresaId,
      versao.exigenciaId,
      versao.chaveStorage,
      versao.nomeOriginal,
      versao.tipoConteudo,
      versao.tamanhoBytes,
      versao.validade,
      versao.enviadoPor,
    ],
  );

  const linha = rows[0];

  if (linha === undefined) {
    throw new Error('insert de versão documental não devolveu linha');
  }

  return paraVersaoPersistida(linha);
};

// -- Eventos -----------------------------------------------------------------

export const ACOES_DOCUMENTAIS = [
  'EXIGENCIA_CRIADA',
  'ENVIO',
  'SUBSTITUICAO',
  'APROVACAO',
  'REJEICAO',
  'DISPENSA',
  'VENCIMENTO',
  'VISUALIZACAO',
  'DOWNLOAD',
] as const;

export type AcaoDocumental = (typeof ACOES_DOCUMENTAIS)[number];

export type EventoDocumentalParaRegistrar = Readonly<{
  empresaId: string;
  exigenciaId: string;
  versaoId: string | null;
  acao: AcaoDocumental;
  estadoAnterior: EstadoDoDocumento | null;
  estadoNovo: EstadoDoDocumento | null;
  justificativa: string | null;
  /** Nulo apenas em `VENCIMENTO`, apurado pela aplicação (§3.2). */
  usuarioId: string | null;
}>;

export const registrarEventosDocumentais = async (
  cliente: PoolClient,
  tenantId: string,
  eventos: readonly EventoDocumentalParaRegistrar[],
): Promise<void> => {
  for (const evento of eventos) {
    await cliente.query(
      `insert into app.empresa_evento_documental
         (tenant_id, empresa_id, exigencia_id, versao_id, acao,
          estado_anterior, estado_novo, justificativa, usuario_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        evento.empresaId,
        evento.exigenciaId,
        evento.versaoId,
        evento.acao,
        evento.estadoAnterior,
        evento.estadoNovo,
        evento.justificativa,
        evento.usuarioId,
      ],
    );
  }
};

export type EventoDocumentalNaLista = Readonly<{
  id: string;
  exigenciaId: string;
  exigenciaNome: string;
  versaoNumero: number | null;
  acao: AcaoDocumental;
  estadoAnterior: EstadoDoDocumento | null;
  estadoNovo: EstadoDoDocumento | null;
  justificativa: string | null;
  usuarioNome: string | null;
  ocorridoEm: string;
}>;

/** Histórico documental da empresa, do mais recente para o mais antigo. */
export const listarHistoricoDocumental = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  paginacao: Readonly<{ limite: number; deslocamento: number }>,
): Promise<Readonly<{ eventos: readonly EventoDocumentalNaLista[]; total: number }>> => {
  const { rows } = await cliente.query<{
    id: string;
    exigencia_id: string;
    exigencia_nome: string;
    versao_numero: number | null;
    acao: AcaoDocumental;
    estado_anterior: EstadoDoDocumento | null;
    estado_novo: EstadoDoDocumento | null;
    justificativa: string | null;
    usuario_nome: string | null;
    ocorrido_em: Date;
    total: string;
  }>(
    `select evento.id, evento.exigencia_id, exigencia.nome as exigencia_nome,
            versao.numero as versao_numero, evento.acao,
            evento.estado_anterior, evento.estado_novo, evento.justificativa,
            usuario.nome as usuario_nome, evento.ocorrido_em,
            count(*) over () as total
       from app.empresa_evento_documental evento
       join app.empresa_exigencia_documental exigencia on exigencia.id = evento.exigencia_id
       left join app.empresa_documento_versao versao on versao.id = evento.versao_id
       left join app.usuario usuario on usuario.id = evento.usuario_id
      where evento.tenant_id = $1 and evento.empresa_id = $2
      order by evento.ocorrido_em desc, evento.sequencia desc
      limit $3 offset $4`,
    [tenantId, empresaId, paginacao.limite, paginacao.deslocamento],
  );

  return {
    eventos: rows.map((linha) => ({
      id: linha.id,
      exigenciaId: linha.exigencia_id,
      exigenciaNome: linha.exigencia_nome,
      versaoNumero: linha.versao_numero,
      acao: linha.acao,
      estadoAnterior: linha.estado_anterior,
      estadoNovo: linha.estado_novo,
      justificativa: linha.justificativa,
      usuarioNome: linha.usuario_nome,
      ocorridoEm: linha.ocorrido_em.toISOString(),
    })),
    total: Number(rows[0]?.total ?? 0),
  };
};
