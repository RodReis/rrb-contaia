/**
 * Endpoints de Notificações (SPEC-006). Somente `admin_escritorio` (§4.2).
 *
 * Rota `/notificacoes` não é aninhada em empresa: notificação é lista do
 * usuário/tenant, diferente de pendências (aninhada em `empresas/:empresaId`).
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';

import { ExigePapel, GuardDePapel } from '../auth/papel.guard';
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
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDePapel)
@ExigePapel('admin_escritorio')
export class NotificacoesController {
  constructor(private readonly notificacoes: NotificacoesService) {}

  @Get('painel')
  async consultarPainel(@Req() requisicao: RequisicaoAutenticada) {
    return this.notificacoes.consultarPainel(tenantDa(requisicao));
  }

  @Get('historico')
  async consultarHistorico(@Req() requisicao: RequisicaoAutenticada, @Query() consulta: unknown) {
    const filtro = analisar(filtroDoHistoricoSchema, consulta);

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
    return this.notificacoes.marcarComoLida(
      tenantDa(requisicao),
      notificacaoId,
      autorDa(requisicao),
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
