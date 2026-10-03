/**
 * Cofre de certificados A1 (SPEC-011): versões, eventos e tickets de ingestão.
 *
 * Aqui mora só metadado. Arquivo, senha e chave privada existem apenas no Vault
 * (SPEC-011 §6.2); a coluna `referencia_segredo` é um UUID opaco que o caso de uso
 * entrega ao cofre, nunca ao cliente. O caso de uso controla a transação; cada
 * função recebe o `PoolClient` e repete `tenant_id` no SQL — a RLS é a rede de
 * proteção, não o único controle.
 */
import {
  planejarAtivacao,
  planejarDesativacao,
  planejarTrocaDeResponsavel,
  type OperacaoDeIngestao,
  type VersaoVigente,
} from '@contaia/domain';
import type { PoolClient } from 'pg';

export type EstadoDaVersao = 'VIGENTE' | 'SUBSTITUIDO' | 'DESATIVADO';

export type VersaoDoCertificado = Readonly<{
  id: string;
  empresaId: string;
  versao: number;
  estado: EstadoDaVersao;
  titular: string;
  cnpjTitular: string;
  autoridadeCertificadora: string;
  cadeia: readonly string[];
  numeroSerie: string;
  impressaoDigital: string;
  /** Datas civis `YYYY-MM-DD` (I-11). */
  validoDe: string;
  validoAte: string;
  responsavelId: string;
  /** Referência opaca do segredo no Vault: só o servidor a usa, nunca sai em resposta. */
  referenciaSegredo: string;
  cadastradoEm: string;
  cadastradoPorId: string;
  encerradoEm: string | null;
  encerradoPorId: string | null;
  motivoDoEncerramento: 'SUBSTITUICAO' | 'DESATIVACAO' | null;
  justificativa: string | null;
  substituidoPorId: string | null;
}>;

export type DadosDoCertificado = Readonly<{
  titular: string;
  cnpjTitular: string;
  autoridadeCertificadora: string;
  cadeia: readonly string[];
  numeroSerie: string;
  impressaoDigital: string;
  validoDe: string;
  validoAte: string;
  referenciaSegredo: string;
}>;

type LinhaDaVersao = {
  id: string;
  empresa_id: string;
  versao: number;
  estado: EstadoDaVersao;
  titular: string;
  cnpj_titular: string;
  autoridade_certificadora: string;
  cadeia: string[];
  numero_serie: string;
  impressao_digital: string;
  valido_de: string;
  valido_ate: string;
  responsavel_id: string;
  referencia_segredo: string;
  cadastrado_em: Date;
  cadastrado_por: string;
  encerrado_em: Date | null;
  encerrado_por: string | null;
  motivo_encerramento: 'SUBSTITUICAO' | 'DESATIVACAO' | null;
  justificativa: string | null;
  substituido_por: string | null;
};

/** `to_char` nas datas: o driver devolveria `Date` no fuso do servidor (I-11). */
export const COLUNAS_DA_VERSAO = `c.id, c.empresa_id, c.versao, c.estado, c.titular, c.cnpj_titular,
  c.autoridade_certificadora, c.cadeia, c.numero_serie, c.impressao_digital,
  to_char(c.valido_de, 'YYYY-MM-DD') as valido_de, to_char(c.valido_ate, 'YYYY-MM-DD') as valido_ate,
  c.responsavel_id, c.referencia_segredo, c.cadastrado_em, c.cadastrado_por, c.encerrado_em,
  c.encerrado_por, c.motivo_encerramento, c.justificativa, c.substituido_por`;

export const linhaParaVersao = (linha: LinhaDaVersao): VersaoDoCertificado => ({
  id: linha.id,
  empresaId: linha.empresa_id,
  versao: linha.versao,
  estado: linha.estado,
  titular: linha.titular,
  cnpjTitular: linha.cnpj_titular,
  autoridadeCertificadora: linha.autoridade_certificadora,
  cadeia: linha.cadeia,
  numeroSerie: linha.numero_serie,
  impressaoDigital: linha.impressao_digital,
  validoDe: linha.valido_de,
  validoAte: linha.valido_ate,
  responsavelId: linha.responsavel_id,
  referenciaSegredo: linha.referencia_segredo,
  cadastradoEm: linha.cadastrado_em.toISOString(),
  cadastradoPorId: linha.cadastrado_por,
  encerradoEm: linha.encerrado_em === null ? null : linha.encerrado_em.toISOString(),
  encerradoPorId: linha.encerrado_por,
  motivoDoEncerramento: linha.motivo_encerramento,
  justificativa: linha.justificativa,
  substituidoPorId: linha.substituido_por,
});

