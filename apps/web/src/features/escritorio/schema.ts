/**
 * Schemas do formulário, derivados do contrato da API. Validação reaproveita o
 * domínio: o mesmo validador que a API usa roda aqui (FRONTEND.md §8).
 */
import {
  ehCepValido,
  ehCnpjValido,
  ehCpfValido,
  ehEmailValido,
  ehTelefoneValido,
  ehUfValida,
} from '@contaia/domain';
import { z } from 'zod';

export const identificacaoFormSchema = z.object({
  cnpj: z.string().refine(ehCnpjValido, 'CNPJ inválido'),
  razaoSocial: z.string().trim().min(3, 'Informe a razão social').max(200),
});

export const responsavelFormSchema = z.object({
  nomeCompleto: z.string().trim().min(3, 'Informe o nome completo').max(200),
  cpf: z.string().refine(ehCpfValido, 'CPF inválido'),
  crc: z.string().trim().min(3, 'Informe o registro no CRC').max(40),
  email: z.string().refine(ehEmailValido, 'E-mail inválido'),
  telefone: z.string().refine(ehTelefoneValido, 'Telefone inválido'),
});

export const enderecoFormSchema = z.object({
  cep: z.string().refine(ehCepValido, 'CEP inválido'),
  logradouro: z.string().trim().min(3, 'Informe o logradouro').max(200),
  numero: z.string().trim().min(1, 'Informe o número').max(20),
  complemento: z.string().trim().max(100).optional().or(z.literal('')),
  bairro: z.string().trim().min(2, 'Informe o bairro').max(100),
  municipio: z.string().trim().min(2, 'Informe o município').max(100),
  uf: z.string().refine(ehUfValida, 'UF inválida'),
});

export type IdentificacaoForm = z.infer<typeof identificacaoFormSchema>;
export type ResponsavelForm = z.infer<typeof responsavelFormSchema>;
export type EnderecoForm = z.infer<typeof enderecoFormSchema>;
