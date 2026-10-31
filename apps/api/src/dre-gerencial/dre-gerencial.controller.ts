import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { CODIGOS_DE_ERRO, ErroDeDominio } from "@contaia/domain";
import { ExigePermissao, GuardDeAcao } from "../auth/acao.guard";
import { autorDa, tenantDa } from "../auth/contexto-da-sessao";
import { GuardDeEscopoDeEmpresa } from "../auth/escopo";
import {
  GuardDeCadastro,
  GuardDeSessao,
  type RequisicaoAutenticada,
} from "../auth/sessao.guard";
import { obterCorrelationId } from "../comum/problema";
import { analisar } from "../escritorio/escritorio.dto";
import {
  consultaDreSchema,
  criarRascunhoSchema,
  exportarDreSchema,
  publicarEstruturaSchema,
  salvarEstruturaSchema,
  statementVersionIdSchema,
} from "./dre-gerencial.dto";
import { DreGerencialService } from "./dre-gerencial.service";

@Controller("empresas/:empresaId/dre-gerencial")
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class DreGerencialController {
  constructor(private readonly service: DreGerencialService) {}
  private actor(req: RequisicaoAutenticada) {
    return { tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId };
  }
  @Get()
  @ExigePermissao("contabil.dre_gerencial.consultar")
  consultar(
    @Req() req: RequisicaoAutenticada,
    @Param("empresaId") companyId: string,
    @Query() query: unknown,
  ) {
    return this.service.consultar(
      this.actor(req),
      companyId,
      analisar(consultaDreSchema, query),
      obterCorrelationId(req),
    );
  }
  @Get("versoes")
  @ExigePermissao("contabil.dre_gerencial.editar")
  listar(
    @Req() req: RequisicaoAutenticada,
    @Param("empresaId") companyId: string,
  ) {
    return this.service.listarVersoes(this.actor(req), companyId);
  }
  @Get("versoes/:versionId")
  @ExigePermissao("contabil.dre_gerencial.editar")
  obter(
    @Req() req: RequisicaoAutenticada,
    @Param("empresaId") companyId: string,
    @Param() params: unknown,
  ) {
    return this.service.obterVersao(
      this.actor(req),
      companyId,
      analisar(statementVersionIdSchema, params).versionId,
    );
  }
  @Post("versoes")
  @ExigePermissao("contabil.dre_gerencial.editar")
  criar(
    @Req() req: RequisicaoAutenticada,
    @Param("empresaId") companyId: string,
    @Body() body: unknown,
  ) {
    return this.service.criarRascunho(
      this.actor(req),
      companyId,
      analisar(criarRascunhoSchema, body).fromVersion,
      obterCorrelationId(req),
    );
  }
  @Post("versoes/:versionId/linhas")
  @ExigePermissao("contabil.dre_gerencial.editar")
  salvar(
    @Req() req: RequisicaoAutenticada,
    @Param("empresaId") companyId: string,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    const { versionId } = analisar(statementVersionIdSchema, params);
    const value = analisar(salvarEstruturaSchema, body);
    return this.service.salvarEstrutura(
      this.actor(req),
      companyId,
      versionId,
      value.expectedRevision,
      value.lines,
      obterCorrelationId(req),
    );
  }
  @Post("versoes/:versionId/publicar")
  @ExigePermissao("contabil.dre_gerencial.publicar")
  publicar(
    @Req() req: RequisicaoAutenticada,
    @Param("empresaId") companyId: string,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    const { versionId } = analisar(statementVersionIdSchema, params);
    const value = analisar(publicarEstruturaSchema, body);
    return this.service.publicar(
      this.actor(req),
      companyId,
      versionId,
      value.expectedRevision,
      value.effectiveFrom,
      obterCorrelationId(req),
    );
  }
  @Get("exportacoes/:format")
  @ExigePermissao("contabil.dre_gerencial.baixar")
  async exportar(
    @Req() req: RequisicaoAutenticada,
    @Param("empresaId") companyId: string,
    @Param("format") format: string,
    @Headers("idempotency-key") key: string | undefined,
    @Query() query: unknown,
    @Res() res: Response,
  ) {
    if (format !== "PDF" && format !== "CSV")
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
        "Formato de exportação inválido.",
      );
    const file = await this.service.exportar(
      this.actor(req),
      companyId,
      analisar(exportarDreSchema, query),
      format,
      key,
      obterCorrelationId(req),
    );
    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.fileName}"`,
    );
    res.send(file.body);
  }
}
