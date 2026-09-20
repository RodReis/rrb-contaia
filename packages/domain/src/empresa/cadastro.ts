/**
 * Cadastro e ativação da empresa cliente (SPEC-002 §§3.2 e 4).
 *
 * Funções puras: nenhuma consulta, nenhum relógio, nenhuma mutação da entrada.
 * A empresa só sai de `CADASTRO_INCOMPLETO` por `ativarEmpresa`.
 *
 * Difere do cadastro do escritório em três pontos que valem lembrar: o logo é
 * opcional, o CNPJ é único por tenant (não global) e a etapa fiscal tem regras
 * condicionais — enquadramento só no Simples, número só quando `POSSUI`.
 */

import { CODIGOS_DE_ERRO, ErroDeDominio, type CampoInvalido } from '../erros.js';
import { ehCnpjValido } from '../validadores/cnpj.js';
import {
  ehCepValido,
  ehEmailValido,
  ehTelefoneValido,
  ehUfValida,
} from '../validadores/contato.js';

export type StatusDaEmpresa = 'CADASTRO_INCOMPLETO' | 'ATIVA';

export const REGIMES_TRIBUTARIOS = [
  'SIMPLES_NACIONAL',
  'LUCRO_PRESUMIDO',
  'LUCRO_REAL',
] as const;

export type RegimeTributario = (typeof REGIMES_TRIBUTARIOS)[number];

export const ENQUADRAMENTOS_DO_SIMPLES = ['MEI', 'NAO_MEI'] as const;

export type EnquadramentoSimples = (typeof ENQUADRAMENTOS_DO_SIMPLES)[number];

export const SITUACOES_DE_INSCRICAO = ['POSSUI', 'ISENTO', 'NAO_SE_APLICA'] as const;

export type SituacaoDeInscricao = (typeof SITUACOES_DE_INSCRICAO)[number];

export const ETAPAS_DA_EMPRESA = ['identificacao', 'fiscal', 'endereco', 'revisao'] as const;

export type EtapaDaEmpresa = (typeof ETAPAS_DA_EMPRESA)[number];

export type Inscricao = Readonly<{
  situacao: SituacaoDeInscricao;
  numero: string | null;
}>;

export type IdentificacaoDaEmpresa = Readonly<{
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  logoArquivoId: string | null;
  telefone: string | null;
  email: string | null;
}>;

export type DadosFiscaisDaEmpresa = Readonly<{
  regimeTributario: RegimeTributario | null;
  enquadramentoSimples: EnquadramentoSimples | null;
  cnaePrincipal: string;
  cnaesSecundarios: readonly string[];
  inscricaoEstadual: Inscricao;
  inscricaoMunicipal: Inscricao;
}>;

export type EnderecoDaEmpresa = Readonly<{
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  uf: string;
}>;

export type CadastroDaEmpresa = Readonly<{
  status: StatusDaEmpresa;
  identificacao: IdentificacaoDaEmpresa | null;
  dadosFiscais: DadosFiscaisDaEmpresa | null;
  enderecoPrincipal: EnderecoDaEmpresa | null;
  /** Situação cadastral informada pela fonte externa; `null` quando não consultada. */
  situacaoCadastralExterna: string | null;
  validadoPorFonteExterna: boolean;
  versao: number;
}>;

const preenchido = (valor: string | null | undefined): boolean =>
  typeof valor === 'string' && valor.trim().length > 0;

export const ehRegimeTributario = (valor: string): valor is RegimeTributario =>
  (REGIMES_TRIBUTARIOS as readonly string[]).includes(valor);

export const ehEnquadramentoSimples = (valor: string): valor is EnquadramentoSimples =>
  (ENQUADRAMENTOS_DO_SIMPLES as readonly string[]).includes(valor);

export const ehSituacaoDeInscricao = (valor: string): valor is SituacaoDeInscricao =>
  (SITUACOES_DE_INSCRICAO as readonly string[]).includes(valor);

/**
 * Situação cadastral externa considerada regular. Qualquer outra exige
 * confirmação explícita antes da ativação, mas não bloqueia (SPEC-002 §4.4).
 */
export const exigeConfirmacaoDeSituacaoExterna = (cadastro: CadastroDaEmpresa): boolean =>
  cadastro.situacaoCadastralExterna !== null &&
  cadastro.situacaoCadastralExterna.trim().toLowerCase() !== 'ativa';

