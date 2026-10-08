import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ImportService } from './import.service';

const CABECALHO = 'CPF,Nome,Matrícula,Data de nascimento,Data de admissão';
const arquivo = (linhas: string[]) => ({ buffer: Buffer.from([CABECALHO, ...linhas].join('\n')) });

describe('ImportService', () => {
  const service = new ImportService();

  it('aceita linha válida', () => {
    const [resultado] = service.processCsv(
      arquivo(['529.982.247-25,João Silva,MAT-001,1990-01-01,2023-01-15']),
    );

    expect(resultado?.status).toBe('valid');
  });

  it('recusa CPF com dígitos verificadores inválidos', () => {
    const [resultado] = service.processCsv(
      arquivo(['123.456.789-00,João Silva,MAT-001,1990-01-01,2023-01-15']),
    );

    expect(resultado).toMatchObject({ status: 'invalid', message: 'CPF inválido' });
  });

  it('recusa admissão anterior ao nascimento', () => {
    const [resultado] = service.processCsv(
      arquivo(['529.982.247-25,João Silva,MAT-001,2023-01-15,1990-01-01']),
    );

    expect(resultado?.status).toBe('invalid');
  });

  it('recusa campos obrigatórios ausentes', () => {
    const [resultado] = service.processCsv(arquivo([',,,1990-01-01,2023-01-15']));

    expect(resultado).toMatchObject({ status: 'invalid' });
  });

  it('rejeita CSV malformado', () => {
    expect(() => service.processCsv({ buffer: Buffer.from('CPF,Nome\n"aberta,x') })).toThrow(
      BadRequestException,
    );
  });
});