/**
 * Serializa as mutações do cofre de UMA empresa. Substituição, desativação e troca
 * de responsável leem o vigente e escrevem a partir dele: sem o lock, duas
 * simultâneas planejariam sobre o mesmo estado. O lock é de transação (cai no
 * commit/rollback) e não toca a linha da empresa, que outras fatias editam.
 */
export const travarCofreDaEmpresa = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<void> => {
  await cliente.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `cofre-de-certificados:${empresaId}`,
  ]);
};

export const carregarVigente = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<VersaoDoCertificado | null> => {
  const { rows } = await cliente.query<LinhaDaVersao>(
    `select ${COLUNAS_DA_VERSAO} from app.empresa_certificado c
      where c.tenant_id = $1 and c.empresa_id = $2 and c.estado = 'VIGENTE'`,
    [tenantId, empresaId],
  );

  return rows[0] === undefined ? null : linhaParaVersao(rows[0]);
};

/** Todas as versões da empresa, da mais recente para a mais antiga. */
export const listarVersoesDoCertificado = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<readonly VersaoDoCertificado[]> => {
  const { rows } = await cliente.query<LinhaDaVersao>(
    `select ${COLUNAS_DA_VERSAO} from app.empresa_certificado c
      where c.tenant_id = $1 and c.empresa_id = $2
      order by c.versao desc`,
    [tenantId, empresaId],
  );

  return rows.map(linhaParaVersao);
};

export const carregarVersaoDoCertificado = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  versaoId: string,
): Promise<VersaoDoCertificado | null> => {
  const { rows } = await cliente.query<LinhaDaVersao>(
    `select ${COLUNAS_DA_VERSAO} from app.empresa_certificado c
      where c.tenant_id = $1 and c.empresa_id = $2 and c.id = $3`,
    [tenantId, empresaId, versaoId],
  );

  return rows[0] === undefined ? null : linhaParaVersao(rows[0]);
};

const ultimoNumeroDeVersao = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<number> => {
  const { rows } = await cliente.query<{ maximo: number | null }>(
    `select max(versao)::int as maximo from app.empresa_certificado
      where tenant_id = $1 and empresa_id = $2`,
    [tenantId, empresaId],
  );

  return rows[0]?.maximo ?? 0;
};

export const novoIdentificador = async (cliente: PoolClient): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>('select app.uuid_v7() as id');

  return rows[0]?.id ?? '';
};

export type AtivacaoDeVersao = Readonly<{
  tenantId: string;
  empresaId: string;
  operacao: OperacaoDeIngestao;
  dados: DadosDoCertificado;
  responsavelId: string;
  autorId: string;
}>;

export type VersaoAtivada = Readonly<{
  nova: VersaoDoCertificado;
  anteriorId: string | null;
  acao: OperacaoDeIngestao;
}>;

/**
 * Ativa a versão nova numa operação só (SPEC-011 §3.3): o domínio decide (cadastro sem
 * vigente, substituição com vigente), a anterior é encerrada apontando para a nova, e a
 * nova entra vigente. Tudo na transação do chamador: falha em qualquer passo desfaz os
 * dois lados e o anterior continua vigente e utilizável. O índice único parcial é a
 * última defesa contra dois vigentes.
 */
