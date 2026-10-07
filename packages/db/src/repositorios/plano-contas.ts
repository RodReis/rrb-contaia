/**
 * Repositório da importação do plano de contas (SPEC-013).
 *
 * Roda SEMPRE dentro de `comContextoHumano` ou `comContextoTecnico` com empresa do trabalho.
 * A RLS limita cada leitura e escrita à empresa do contexto.
 * O caso de uso controla a transação; aqui só SQL.
 */
import type { PoolClient } from 'pg';

export type TipoDeConta = 'analitica' | 'sintetica';
export type NaturezaDeConta = 'devedora' | 'credora';

export type ContaContabil = Readonly<{
  id: string;
  tenantId: string;
  empresaId: string;
  codigo: string;
  nome: string;
  tipo: TipoDeConta;
  natureza: NaturezaDeConta;
  contaPai: string | null;
  versao: number;
  arquivada: boolean;
  arquivadaEm: string | null;
  arquivadaPor: string | null;
  criadoEm: string;
  atualizadoEm: string;
}>;

export type LinhaDeStaging = Readonly<{
  id: string;
  tentativaId: string;
  numeroDaLinha: number;
  codigo: string;
  nome: string;
  tipo: TipoDeConta;
  natureza: NaturezaDeConta;
  contaPai: string | null;
  aceita: boolean;
  codigoErro: string | null;
  campoErro: string | null;
}>;

export type TentativaDeImportacao = Readonly<{
  id: string;
  tenantId: string;
  empresaId: string;
  hashArquivo: string;
  mapeamento: Record<string, string>;
  arquivoNome: string;
  arquivoTamanho: number;
  estado: EstadoDaTentativa;
  planoVersaoNaValidacao: number;
  totais: {
    lidas: number;
    novas: number;
    atualizadas: number;
    rejeitadas: number;
  };
  usuarioIniciadorId: string;
  usuarioConfirmadorOuCanceladorId: string | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
  correlationId: string;
  reutilizadaPorIdempotencia: boolean;
}>;

export type EstadoDaTentativa =
  | 'RECEBIDA'
  | 'VALIDANDO'
  | 'AGUARDANDO_CONFIRMACAO'
  | 'APLICANDO'
  | 'CONCLUIDA'
  | 'CONCLUIDA_COM_REJEICOES'
  | 'REJEITADA'
  | 'CANCELADA'
  | 'FALHA';

export type EventoDaImportacao = Readonly<{
  id: string;
  tentativaId: string;
  estadoAnterior: EstadoDaTentativa | null;
  estadoNovo: EstadoDaTentativa;
  linhasIncluidas: number | null;
  linhasAtualizadas: number | null;
  linhasRejeitadas: number | null;
  iniciadoEm: string;
  finalizadoEm: string;
  correlationId: string;
}>;

export type NotificacaoDeConclusao = Readonly<{
  id: string;
  usuarioId: string;
  tentativaId: string;
  tipo: 'CONCLUIDA' | 'CONCLUIDA_COM_REJEICOES' | 'REJEITADA' | 'FALHA';
  estado: EstadoDaTentativa;
  totais: {
    lidas: number;
    novas: number;
    atualizadas: number;
    rejeitadas: number;
  };
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
}>;

