import { createHash } from 'node:crypto';
import {
  CODIGOS_DE_ERRO,
  dataCivilEmSaoPaulo,
  ErroDeDominio,
  normalizarCnpj,
  validarPoderesRfb,
  type PoderRfb,
} from '@contaia/domain';
import {
  anexarEvidenciaDeProcuracao,
  arquivarProcuracaoRfb,
  atualizarRascunhoDeProcuracao,
  carregarEvidenciaDeProcuracao,
  carregarOperacaoIdempotenteDeProcuracao,
  carregarProcuracaoRfb,
  carregarUsuarioAdminDaProcuracao,
  exigirCarteiraDaProcuracao,
  exigirCarteiraOuAdminDaProcuracao,
  comContextoHumano,
  confirmarProcuracaoRfb,
  criarRascunhoDeProcuracao,
  gravarOperacaoDeProcuracao,
  gravarTesteLocalDaProcuracao,
  listarEventosDeProcuracao,
  listarProcuracoesRfb,
  registrarEventoDeProcuracao,
  registrarTentativaRecusadaDeProcuracao,
  resumirProcuracoesRfb,
  revogarProcuracaoRfb,
} from '@contaia/db';
import {
  conteudoConfereComOTipo,
  mensagemDaFalha,
  validarArquivo,
} from '@contaia/shared';
import { Injectable } from '@nestjs/common';
import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import { RfbDubleClient } from './rfb-duble.client';
import type { EntradaRascunho } from './procuracoes.dto';
import type { EntradaOperacao } from './procuracoes.dto';

export type SessaoProcuracao = Readonly<{
  tenantId: string;
  usuarioId: string;
  permissoes: readonly string[];
}>;
const erro = (codigo: string, mensagem: string) =>
  new ErroDeDominio(
    codigo as (typeof CODIGOS_DE_ERRO)[keyof typeof CODIGOS_DE_ERRO],
    mensagem,
  );

