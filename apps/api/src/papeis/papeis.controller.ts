/**
 * Endpoints de papéis personalizados e catálogo de permissões (SPEC-008). O
 * controller valida a entrada e delega: nenhuma regra de negócio aqui
 * (ARCHITECTURE.md §4).
 *
 * Tenant e autor saem sempre da sessão, nunca do corpo. Só `admin_escritorio`
 * administra papéis; quem consulta usuários e papéis (auditor) apenas lê.
 */
import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import { IDENTIFICADOR } from '../usuarios/usuarios.dto';
import { type CatalogoDePermissoes, catalogoDePermissoes } from './catalogo-de-permissoes';
import {
  arquivamentoDePapelSchema,
  criacaoDePapelSchema,
  edicaoDePapelSchema,
  filtroDePapeisSchema,
  reativacaoDePapelSchema,
} from './papeis.dto';
import { type DetalheDePapel, type PaginaDePapeisVisao, PapeisService } from './papeis.service';

/** Id malformado responde como inexistente: o banco daria erro de cast (500) e vazaria o formato. */
const papelDe = (parametro: string): string => {
  if (!IDENTIFICADOR.test(parametro)) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO, 'Papel não encontrado.');
  }

  return parametro;
};

@Controller('papeis')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
// Padrão da classe é a ação mais restrita; a leitura a relaxa explicitamente.
@ExigePermissao('usuarios.usuarios_e_papeis.administrar')
export class PapeisController {
  constructor(private readonly papeis: PapeisService) {}

  @Get('catalogo')
  @ExigePermissao('usuarios.usuarios_e_papeis.consultar')
  catalogo(): CatalogoDePermissoes {
    return catalogoDePermissoes();
  }

  @Get()
  @ExigePermissao('usuarios.usuarios_e_papeis.consultar')
  async listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ): Promise<PaginaDePapeisVisao> {
    return this.papeis.listar(
      tenantDa(requisicao),
      autorDa(requisicao),
      analisar(filtroDePapeisSchema, consulta),
    );
  }

  @Get(':papelId')
  @ExigePermissao('usuarios.usuarios_e_papeis.consultar')
  async obter(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('papelId') papelId: string,
  ): Promise<DetalheDePapel> {
    return this.papeis.obter(tenantDa(requisicao), autorDa(requisicao), papelDe(papelId));
  }

  @Post()
  async criar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() corpo: unknown,
  ): Promise<DetalheDePapel> {
    return this.papeis.criar(
      tenantDa(requisicao),
      autorDa(requisicao),
      analisar(criacaoDePapelSchema, corpo),
    );
  }

  @Put(':papelId')
  async editar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('papelId') papelId: string,
    @Body() corpo: unknown,
  ): Promise<DetalheDePapel> {
    return this.papeis.editar(
      tenantDa(requisicao),
      autorDa(requisicao),
      papelDe(papelId),
      analisar(edicaoDePapelSchema, corpo),
    );
  }

  @Post(':papelId/arquivar')
  async arquivar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('papelId') papelId: string,
    @Body() corpo: unknown,
  ): Promise<DetalheDePapel> {
    return this.papeis.arquivar(
      tenantDa(requisicao),
      autorDa(requisicao),
      papelDe(papelId),
      analisar(arquivamentoDePapelSchema, corpo),
    );
  }

  @Post(':papelId/reativar')
  async reativar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('papelId') papelId: string,
    @Body() corpo: unknown,
  ): Promise<DetalheDePapel> {
    return this.papeis.reativar(
      tenantDa(requisicao),
      autorDa(requisicao),
      papelDe(papelId),
      analisar(reativacaoDePapelSchema, corpo),
    );
  }
}
