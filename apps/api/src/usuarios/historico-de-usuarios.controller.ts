/**
 * Aba "Usuários e acessos" do Histórico de Informações (SPEC-007 §3.5): somente
 * leitura, limitada ao escritório da sessão. Exige as duas capacidades — ler o
 * Histórico e ler usuários —, então `contador` e `auxiliar` não a enxergam.
 */
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import { filtroDeEventosSchema } from './usuarios.dto';
import { type PaginaDeEventosVisao, UsuariosService } from './usuarios.service';

@Controller('historico/usuarios')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('historico.global.consultar', 'usuarios.usuarios_e_papeis.consultar')
export class HistoricoDeUsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  async listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ): Promise<PaginaDeEventosVisao> {
    return this.usuarios.consultarHistorico(
      tenantDa(requisicao),
      analisar(filtroDeEventosSchema, consulta),
    );
  }
}