/** Busca a tentativa por id (visivel so se empresa no contexto). */
export const buscarTentativaPorId = async (
  cliente: PoolClient,
  tentativaId: string,
): Promise<TentativaDeImportacao | null> => {
  const { rows } = await cliente.query<{
    id: string;
    tenant_id: string;
    empresa_id: string;
    hash_arquivo: string;
    mapeamento: Record<string, string>;
    arquivo_nome: string;
    arquivo_tamanho: string;
    estado: EstadoDaTentativa;
    plano_versao_na_validacao: number;
    totais: { lidas: number; novas: number; atualizadas: number; rejeitadas: number };
    usuario_iniciador_id: string;
    usuario_confirmador_ou_cancelador_id: string | null;
    iniciado_em: string;
    finalizado_em: string | null;
    correlation_id: string;
    reutilizada_por_idempotencia: boolean;
  }>(
    `select id, tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho,
            estado, plano_versao_na_validacao, totais,
            usuario_iniciador_id, usuario_confirmador_ou_cancelador_id,
            iniciado_em::text, finalizado_em::text, correlation_id, reutilizada_por_idempotencia
       from app.importacao_plano_contas
      where id = $1`,
    [tentativaId],
  );

  const linha = rows[0];
  return linha === undefined
    ? null
    : {
        id: linha.id,
        tenantId: linha.tenant_id,
        empresaId: linha.empresa_id,
        hashArquivo: linha.hash_arquivo,
        mapeamento: linha.mapeamento,
        arquivoNome: linha.arquivo_nome,
        arquivoTamanho: Number(linha.arquivo_tamanho),
        estado: linha.estado,
        planoVersaoNaValidacao: linha.plano_versao_na_validacao,
        totais: linha.totais,
        usuarioIniciadorId: linha.usuario_iniciador_id,
        usuarioConfirmadorOuCanceladorId: linha.usuario_confirmador_ou_cancelador_id,
        iniciadoEm: linha.iniciado_em,
        finalizadoEm: linha.finalizado_em,
        correlationId: linha.correlation_id,
        reutilizadaPorIdempotencia: linha.reutilizada_por_idempotencia,
      };
};

/** Busca tentativa existente pela chave idempotente (empresa + hash + mapeamento). */
export const buscarTentativaPorChave = async (
  cliente: PoolClient,
  empresaId: string,
  hashArquivo: string,
  mapeamento: Record<string, string>,
): Promise<TentativaDeImportacao | null> => {
  const { rows } = await cliente.query<{
    id: string;
    tenant_id: string;
    empresa_id: string;
    hash_arquivo: string;
    mapeamento: Record<string, string>;
    arquivo_nome: string;
    arquivo_tamanho: string;
    estado: EstadoDaTentativa;
    plano_versao_na_validacao: number;
    totais: { lidas: number; novas: number; atualizadas: number; rejeitadas: number };
    usuario_iniciador_id: string;
    usuario_confirmador_ou_cancelador_id: string | null;
    iniciado_em: string;
    finalizado_em: string | null;
    correlation_id: string;
    reutilizada_por_idempotencia: boolean;
  }>(
    `select id, tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho,
            estado, plano_versao_na_validacao, totais,
            usuario_iniciador_id, usuario_confirmador_ou_cancelador_id,
            iniciado_em::text, finalizado_em::text, correlation_id, reutilizada_por_idempotencia
       from app.importacao_plano_contas
      where empresa_id = $1 and hash_arquivo = $2 and mapeamento = $3`,
    [empresaId, hashArquivo, JSON.stringify(mapeamento)],
  );

  const linha = rows[0];
  return linha === undefined
    ? null
    : {
        id: linha.id,
        tenantId: linha.tenant_id,
        empresaId: linha.empresa_id,
        hashArquivo: linha.hash_arquivo,
        mapeamento: linha.mapeamento,
        arquivoNome: linha.arquivo_nome,
        arquivoTamanho: Number(linha.arquivo_tamanho),
        estado: linha.estado,
        planoVersaoNaValidacao: linha.plano_versao_na_validacao,
        totais: linha.totais,
        usuarioIniciadorId: linha.usuario_iniciador_id,
        usuarioConfirmadorOuCanceladorId: linha.usuario_confirmador_ou_cancelador_id,
        iniciadoEm: linha.iniciado_em,
        finalizadoEm: linha.finalizado_em,
        correlationId: linha.correlation_id,
        reutilizadaPorIdempotencia: linha.reutilizada_por_idempotencia,
      };
};

/** Cria nova tentativa no estado RECEBIDA. */
export type NovaTentativa = Readonly<{
  tenantId: string;
  empresaId: string;
  hashArquivo: string;
  mapeamento: Record<string, string>;
  arquivoNome: string;
  arquivoTamanho: number;
  usuarioIniciadorId: string;
  correlationId: string;
}>;

