/**
 * Endpoints da Central de Pendências (SPEC-005). A autorização é por ação
 * (SPEC-007 §3.1): `GuardDeAcao` vem sempre depois de `GuardDeSessao` na cadeia
 * (é `GuardDeSessao` quem popula `requisicao.sessao`, de onde ele lê os papéis).
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';

import { ExigeAcao, GuardDeAcao } from '../auth/acao.guard';
import { escopoDaSessao, GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import { dispensaDePendenciaSchema, filtroDaCentralSchema } from './pendencias.dto';
import { type Autor, PendenciasService } from './pendencias.service';

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

@Controller('pendencias')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigeAcao('PENDENCIAS', 'consultar')
export class PendenciasController {
  constructor(private readonly pendencias: PendenciasService) {}

  @Get()
  async consultarCentral(@Req() requisicao: RequisicaoAutenticada, @Query() consulta: unknown) {
    // A central cruza empresas: sem carteira, nenhuma pendência é visível.
    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      return { pendencias: [], total: 0, escopoDeEmpresas: 'NENHUMA' as const };
    }

    return this.pendencias.consultarCentral(
      tenantDa(requisicao),
      analisar(filtroDaCentralSchema, consulta),
    );
  }
}

@Controller('empresas/:empresaId/pendencias')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
@ExigeAcao('PENDENCIAS', 'administrar')
export class PendenciasDaEmpresaController {
  constructor(private readonly pendencias: PendenciasService) {}

  @Put(':pendenciaId/dispensa')
  async dispensar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('pendenciaId') pendenciaId: string,
    @Body() corpo: unknown,
  ) {
    const entrada = analisar(dispensaDePendenciaSchema, corpo);

    return this.pendencias.dispensar(
      tenantDa(requisicao),
      empresaId,
      pendenciaId,
      autorDa(requisicao),
      entrada.justificativa,
    );
  }
}
