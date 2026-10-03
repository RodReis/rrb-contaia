/**
 * Endpoints de Notificações (SPEC-006). A autorização é por ação (SPEC-007 §3.1):
 * leitura para quem consulta, marcar como lida para quem administra.
 *
 * Rota `/notificacoes` não é aninhada em empresa: notificação é lista do
 * usuário/tenant, diferente de pendências (aninhada em `empresas/:empresaId`).
 */
import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { CarteiraService } from '../carteira/carteira.service';
import { CertificadosService } from '../certificados/certificados.service';
import { obterCorrelationId } from '../comum/problema';
import { restringirPendencia } from '../comum/restricao-por-chave';
import { analisar } from '../escritorio/escritorio.dto';
import { filtroDoHistoricoSchema, marcacaoEmLoteSchema } from './notificacoes.dto';
import { NotificacoesService } from './notificacoes.service';

@Controller('notificacoes')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
// Padrão da classe é a ação mais restrita; a leitura a relaxa explicitamente.
@ExigePermissao('notificacoes.sino.marcar_lida')
export class NotificacoesController {
  constructor(
    private readonly notificacoes: NotificacoesService,
    private readonly carteira: CarteiraService,
    private readonly certificados: CertificadosService,
  ) {}

  /**
   * O sino é do usuário: pendências das empresas da carteira dele mais o aviso
   * consolidado de carteira. `escopoDeEmpresas: 'NENHUMA'` só orienta a tela quando
   * não há nada a mostrar e a carteira está vazia.
   */
  @Get('painel')
  @ExigePermissao('notificacoes.sino.consultar')
  async consultarPainel(@Req() requisicao: RequisicaoAutenticada) {
    const tenantId = tenantDa(requisicao);
    const { usuarioId } = autorDa(requisicao);
    const permissoes = requisicao.sessao?.permissoes ?? [];
    // Alertas do cofre (D-30/15/7/vencido) nascem preguiçosos, ao consultar o sino (SPEC-011).
    await this.certificados.reconciliarDaCarteira({ tenantId, usuarioId }, obterCorrelationId(requisicao));
    const bruto = await this.notificacoes.consultarPainel(tenantId, usuarioId);
    // Mesma regra da Central: origem e veredito da análise só saem com a permissão.
    const painel = {
      ...bruto,
      notificacoes: bruto.notificacoes.map((n) => restringirPendencia(permissoes, n)),
    };

    if (painel.notificacoes.length > 0 || (await this.carteira.possuiCarteira(tenantId, usuarioId))) {
      return painel;
    }

    return { ...painel, escopoDeEmpresas: 'NENHUMA' as const };
  }

  @Get('historico')
  @ExigePermissao('notificacoes.sino.consultar')
  async consultarHistorico(@Req() requisicao: RequisicaoAutenticada, @Query() consulta: unknown) {
    const filtro = analisar(filtroDoHistoricoSchema, consulta);
    const tenantId = tenantDa(requisicao);
    const { usuarioId } = autorDa(requisicao);
    const permissoes = requisicao.sessao?.permissoes ?? [];
    await this.certificados.reconciliarDaCarteira({ tenantId, usuarioId }, obterCorrelationId(requisicao));
    const bruta = await this.notificacoes.consultarHistorico(
      tenantId,
      usuarioId,
      filtro.limite,
      filtro.deslocamento,
    );
    const pagina = {
      ...bruta,
      notificacoes: bruta.notificacoes.map((n) => restringirPendencia(permissoes, n)),
    };

    if (pagina.total > 0 || (await this.carteira.possuiCarteira(tenantId, usuarioId))) {
      return pagina;
    }

    return { ...pagina, escopoDeEmpresas: 'NENHUMA' as const };
  }

  @Put(':notificacaoId/leitura')
  async marcarComoLida(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('notificacaoId') notificacaoId: string,
  ) {
    return restringirPendencia(
      requisicao.sessao?.permissoes ?? [],
      await this.notificacoes.marcarComoLida(tenantDa(requisicao), notificacaoId, autorDa(requisicao)),
    );
  }

  @Put('leitura-em-lote')
  async marcarVariasComoLidas(@Req() requisicao: RequisicaoAutenticada, @Body() corpo: unknown) {
    const entrada = analisar(marcacaoEmLoteSchema, corpo);

    return this.notificacoes.marcarVariasComoLidas(
      tenantDa(requisicao),
      entrada.ids,
      autorDa(requisicao),
    );
  }
}