export const criarTentativa = async (
  cliente: PoolClient,
  tentativa: NovaTentativa,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.importacao_plano_contas
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho,
        usuario_iniciador_id, correlation_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      tentativa.tenantId,
      tentativa.empresaId,
      tentativa.hashArquivo,
      JSON.stringify(tentativa.mapeamento),
      tentativa.arquivoNome,
      tentativa.arquivoTamanho,
      tentativa.usuarioIniciadorId,
      tentativa.correlationId,
    ],
  );

  return (rows[0] as { id: string }).id;
};

/** Atualiza mapeamento confirmado (antes de enfileirar validacao). */
export const salvarMapeamento = async (
  cliente: PoolClient,
  tentativaId: string,
  mapeamento: Record<string, string>,
): Promise<void> => {
  await cliente.query(
    `update app.importacao_plano_contas
        set mapeamento = $2
      where id = $1 and estado = 'RECEBIDA'`,
    [tentativaId, JSON.stringify(mapeamento)],
  );
};

/** Inicia validacao: RECEBIDA -> VALIDANDO, grava versao do plano vigente. */
export const iniciarValidacao = async (
  cliente: PoolClient,
  tentativaId: string,
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `update app.importacao_plano_contas
        set estado = 'VALIDANDO',
            plano_versao_na_validacao = (
              select max(versao) from app.conta_contabil where empresa_id = importacao_plano_contas.empresa_id
            )
      where id = $1 and estado = 'RECEBIDA'`,
    [tentativaId],
  );

  return (rowCount ?? 0) === 1;
};

/** Registra linhas de staging (worker de validacao). */
export type LinhaParaStaging = Readonly<{
  tentativaId: string;
  numeroDaLinha: number;
  codigo: string;
  nome: string;
  tipo: TipoDeConta;
  natureza: NaturezaDeConta;
  contaPai: string | null;
  aceita: boolean;
  codigoErro: string | null;
  campoErro: string | null;
}>;

