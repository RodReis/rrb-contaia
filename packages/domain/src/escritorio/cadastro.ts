/**
 * Conclusão do cadastro do escritório (SPEC-001 §3.2).
 *
 * Funções puras: nenhuma consulta, nenhum relógio, nenhuma mutação da entrada.
 * O estado do tenant só sai de `CADASTRO_INCOMPLETO` por `ativarCadastro`.
 */

import { CODIGOS_DE_ERRO, ErroDeDominio, type CampoInvalido } from '../erros.js';
import { ehCnpjValido } from '../validadores/cnpj.js';
import { ehCpfValido } from '../validadores/cpf.js';
import {
  ehCepValido,
  ehEmailValido,
  ehTelefoneValido,
  ehUfValida,
} from '../validadores/contato.js';

export type StatusDoTenant = 'CADASTRO_INCOMPLETO' | 'ATIVO';

export const ETAPAS_DO_CADASTRO = [
  'identificacao',
  'responsavel',
  'endereco',
  'documentos',
  'revisao',
] as const;

export type EtapaDoCadastro = (typeof ETAPAS_DO_CADASTRO)[number];

export type IdentificacaoDoEscritorio = Readonly<{
  cnpj: string;
  razaoSocial: string;
  logoArquivoId: string | null;
}>;

export type ResponsavelTecnico = Readonly<{
  nomeCompleto: string;
  cpf: string;
  crc: string;
  email: string;
  telefone: string;
}>;

export type EnderecoDoEscritorio = Readonly<{
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  uf: string;
}>;

export type CadastroDoEscritorio = Readonly<{
  status: StatusDoTenant;
  identificacao: IdentificacaoDoEscritorio | null;
  responsavel: ResponsavelTecnico | null;
  enderecoPrincipal: EnderecoDoEscritorio | null;
  documentosArquivoIds: readonly string[];
  versao: number;
}>;

const preenchido = (valor: string | null | undefined): boolean =>
  typeof valor === 'string' && valor.trim().length > 0;

export const validarIdentificacao = (
  identificacao: IdentificacaoDoEscritorio | null,
): readonly CampoInvalido[] => {
  if (identificacao === null) {
    return [{ campo: 'identificacao', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO }];
  }

  const campos: CampoInvalido[] = [];

  if (!ehCnpjValido(identificacao.cnpj)) {
    campos.push({ campo: 'cnpj', codigo: CODIGOS_DE_ERRO.CNPJ_INVALIDO });
  }

  if (!preenchido(identificacao.razaoSocial)) {
    campos.push({ campo: 'razaoSocial', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }

  // Logo só conta depois de persistido (SPEC-001 §3.2).
  if (!preenchido(identificacao.logoArquivoId)) {
    campos.push({ campo: 'logo', codigo: CODIGOS_DE_ERRO.LOGO_OBRIGATORIO });
  }

  return campos;
};

export const validarResponsavel = (
  responsavel: ResponsavelTecnico | null,
): readonly CampoInvalido[] => {
  if (responsavel === null) {
    return [{ campo: 'responsavel', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO }];
  }

  const campos: CampoInvalido[] = [];

  if (!preenchido(responsavel.nomeCompleto)) {
    campos.push({ campo: 'nomeCompleto', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }

  if (!ehCpfValido(responsavel.cpf)) {
    campos.push({ campo: 'cpf', codigo: CODIGOS_DE_ERRO.CPF_INVALIDO });
  }

  if (!preenchido(responsavel.crc)) {
    campos.push({ campo: 'crc', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }

  if (!ehEmailValido(responsavel.email)) {
    campos.push({ campo: 'email', codigo: CODIGOS_DE_ERRO.EMAIL_INVALIDO });
  }

  if (!ehTelefoneValido(responsavel.telefone)) {
    campos.push({ campo: 'telefone', codigo: CODIGOS_DE_ERRO.TELEFONE_INVALIDO });
  }

  return campos;
};

export const validarEndereco = (
  endereco: EnderecoDoEscritorio | null,
): readonly CampoInvalido[] => {
  if (endereco === null) {
    return [{ campo: 'endereco', codigo: CODIGOS_DE_ERRO.ENDERECO_PRINCIPAL_OBRIGATORIO }];
  }

  const campos: CampoInvalido[] = [];

  if (!ehCepValido(endereco.cep)) {
    campos.push({ campo: 'cep', codigo: CODIGOS_DE_ERRO.CEP_INVALIDO });
  }

  for (const campo of ['logradouro', 'numero', 'bairro', 'municipio'] as const) {
    if (!preenchido(endereco[campo])) {
      campos.push({ campo, codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
    }
  }

  if (!ehUfValida(endereco.uf)) {
    campos.push({ campo: 'uf', codigo: CODIGOS_DE_ERRO.UF_INVALIDA });
  }

  return campos;
};

export const validarDocumentos = (
  documentosArquivoIds: readonly string[],
): readonly CampoInvalido[] =>
  documentosArquivoIds.length === 0
    ? [{ campo: 'documentos', codigo: CODIGOS_DE_ERRO.DOCUMENTO_OBRIGATORIO }]
    : [];

const validacaoPorEtapa: Record<
  EtapaDoCadastro,
  (cadastro: CadastroDoEscritorio) => readonly CampoInvalido[]
> = {
  identificacao: (cadastro) => validarIdentificacao(cadastro.identificacao),
  responsavel: (cadastro) => validarResponsavel(cadastro.responsavel),
  endereco: (cadastro) => validarEndereco(cadastro.enderecoPrincipal),
  documentos: (cadastro) => validarDocumentos(cadastro.documentosArquivoIds),
  // Revisão não tem campo próprio: conclui quando as quatro anteriores concluíram.
  revisao: (cadastro) =>
    ETAPAS_DO_CADASTRO.filter((etapa) => etapa !== 'revisao').flatMap((etapa) =>
      validacaoPorEtapa[etapa](cadastro),
    ),
};

export const camposInvalidosDaEtapa = (
  cadastro: CadastroDoEscritorio,
  etapa: EtapaDoCadastro,
): readonly CampoInvalido[] => validacaoPorEtapa[etapa](cadastro);

export const etapasConcluidas = (cadastro: CadastroDoEscritorio): readonly EtapaDoCadastro[] =>
  ETAPAS_DO_CADASTRO.filter((etapa) => validacaoPorEtapa[etapa](cadastro).length === 0);

export const primeiraEtapaIncompleta = (
  cadastro: CadastroDoEscritorio,
): EtapaDoCadastro | null =>
  ETAPAS_DO_CADASTRO.find((etapa) => validacaoPorEtapa[etapa](cadastro).length > 0) ?? null;

export const podeAtivar = (cadastro: CadastroDoEscritorio): boolean =>
  validacaoPorEtapa.revisao(cadastro).length === 0;

/**
 * Ativa o tenant. Idempotente: cadastro já `ATIVO` volta inalterado, sem
 * revalidar — a ativação anterior já provou as etapas (SPEC-001 §6).
 */
export const ativarCadastro = (cadastro: CadastroDoEscritorio): CadastroDoEscritorio => {
  if (cadastro.status === 'ATIVO') {
    return cadastro;
  }

  const pendencias = validacaoPorEtapa.revisao(cadastro);

  if (pendencias.length > 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.ETAPA_INCOMPLETA,
      'O cadastro tem etapas incompletas e não pode ser concluído.',
      pendencias,
    );
  }

  return { ...cadastro, status: 'ATIVO' };
};
