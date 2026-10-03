/**
 * Endpoints de usuários e papéis padrão (SPEC-007). O controller valida a
 * entrada e delega: nenhuma regra de negócio aqui (ARCHITECTURE.md §4).
 *
 * Tenant e autor saem sempre da sessão, nunca do corpo. Quem só consulta
 * (`auditor_readonly`) recebe a visão sem o estado técnico do convite.
 */
import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';

import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  escopoDeEmpresas,
  podeExecutar,
} from '@contaia/domain';
import type { PapelPadrao } from '@contaia/domain';

import { AcaoLivre, ExigeAcao, GuardDeAcao } from '../auth/acao.guard';
import {
  GuardDeCadastro,
  GuardDeSessao,
  PermiteCadastroIncompleto,
  type RequisicaoAutenticada,
} from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import { catalogoDePapeis, permissoesDe } from './permissoes';
import {
  IDENTIFICADOR,
  conviteSchema,
  edicaoSchema,
  filtroDeUsuariosSchema,
  novoConviteSchema,
} from './usuarios.dto';
import {
  type Autor,
  type PaginaDeUsuariosVisao,
  type VisaoDeUsuario,
  UsuariosService,
} from './usuarios.service';

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

/** Id malformado responde como inexistente: o banco daria erro de cast (500) e vazaria o formato. */
const usuarioDe = (parametro: string): string => {
  if (!IDENTIFICADOR.test(parametro)) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO, 'Usuário não encontrado.');
  }

  return parametro;
};

const papeisDa = (requisicao: RequisicaoAutenticada): readonly PapelPadrao[] =>
  requisicao.sessao?.papeis ?? [];

/** Sem `administrar`, o estado técnico do convite (prazo, falha de envio) não é exposto. */
const paraLeitor = (requisicao: RequisicaoAutenticada, usuario: VisaoDeUsuario): VisaoDeUsuario =>
  podeExecutar(papeisDa(requisicao), 'USUARIOS', 'administrar')
    ? usuario
    : { ...usuario, conviteExpiraEm: null, envioFalhou: false };

@Controller('usuarios')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
// Padrão da classe é a ação mais restrita; a leitura a relaxa explicitamente.
@ExigeAcao('USUARIOS', 'administrar')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  /** Papéis, permissões e escopo da própria sessão: a interface decide o que mostrar a partir daqui. */
  @Get('eu')
  @AcaoLivre()
  @PermiteCadastroIncompleto()
  eu(@Req() requisicao: RequisicaoAutenticada) {
    const papeis = papeisDa(requisicao);

    return {
      papeis,
      permissoes: permissoesDe(papeis),
      escopoDeEmpresas: escopoDeEmpresas(papeis),
    };
  }

  @Get('papeis')
  @ExigeAcao('USUARIOS', 'consultar')
  papeis() {
    return catalogoDePapeis();
  }

  @Get()
  @ExigeAcao('USUARIOS', 'consultar')
  async listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ): Promise<PaginaDeUsuariosVisao> {
    const pagina = await this.usuarios.listar(
      tenantDa(requisicao),
      analisar(filtroDeUsuariosSchema, consulta),
    );

    return {
      total: pagina.total,
      usuarios: pagina.usuarios.map((usuario) => paraLeitor(requisicao, usuario)),
    };
  }

  @Get(':usuarioId')
  @ExigeAcao('USUARIOS', 'consultar')
  async obter(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
  ): Promise<VisaoDeUsuario> {
    return paraLeitor(
      requisicao,
      await this.usuarios.obter(tenantDa(requisicao), usuarioDe(usuarioId)),
    );
  }

  @Post()
  async convidar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() corpo: unknown,
  ): Promise<VisaoDeUsuario> {
    return this.usuarios.convidar(
      tenantDa(requisicao),
      autorDa(requisicao),
      analisar(conviteSchema, corpo),
    );
  }

  @Put(':usuarioId')
  async editar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDeUsuario> {
    return this.usuarios.editar(
      tenantDa(requisicao),
      autorDa(requisicao),
      usuarioDe(usuarioId),
      analisar(edicaoSchema, corpo),
    );
  }

  @Post(':usuarioId/reenviar-convite')
  async reenviarConvite(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
  ): Promise<VisaoDeUsuario> {
    return this.usuarios.reenviarConvite(
      tenantDa(requisicao),
      autorDa(requisicao),
      usuarioDe(usuarioId),
    );
  }

  @Post(':usuarioId/suspender')
  async suspender(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
  ): Promise<VisaoDeUsuario> {
    return this.usuarios.suspender(tenantDa(requisicao), autorDa(requisicao), usuarioDe(usuarioId));
  }

  @Post(':usuarioId/reativar')
  async reativar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
  ): Promise<VisaoDeUsuario> {
    return this.usuarios.reativar(tenantDa(requisicao), autorDa(requisicao), usuarioDe(usuarioId));
  }

  @Post(':usuarioId/arquivar')
  async arquivar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
  ): Promise<VisaoDeUsuario> {
    return this.usuarios.arquivar(tenantDa(requisicao), autorDa(requisicao), usuarioDe(usuarioId));
  }

  @Post(':usuarioId/novo-convite')
  async novoConvite(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('usuarioId') usuarioId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDeUsuario> {
    return this.usuarios.novoConvite(
      tenantDa(requisicao),
      autorDa(requisicao),
      usuarioDe(usuarioId),
      analisar(novoConviteSchema, corpo),
    );
  }
}
