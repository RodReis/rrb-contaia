/**
 * Área operacional. Existe nesta fatia para provar o bloqueio: tenant em
 * `CADASTRO_INCOMPLETO` não passa do `GuardDeCadastro` (SPEC-001 §3.1).
 *
 * A visão inicial ativa é vazia — o CTA de cadastrar empresa chega na fatia
 * própria, junto com o fluxo que ele dispara.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';

import { AcaoLivre, GuardDeAcao } from '../auth/acao.guard';
import { GuardDeCadastro, GuardDeSessao } from '../auth/sessao.guard';

export type VisaoInicial = Readonly<{
  empresas: readonly never[];
  mensagemVazio: string;
}>;

@Controller('painel')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
// A visão é sempre vazia nesta fatia: não expõe dado de empresa a ninguém.
@AcaoLivre()
export class PainelController {
  @Get('empresas')
  listarEmpresas(): VisaoInicial {
    return { empresas: [], mensagemVazio: 'Nenhuma empresa cadastrada' };
  }
}
