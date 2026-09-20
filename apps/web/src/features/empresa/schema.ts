/**
 * Schemas do formulário da empresa cliente, derivados do contrato da API.
 * A validação reaproveita o domínio: o mesmo validador que a API usa roda aqui
 * (FRONTEND.md §8).
 */
import {
  ENQUADRAMENTOS_DO_SIMPLES,
  FINALIDADES_DE_ENDERECO,
  REGIMES_TRIBUTARIOS,
  SITUACOES_DE_INSCRICAO,
  ehCepValido,
  ehCnpjValido,
  ehEmailValido,
  ehTelefoneValido,
  ehUfValida,
} from '@contaia/domain';
import { z } from 'zod';

/** Campo opcional: vazio é ausência, não erro — mas o que vem preenchido vale. */
const opcional = (validador: (valor: string) => boolean, mensagem: string) =>
  z
    .string()
    .trim()
    .optional()
    .refine((valor) => valor === undefined || valor === '' || validador(valor), mensagem);

export const cnpjFormSchema = z.object({
  cnpj: z.string().refine(ehCnpjValido, 'CNPJ inválido'),
});

export const identificacaoDaEmpresaFormSchema = z.object({
  razaoSocial: z.string().trim().min(3, 'Informe a razão social').max(200),
  nomeFantasia: z.string().trim().min(2, 'Informe o nome fantasia').max(200),
  telefone: opcional(ehTelefoneValido, 'Telefone inválido'),
  email: opcional(ehEmailValido, 'E-mail inválido'),
});

const inscricaoFormSchema = z
  .object({
    situacao: z.enum(SITUACOES_DE_INSCRICAO),
    numero: z.string().trim().max(40).optional(),
  })
  .refine(
    (inscricao) =>
      inscricao.situacao !== 'POSSUI' ||
      (inscricao.numero !== undefined && inscricao.numero.length > 0),
    { message: 'Informe o número da inscrição', path: ['numero'] },
  );

export const dadosFiscaisFormSchema = z
  .object({
    regimeTributario: z.enum(REGIMES_TRIBUTARIOS, { message: 'Selecione o regime tributário' }),
    enquadramentoSimples: z.enum(ENQUADRAMENTOS_DO_SIMPLES).optional(),
    cnaePrincipal: z
      .string()
      .trim()
      .min(7, 'Informe o CNAE principal')
      .max(10)
      .regex(/^[\d./-]+$/u, 'CNAE aceita apenas números'),
    cnaesSecundarios: z.array(z.string().trim().min(1)).max(50).default([]),
    inscricaoEstadual: inscricaoFormSchema,
    inscricaoMunicipal: inscricaoFormSchema,
  })
  .refine(
    (dados) =>
      dados.regimeTributario !== 'SIMPLES_NACIONAL' ||
      dados.enquadramentoSimples !== undefined,
    {
      message: 'Informe o enquadramento no Simples',
      path: ['enquadramentoSimples'],
    },
  );

export const enderecoDaEmpresaFormSchema = z.object({
  cep: z.string().refine(ehCepValido, 'CEP inválido'),
  logradouro: z.string().trim().min(3, 'Informe o logradouro').max(200),
  numero: z.string().trim().min(1, 'Informe o número').max(20),
  complemento: z.string().trim().max(100).optional().or(z.literal('')),
  bairro: z.string().trim().min(2, 'Informe o bairro').max(100),
  municipio: z.string().trim().min(2, 'Informe o município').max(100),
  uf: z.string().refine(ehUfValida, 'UF inválida'),
});

export type CnpjForm = z.infer<typeof cnpjFormSchema>;
export type IdentificacaoDaEmpresaForm = z.infer<typeof identificacaoDaEmpresaFormSchema>;
/**
 * O formulário fiscal trabalha com a **entrada** do schema, não com a saída:
 * `cnaesSecundarios` tem `.default([])`, então é opcional ao preencher e
 * garantido depois de validar. Tipar o `useForm` pela saída faria o campo ser
 * exigido no estado inicial — o `react-hook-form` precisa dos dois lados.
 */
export type DadosFiscaisForm = z.input<typeof dadosFiscaisFormSchema>;
export type DadosFiscaisValidados = z.output<typeof dadosFiscaisFormSchema>;
export type EnderecoDaEmpresaForm = z.infer<typeof enderecoDaEmpresaFormSchema>;

/**
 * Endereço com finalidade (SPEC-003 §3.4). `OUTRO` exige descrição; nas demais
 * finalidades a descrição é recusada — a finalidade já nomeia o endereço.
 */
export const enderecoComFinalidadeFormSchema = enderecoDaEmpresaFormSchema
  .extend({
    finalidade: z.enum(FINALIDADES_DE_ENDERECO),
    descricao: z.string().trim().max(200).optional().or(z.literal('')),
  })
  .refine(
    (valor) => valor.finalidade !== 'OUTRO' || (valor.descricao ?? '').length > 0,
    { path: ['descricao'], message: 'Descreva a finalidade deste endereço' },
  );

export type EnderecoComFinalidadeForm = z.infer<typeof enderecoComFinalidadeFormSchema>;