export const inserirLinhasStaging = async (
  cliente: PoolClient,
  linhas: readonly LinhaParaStaging[],
): Promise<void> => {
  if (linhas.length === 0) return;

  // Batch insert via VALUES
  const values: string[] = [];
  const params: (string | number | boolean | null)[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!;
    const base = i * 9;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`,
    );
    params.push(
      l.tentativaId,
      l.numeroDaLinha,
      l.codigo,
      l.nome,
      l.tipo,
      l.natureza,
      l.contaPai,
      l.aceita,
      l.codigoErro,
      l.campoErro,
    );
  }

  await cliente.query(
    `insert into app.importacao_plano_contas_linha
       (tentativa_id, numero_da_linha, codigo, nome, tipo, natureza, conta_pai, aceita, codigo_erro, campo_erro)
     values ${values.join(', ')}`,
    params,
  );
};

/** Finaliza validacao: VALIDANDO -> AGUARDANDO_CONFIRMACAO | REJEITADA | FALHA. */
export const finalizarValidacao = async (
  cliente: PoolClient,
  tentativaId: string,
  estado: 'AGUARDANDO_CONFIRMACAO' | 'REJEITADA' | 'FALHA',
  totais: { lidas: number; novas: number; atualizadas: number; rejeitadas: number },
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `update app.importacao_plano_contas
        set estado = $2, totais = $3, finalizado_em = now()
      where id = $1 and estado = 'VALIDANDO'`,
    [tentativaId, estado, JSON.stringify(totais)],
  );

  return (rowCount ?? 0) === 1;
};

/** Confirma importação: AGUARDANDO_CONFIRMACAO -> APLICANDO (versao otimista). */
export const confirmarImportacao = async (
  cliente: PoolClient,
  tentativaId: string,
  planoVersaoEsperada: number,
  usuarioConfirmadorId: string,
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `update app.importacao_plano_contas
        set estado = 'APLICANDO',
            usuario_confirmador_ou_cancelador_id = $3
      where id = $1
        and estado = 'AGUARDANDO_CONFIRMACAO'
        and plano_versao_na_validacao = $2`,
    [tentativaId, planoVersaoEsperada, usuarioConfirmadorId],
  );

  return (rowCount ?? 0) === 1;
};

/** Cancela prévia: AGUARDANDO_CONFIRMACAO -> CANCELADA. */
export const cancelarPrevia = async (
  cliente: PoolClient,
  tentativaId: string,
  usuarioCanceladorId: string,
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `update app.importacao_plano_contas
        set estado = 'CANCELADA',
            usuario_confirmador_ou_cancelador_id = $2,
            finalizado_em = now()
      where id = $1 and estado = 'AGUARDANDO_CONFIRMACAO'`,
    [tentativaId, usuarioCanceladorId],
  );

  return (rowCount ?? 0) === 1;
};

/** Aplica linhas aceitas no plano vigente (uma transacao). */
export const aplicarLinhasNoPlano = async (
  cliente: PoolClient,
  empresaId: string,
  linhas: readonly LinhaDeStaging[],
): Promise<{ incluidas: number; atualizadas: number }> => {
  const aceitas = linhas.filter((l) => l.aceita);
  let incluidas = 0;
  let atualizadas = 0;

  for (const linha of aceitas) {
    const { rows } = await cliente.query<{ incluida: boolean }>(
      `insert into app.conta_contabil
         (tenant_id, empresa_id, codigo, nome, tipo, natureza, conta_pai)
       values (
         (select tenant_id from app.empresa where id = $1),
         $1, $2, $3, $4, $5, $6
       )
       on conflict (empresa_id, codigo) do update
         set nome = excluded.nome,
             tipo = excluded.tipo,
             natureza = excluded.natureza,
             conta_pai = excluded.conta_pai,
             arquivada = false,
             arquivada_em = null,
             arquivada_por = null,
             atualizado_em = now()
       where app.conta_contabil.arquivada = false
       returning (xmax = 0) as incluida`,
      [empresaId, linha.codigo, linha.nome, linha.tipo, linha.natureza, linha.contaPai],
    );

    const incluida = rows[0]?.incluida ?? false;
    if (incluida) {
      incluidas++;
    } else {
      atualizadas++;
    }
  }

  return { incluidas, atualizadas };
};

/** Finaliza aplicação: APLICANDO -> CONCLUIDA | CONCLUIDA_COM_REJEICOES | FALHA. */
export const finalizarAplicacao = async (
  cliente: PoolClient,
  tentativaId: string,
  estado: 'CONCLUIDA' | 'CONCLUIDA_COM_REJEICOES' | 'FALHA',
  totais: { lidas: number; novas: number; atualizadas: number; rejeitadas: number },
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `update app.importacao_plano_contas
        set estado = $2, totais = $3, finalizado_em = now()
      where id = $1 and estado = 'APLICANDO'`,
    [tentativaId, estado, JSON.stringify(totais)],
  );

  return (rowCount ?? 0) === 1;
};

/** Marca tentativa como reutilizada por idempotencia. */
export const marcarReutilizada = async (
  cliente: PoolClient,
  tentativaId: string,
): Promise<void> => {
  await cliente.query(
    `update app.importacao_plano_contas
        set reutilizada_por_idempotencia = true
      where id = $1`,
    [tentativaId],
  );
};

/** Registra evento de transição de estado. */
export const registrarEvento = async (
  cliente: PoolClient,
  evento: {
    tenantId: string;
    empresaId: string;
    tentativaId: string;
    estadoAnterior: EstadoDaTentativa | null;
    estadoNovo: EstadoDaTentativa;
    linhasIncluidas: number | null;
    linhasAtualizadas: number | null;
    linhasRejeitadas: number | null;
    iniciadoEm: Date;
    finalizadoEm: Date;
    correlationId: string;
  },
): Promise<void> => {
  await cliente.query(
    `insert into app.importacao_plano_contas_evento
       (tenant_id, empresa_id, tentativa_id, estado_anterior, estado_novo,
        linhas_incluidas, linhas_atualizadas, linhas_rejeitadas,
        iniciado_em, finalizado_em, correlation_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      evento.tenantId,
      evento.empresaId,
      evento.tentativaId,
      evento.estadoAnterior,
      evento.estadoNovo,
      evento.linhasIncluidas,
      evento.linhasAtualizadas,
      evento.linhasRejeitadas,
      evento.iniciadoEm,
      evento.finalizadoEm,
      evento.correlationId,
    ],
  );
};

/** Lista histórico de tentativas (15 por pagina). */
export type PaginaDeHistorico = Readonly<{
  tentativas: readonly TentativaDeImportacao[];
  total: number;
}>;

