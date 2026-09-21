/**
 * Endpoints da Central de Pendências (SPEC-005). Somente `admin_escritorio`
 * (§5.2) — `GuardDePapel` aplicado na classe inteira, sempre depois de
 * `GuardDeSessao` na cadeia (é `GuardDeSessao` quem popula `requisicao.sessao`,
 * de onde `GuardDePapel` lê o papel).
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';

import { ExigePapel, GuardDePapel } from '../auth/papel.guard';
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
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDePapel)
@ExigePapel('admin_escritorio')
export class PendenciasController {
  constructor(private readonly pendencias: PendenciasService) {}

  @Get()
  async consultarCentral(@Req() requisicao: RequisicaoAutenticada, @Query() consulta: unknown) {
    return this.pendencias.consultarCentral(
      tenantDa(requisicao),
      analisar(filtroDaCentralSchema, consulta),
    );
  }
}

@Controller('empresas/:empresaId/pendencias')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDePapel)
@ExigePapel('admin_escritorio')
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
