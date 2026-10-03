/**
 * Endpoints da empresa cliente. O controller valida a entrada e delega:
 * nenhuma regra de negócio aqui (ARCHITECTURE.md §4).
 *
 * Sem `@PermiteCadastroIncompleto`: o `GuardDeCadastro` exige escritório já
 * ativo, porque cadastrar cliente é área operacional e pressupõe a F1 concluída
 * (SPEC-002 §2).
 */
import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import type { EmpresaNaLista } from '@contaia/db';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { escopoDaSessao, exigirAlcada, GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import { PendenciasService } from '../pendencias/pendencias.service';
import {
  ativacaoSchema,
  criacaoSchema,
  dadosFiscaisSchema,
  enderecoDaEmpresaSchema,
  filtroDaListaSchema,
  identificacaoDaEmpresaSchema,
} from './empresa.dto';
import {
  EmpresaService,
  type ResultadoDaConsultaDeCnpj,
  type VisaoDaEmpresa,
} from './empresa.service';

export type EmpresaNaListaComPendencias = EmpresaNaLista &
  Readonly<{ pendenciasAbertas: number }>;

const tenantDa = (requisicao: RequisicaoAutenticada): string => {
  const tenantId = requisicao.sessao?.tenantId;

  if (tenantId === undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.TENANT_DIVERGENTE,
      'Sessão sem escritório associado.',
    );
  }

  return tenantId;
};

@Controller('empresas')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
// Padrão da classe é a ação mais restrita; leitura e criação a relaxam explicitamente.
@ExigePermissao('empresas.cadastro.editar')
export class EmpresaController {
  constructor(
    private readonly empresaService: EmpresaService,
    private readonly pendencias: PendenciasService,
  ) {}

  @Get()
  @ExigePermissao('empresas.cadastro.consultar')
  async listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ): Promise<
    Readonly<{
      empresas: readonly EmpresaNaListaComPendencias[];
      total: number;
      /** Presente só quando a lista é vazia por falta de carteira, não por carteira vazia. */
      escopoDeEmpresas?: 'NENHUMA';
    }>
  > {
    // Sem carteira não há empresa visível: lista vazia, nunca a base inteira.
    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      return { empresas: [], total: 0, escopoDeEmpresas: 'NENHUMA' };
    }

    const tenantId = tenantDa(requisicao);
    const resultado = await this.empresaService.listar(
      tenantId,
      analisar(filtroDaListaSchema, consulta),
    );
    const contagem = await this.pendencias.contarPorEmpresas(
      tenantId,
      resultado.empresas.map((empresa) => empresa.id),
    );

    return {
      ...resultado,
      empresas: resultado.empresas.map((empresa) => ({
        ...empresa,
        pendenciasAbertas: contagem.get(empresa.id) ?? 0,
      })),
    };
  }

  /**
   * Consulta por CNPJ antes de criar. Fica antes de `:empresaId` de propósito:
   * uma rota dinâmica declarada primeiro capturaria `consulta-cnpj` como id.
   */
  @Get('consulta-cnpj/:cnpj')
  @ExigePermissao('empresas.cadastro.criar')
  async consultarCnpj(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('cnpj') cnpj: string,
  ): Promise<ResultadoDaConsultaDeCnpj> {
    // A consulta revela se a empresa já existe no escritório: exige alçada.
    exigirAlcada(requisicao);

    return this.empresaService.consultarCnpj(tenantDa(requisicao), cnpj);
  }

  @Post()
  @ExigePermissao('empresas.cadastro.criar')
  async criar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    // Sem carteira a empresa criada ficaria órfã: toda etapa seguinte é por empresaId.
    exigirAlcada(requisicao);

    const { cnpj } = analisar(criacaoSchema, corpo);

    return this.empresaService.criar(tenantDa(requisicao), cnpj);
  }

  @Get(':empresaId')
  @ExigePermissao('empresas.cadastro.consultar')
  async obter(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
  ): Promise<VisaoDaEmpresa> {
    return this.empresaService.obter(tenantDa(requisicao), empresaId);
  }

  @Put(':empresaId/identificacao')
  async salvarIdentificacao(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    return this.empresaService.salvarIdentificacao(
      tenantDa(requisicao),
      empresaId,
      analisar(identificacaoDaEmpresaSchema, corpo),
    );
  }

  @Put(':empresaId/fiscal')
  async salvarFiscal(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    return this.empresaService.salvarFiscal(
      tenantDa(requisicao),
      empresaId,
      analisar(dadosFiscaisSchema, corpo),
    );
  }

  @Put(':empresaId/endereco')
  async salvarEndereco(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    return this.empresaService.salvarEndereco(
      tenantDa(requisicao),
      empresaId,
      analisar(enderecoDaEmpresaSchema, corpo),
    );
  }

  @Post(':empresaId/ativar')
  @ExigePermissao('empresas.cadastro.criar')
  async ativar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    const { situacaoExternaConfirmada } = analisar(ativacaoSchema, corpo);

    return this.empresaService.ativar(
      tenantDa(requisicao),
      empresaId,
      situacaoExternaConfirmada,
    );
  }
}
