/**
 * Carteiras (SPEC-009). O controller valida a entrada e delega; a decisão de
 * quem pode o quê é do servidor — esconder botão não é autorização.
 *
 * Somente `admin_escritorio` administra carteiras (`usuarios.usuarios_e_papeis.administrar`).
 * A única rota aberta a qualquer usuário autenticado é `minha`, que devolve só
 * a carteira da própria sessão.
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import type {
  ColaboradorDaEmpresa,
  ColaboradorNaCentral,
  EmpresaParaAtribuicao,
  PaginaDeColaboradores,
  PaginaDeEmpresasParaAtribuicao,
  PaginaDeEventosDeCarteira,
} from '@contaia/db';

import { AcaoLivre, ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import { identificador } from '../usuarios/usuarios.dto';
import {
  alteracaoSchema,
  filtroDeColaboradoresSchema,
  filtroDeEmpresasSchema,
  filtroDeEventosDeCarteiraSchema,
} from './carteira.dto';
import { CarteiraService, type ResultadoDaAlteracao } from './carteira.service';

const idSchema = z.object({ id: identificador });
const idDe = (valor: string): string => analisar(idSchema, { id: valor }).id;

@Controller('carteiras')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('usuarios.usuarios_e_papeis.administrar')
export class CarteirasController {
  constructor(private readonly carteira: CarteiraService) {}

  /** Carteira da própria sessão: qualquer usuário ativo vê só os próprios vínculos. */
  @Get('minha')
  @AcaoLivre()
  async minha(
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<Readonly<{ empresas: readonly EmpresaParaAtribuicao[] }>> {
    const empresas = await this.carteira.minhaCarteira(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
    );

    return { empresas };
  }

  @Get('colaboradores')
  async colaboradores(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ): Promise<PaginaDeColaboradores> {
    return this.carteira.listarColaboradores(
      tenantDa(requisicao),
      analisar(filtroDeColaboradoresSchema, consulta),
    );
  }

  @Get('colaboradores/:usuarioId')
  async colaborador(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
  ): Promise<ColaboradorNaCentral> {
    return this.carteira.obterColaborador(tenantDa(requisicao), idDe(usuarioId));
  }

  /** Gestão individual: todas as empresas ativas do tenant, com a marca de atribuída. */
  @Get('colaboradores/:usuarioId/empresas')
  async empresas(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
    @Query() consulta: unknown,
  ): Promise<PaginaDeEmpresasParaAtribuicao> {
    return this.carteira.empresasParaAtribuicao(
      tenantDa(requisicao),
      idDe(usuarioId),
      analisar(filtroDeEmpresasSchema, consulta),
    );
  }

  /** Aba "Colaboradores" da empresa: a Central administrativa vê qualquer empresa do tenant. */
  @Get('empresas/:empresaId/colaboradores')
  async colaboradoresDaEmpresa(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
  ): Promise<Readonly<{ colaboradores: readonly ColaboradorDaEmpresa[] }>> {
    const colaboradores = await this.carteira.colaboradoresDaEmpresa(
      tenantDa(requisicao),
      idDe(empresaId),
    );

    return { colaboradores };
  }

  @Post('alteracoes')
  async alterar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() corpo: unknown,
  ): Promise<ResultadoDaAlteracao> {
    return this.carteira.alterar(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
      analisar(alteracaoSchema, corpo),
    );
  }
}

/** Aba "Carteiras" do Histórico de Informações: somente leitura, limitada ao escritório. */
@Controller('historico/carteiras')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('historico.global.consultar', 'usuarios.usuarios_e_papeis.consultar')
export class HistoricoDeCarteirasController {
  constructor(private readonly carteira: CarteiraService) {}

  @Get()
  async listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ): Promise<PaginaDeEventosDeCarteira> {
    return this.carteira.eventos(
      tenantDa(requisicao),
      analisar(filtroDeEventosDeCarteiraSchema, consulta),
    );
  }
}
