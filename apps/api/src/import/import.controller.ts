import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { GuardDeCadastro, GuardDeSessao } from '../auth/sessao.guard';
import { ImportService, type ArquivoCsv, type ResultadoDaLinha } from './import.service';

const LIMITE_DO_CSV_BYTES = 5 * 1024 * 1024;

@Controller('import')
@UseGuards(GuardDeSessao, GuardDeCadastro)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LIMITE_DO_CSV_BYTES } }))
  uploadCsv(@UploadedFile() file: ArquivoCsv | undefined): ResultadoDaLinha[] {
    if (file === undefined) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }

    return this.importService.processCsv(file);
  }
}