export const validarIdentificacaoDaEmpresa = (
  identificacao: IdentificacaoDaEmpresa | null,
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

  // Nome fantasia é obrigatório por decisão do PI (SPEC-002 §14).
  if (!preenchido(identificacao.nomeFantasia)) {
    campos.push({ campo: 'nomeFantasia', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }

  // Telefone, e-mail e logo são opcionais (§4.2) — mas o que for preenchido
  // precisa ser válido: campo opcional não é campo sem regra.
  if (preenchido(identificacao.telefone) && !ehTelefoneValido(identificacao.telefone ?? '')) {
    campos.push({ campo: 'telefone', codigo: CODIGOS_DE_ERRO.TELEFONE_INVALIDO });
  }

  if (preenchido(identificacao.email) && !ehEmailValido(identificacao.email ?? '')) {
    campos.push({ campo: 'email', codigo: CODIGOS_DE_ERRO.EMAIL_INVALIDO });
  }

  return campos;
};

const validarInscricao = (
  inscricao: Inscricao,
  campo: 'inscricaoEstadual' | 'inscricaoMunicipal',
): readonly CampoInvalido[] => {
  if (!ehSituacaoDeInscricao(inscricao.situacao)) {
    return [{ campo, codigo: CODIGOS_DE_ERRO.INSCRICAO_INVALIDA }];
  }

  // Número é obrigatório somente quando a situação for `POSSUI` (§4.3).
  if (inscricao.situacao === 'POSSUI' && !preenchido(inscricao.numero)) {
    return [{ campo: `${campo}.numero`, codigo: CODIGOS_DE_ERRO.INSCRICAO_NUMERO_OBRIGATORIO }];
  }

  return [];
};

export const validarDadosFiscais = (
  dados: DadosFiscaisDaEmpresa | null,
): readonly CampoInvalido[] => {
  if (dados === null) {
    return [{ campo: 'dadosFiscais', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO }];
  }

  const campos: CampoInvalido[] = [];

  if (dados.regimeTributario === null || !ehRegimeTributario(dados.regimeTributario)) {
    campos.push({ campo: 'regimeTributario', codigo: CODIGOS_DE_ERRO.REGIME_INVALIDO });
  } else if (dados.regimeTributario === 'SIMPLES_NACIONAL') {
    // MEI é enquadramento do Simples, não regime separado (§14). Fora do
    // Simples o campo não se aplica; dentro dele, é obrigatório.
    if (
      dados.enquadramentoSimples === null ||
      !ehEnquadramentoSimples(dados.enquadramentoSimples)
    ) {
      campos.push({
        campo: 'enquadramentoSimples',
        codigo: CODIGOS_DE_ERRO.ENQUADRAMENTO_OBRIGATORIO,
      });
    }
  }

  if (!preenchido(dados.cnaePrincipal)) {
    campos.push({ campo: 'cnaePrincipal', codigo: CODIGOS_DE_ERRO.CNAE_OBRIGATORIO });
  }

  campos.push(...validarInscricao(dados.inscricaoEstadual, 'inscricaoEstadual'));
  campos.push(...validarInscricao(dados.inscricaoMunicipal, 'inscricaoMunicipal'));

  return campos;
};

export const validarEnderecoDaEmpresa = (
  endereco: EnderecoDaEmpresa | null,
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

const validacaoPorEtapa: Record<
  EtapaDaEmpresa,
  (cadastro: CadastroDaEmpresa) => readonly CampoInvalido[]
> = {
  identificacao: (cadastro) => validarIdentificacaoDaEmpresa(cadastro.identificacao),
  fiscal: (cadastro) => validarDadosFiscais(cadastro.dadosFiscais),
  endereco: (cadastro) => validarEnderecoDaEmpresa(cadastro.enderecoPrincipal),
  // Revisão não tem campo próprio: conclui quando as três anteriores concluíram.
  revisao: (cadastro) =>
    ETAPAS_DA_EMPRESA.filter((etapa) => etapa !== 'revisao').flatMap((etapa) =>
      validacaoPorEtapa[etapa](cadastro),
    ),
};

export const camposInvalidosDaEtapaDaEmpresa = (
  cadastro: CadastroDaEmpresa,
  etapa: EtapaDaEmpresa,
): readonly CampoInvalido[] => validacaoPorEtapa[etapa](cadastro);

export const etapasConcluidasDaEmpresa = (
  cadastro: CadastroDaEmpresa,
): readonly EtapaDaEmpresa[] =>
  ETAPAS_DA_EMPRESA.filter((etapa) => validacaoPorEtapa[etapa](cadastro).length === 0);

export const primeiraEtapaIncompletaDaEmpresa = (
  cadastro: CadastroDaEmpresa,
): EtapaDaEmpresa | null =>
  ETAPAS_DA_EMPRESA.find((etapa) => validacaoPorEtapa[etapa](cadastro).length > 0) ?? null;

export const podeAtivarEmpresa = (cadastro: CadastroDaEmpresa): boolean =>
  validacaoPorEtapa.revisao(cadastro).length === 0;

/**
 * Ativa a empresa. Idempotente: cadastro já `ATIVA` volta inalterado, sem
 * revalidar — a ativação anterior já provou as etapas (SPEC-002 §3.2).
 *
 * A confirmação da situação cadastral externa é decisão do usuário e chega como
 * parâmetro: o domínio exige que ela tenha sido dada, não a inventa.
 */
export const ativarEmpresa = (
  cadastro: CadastroDaEmpresa,
  situacaoExternaConfirmada = false,
): CadastroDaEmpresa => {
  if (cadastro.status === 'ATIVA') {
    return cadastro;
  }

  const pendencias = validacaoPorEtapa.revisao(cadastro);

  if (pendencias.length > 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.ETAPA_INCOMPLETA,
      'O cadastro da empresa tem etapas incompletas e não pode ser ativado.',
      pendencias,
    );
  }

  if (exigeConfirmacaoDeSituacaoExterna(cadastro) && !situacaoExternaConfirmada) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO,
      'A situação cadastral da empresa não é Ativa na fonte externa e exige confirmação explícita.',
    );
  }

  return { ...cadastro, status: 'ATIVA' };
};