export const ativarVersao = async (
  cliente: PoolClient,
  ativacao: AtivacaoDeVersao,
): Promise<VersaoAtivada> => {
  const { tenantId, empresaId, dados } = ativacao;

  await travarCofreDaEmpresa(cliente, empresaId);

  const vigente = await carregarVigente(cliente, tenantId, empresaId);
  const plano = planejarAtivacao(
    ativacao.operacao,
    vigente === null ? null : paraVersaoVigente(vigente),
    await ultimoNumeroDeVersao(cliente, tenantId, empresaId),
  );
  const novaId = await novoIdentificador(cliente);

  if (plano.encerrarId !== null) {
    // A FK do sucessor é adiada até o fim da transação: a nova linha entra logo abaixo.
    await cliente.query(
      `update app.empresa_certificado
          set estado = 'SUBSTITUIDO', encerrado_em = now(), encerrado_por = $3,
              motivo_encerramento = 'SUBSTITUICAO', substituido_por = $4
        where tenant_id = $1 and id = $2 and estado = 'VIGENTE'`,
      [tenantId, plano.encerrarId, ativacao.autorId, novaId],
    );
  }

  const { rows } = await cliente.query<LinhaDaVersao>(
    `with nova as (
       insert into app.empresa_certificado
         (id, tenant_id, empresa_id, versao, titular, cnpj_titular, autoridade_certificadora, cadeia,
          numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo,
          cadastrado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning *)
     select ${COLUNAS_DA_VERSAO} from nova c`,
    [
      novaId,
      tenantId,
      empresaId,
      plano.versao,
      dados.titular,
      dados.cnpjTitular,
      dados.autoridadeCertificadora,
      dados.cadeia,
      dados.numeroSerie,
      dados.impressaoDigital,
      dados.validoDe,
      dados.validoAte,
      ativacao.responsavelId,
      dados.referenciaSegredo,
      ativacao.autorId,
    ],
  );
  const nova = rows[0];

  if (nova === undefined) {
    throw new Error('A versão do certificado não foi gravada.');
  }

  return { nova: linhaParaVersao(nova), anteriorId: plano.encerrarId, acao: plano.acao };
};

export const paraVersaoVigente = (versao: VersaoDoCertificado): VersaoVigente => ({
  id: versao.id,
  versao: versao.versao,
  responsavelId: versao.responsavelId,
});

/**
 * Desativa o vigente sem apagar nada (SPEC-011 §3.4): a versão fica `DESATIVADO` com
 * motivo, autor e instante. O motivo vazio é recusado pelo domínio antes de qualquer SQL.
 */
export const desativarVigente = async (
  cliente: PoolClient,
  entrada: Readonly<{ tenantId: string; empresaId: string; motivo: string; autorId: string }>,
): Promise<VersaoDoCertificado> => {
  await travarCofreDaEmpresa(cliente, entrada.empresaId);

  const vigente = await carregarVigente(cliente, entrada.tenantId, entrada.empresaId);
  const plano = planejarDesativacao(vigente === null ? null : paraVersaoVigente(vigente), entrada.motivo);

  const { rows } = await cliente.query<LinhaDaVersao>(
    `with atualizada as (
       update app.empresa_certificado
          set estado = 'DESATIVADO', encerrado_em = now(), encerrado_por = $3,
              motivo_encerramento = 'DESATIVACAO', justificativa = $4
        where tenant_id = $1 and id = $2 and estado = 'VIGENTE'
        returning *)
     select ${COLUNAS_DA_VERSAO} from atualizada c`,
    [entrada.tenantId, plano.encerrarId, entrada.autorId, plano.motivo],
  );
  const desativada = rows[0];

  if (desativada === undefined) {
    throw new Error('A versão do certificado não foi desativada.');
  }

  return linhaParaVersao(desativada);
};

export type TrocaDeResponsavel = Readonly<{
  versao: VersaoDoCertificado;
  mudou: boolean;
  responsavelAnteriorId: string;
}>;

/** Troca o responsável do vigente; `novoElegivel` já foi conferido pelo caso de uso. */
export const trocarResponsavel = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    empresaId: string;
    novoResponsavelId: string;
    novoElegivel: boolean;
  }>,
): Promise<TrocaDeResponsavel> => {
  await travarCofreDaEmpresa(cliente, entrada.empresaId);

  const vigente = await carregarVigente(cliente, entrada.tenantId, entrada.empresaId);
  const plano = planejarTrocaDeResponsavel(
    vigente === null ? null : paraVersaoVigente(vigente),
    entrada.novoResponsavelId,
    entrada.novoElegivel,
  );

  if (vigente === null) {
    // Inalcançável: o domínio já recusou a troca sem vigente.
    throw new Error('Não há certificado vigente para trocar o responsável.');
  }

  if (!plano.mudou) {
    return { versao: vigente, ...plano };
  }

  const { rows } = await cliente.query<LinhaDaVersao>(
    `with atualizada as (
       update app.empresa_certificado set responsavel_id = $3
        where tenant_id = $1 and id = $2 and estado = 'VIGENTE'
        returning *)
     select ${COLUNAS_DA_VERSAO} from atualizada c`,
    [entrada.tenantId, vigente.id, entrada.novoResponsavelId],
  );
  const atualizada = rows[0];

  if (atualizada === undefined) {
    throw new Error('O responsável do certificado não foi alterado.');
  }

  return {
    versao: linhaParaVersao(atualizada),
    mudou: true,
    responsavelAnteriorId: plano.responsavelAnteriorId,
  };
};

