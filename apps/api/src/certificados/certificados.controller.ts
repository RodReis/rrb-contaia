/**
 * Endpoints do cofre de certificados A1 (SPEC-011). Autorização por chave do catálogo
 * (`GuardDeAcao`, falha fechado) + alçada por empresa (`GuardDeEscopoDeEmpresa`); a regra
 * "papel padrão admin/contador" da SPEC §3.2 é conferida no caso de uso, junto da chave.
 *
 * Nenhum endpoint recebe ou devolve arquivo, senha, chave ou token, e NÃO existe download: o
 * PKCS#12 vai do navegador direto ao cofre, com o ticket que `ingestoes` emite.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import {
  desativacaoSchema,
  filtroDoCofreSchema,
  filtroDoHistoricoDeCertificadosSchema,
  ingestaoSchema,
  pedidoDeAtivacaoSchema,
  pedidoDeRecusaSchema,
  trocaDeResponsavelSchema,
} from './certificados.dto';
import { CertificadosService } from './certificados.service';
import { GuardDeServicoInterno } from './servico-interno.guard';
import type { SessaoDoCofre } from './visoes';

/** Tenant, usuário, papéis e permissão efetiva — sempre da sessão validada, nunca do corpo. */
const sessaoDoCofre = (requisicao: RequisicaoAutenticada): SessaoDoCofre => ({
  tenantId: tenantDa(requisicao),
  usuarioId: autorDa(requisicao).usuarioId,
  papeis: requisicao.sessao?.papeis ?? [],
  permissoes: requisicao.sessao?.permissoes ?? [],
});

@Controller('certificados')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('certificados.cofre.consultar')
export class CertificadosController {
  constructor(private readonly certificados: CertificadosService) {}

  @Get()
  listar(@Req() requisicao: RequisicaoAutenticada, @Query() consulta: unknown) {
    return this.certificados.consultar(
      sessaoDoCofre(requisicao),
      analisar(filtroDoCofreSchema, consulta),
      obterCorrelationId(requisicao),
    );
  }
}

// Registrado antes de `EmpresaController`, como os demais controllers aninhados em `empresas/:empresaId`.
@Controller('empresas/:empresaId/certificados')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
@ExigePermissao('certificados.cofre.consultar')
export class CertificadosDaEmpresaController {
  constructor(private readonly certificados: CertificadosService) {}

  @Get()
  detalhe(@Req() requisicao: RequisicaoAutenticada, @Param('empresaId') empresaId: string) {
    return this.certificados.consultarEmpresa(
      sessaoDoCofre(requisicao),
      empresaId,
      obterCorrelationId(requisicao),
    );
  }

  @Get('responsaveis')
  responsaveis(@Req() requisicao: RequisicaoAutenticada, @Param('empresaId') empresaId: string) {
    return this.certificados.listarResponsaveis(
      sessaoDoCofre(requisicao),
      empresaId,
      obterCorrelationId(requisicao),
    );
  }

  /**
   * Ticket para enviar o PKCS#12 direto ao cofre. Cadastro exige `criar`, substituição exige
   * `substituir`: a chave depende de a empresa já ter vigente, então o caso de uso a confere.
   */
  @Post('ingestoes')
  ingestoes(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ) {
    return this.certificados.emitirTicket(
      sessaoDoCofre(requisicao),
      empresaId,
      analisar(ingestaoSchema, corpo).responsavelId,
      obterCorrelationId(requisicao),
    );
  }

  @Put('vigente/responsavel')
  @ExigePermissao('certificados.cofre.editar')
  trocarResponsavel(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ) {
    return this.certificados.trocarResponsavel(
      sessaoDoCofre(requisicao),
      empresaId,
      analisar(trocaDeResponsavelSchema, corpo).responsavelId,
      obterCorrelationId(requisicao),
    );
  }

  @Post('vigente/desativacao')
  @HttpCode(200)
  @ExigePermissao('certificados.cofre.desativar')
  desativar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ) {
    return this.certificados.desativar(
      sessaoDoCofre(requisicao),
      empresaId,
      analisar(desativacaoSchema, corpo).motivo,
      obterCorrelationId(requisicao),
    );
  }
}

/** Aba Certificados do Histórico de Informações: exige ler o Histórico e o histórico do cofre. */
@Controller('historico/certificados')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('historico.global.consultar', 'certificados.historico.consultar')
export class HistoricoDeCertificadosController {
  constructor(private readonly certificados: CertificadosService) {}

  @Get()
  listar(@Req() requisicao: RequisicaoAutenticada, @Query() consulta: unknown) {
    return this.certificados.consultarHistorico(
      sessaoDoCofre(requisicao),
      analisar(filtroDoHistoricoDeCertificadosSchema, consulta),
      obterCorrelationId(requisicao),
    );
  }
}

/**
 * Rotas internas, chamadas só pelo processo do cofre (Bearer de serviço, sem sessão). O que o
 * ticket assinado autoriza é reavaliado no caso de uso, como o usuário do ticket.
 */
@Controller('interno/cofre')
@UseGuards(GuardDeServicoInterno)
export class CofreInternoController {
  constructor(private readonly certificados: CertificadosService) {}

  @Post('ativacao')
  @HttpCode(200)
  ativacao(@Req() requisicao: RequisicaoAutenticada, @Body() corpo: unknown) {
    return this.certificados.ativar(
      analisar(pedidoDeAtivacaoSchema, corpo),
      obterCorrelationId(requisicao),
    );
  }

  @Post('recusa')
  @HttpCode(200)
  async recusa(@Req() requisicao: RequisicaoAutenticada, @Body() corpo: unknown) {
    await this.certificados.recusar(
      analisar(pedidoDeRecusaSchema, corpo),
      obterCorrelationId(requisicao),
    );

    return { registrado: true };
  }
}
