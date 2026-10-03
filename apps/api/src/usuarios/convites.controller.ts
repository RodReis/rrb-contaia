/**
 * Endpoints públicos do convite (SPEC-007 §3.2). Sem sessão: quem chega só tem
 * o link. Por isso tudo aqui passa pelo limite de tentativas, e a resposta de
 * consulta traz apenas o que a página de aceite precisa mostrar.
 */
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import { GuardDeLimiteDeTentativas } from '../auth/limite-de-tentativas';
import { analisar } from '../escritorio/escritorio.dto';
import { ConvitesService, type VisaoDoConvite } from './convites.service';
import { aceiteDoConviteSchema } from './usuarios.dto';

@Controller('convites')
@UseGuards(GuardDeLimiteDeTentativas)
export class ConvitesController {
  constructor(private readonly convites: ConvitesService) {}

  @Get(':token')
  async consultar(@Param('token') token: string): Promise<VisaoDoConvite> {
    return this.convites.consultar(token);
  }

  @Post('aceitar')
  @HttpCode(204)
  async aceitar(@Body() corpo: unknown): Promise<void> {
    const { token, senha } = analisar(aceiteDoConviteSchema, corpo);

    await this.convites.aceitar(token, senha);
  }
}
