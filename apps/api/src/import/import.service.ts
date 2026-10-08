import { Injectable, BadRequestException } from '@nestjs/common';
import { ehCpfValido } from '@contaia/domain';
import { parse } from 'csv-parse/sync';

export interface CsvRow {
  cpf: string;
  nome: string;
  matricula: string;
  data_nascimento: string;
  data_admissao: string;
}

export type ArquivoCsv = Readonly<{ buffer: Buffer }>;

export type ResultadoDaLinha = Readonly<{
  status: 'valid' | 'invalid';
  message: string;
  data?: CsvRow;
}>;

@Injectable()
export class ImportService {
  processCsv(file: ArquivoCsv): ResultadoDaLinha[] {
    return this.readCsv(file.buffer.toString('utf-8')).map((row) => this.validateRow(row));
  }

  private readCsv(content: string): CsvRow[] {
    let records: Record<string, string>[];

    try {
      records = parse(content, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    } catch {
      throw new BadRequestException('CSV inválido.');
    }

    return records.map((record) => ({
      cpf: record['CPF'] ?? '',
      nome: record['Nome'] ?? '',
      matricula: record['Matrícula'] ?? '',
      data_nascimento: record['Data de nascimento'] ?? '',
      data_admissao: record['Data de admissão'] ?? '',
    }));
  }

  private validateRow(row: CsvRow): ResultadoDaLinha {
    const { cpf, nome, matricula, data_nascimento, data_admissao } = row;

    if (!cpf || !matricula || !nome) {
      return { status: 'invalid', message: 'Campos obrigatórios ausentes' };
    }

    if (!ehCpfValido(cpf)) {
      return { status: 'invalid', message: 'CPF inválido' };
    }

    if (!this.isValidDate(data_nascimento)) {
      return { status: 'invalid', message: 'Data de nascimento inválida' };
    }

    if (!this.isValidDate(data_admissao)) {
      return { status: 'invalid', message: 'Data de admissão inválida' };
    }

    const nascimento = new Date(data_nascimento);
    const admissao = new Date(data_admissao);
    if (isNaN(nascimento.getTime()) || isNaN(admissao.getTime())) {
      return { status: 'invalid', message: 'Datas inválidas' };
    }

    if (admissao <= nascimento) {
      return { status: 'invalid', message: 'Data de admissão deve ser posterior à data de nascimento' };
    }

    if (!matricula.trim()) {
      return { status: 'invalid', message: 'Matrícula não pode ser vazia' };
    }

    return { status: 'valid', message: 'Linha válida', data: row };
  }

  private isValidDate(dateStr: string): boolean {
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  }
}