export const listarHistorico = async (
  cliente: PoolClient,
  empresaId: string,
  pagina: number,
  itensPorPagina: number,
): Promise<PaginaDeHistorico> => {
  const deslocamento = (pagina - 1) * itensPorPagina;

  const [linhas, total] = await Promise.all([
    cliente.query<{
      id: string;
      tenant_id: string;
      empresa_id: string;
      hash_arquivo: string;
      mapeamento: Record<string, string>;
      arquivo_nome: string;
      arquivo_tamanho: string;
      estado: EstadoDaTentativa;
      plano_versao_na_validacao: number;
      totais: { lidas: number; novas: number; atualizadas: number; rejeitadas: number };
      usuario_iniciador_id: string;
      usuario_confirmador_ou_cancelador_id: string | null;
      iniciado_em: string;
      finalizado_em: string | null;
      correlation_id: string;
      reutilizada_por_idempotencia: boolean;
    }>(
      `select id, tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho,
              estado, plano_versao_na_validacao, totais,
              usuario_iniciador_id, usuario_confirmador_ou_cancelador_id,
              iniciado_em::text, finalizado_em::text, correlation_id, reutilizada_por_idempotencia
         from app.importacao_plano_contas
        where empresa_id = $1
        order by iniciado_em desc, sequencia desc
        limit $2 offset $3`,
      [empresaId, itensPorPagina, deslocamento],
    ),
    cliente.query<{ total: string }>(
      `select count(*)::text as total from app.importacao_plano_contas where empresa_id = $1`,
      [empresaId],
    ),
  ]);

  const tentativas = linhas.rows.map((linha) => ({
    id: linha.id,
    tenantId: linha.tenant_id,
    empresaId: linha.empresa_id,
    hashArquivo: linha.hash_arquivo,
    mapeamento: linha.mapeamento,
    arquivoNome: linha.arquivo_nome,
    arquivoTamanho: Number(linha.arquivo_tamanho),
    estado: linha.estado,
    planoVersaoNaValidacao: linha.plano_versao_na_validacao,
    totais: linha.totais,
    usuarioIniciadorId: linha.usuario_iniciador_id,
    usuarioConfirmadorOuCanceladorId: linha.usuario_confirmador_ou_cancelador_id,
    iniciadoEm: linha.iniciado_em,
    finalizadoEm: linha.finalizado_em,
    correlationId: linha.correlation_id,
    reutilizadaPorIdempotencia: linha.reutilizada_por_idempotencia,
  }));

  return {
    tentativas,
    total: Number(total.rows[0]?.total ?? '0'),
  };
};

/** Lista plano de contas vigente da empresa (ordenado por codigo). */
export const listarPlanoVigente = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<readonly ContaContabil[]> => {
  const { rows } = await cliente.query<{
    id: string;
    tenant_id: string;
    empresa_id: string;
    codigo: string;
    nome: string;
    tipo: TipoDeConta;
    natureza: NaturezaDeConta;
    conta_pai: string | null;
    versao: number;
    arquivada: boolean;
    arquivada_em: string | null;
    arquivada_por: string | null;
    criado_em: string;
    atualizado_em: string;
  }>(
    `select id, tenant_id, empresa_id, codigo, nome, tipo, natureza, conta_pai,
            versao, arquivada, arquivada_em::text, arquivada_por,
            criado_em::text, atualizado_em::text
       from app.conta_contabil
      where empresa_id = $1 and arquivada = false
      order by codigo`,
    [empresaId],
  );

  return rows.map((linha) => ({
    id: linha.id,
    tenantId: linha.tenant_id,
    empresaId: linha.empresa_id,
    codigo: linha.codigo,
    nome: linha.nome,
    tipo: linha.tipo,
    natureza: linha.natureza,
    contaPai: linha.conta_pai,
    versao: linha.versao,
    arquivada: linha.arquivada,
    arquivadaEm: linha.arquivada_em,
    arquivadaPor: linha.arquivada_por,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  }));
};

