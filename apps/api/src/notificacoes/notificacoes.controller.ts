/**
 * Endpoints de Notificações (SPEC-006). A autorização é por ação (SPEC-007 §3.1):
 * leitura para quem consulta, marcar como lida para quem administra.
 *
 * Rota `/notificacoes` não é aninhada em empresa: notificação é lista do
 * usuário/tenant, diferente de pendências (aninhada em `empresas/:empresaId`).
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';

import { ExigeAcao, GuardDeAcao } from '../auth/acao.guard';
import { escopoDaSessao } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import { filtroDoHistoricoSchema, marcacaoEmLoteSchema } from './notificacoes.dto';
import { type Autor, NotificacoesService } from './notificacoes.service';

const tenantDa = (requisicao: RequisicaoAutenticada): string => {
  const tenantId = requisicao.sessao?.tenantId;

  if (tenantId === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.TENANT_DIVERGENTE, 'Sessão sem escritório associado.');
  }

  return tenantId;
};

const autorDa = (requisicao: RequisicaoAutenticada): Autor => {
  const usuarioId = requisicao.sessao?.usuarioId;

  if (usuarioId === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.TENANT_DIVERGENTE, 'Sessão sem usuário associado.');
  }

  return { usuarioId };
};

@Controller('notificacoes')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
// Padrão da classe é a ação mais restrita; a leitura a relaxa explicitamente.
@ExigeAcao('NOTIFICACOES', 'administrar')
export class NotificacoesController {
  constructor(private readonly notificacoes: NotificacoesService) {}

  // As notificações nascem de empresas: sem carteira, nada é visível nem marcável.
  @Get('painel')
  @ExigeAcao('NOTIFICACOES', 'consultar')
  async consultarPainel(@Req() requisicao: RequisicaoAutenticada) {
    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      return { notificacoes: [], naoLidas: 0, escopoDeEmpresas: 'NENHUMA' as const };
    }

    return this.notificacoes.consultarPainel(tenantDa(requisicao));
  }

  @Get('historico')
  @ExigeAcao('NOTIFICACOES', 'consultar')
  async consultarHistorico(@Req() requisicao: RequisicaoAutenticada, @Query() consulta: unknown) {
    const filtro = analisar(filtroDoHistoricoSchema, consulta);

    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      return { notificacoes: [], total: 0, escopoDeEmpresas: 'NENHUMA' as const };
    }

    return this.notificacoes.consultarHistorico(
      tenantDa(requisicao),
      filtro.limite,
      filtro.deslocamento,
    );
  }

  @Put(':notificacaoId/leitura')
  async marcarComoLida(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('notificacaoId') notificacaoId: string,
  ) {
    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.NOTIFICACAO_NAO_ENCONTRADA,
        'Notificação não encontrada.',
      );
    }

    return this.notificacoes.marcarComoLida(
      tenantDa(requisicao),
      notificacaoId,
      autorDa(requisicao),
    );
  }

  @Put('leitura-em-lote')
  async marcarVariasComoLidas(@Req() requisicao: RequisicaoAutenticada, @Body() corpo: unknown) {
    const entrada = analisar(marcacaoEmLoteSchema, corpo);

    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      return { marcadas: 0 };
    }

    return this.notificacoes.marcarVariasComoLidas(
      tenantDa(requisicao),
      entrada.ids,
      autorDa(requisicao),
    );
  }
}
