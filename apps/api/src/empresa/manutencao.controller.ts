/**
 * Endpoints da manutenção da empresa já ativada e do Histórico de Informações
 * (SPEC-003). O controller valida a entrada e delega; nenhuma regra aqui.
 *
 * As rotas de manutenção são separadas das de cadastro (SPEC-002) de propósito:
 * o wizard preenche etapas de uma empresa em formação, a manutenção altera uma
 * empresa ativa e **sempre** deixa rastro no histórico. Misturar as duas numa
 * rota só faria o registro auditável depender de um `if`.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import type { EnderecoDaEmpresaPersistido, PaginaDoHistorico } from '@contaia/db';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { escopoDaSessao, GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import {
  aplicacaoDaFonteSchema,
  dadosFiscaisMantidosSchema,
  enderecoComFinalidadeSchema,
  enderecoMantidoSchema,
  filtroDoHistoricoSchema,
  identificacaoMantidaSchema,
  justificativaSchema,
  trocaDeFinalidadeFiscalSchema,
} from './empresa.dto';
import type { VisaoDaEmpresa } from './empresa.service';
import {
  type Autor,
  type ComparacaoComAFonte,
  ManutencaoDaEmpresaService,
} from './manutencao.service';

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

/** Autor do evento histórico: vem da sessão, nunca do corpo da requisição. */
const autorDa = (requisicao: RequisicaoAutenticada): Autor => {
  const usuarioId = requisicao.sessao?.usuarioId;

  if (usuarioId === undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.TENANT_DIVERGENTE,
      'Sessão sem usuário associado.',
    );
  }

  return { usuarioId };
};

@Controller('empresas/:empresaId/manutencao')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
// Padrão da classe é a ação mais restrita; leitura e arquivamento a ajustam explicitamente.
@ExigePermissao('empresas.cadastro.editar')
export class ManutencaoDaEmpresaController {
  constructor(private readonly manutencao: ManutencaoDaEmpresaService) {}

  @Put('identificacao')
  async salvarIdentificacao(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    return this.manutencao.salvarIdentificacao(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
      analisar(identificacaoMantidaSchema, corpo),
    );
  }

  @Put('fiscal')
  async salvarFiscal(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    const { vigencia, ...fiscais } = analisar(dadosFiscaisMantidosSchema, corpo);

    return this.manutencao.salvarFiscal(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
      fiscais,
      vigencia,
      // O "agora" entra por parâmetro: o domínio não lê relógio.
      new Date(),
    );
  }

  @Get('enderecos')
  @ExigePermissao('empresas.cadastro.consultar')
  async listarEnderecos(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return this.manutencao.listarEnderecos(tenantDa(requisicao), empresaId);
  }

  @Post('enderecos')
  async criarEndereco(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return this.manutencao.criarEndereco(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
      analisar(enderecoComFinalidadeSchema, corpo),
    );
  }

  /**
   * Declarada antes de `:enderecoId` de propósito: uma rota dinâmica anterior
   * capturaria `fiscal` como identificador.
   */
  @Post('enderecos/fiscal')
  async trocarFiscal(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return this.manutencao.trocarEnderecoFiscal(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
      analisar(trocaDeFinalidadeFiscalSchema, corpo),
    );
  }

  @Put('enderecos/:enderecoId')
  async atualizarEndereco(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('enderecoId') enderecoId: string,
    @Body() corpo: unknown,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    const { versao, ...endereco } = analisar(enderecoMantidoSchema, corpo);

    return this.manutencao.atualizarEndereco(
      tenantDa(requisicao),
      empresaId,
      enderecoId,
      autorDa(requisicao),
      endereco,
      versao,
    );
  }

  /**
   * `DELETE` arquiva, não apaga (I-7). O verbo descreve a intenção do usuário
   * — remover o endereço da lista ativa —, e o efeito é o arquivamento.
   */
  @Delete('enderecos/:enderecoId')
  async arquivarEndereco(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('enderecoId') enderecoId: string,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return this.manutencao.arquivarEndereco(
      tenantDa(requisicao),
      empresaId,
      enderecoId,
      autorDa(requisicao),
    );
  }

  @Post('arquivar')
  @ExigePermissao('empresas.cadastro.arquivar')
  async arquivar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    const { justificativa } = analisar(justificativaSchema, corpo);

    return this.manutencao.arquivar(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
      justificativa,
    );
  }

  @Post('reativar')
  @ExigePermissao('empresas.cadastro.reativar')
  async reativar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    const { justificativa } = analisar(justificativaSchema, corpo);

    return this.manutencao.reativar(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
      justificativa,
    );
  }

  /** Consulta a CNPJá e devolve as diferenças; não aplica nada (§3.3). */
  @Get('fonte-externa')
  @ExigePermissao('empresas.cadastro.consultar')
  async compararComAFonte(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
  ): Promise<ComparacaoComAFonte> {
    return this.manutencao.compararComAFonte(tenantDa(requisicao), empresaId);
  }

  @Post('fonte-externa')
  async aplicarDaFonte(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDaEmpresa> {
    const { campos } = analisar(aplicacaoDaFonteSchema, corpo);

    return this.manutencao.aplicarDaFonte(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
      campos,
    );
  }
}

/**
 * Histórico de Informações: área global do escritório, não de uma empresa
 * (§3.6). Por isso vive fora do controller acima, em rota própria.
 */
@Controller('historico')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
// O menu global exibe o histórico cadastral das empresas: exige as duas permissões.
@ExigePermissao('historico.global.consultar', 'empresas.historico.consultar')
export class HistoricoController {
  constructor(private readonly manutencao: ManutencaoDaEmpresaService) {}

  @Get()
  async listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ): Promise<PaginaDoHistorico> {
    // O histórico de empresas só mostra o que a carteira alcança: sem carteira, vazio.
    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      return { eventos: [], total: 0 };
    }

    return this.manutencao.consultarHistorico(
      tenantDa(requisicao),
      analisar(filtroDoHistoricoSchema, consulta),
    );
  }

  /** Campos já presentes no histórico, para alimentar o filtro da tela. */
  @Get('campos')
  async campos(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() consulta: unknown,
  ): Promise<readonly string[]> {
    const { aba } = analisar(filtroDoHistoricoSchema, consulta);

    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      return [];
    }

    return this.manutencao.camposDoHistorico(tenantDa(requisicao), aba);
  }
}