@Injectable()
export class ProcuracoesService {
  constructor(
    private readonly pool: PoolDoBanco,
    private readonly storage: StorageService,
    private readonly duble: RfbDubleClient,
  ) {}
  private tx<T>(
    s: SessaoProcuracao,
    cid: string,
    fn: (c: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    return comContextoHumano(
      this.pool.instancia,
      { tenantId: s.tenantId, usuarioId: s.usuarioId, correlationId: cid },
      fn,
    );
  }
  private exige(s: SessaoProcuracao, acao: string): void {
    if (!s.permissoes.includes('procuracoes.registro.' + acao))
      throw erro(
        CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
        'Sem autorização para esta ação.',
      );
  }
  private async exigirAdmin(
    s: SessaoProcuracao,
    c: import('pg').PoolClient,
  ): Promise<void> {
    if (!(await carregarUsuarioAdminDaProcuracao(c, s.tenantId, s.usuarioId)))
      throw erro(
        CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
        'Somente admin do escritório administra procurações.',
      );
  }
  async listar(
    s: SessaoProcuracao,
    f: Readonly<{
      empresaId?: string;
      busca?: string;
      estado?: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
      poder?: PoderRfb;
      vencimento?: '30_DIAS' | '7_DIAS' | 'VENCIDAS';
      ordem?: 'VENCIMENTO_ASC' | 'VENCIMENTO_DESC' | 'EMPRESA_ASC';
      limite: number;
      pagina: number;
    }>,
    cid: string,
  ) {
    this.exige(s, 'consultar');
    return this.tx(s, cid, (c) =>
      listarProcuracoesRfb(c, s.tenantId, dataCivilEmSaoPaulo(new Date()), {
        ...f,
        offset: (f.pagina - 1) * f.limite,
        limit: f.limite,
      }),
    );
  }
  async resumo(s: SessaoProcuracao, cid: string) {
    this.exige(s, 'consultar');
    return this.tx(s, cid, (c) =>
      resumirProcuracoesRfb(c, s.tenantId, dataCivilEmSaoPaulo(new Date())),
    );
  }
  async criar(
    s: SessaoProcuracao,
    empresaId: string,
    e: EntradaRascunho,
    cid: string,
  ) {
    this.exige(s, 'administrar');
    if (
      !validarPoderesRfb(e.powers).ok ||
      !this.dataValida(e.validFrom) ||
      !this.dataValida(e.validUntil) ||
      e.validUntil < e.validFrom
    )
      throw erro(
        CODIGOS_DE_ERRO.PROCURACAO_DADOS_INVALIDOS,
        'Período ou poderes inválidos.',
      );
    return this.tx(s, cid, async (c) => {
      await this.exigirAdmin(s, c);
      const id = await criarRascunhoDeProcuracao(c, {
        tenantId: s.tenantId,
        empresaId,
        usuarioId: s.usuarioId,
        validFrom: e.validFrom,
        validUntil: e.validUntil,
        powers: e.powers as PoderRfb[],
        hoje: dataCivilEmSaoPaulo(new Date()),
      });
      if (!id)
        throw erro(
          CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,
          'Empresa ativa ou CNPJ do escritório não disponível.',
        );
      await registrarEventoDeProcuracao(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        acao: 'CRIADA',
        estadoNovo: 'DRAFT',
        correlationId: cid,
        atorId: s.usuarioId,
        idempotencyKey: 'criada:' + id,
      });
      return carregarProcuracaoRfb(
        c,
        s.tenantId,
        id,
        dataCivilEmSaoPaulo(new Date()),
      );
    });
  }
  private dataValida(valor: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
    const data = new Date(`${valor}T00:00:00Z`);
    return (
      !Number.isNaN(data.valueOf()) && data.toISOString().slice(0, 10) === valor
    );
  }
  async editar(
    s: SessaoProcuracao,
    id: string,
    e: EntradaRascunho & { expectedRevision: number },
    cid: string,
  ) {
    this.exige(s, 'administrar');
    if (
      !validarPoderesRfb(e.powers).ok ||
      !this.dataValida(e.validFrom) ||
      !this.dataValida(e.validUntil) ||
      e.validUntil < e.validFrom
    )
      throw erro(
        CODIGOS_DE_ERRO.PROCURACAO_DADOS_INVALIDOS,
        'Período ou poderes inválidos.',
      );
    return this.tx(s, cid, async (c) => {
      await this.exigirAdmin(s, c);
      const ok = await atualizarRascunhoDeProcuracao(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        expectedRevision: e.expectedRevision,
        validFrom: e.validFrom,
        validUntil: e.validUntil,
        powers: e.powers as PoderRfb[],
      });
      if (!ok)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_REVISAO_CONFLITO,
          'Rascunho ou revisão desatualizada.',
        );
      await registrarEventoDeProcuracao(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        acao: 'RASCUNHO_ALTERADO',
        estadoNovo: 'DRAFT',
        correlationId: cid,
        atorId: s.usuarioId,
        idempotencyKey: 'edicao:' + id + ':' + e.expectedRevision,
      });
      return carregarProcuracaoRfb(
        c,
        s.tenantId,
        id,
        dataCivilEmSaoPaulo(new Date()),
      );
    });
  }
  async enviar(
    s: SessaoProcuracao,
    id: string,
    expectedRevision: number,
    a: Readonly<{ nome: string; tipo: string; bytes: Buffer }>,
    cid: string,
  ) {
    this.exige(s, 'administrar');
    const f = validarArquivo('PROCURACAO_RFB', {
      nome: a.nome,
      tipoConteudo: a.tipo,
      tamanhoBytes: a.bytes.byteLength,
    });
    if (
      f ||
      a.tipo !== 'application/pdf' ||
      !conteudoConfereComOTipo(a.tipo, a.bytes.subarray(0, 16))
    )
      throw erro(
        CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
        'PDF inválido: ' +
          (f
            ? mensagemDaFalha('PROCURACAO_RFB', f)
            : 'assinatura mágica não confere.'),
      );
    const sha256 = createHash('sha256').update(a.bytes).digest('hex');
    return this.tx(s, cid, async (c) => {
      await this.exigirAdmin(s, c);
      const p = await carregarProcuracaoRfb(
        c,
        s.tenantId,
        id,
        dataCivilEmSaoPaulo(new Date()),
        true,
      );
      if (!p)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_NAO_ENCONTRADA,
          'Procuração não encontrada.',
        );
      if (
        !(await exigirCarteiraOuAdminDaProcuracao(
          c,
          s.tenantId,
          s.usuarioId,
          p.empresaId,
        ))
      )
        throw erro(
          CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
          'Empresa fora da sua carteira.',
        );
      if (p.statusPersistido !== 'DRAFT' || p.revision !== expectedRevision)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_REVISAO_CONFLITO,
          'Rascunho ou revisão desatualizada.',
        );
      const key = await this.storage.enviar(s.tenantId, 'PROCURACAO_RFB', {
        nomeOriginal: a.nome,
        tipoConteudo: 'application/pdf',
        conteudo: a.bytes,
      });
      const saved = await anexarEvidenciaDeProcuracao(c, {
        tenantId: s.tenantId,
        empresaId: p.empresaId,
        procuracaoId: id,
        usuarioId: s.usuarioId,
        expectedRevision,
        storageKey: key,
        nome: a.nome.slice(0, 120),
        tamanho: a.bytes.byteLength,
        sha256,
      });
      if (!saved)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_REVISAO_CONFLITO,
          'Rascunho alterado durante envio.',
        );
      await registrarEventoDeProcuracao(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        acao: p.evidence ? 'EVIDENCIA_SUBSTITUIDA' : 'EVIDENCIA_ENVIADA',
        estadoNovo: 'DRAFT',
        correlationId: cid,
        atorId: s.usuarioId,
        idempotencyKey: 'evidencia:' + id + ':' + saved.revision,
      });
      return { revision: saved.revision, sha256, tamanho: a.bytes.byteLength };
    });
  }
  async testar(
    s: SessaoProcuracao,
    id: string,
    e: Readonly<{ expectedRevision: number; power: PoderRfb }>,
    cid: string,
  ) {
    this.exige(s, 'testar');
    return this.tx(s, cid, async (c) => {
      await this.exigirAdmin(s, c);
      const p = await carregarProcuracaoRfb(
        c,
        s.tenantId,
        id,
        dataCivilEmSaoPaulo(new Date()),
      );
      if (!p)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_NAO_ENCONTRADA,
          'Procuração não encontrada.',
        );
      if (
        !(await exigirCarteiraOuAdminDaProcuracao(
          c,
          s.tenantId,
          s.usuarioId,
          p.empresaId,
        ))
      )
        throw erro(
          CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
          'Empresa fora da sua carteira.',
        );
      if (
        !p.evidence ||
        p.statusPersistido !== 'DRAFT' ||
        p.revision !== e.expectedRevision ||
        !p.powers.includes(e.power)
      )
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_ESTADO_INVALIDO,
          'Estado, revisão ou poder incompatível.',
        );
      let out: Readonly<{ code: string }>;
      try {
        out = await this.duble.executar({
          poder: e.power,
          cnpj: normalizarCnpj(p.empresaCnpj),
          idempotencyKey: createHash('sha256')
            .update(
              `teste:${s.tenantId}:${p.empresaId}:${id}:${e.expectedRevision}`,
            )
            .digest('hex'),
          correlationId: cid,
        });
      } catch {
        out = { code: 'DUBLE_INDISPONIVEL' };
      }
      const ok = out.code === 'OK';
      const gravado = await gravarTesteLocalDaProcuracao(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        usuarioId: s.usuarioId,
        expectedRevision: e.expectedRevision,
        power: e.power,
        sucesso: ok,
        correlationId: cid,
      });
      if (!gravado)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_REVISAO_CONFLITO,
          'Revisão mudou durante o teste local.',
        );
      return {
        configuracaoTestadaLocalmente: ok,
        correlationId: cid,
        code: out.code,
      };
    });
  }
  async operar(
    s: SessaoProcuracao,
    id: string,
    e: EntradaOperacao,
    cid: string,
  ) {
    this.exige(s, 'operar');
    let chamadaIniciada = false;
    try {
      return await this.tx(s, cid, async (c) => {
        const p = await carregarProcuracaoRfb(
          c,
          s.tenantId,
          id,
          dataCivilEmSaoPaulo(new Date()),
        );
        if (!p)
          throw erro(
            CODIGOS_DE_ERRO.PROCURACAO_NAO_ENCONTRADA,
            'Procuração não encontrada.',
          );
        if (
          !(await exigirCarteiraDaProcuracao(
            c,
            s.tenantId,
            s.usuarioId,
            p.empresaId,
          ))
        )
          throw erro(
            CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
            'Empresa fora da sua carteira.',
          );
        if (
          !p.powers.includes(e.power) ||
          p.status !== 'ACTIVE' ||
          p.archivedAt !== null
        )
          throw erro(
            CODIGOS_DE_ERRO.PROCURACAO_ESTADO_INVALIDO,
            'Procuração não autoriza este poder neste momento.',
          );
        const anterior = await carregarOperacaoIdempotenteDeProcuracao(c, {
          tenantId: s.tenantId,
          empresaId: p.empresaId,
          idempotencyKey: e.idempotencyKey,
        });
        if (anterior) {
          if (anterior.poder !== e.power)
            throw erro(
              CODIGOS_DE_ERRO.PROCURACAO_IDEMPOTENCIA_CONFLITO,
              'Chave idempotente já usada com outro poder.',
            );
          return {
            code: anterior.codigo,
            summary: anterior.resumo,
            repetida: true,
          };
        }
        chamadaIniciada = true;
        const out = await this.duble.executar({
          poder: e.power,
          cnpj: normalizarCnpj(p.empresaCnpj),
          idempotencyKey: createHash('sha256')
            .update(`${s.tenantId}:${p.empresaId}:${e.idempotencyKey}`)
            .digest('hex'),
          correlationId: cid,
        });
        const gravada = await gravarOperacaoDeProcuracao(c, {
          tenantId: s.tenantId,
          empresaId: p.empresaId,
          procuracaoId: id,
          usuarioId: s.usuarioId,
          poder: e.power,
          idempotencyKey: e.idempotencyKey,
          codigo: out.code,
          resumo: out.summary,
          correlationId: cid,
        });
        if (!gravada) {
          const corrida = await carregarOperacaoIdempotenteDeProcuracao(c, {
            tenantId: s.tenantId,
            empresaId: p.empresaId,
            idempotencyKey: e.idempotencyKey,
          });
          if (!corrida)
            throw erro(
              CODIGOS_DE_ERRO.PROCURACAO_ESTADO_INVALIDO,
              'Resultado concorrente ainda indisponível.',
            );
          if (corrida.poder !== e.power)
            throw erro(
              CODIGOS_DE_ERRO.PROCURACAO_IDEMPOTENCIA_CONFLITO,
              'Chave idempotente já usada com outro poder.',
            );
          return {
            code: corrida.codigo,
            summary: corrida.resumo,
            repetida: true,
          };
        }
        return { code: out.code, summary: out.summary, repetida: false };
      });
    } catch (falha) {
      if (
        chamadaIniciada ||
        (falha instanceof ErroDeDominio &&
          (falha.codigo === CODIGOS_DE_ERRO.PROCURACAO_ESTADO_INVALIDO ||
            falha.codigo === CODIGOS_DE_ERRO.PROCURACAO_IDEMPOTENCIA_CONFLITO))
      ) {
        const motivo =
          falha instanceof ErroDeDominio ? falha.codigo : 'FALHA_TECNICA';
        try {
          await this.tx(s, cid, (c) =>
            registrarTentativaRecusadaDeProcuracao(c, {
              tenantId: s.tenantId,
              procuracaoId: id,
              usuarioId: s.usuarioId,
              poder: e.power,
              resultado: 'RECUSADA',
              motivo,
              correlationId: cid,
              idempotencyKey: `tentativa:${s.tenantId}:${id}:${e.idempotencyKey}`,
            }),
          );
        } catch {
          /* preserve the original failure */
        }
      }
      throw falha;
    }
  }
  async confirmar(
    s: SessaoProcuracao,
    id: string,
    entrada: Readonly<{ expectedRevision: number; declaracaoConferida: true }>,
    cid: string,
  ) {
    this.exige(s, 'confirmar');
    return this.tx(s, cid, async (c) => {
      await this.exigirAdmin(s, c);
      const r = await confirmarProcuracaoRfb(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        expectedRevision: entrada.expectedRevision,
        usuarioId: s.usuarioId,
        hoje: dataCivilEmSaoPaulo(new Date()),
        correlationId: cid,
      });
      if (r === 'OVERLAP')
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_PERIODO_SOBREPOSTO,
          'Período conflita com outra procuração.',
        );
      if (r === 'REVISION_CONFLICT')
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_REVISAO_CONFLITO,
          'Revisão desatualizada.',
        );
      if (r !== 'CONFIRMED')
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_ESTADO_INVALIDO,
          'Confirmação exige PDF e teste local bem-sucedido.',
        );
      return { confirmada: true };
    });
  }
  async revogar(
    s: SessaoProcuracao,
    id: string,
    e: Readonly<{ expectedRevision: number; motivo: string }>,
    cid: string,
  ) {
    this.exige(s, 'revogar');
    return this.tx(s, cid, async (c) => {
      await this.exigirAdmin(s, c);
      const ok = await revogarProcuracaoRfb(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        expectedRevision: e.expectedRevision,
        usuarioId: s.usuarioId,
        motivo: e.motivo,
        correlationId: cid,
      });
      if (!ok)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_REVISAO_CONFLITO,
          'Estado ou revisão mudou.',
        );
      return { revogada: true };
    });
  }
  async arquivar(
    s: SessaoProcuracao,
    id: string,
    expectedRevision: number,
    cid: string,
  ) {
    this.exige(s, 'arquivar');
    return this.tx(s, cid, async (c) => {
      await this.exigirAdmin(s, c);
      const ok = await arquivarProcuracaoRfb(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        expectedRevision,
        hoje: dataCivilEmSaoPaulo(new Date()),
        correlationId: cid,
        usuarioId: s.usuarioId,
      });
      if (!ok)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_ESTADO_INVALIDO,
          'Somente procuração vencida ou revogada pode ser arquivada.',
        );
      return { arquivada: true };
    });
  }
  async historico(
    s: SessaoProcuracao,
    id: string,
    pagina: number,
    cid: string,
  ) {
    this.exige(s, 'consultar');
    return this.tx(s, cid, async (c) => {
      const p = await carregarProcuracaoRfb(
        c,
        s.tenantId,
        id,
        dataCivilEmSaoPaulo(new Date()),
      );
      if (!p)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_NAO_ENCONTRADA,
          'Procuração não encontrada.',
        );
      if (
        !(await exigirCarteiraOuAdminDaProcuracao(
          c,
          s.tenantId,
          s.usuarioId,
          p.empresaId,
        ))
      )
        throw erro(
          CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
          'Empresa fora da sua carteira.',
        );
      const eventos = await listarEventosDeProcuracao(
        c,
        s.tenantId,
        id,
        25,
        (pagina - 1) * 25,
      );
      const { rows } = await c.query<{ total: string }>(
        'select count(*)::text total from app.rfb_procuracao_evento where tenant_id=$1 and procuracao_id=$2',
        [s.tenantId, id],
      );
      return { eventos, total: Number(rows[0]?.total ?? 0) };
    });
  }
  async obterEvidencia(s: SessaoProcuracao, id: string, cid: string) {
    this.exige(s, 'consultar');
    return this.tx(s, cid, async (c) => {
      const p = await carregarProcuracaoRfb(
        c,
        s.tenantId,
        id,
        dataCivilEmSaoPaulo(new Date()),
      );
      if (!p)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_NAO_ENCONTRADA,
          'Procuração não encontrada.',
        );
      if (!p.evidence)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_SEM_EVIDENCIA,
          'Evidência não encontrada.',
        );
      const doc = await carregarEvidenciaDeProcuracao(c, s.tenantId, id);
      if (!doc)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_NAO_ENCONTRADA,
          'Evidência não encontrada.',
        );
      const { rows } = await c.query<{ autorizado: boolean }>(
        'select app.usuario_admin_atual() or app.empresa_autorizada($1) autorizado',
        [p.empresaId],
      );
      if (rows[0]?.autorizado !== true)
        throw erro(
          CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
          'Empresa fora da sua carteira.',
        );
      return doc;
    });
  }
  async registrarEvidenciaBaixada(
    s: SessaoProcuracao,
    id: string,
    cid: string,
  ): Promise<void> {
    this.exige(s, 'consultar');
    await this.tx(s, cid, async (c) => {
      const p = await carregarProcuracaoRfb(
        c,
        s.tenantId,
        id,
        dataCivilEmSaoPaulo(new Date()),
      );
      if (!p || !p.evidence)
        throw erro(
          CODIGOS_DE_ERRO.PROCURACAO_SEM_EVIDENCIA,
          'Evidência não encontrada.',
        );
      if (
        !(await exigirCarteiraOuAdminDaProcuracao(
          c,
          s.tenantId,
          s.usuarioId,
          p.empresaId,
        ))
      )
        throw erro(
          CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
          'Empresa fora da sua carteira.',
        );
      await registrarEventoDeProcuracao(c, {
        tenantId: s.tenantId,
        procuracaoId: id,
        acao: 'EVIDENCIA_BAIXADA',
        correlationId: cid,
        atorId: s.usuarioId,
        idempotencyKey: 'evidencia-download:' + id + ':' + cid,
      });
    });
  }
}
