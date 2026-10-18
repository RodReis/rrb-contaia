import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  CATALOGO_DE_PODERES_RFB,
  CODIGOS_DE_ERRO,
  ErroDeDominio,
} from '@contaia/domain';
import type { PoderRfb } from '@contaia/domain';
import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { DfeAdminTenantScope } from '../auth/escopo';
import {
  GuardDeCadastro,
  GuardDeSessao,
  type RequisicaoAutenticada,
} from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { nomeSeguro } from '../comum/nome-seguro';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { analisar } from '../escritorio/escritorio.dto';
import { StorageService } from '../comum/storage.service';
import {
  ProcuracoesService,
  type SessaoProcuracao,
} from './procuracoes.service';
import {
  confirmacaoSchema,
  criacaoSchema,
  evidenciaSchema,
  filtroSchema,
  operacaoSchema,
  paginaSchema,
  rascunhoSchema,
  revisaoSchema,
  revogacaoSchema,
  testeSchema,
} from './procuracoes.dto';

type Arquivo = Readonly<{
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}>;
import { z as Z } from 'zod';
const sessao = (r: RequisicaoAutenticada): SessaoProcuracao => ({
  tenantId: tenantDa(r),
  usuarioId: autorDa(r).usuarioId,
  permissoes: r.sessao?.permissoes ?? [],
});

@Controller('procurações-rfb')
@DfeAdminTenantScope()
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
export class ProcuracoesController {
  constructor(
    private readonly service: ProcuracoesService,
    private readonly storage: StorageService,
  ) {}
  @Get()
  @ExigePermissao('procuracoes.registro.consultar')
  listar(@Req() r: RequisicaoAutenticada, @Query() q: unknown) {
    const f = analisar(filtroSchema, q ?? {});
    return this.service.listar(
      sessao(r),
      {
        limite: f.limite,
        pagina: f.pagina,
        ordem: f.ordem,
        ...(typeof f.empresaId === 'string' ? { empresaId: f.empresaId } : {}),
        ...(typeof f.busca === 'string' ? { busca: f.busca } : {}),
        ...(f.estado === undefined ? {} : { estado: f.estado }),
        ...(f.poder === undefined ? {} : { poder: f.poder }),
        ...(f.vencimento === undefined ? {} : { vencimento: f.vencimento }),
      },
      obterCorrelationId(r),
    );
  }
  @Get('resumo')
  @ExigePermissao('procuracoes.registro.consultar')
  resumo(@Req() r: RequisicaoAutenticada) {
    return this.service.resumo(sessao(r), obterCorrelationId(r));
  }
  @Get('catalogo')
  @ExigePermissao('procuracoes.registro.consultar')
  catalogo() {
    return { versao: 1, poderes: CATALOGO_DE_PODERES_RFB };
  }
  @Post()
  @ExigePermissao('procuracoes.registro.administrar')
  criar(@Req() r: RequisicaoAutenticada, @Body() b: unknown) {
    const x = analisar(criacaoSchema, b);
    return this.service.criar(sessao(r), x.empresaId, x, obterCorrelationId(r));
  }
  @Put(':id')
  @ExigePermissao('procuracoes.registro.administrar')
  editar(
    @Req() r: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.editar(
      sessao(r),
      analisar(Z.string().uuid(), id),
      analisar(
        rascunhoSchema.extend({
          expectedRevision: Z.number().int().positive(),
        }),
        b,
      ),
      obterCorrelationId(r),
    );
  }
  @Post(':id/evidencia')
  @ExigePermissao('procuracoes.registro.administrar')
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  enviar(
    @Req() r: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body() b: unknown,
    @UploadedFile() f: Arquivo | undefined,
  ) {
    if (!f)
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
        'Envie um PDF.',
      );
    const x = analisar(evidenciaSchema, b);
    return this.service.enviar(
      sessao(r),
      analisar(Z.string().uuid(), id),
      x.expectedRevision,
      { nome: f.originalname, tipo: f.mimetype, bytes: f.buffer },
      obterCorrelationId(r),
    );
  }
  @Post(':id/teste-local')
  @ExigePermissao('procuracoes.registro.testar')
  testar(
    @Req() r: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.testar(
      sessao(r),
      analisar(Z.string().uuid(), id),
      analisar(testeSchema, b) as { expectedRevision: number; power: PoderRfb },
      obterCorrelationId(r),
    );
  }
  @Post(':id/operacoes')
  @ExigePermissao('procuracoes.registro.operar')
  operar(
    @Req() r: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.operar(
      sessao(r),
      analisar(Z.string().uuid(), id),
      analisar(operacaoSchema, b),
      obterCorrelationId(r),
    );
  }
  @Post(':id/confirmacao')
  @ExigePermissao('procuracoes.registro.confirmar')
  confirmar(
    @Req() r: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.confirmar(
      sessao(r),
      analisar(Z.string().uuid(), id),
      analisar(confirmacaoSchema, b),
      obterCorrelationId(r),
    );
  }
  @Post(':id/revogacao')
  @ExigePermissao('procuracoes.registro.revogar')
  revogar(
    @Req() r: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.revogar(
      sessao(r),
      analisar(Z.string().uuid(), id),
      analisar(revogacaoSchema, b),
      obterCorrelationId(r),
    );
  }
  @Post(':id/arquivamento')
  @ExigePermissao('procuracoes.registro.arquivar')
  arquivar(
    @Req() r: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.arquivar(
      sessao(r),
      analisar(Z.string().uuid(), id),
      analisar(revisaoSchema, b).expectedRevision,
      obterCorrelationId(r),
    );
  }
  @Get(':id/historico')
  @ExigePermissao('procuracoes.registro.consultar')
  historico(
    @Req() r: RequisicaoAutenticada,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.historico(
      sessao(r),
      analisar(Z.string().uuid(), id),
      analisar(paginaSchema, q ?? {}).pagina,
      obterCorrelationId(r),
    );
  }
  @Get(':id/evidencia')
  @ExigePermissao('procuracoes.registro.consultar')
  @Header('X-Content-Type-Options', 'nosniff')
  async evidencia(
    @Req() r: RequisicaoAutenticada,
    @Param('id') raw: string,
    @Res() res: Response,
  ) {
    const id = analisar(Z.string().uuid(), raw),
      s = sessao(r),
      cid = obterCorrelationId(r);
    const dado = await this.service.obterEvidencia(s, id, cid);
    const arquivo = await this.storage.obter(dado.chaveStorage);
    await this.service.registrarEvidenciaBaixada(s, id, cid);
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader(
        'Content-Disposition',
        `inline; filename="${nomeSeguro(dado.nome, 'procuracao.pdf')}"`,
      )
      .send(arquivo.conteudo);
  }
}