/** Lista linhas de staging de uma tentativa (para prévia/relatório). */
export const listarLinhasStaging = async (
  cliente: PoolClient,
  tentativaId: string,
): Promise<readonly LinhaDeStaging[]> => {
  const { rows } = await cliente.query<{
    id: string;
    tentativa_id: string;
    numero_da_linha: number;
    codigo: string;
    nome: string;
    tipo: TipoDeConta;
    natureza: NaturezaDeConta;
    conta_pai: string | null;
    aceita: boolean;
    codigo_erro: string | null;
    campo_erro: string | null;
  }>(
    `select id, tentativa_id, numero_da_linha, codigo, nome, tipo, natureza, conta_pai,
            aceita, codigo_erro, campo_erro
       from app.importacao_plano_contas_linha
      where tentativa_id = $1
      order by numero_da_linha`,
    [tentativaId],
  );

  return rows.map((linha) => ({
    id: linha.id,
    tentativaId: linha.tentativa_id,
    numeroDaLinha: linha.numero_da_linha,
    codigo: linha.codigo,
    nome: linha.nome,
    tipo: linha.tipo,
    natureza: linha.natureza,
    contaPai: linha.conta_pai,
    aceita: linha.aceita,
    codigoErro: linha.codigo_erro,
    campoErro: linha.campo_erro,
  }));
};

/** Lista rejeicoes paginadas (para tabela da prévia). */
export const listarRejeicoesPaginadas = async (
  cliente: PoolClient,
  tentativaId: string,
  pagina: number,
  itensPorPagina: number,
): Promise<{ rejeicoes: readonly LinhaDeStaging[]; total: number }> => {
  const deslocamento = (pagina - 1) * itensPorPagina;

  const [linhas, total] = await Promise.all([
    cliente.query<{
      id: string;
      tentativa_id: string;
      numero_da_linha: number;
      codigo: string;
      nome: string;
      tipo: TipoDeConta;
      natureza: NaturezaDeConta;
      conta_pai: string | null;
      aceita: boolean;
      codigo_erro: string | null;
      campo_erro: string | null;
    }>(
      `select id, tentativa_id, numero_da_linha, codigo, nome, tipo, natureza, conta_pai,
              aceita, codigo_erro, campo_erro
         from app.importacao_plano_contas_linha
        where tentativa_id = $1 and aceita = false
        order by numero_da_linha
        limit $2 offset $3`,
      [tentativaId, itensPorPagina, deslocamento],
    ),
    cliente.query<{ total: string }>(
      `select count(*)::text as total
         from app.importacao_plano_contas_linha
        where tentativa_id = $1 and aceita = false`,
      [tentativaId],
    ),
  ]);

  return {
    rejeicoes: linhas.rows.map((linha) => ({
      id: linha.id,
      tentativaId: linha.tentativa_id,
      numeroDaLinha: linha.numero_da_linha,
      codigo: linha.codigo,
      nome: linha.nome,
      tipo: linha.tipo,
      natureza: linha.natureza,
      contaPai: linha.conta_pai,
      aceita: linha.aceita,
      codigoErro: linha.codigo_erro,
      campoErro: linha.campo_erro,
    })),
    total: Number(total.rows[0]?.total ?? '0'),
  };
};

/** Cria notificação de conclusão para o usuário iniciador. */
export const criarNotificacaoConclusao = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  tentativaId: string,
  tipo: 'CONCLUIDA' | 'CONCLUIDA_COM_REJEICOES' | 'REJEITADA' | 'FALHA',
  totais: { lidas: number; novas: number; atualizadas: number; rejeitadas: number },
): Promise<void> => {
  await cliente.query(
    `insert into app.importacao_plano_contas_notificacao
       (tenant_id, usuario_id, tentativa_id, tipo, estado, totais)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (tentativa_id, usuario_id, tipo) do nothing`,
    [tenantId, usuarioId, tentativaId, tipo, tipo, JSON.stringify(totais)],
  );
};

/** Empresa tem pelo menos uma conta válida? (para resolver pendência F5). */
export const empresaTemContaValida = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<boolean> => {
  const { rowCount } = await cliente.query(
    `select 1 from app.conta_contabil where empresa_id = $1 and arquivada = false limit 1`,
    [empresaId],
  );

  return (rowCount ?? 0) > 0;
};