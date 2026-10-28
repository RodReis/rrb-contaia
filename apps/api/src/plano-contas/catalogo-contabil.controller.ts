import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { camposDaContaSchema, camposDoCentroSchema, consultaCatalogoSchema, historicoDoCatalogoSchema, versaoCatalogoSchema } from './catalogo-contabil.dto';
import { CatalogoContabilService } from './catalogo-contabil.service';

@Controller('empresas/:empresaId/estrutura-contabil')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class CatalogoContabilController {
  constructor(private readonly catalogo: CatalogoContabilService) {}

  @Get('contas')
  @ExigePermissao('contabil.estrutura_contabil.consultar')
  contas(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Query() query: unknown) {
    const consulta = analisar(consultaCatalogoSchema,query);
    return this.catalogo.listarContas({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, consulta.cursor, consulta.busca);
  }

  @Get('centros-de-custo')
  @ExigePermissao('contabil.estrutura_contabil.consultar')
  centros(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Query() query: unknown) {
    const consulta = analisar(consultaCatalogoSchema,query);
    return this.catalogo.listarCentros({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, consulta.cursor, consulta.busca);
  }

  @Put('contas/:codigo')
  @ExigePermissao('contabil.estrutura_contabil.manter_plano_contas')
  async conta(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Param('codigo') codigo: string, @Body() body: unknown) {
    const dados = analisar(camposDaContaSchema, body);
    return this.catalogo.salvarConta({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, codigo, dados, obterCorrelationId(req));
  }

  @Put('contas/:codigo/arquivamento')
  @ExigePermissao('contabil.estrutura_contabil.arquivar')
  async arquivarConta(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Param('codigo') codigo: string, @Body() body: unknown) {
    const { version } = analisar(versaoCatalogoSchema, body);
    return this.catalogo.alterarEstado({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, 'CONTA', codigo, version, true, obterCorrelationId(req));
  }

  @Put('contas/:codigo/reativacao')
  @ExigePermissao('contabil.estrutura_contabil.reativar')
  async reativarConta(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Param('codigo') codigo: string, @Body() body: unknown) {
    const { version } = analisar(versaoCatalogoSchema, body);
    return this.catalogo.alterarEstado({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, 'CONTA', codigo, version, false, obterCorrelationId(req));
  }

  @Put('centros-de-custo/:codigo/arquivamento')
  @ExigePermissao('contabil.estrutura_contabil.arquivar')
  async arquivarCentro(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Param('codigo') codigo: string, @Body() body: unknown) {
    const { version } = analisar(versaoCatalogoSchema, body);
    return this.catalogo.alterarEstado({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, 'CENTRO_CUSTO', codigo, version, true, obterCorrelationId(req));
  }

  @Put('centros-de-custo/:codigo/reativacao')
  @ExigePermissao('contabil.estrutura_contabil.reativar')
  async reativarCentro(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Param('codigo') codigo: string, @Body() body: unknown) {
    const { version } = analisar(versaoCatalogoSchema, body);
    return this.catalogo.alterarEstado({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, 'CENTRO_CUSTO', codigo, version, false, obterCorrelationId(req));
  }

  @Post('contas')
  @ExigePermissao('contabil.estrutura_contabil.manter_plano_contas')
  async criarConta(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Body() body: unknown) {
    const dados = analisar(camposDaContaSchema, body);
    return this.catalogo.salvarConta({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, dados.code, dados, obterCorrelationId(req));
  }

  @Post('centros-de-custo')
  @ExigePermissao('contabil.estrutura_contabil.manter_centros_custo')
  async criarCentro(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Body() body: unknown) {
    const dados = analisar(camposDoCentroSchema, body);
    return this.catalogo.salvarCentro({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, dados.code, dados, obterCorrelationId(req));
  }

  @Put('centros-de-custo/:codigo')
  @ExigePermissao('contabil.estrutura_contabil.manter_centros_custo')
  async centro(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Param('codigo') codigo: string, @Body() body: unknown) {
    const dados = analisar(camposDoCentroSchema, body);
    return this.catalogo.salvarCentro({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, codigo, dados, obterCorrelationId(req));
  }

  @Get('historico')
  @ExigePermissao('contabil.estrutura_contabil.consultar')
  historico(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Query() query: unknown) {
    const { catalogo, codigo } = analisar(historicoDoCatalogoSchema, query);
    return this.catalogo.historico({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId, catalogo, codigo);
  }
}