// -- Eventos (append-only, I-6) -------------------------------------------------------

export type AcaoDoEventoDeCertificado =
  | 'CADASTRO'
  | 'SUBSTITUICAO'
  | 'DESATIVACAO'
  | 'RESPONSAVEL_ALTERADO'
  | 'RESPONSAVEL_PERDIDO'
  | 'ALERTA_EMITIDO'
  | 'RECUSA';

export type EventoDeCertificadoParaRegistrar = Readonly<{
  tenantId: string;
  empresaId: string;
  certificadoId: string | null;
  acao: AcaoDoEventoDeCertificado;
  /** Código estável da recusa ou marco do alerta. Nunca detalhe criptográfico. */
  codigo?: string | null;
  motivo?: string | null;
  usuarioId: string | null;
  identidadeTecnica?: string | null;
  correlationId: string;
}>;

export const registrarEventoDeCertificado = async (
  cliente: PoolClient,
  evento: EventoDeCertificadoParaRegistrar,
): Promise<void> => {
  await cliente.query(
    `insert into app.empresa_certificado_evento
       (tenant_id, empresa_id, certificado_id, acao, resultado, codigo, motivo, usuario_id,
        identidade_tecnica, correlation_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      evento.tenantId,
      evento.empresaId,
      evento.certificadoId,
      evento.acao,
      evento.acao === 'RECUSA' ? 'RECUSADO' : 'SUCESSO',
      evento.codigo ?? null,
      evento.motivo ?? null,
      evento.usuarioId,
      evento.identidadeTecnica ?? null,
      evento.correlationId,
    ],
  );
};

export type EventoNaLista = Readonly<{
  id: string;
  empresaId: string;
  empresaNome: string;
  acao: AcaoDoEventoDeCertificado;
  resultado: 'SUCESSO' | 'RECUSADO';
  codigo: string | null;
  motivo: string | null;
  usuarioId: string | null;
  usuarioNome: string | null;
  identidadeTecnica: string | null;
  correlationId: string;
  ocorridoEm: string;
}>;

export type FiltroDoHistoricoDeCertificados = Readonly<{
  /** Só os eventos das empresas da carteira de quem pergunta (SPEC-009 §3.5). */
  carteiraDoUsuarioId: string;
  empresaId: string | null;
  acao: AcaoDoEventoDeCertificado | null;
  resultado: 'SUCESSO' | 'RECUSADO' | null;
  limite: number;
  deslocamento: number;
}>;

type LinhaDoEvento = {
  id: string;
  empresa_id: string;
  empresa_nome: string;
  acao: AcaoDoEventoDeCertificado;
  resultado: 'SUCESSO' | 'RECUSADO';
  codigo: string | null;
  motivo: string | null;
  usuario_id: string | null;
  usuario_nome: string | null;
  identidade_tecnica: string | null;
  correlation_id: string;
  ocorrido_em: Date;
};

/** Aba Certificados do Histórico de Informações: da data mais recente para a mais antiga. */
export const listarHistoricoDeCertificados = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDoHistoricoDeCertificados,
): Promise<Readonly<{ eventos: readonly EventoNaLista[]; total: number }>> => {
  const condicoes = `
    ev.tenant_id = $1
    and ($3::uuid is null or ev.empresa_id = $3)
    and ($4::text is null or ev.acao = $4)
    and ($5::text is null or ev.resultado = $5)
    and exists (
      select 1 from app.carteira_vinculo v
       where v.tenant_id = ev.tenant_id and v.empresa_id = ev.empresa_id
         and v.usuario_id = $2 and v.encerrado_em is null)`;
  const base = [tenantId, filtro.carteiraDoUsuarioId, filtro.empresaId, filtro.acao, filtro.resultado];

  const { rows } = await cliente.query<LinhaDoEvento>(
    `select ev.id, ev.empresa_id, coalesce(e.nome_fantasia, e.razao_social, e.cnpj) as empresa_nome,
            ev.acao, ev.resultado, ev.codigo, ev.motivo, ev.usuario_id, u.nome as usuario_nome,
            ev.identidade_tecnica, ev.correlation_id, ev.ocorrido_em
       from app.empresa_certificado_evento ev
       join app.empresa e on e.id = ev.empresa_id and e.tenant_id = ev.tenant_id
       left join app.usuario u on u.id = ev.usuario_id and u.tenant_id = ev.tenant_id
      where ${condicoes}
      order by ev.ocorrido_em desc, ev.sequencia desc
      limit $6 offset $7`,
    [...base, filtro.limite, filtro.deslocamento],
  );
  const total = await cliente.query<{ total: string }>(
    `select count(*)::text as total from app.empresa_certificado_evento ev where ${condicoes}`,
    base,
  );

  return {
    eventos: rows.map((linha) => ({
      id: linha.id,
      empresaId: linha.empresa_id,
      empresaNome: linha.empresa_nome,
      acao: linha.acao,
      resultado: linha.resultado,
      codigo: linha.codigo,
      motivo: linha.motivo,
      usuarioId: linha.usuario_id,
      usuarioNome: linha.usuario_nome,
      identidadeTecnica: linha.identidade_tecnica,
      correlationId: linha.correlation_id,
      ocorridoEm: linha.ocorrido_em.toISOString(),
    })),
    total: Number(total.rows[0]?.total ?? '0'),
  };
};

// -- Ticket de ingestão (uso único) -------------------------------------------------

export type TicketEmitido = Readonly<{ id: string; expiraEm: string }>;

export const emitirTicketDeIngestao = async (
  cliente: PoolClient,
  entrada: Readonly<{
    tenantId: string;
    empresaId: string;
    usuarioId: string;
    operacao: OperacaoDeIngestao;
    responsavelId: string;
    correlationId: string;
    validadeEmSegundos: number;
  }>,
): Promise<TicketEmitido> => {
  const { rows } = await cliente.query<{ id: string; expira_em: Date }>(
    `insert into app.empresa_certificado_ingestao
       (tenant_id, empresa_id, usuario_id, operacao, responsavel_id, correlation_id, expira_em)
     values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
     returning id, expira_em`,
    [
      entrada.tenantId,
      entrada.empresaId,
      entrada.usuarioId,
      entrada.operacao,
      entrada.responsavelId,
      entrada.correlationId,
      entrada.validadeEmSegundos,
    ],
  );
  const linha = rows[0];

  if (linha === undefined) {
    throw new Error('O ticket de ingestão não foi gravado.');
  }

  return { id: linha.id, expiraEm: linha.expira_em.toISOString() };
};

export type TicketParaConsumir = Readonly<{
  id: string;
  tenantId: string;
  empresaId: string;
  usuarioId: string;
  operacao: OperacaoDeIngestao;
  responsavelId: string;
}>;

/**
 * Consumo atômico: só a primeira tentativa vence (`update ... where estado = 'EMITIDO'`),
 * e a linha precisa coincidir com a carga assinada. `RECUSADO` aceita ticket já vencido —
 * a tentativa recusada existiu e entra no histórico —, `CONSUMIDO` não. Ticket vencido que
 * ninguém usou é marcado `EXPIRADO`. Devolve `true` quando ESTA chamada o consumiu.
 */
export const consumirTicketDeIngestao = async (
  cliente: PoolClient,
  ticket: TicketParaConsumir,
  destino: 'CONSUMIDO' | 'RECUSADO',
): Promise<boolean> => {
  const consumido = await cliente.query(
    `update app.empresa_certificado_ingestao
        set estado = $7, consumido_em = now()
      where id = $1 and tenant_id = $2 and empresa_id = $3 and usuario_id = $4
        and operacao = $5 and responsavel_id = $6 and estado = 'EMITIDO'
        and ($7 = 'RECUSADO' or expira_em > now())`,
    [
      ticket.id,
      ticket.tenantId,
      ticket.empresaId,
      ticket.usuarioId,
      ticket.operacao,
      ticket.responsavelId,
      destino,
    ],
  );

  if ((consumido.rowCount ?? 0) > 0) {
    return true;
  }

  await cliente.query(
    `update app.empresa_certificado_ingestao
        set estado = 'EXPIRADO', consumido_em = now()
      where id = $1 and tenant_id = $2 and estado = 'EMITIDO' and expira_em <= now()`,
    [ticket.id, ticket.tenantId],
  );

  return false;
};
