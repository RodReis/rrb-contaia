/**
 * Endpoints da importação do plano de contas (SPEC-013 §5.1, §5.2).
 *
 * Dois controllers: um global (modelo, wizard) e outro aninhado em `empresas/:empresaId`
 * (aba Plano de contas, reimportação, histórico).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import type { SessaoDoCofre } from '../certificados/visoes';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import {
  cancelarPreviaSchema,
  confirmarImportacaoSchema,
  criarTentativaSchema,
  listarHistoricoSchema,
  listarRejeicoesSchema,
  mapeamentoSchema,
  salvarMapeamentoSchema,
} from './plano-contas.dto';
import { PlanoContasService } from './plano-contas.service';

/** Tenant, usuário, papéis e permissão efetiva — sempre da sessão validada, nunca do corpo. */
const sessaoDoPlanoContas = (requisicao: RequisicaoAutenticada): SessaoDoCofre => ({
  tenantId: tenantDa(requisicao),
  usuarioId: autorDa(requisicao).usuarioId,
  empresaId: (requisicao as RequisicaoAutenticada & { empresaId?: string }).empresaId,
  papeis: requisicao.sessao?.papeis ?? [],
  permissoes: requisicao.sessao?.permissoes ?? [],
});

@Controller('plano-contas')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('empresas.plano_contas.importar')
export class PlanoContasController {
  constructor(private readonly planoContas: PlanoContasService) {}

  /** Modelo CSV do ContaIA para download (SPEC-013 §3.2). */
  @Get('modelo')
  async modelo(@Req() requisicao: RequisicaoAutenticada) {
    const csv = [
      'codigo,nome,tipo,natureza,conta_pai',
      '1,Ativo,sintetica,devedora,',
      '1.1,Caixa e equivalentes,analitica,devedora,1',
      '1.1.01,Caixa,analitica,devedora,1.1',
      '1.1.02,Bancos conta movimento,analitica,devedora,1.1',
      '1.2,Contas a receber,analitica,devedora,1',
      '2,Passivo,sintetica,credora,',
      '2.1,Fornecedores,analitica,credora,2',
      '2.2,Empréstimos e financiamentos,analitica,credora,2',
      '3,Patrimônio líquido,sintetica,credora,',
      '3.1,Capital social,analitica,credora,3',
      '3.2,Reservas de lucro,analitica,credora,3',
      '4,Receitas,sintetica,credora,',
      '4.1,Receita de vendas,analitica,credora,4',
      '5,Despesas,sintetica,devedora,',
      '5.1,Despesas com pessoal,analitica,devedora,5',
    ].join('\n');

    return { versaoContrato: 'v1', csv };
  }

  /** Inicia tentativa de importação (wizard onboarding ou aba empresa). */
  @Post('tentativas')
  @HttpCode(201)
  async criarTentativa(@Req() requisicao: RequisicaoAutenticada, @Body() corpo: unknown) {
    const sessao = sessaoDoPlanoContas(requisicao);
    const validado = analisar(criarTentativaSchema, corpo);
    const correlationId = obterCorrelationId(requisicao);

    return this.planoContas.criarTentativa(sessao, validado, correlationId);
  }
}

// Registrado ANTES de EmpresaController (rotas aninhadas em empresas/:empresaId).
@Controller('empresas/:empresaId/plano-contas')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
@ExigePermissao('empresas.plano_contas.importar')
export class PlanoContasDaEmpresaController {
  constructor(private readonly planoContas: PlanoContasService) {}

  /** Salva mapeamento confirmado e enfileira validação assíncrona. */
  @Post('tentativas/:tentativaId/mapeamento')
  @HttpCode(200)
  async salvarMapeamento(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('tentativaId') tentativaId: string,
    @Body() corpo: unknown,
  ) {
    const sessao = sessaoDoPlanoContas(requisicao);
    const validado = analisar(salvarMapeamentoSchema, corpo);
    const correlationId = obterCorrelationId(requisicao);

    return this.planoContas.salvarMapeamento(sessao, tentativaId, validado, correlationId);
  }

  /** Consulta prévia da importação (estado + totais + amostra de rejeições). */
  @Get('tentativas/:tentativaId/previa')
  async consultarPrevia(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('tentativaId') tentativaId: string,
  ) {
    const sessao = sessaoDoPlanoContas(requisicao);
    const correlationId = obterCorrelationId(requisicao);

    return this.planoContas.consultarPrevia(sessao, tentativaId, correlationId);
  }

  /** Confirma importação: aplica linhas válidas no plano (transacional, versão otimista). */
  @Post('tentativas/:tentativaId/confirmar')
  @HttpCode(200)
  @ExigePermissao('empresas.plano_contas.confirmar')
  async confirmarImportacao(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('tentativaId') tentativaId: string,
    @Body() corpo: unknown,
  ) {
    const sessao = sessaoDoPlanoContas(requisicao);
    const validado = analisar(confirmarImportacaoSchema, corpo);
    const correlationId = obterCorrelationId(requisicao);

    return this.planoContas.confirmarImportacao(sessao, tentativaId, validado, correlationId);
  }

  /** Cancela prévia sem alterar o plano. */
  @Post('tentativas/:tentativaId/cancelar')
  @HttpCode(200)
  async cancelarPrevia(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('tentativaId') tentativaId: string,
    @Body() corpo: unknown,
  ) {
    const sessao = sessaoDoPlanoContas(requisicao);
    const validado = analisar(cancelarPreviaSchema, corpo);
    const correlationId = obterCorrelationId(requisicao);

    await this.planoContas.cancelarPrevia(sessao, tentativaId, validado, correlationId);

    return { cancelada: true };
  }

  /** Histórico de importações da empresa (15 por página). */
  @Get('historico')
  async listarHistorico(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ) {
    const sessao = sessaoDoPlanoContas(requisicao);
    const validado = analisar(listarHistoricoSchema, consulta);
    const correlationId = obterCorrelationId(requisicao);

    return this.planoContas.listarHistorico(sessao, validado, correlationId);
  }

  /** Plano de contas vigente da empresa. */
  @Get('plano')
  async listarPlanoVigente(@Req() requisicao: RequisicaoAutenticada) {
    const sessao = sessaoDoPlanoContas(requisicao);
    const correlationId = obterCorrelationId(requisicao);

    return this.planoContas.listarPlanoVigente(sessao, correlationId);
  }

  /** Rejeições paginadas de uma tentativa (tabela da prévia). */
  @Get('tentativas/:tentativaId/rejeicoes')
  async listarRejeicoes(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('tentativaId') tentativaId: string,
    @Query() consulta: unknown,
  ) {
    const sessao = sessaoDoPlanoContas(requisicao);
    const validado = analisar(listarRejeicoesSchema, consulta);
    const correlationId = obterCorrelationId(requisicao);

    return this.planoContas.listarRejeicoes(sessao, tentativaId, validado, correlationId);
  }
}