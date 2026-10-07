/**
 * Endpoints do painel do Signer (SPEC-012 §5). Autorização por chave do catálogo (`GuardDeAcao`,
 * falha fechado) + alçada por empresa (`GuardDeEscopoDeEmpresa`) + papel padrão no teste manual.
 *
 * A API só CONSULTA e DIAGNOSTICA. Não há rota que assine XML ou execute operação funcional, e o
 * navegador nunca recebe XML, resposta do destino, segredo nem a referência do segredo.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import type { SessaoDoCofre } from '../certificados/visoes';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { estadosSchema, filtroDoHistoricoDoSignerSchema, testeManualSchema } from './signer.dto';
import { SignerService } from './signer.service';

/** Tenant, usuário, papéis e permissão efetiva — sempre da sessão validada, nunca do corpo. */
const sessaoDoSigner = (requisicao: RequisicaoAutenticada): SessaoDoCofre => ({
  tenantId: tenantDa(requisicao),
  usuarioId: autorDa(requisicao).usuarioId,
  papeis: requisicao.sessao?.papeis ?? [],
  permissoes: requisicao.sessao?.permissoes ?? [],
});

@Controller('signer')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('certificados.signer.consultar')
export class SignerController {
  constructor(private readonly signer: SignerService) {}

  /** Cartão geral `Microserviço Signer`: estado, última verificação e latência. */
  @Get('painel')
  painel(@Req() requisicao: RequisicaoAutenticada) {
    return this.signer.painelDoServico(sessaoDoSigner(requisicao), obterCorrelationId(requisicao));
  }

  /** Coluna `Signer mTLS` da lista: estados de várias empresas da carteira, em lote. */
  @Get('estados')
  estados(@Req() requisicao: RequisicaoAutenticada, @Query() consulta: unknown) {
    return this.signer.estados(
      sessaoDoSigner(requisicao),
      analisar(estadosSchema, consulta).empresaIds,
      obterCorrelationId(requisicao),
    );
  }
}

// Registrado antes de `EmpresaController`, como os demais controllers aninhados em `empresas/:empresaId`.
@Controller('empresas/:empresaId/signer')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
@ExigePermissao('certificados.signer.consultar')
export class SignerDaEmpresaController {
  constructor(private readonly signer: SignerService) {}

  @Get()
  async estado(@Req() requisicao: RequisicaoAutenticada, @Param('empresaId') empresaId: string) {
    const { empresas } = await this.signer.estados(sessaoDoSigner(requisicao), [empresaId], obterCorrelationId(requisicao));

    return empresas[0];
  }

  @Get('historico')
  historico(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Query() consulta: unknown,
  ) {
    return this.signer.historico(
      sessaoDoSigner(requisicao),
      empresaId,
      analisar(filtroDoHistoricoDoSignerSchema, consulta),
      obterCorrelationId(requisicao),
    );
  }

  /** Teste manual: só dispara o diagnóstico do próprio Signer. Admin e contador da carteira. */
  @Post('testes')
  @HttpCode(200)
  @ExigePermissao('certificados.signer.testar')
  testar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ) {
    return this.signer.testarManual(
      sessaoDoSigner(requisicao),
      empresaId,
      analisar(testeManualSchema, corpo ?? {}).finalidade,
      obterCorrelationId(requisicao),
    );
  }
}
