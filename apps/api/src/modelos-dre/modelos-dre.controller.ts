import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ExigePermissao, GuardDeAcao } from "../auth/acao.guard";
import { autorDa, tenantDa } from "../auth/contexto-da-sessao";
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from "../auth/sessao.guard";
import { obterCorrelationId } from "../comum/problema";
import { analisar } from "../escritorio/escritorio.dto";
import {
  aplicarModeloSchema, atualizarModeloSchema, criarModeloOrigemSchema, criarModeloSchema,
  publicarModeloSchema, salvarLinhasModeloSchema, templateIdParamsSchema, templateVersionParamsSchema,
} from "./modelos-dre.dto";
import { ModelosDreService } from "./modelos-dre.service";

@Controller("contabil/modelos-dre")
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
export class ModelosDreController {
  constructor(private readonly service: ModelosDreService) {}
  private actor(req: RequisicaoAutenticada) { return { tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }; }

  @Get()
  @ExigePermissao("contabil.dre_gerencial.consultar")
  listar(@Req() req: RequisicaoAutenticada, @Query("busca") busca = "", @Query("estado") estado?: string) {
    const status = estado === "ACTIVE" || estado === "ARCHIVED" ? estado : null;
    return this.service.listar(this.actor(req), busca, status);
  }

  @Post()
  @ExigePermissao("contabil.dre_gerencial.editar")
  criar(@Req() req: RequisicaoAutenticada, @Body() body: unknown) {
    return this.service.criar(this.actor(req), analisar(criarModeloSchema, body), obterCorrelationId(req));
  }

  @Post("origem-empresa")
  @ExigePermissao("contabil.dre_gerencial.editar")
  criarDaEmpresa(@Req() req: RequisicaoAutenticada, @Body() body: unknown) {
    return this.service.criarDaEmpresa(this.actor(req), analisar(criarModeloOrigemSchema, body), obterCorrelationId(req));
  }

  @Patch(":templateId")
  @ExigePermissao("contabil.dre_gerencial.editar")
  atualizar(@Req() req: RequisicaoAutenticada, @Param() params: unknown, @Body() body: unknown) {
    const { templateId } = analisar(templateIdParamsSchema, params);
    return this.service.atualizar(this.actor(req), templateId, analisar(atualizarModeloSchema, body), obterCorrelationId(req));
  }

  @Post(":templateId/arquivar")
  @ExigePermissao("contabil.dre_gerencial.editar")
  arquivar(@Req() req: RequisicaoAutenticada, @Param() params: unknown) {
    const { templateId } = analisar(templateIdParamsSchema, params);
    return this.service.alterarStatus(this.actor(req), templateId, "ARCHIVED", obterCorrelationId(req));
  }

  @Post(":templateId/reativar")
  @ExigePermissao("contabil.dre_gerencial.editar")
  reativar(@Req() req: RequisicaoAutenticada, @Param() params: unknown) {
    const { templateId } = analisar(templateIdParamsSchema, params);
    return this.service.alterarStatus(this.actor(req), templateId, "ACTIVE", obterCorrelationId(req));
  }

  @Get(":templateId/versoes")
  @ExigePermissao("contabil.dre_gerencial.consultar")
  versoes(@Req() req: RequisicaoAutenticada, @Param() params: unknown) {
    const { templateId } = analisar(templateIdParamsSchema, params);
    return this.service.listarVersoes(this.actor(req), templateId);
  }

  @Post(":templateId/versoes")
  @ExigePermissao("contabil.dre_gerencial.editar")
  novaVersao(@Req() req: RequisicaoAutenticada, @Param() params: unknown) {
    const { templateId } = analisar(templateIdParamsSchema, params);
    return this.service.criarVersao(this.actor(req), templateId, obterCorrelationId(req));
  }

  @Post(":templateId/versoes/:version/descartar")
  @ExigePermissao("contabil.dre_gerencial.editar")
  descartarRascunho(@Req() req: RequisicaoAutenticada, @Param() params: unknown) {
    const { templateId, version } = analisar(templateVersionParamsSchema, params);
    return this.service.descartarRascunho(this.actor(req), templateId, version, obterCorrelationId(req));
  }

  @Get(":templateId/versoes/:version")
  @ExigePermissao("contabil.dre_gerencial.consultar")
  obterVersao(@Req() req: RequisicaoAutenticada, @Param() params: unknown) {
    const { templateId, version } = analisar(templateVersionParamsSchema, params);
    return this.service.obterVersao(this.actor(req), templateId, version);
  }

  @Put(":templateId/versoes/:version/linhas")
  @ExigePermissao("contabil.dre_gerencial.editar")
  salvarLinhas(@Req() req: RequisicaoAutenticada, @Param() params: unknown, @Body() body: unknown) {
    const { templateId, version } = analisar(templateVersionParamsSchema, params);
    return this.service.salvarLinhas(this.actor(req), templateId, version, analisar(salvarLinhasModeloSchema, body), obterCorrelationId(req));
  }

  @Post(":templateId/versoes/:version/publicar")
  @ExigePermissao("contabil.dre_gerencial.publicar")
  publicar(@Req() req: RequisicaoAutenticada, @Param() params: unknown, @Body() body: unknown) {
    const { templateId, version } = analisar(templateVersionParamsSchema, params);
    const { expectedRevision } = analisar(publicarModeloSchema, body);
    return this.service.publicar(this.actor(req), templateId, version, expectedRevision, obterCorrelationId(req));
  }

  @Post(":templateId/aplicar")
  @ExigePermissao("contabil.dre_gerencial.editar")
  aplicar(@Req() req: RequisicaoAutenticada, @Param() params: unknown, @Body() body: unknown) {
    const { templateId } = analisar(templateIdParamsSchema, params);
    const parsed = analisar(aplicarModeloSchema, body);
    return this.service.aplicar(this.actor(req), templateId, parsed, obterCorrelationId(req));
  }

  @Get(":templateId/versoes/:version/proveniencia")
  @ExigePermissao("contabil.dre_gerencial.consultar")
  proveniencia(@Req() req: RequisicaoAutenticada, @Param() params: unknown) {
    const { templateId, version } = analisar(templateVersionParamsSchema, params);
    return this.service.proveniencia(this.actor(req), templateId, version);
  }
}
