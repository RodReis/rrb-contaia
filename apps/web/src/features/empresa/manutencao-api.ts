/** Chamadas ao backend da manutenção da empresa e do histórico (SPEC-003). */
import type {
  AbaDoHistorico,
  AcaoDoHistorico,
  DadosFiscaisDaEmpresa,
  FinalidadeDeEndereco,
} from '@contaia/domain';

import { requisitar } from '@/lib/http';
import type { VisaoDaEmpresa } from './api';

export type EnderecoDaEmpresa = Readonly<{
  id: string;
  finalidade: FinalidadeDeEndereco;
  descricao: string | null;
  principal: boolean;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  uf: string;
  versao: number;
}>;

export type EnderecoParaSalvar = Omit<EnderecoDaEmpresa, 'id' | 'principal' | 'versao'>;

export type DiferencaExterna = Readonly<{
  campo: string;
  valorAtual: string | null;
  valorExterno: string | null;
}>;

export type ComparacaoComAFonte = Readonly<{
  situacao: 'comparado' | 'sem_fonte' | 'sem_diferencas';
  diferencas: readonly DiferencaExterna[];
  situacaoCadastralExterna: string | null;
  alertaDeSituacaoExterna: boolean;
  motivo: string | null;
}>;

export type EventoDoHistorico = Readonly<{
  id: string;
  empresaId: string;
  empresaNome: string;
  aba: AbaDoHistorico;
  acao: AcaoDoHistorico;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  vigencia: string | null;
  justificativa: string | null;
  usuarioNome: string;
  ocorridoEm: string;
}>;

export type PaginaDoHistorico = Readonly<{
  eventos: readonly EventoDoHistorico[];
  total: number;
}>;

export type FiltroDoHistorico = Readonly<{
  aba: AbaDoHistorico | null;
  empresaId: string | null;
  inicio: string | null;
  fim: string | null;
  usuarioId: string | null;
  campo: string | null;
  limite: number;
  deslocamento: number;
}>;

const comJson = (corpo: unknown, method: 'PUT' | 'POST' = 'PUT'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

const base = (empresaId: string): string => `/empresas/${empresaId}/manutencao`;

export const salvarIdentificacaoMantida = (
  empresaId: string,
  entrada: Readonly<{
    razaoSocial: string;
    nomeFantasia: string;
    telefone: string | null;
    email: string | null;
  }>,
): Promise<VisaoDaEmpresa> =>
  requisitar<VisaoDaEmpresa>(`${base(empresaId)}/identificacao`, comJson(entrada));

export const salvarFiscaisMantidos = (
  empresaId: string,
  entrada: DadosFiscaisDaEmpresa,
  vigencia: string,
): Promise<VisaoDaEmpresa> =>
  requisitar<VisaoDaEmpresa>(
    `${base(empresaId)}/fiscal`,
    comJson({ ...entrada, vigencia }),
  );

export const listarEnderecos = (empresaId: string): Promise<readonly EnderecoDaEmpresa[]> =>
  requisitar<readonly EnderecoDaEmpresa[]>(`${base(empresaId)}/enderecos`);

export const criarEndereco = (
  empresaId: string,
  entrada: EnderecoParaSalvar,
): Promise<readonly EnderecoDaEmpresa[]> =>
  requisitar<readonly EnderecoDaEmpresa[]>(
    `${base(empresaId)}/enderecos`,
    comJson(entrada, 'POST'),
  );

export const atualizarEndereco = (
  empresaId: string,
  enderecoId: string,
  entrada: EnderecoParaSalvar,
): Promise<readonly EnderecoDaEmpresa[]> =>
  requisitar<readonly EnderecoDaEmpresa[]>(
    `${base(empresaId)}/enderecos/${enderecoId}`,
    comJson(entrada),
  );

export const trocarEnderecoFiscal = (
  empresaId: string,
  entrada: Readonly<{ novoFiscalId: string; finalidadeDoAnterior: FinalidadeDeEndereco }>,
): Promise<readonly EnderecoDaEmpresa[]> =>
  requisitar<readonly EnderecoDaEmpresa[]>(
    `${base(empresaId)}/enderecos/fiscal`,
    comJson(entrada, 'POST'),
  );

/** Arquiva o endereço; a API não expõe exclusão física (I-7). */
export const arquivarEndereco = (
  empresaId: string,
  enderecoId: string,
): Promise<readonly EnderecoDaEmpresa[]> =>
  requisitar<readonly EnderecoDaEmpresa[]>(`${base(empresaId)}/enderecos/${enderecoId}`, {
    method: 'DELETE',
  });

export const arquivarEmpresa = (
  empresaId: string,
  justificativa: string,
): Promise<VisaoDaEmpresa> =>
  requisitar<VisaoDaEmpresa>(
    `${base(empresaId)}/arquivar`,
    comJson({ justificativa }, 'POST'),
  );

export const reativarEmpresa = (
  empresaId: string,
  justificativa: string,
): Promise<VisaoDaEmpresa> =>
  requisitar<VisaoDaEmpresa>(
    `${base(empresaId)}/reativar`,
    comJson({ justificativa }, 'POST'),
  );

export const compararComAFonte = (empresaId: string): Promise<ComparacaoComAFonte> =>
  requisitar<ComparacaoComAFonte>(`${base(empresaId)}/fonte-externa`);

export const aplicarDaFonte = (
  empresaId: string,
  campos: readonly string[],
): Promise<VisaoDaEmpresa> =>
  requisitar<VisaoDaEmpresa>(
    `${base(empresaId)}/fonte-externa`,
    comJson({ campos }, 'POST'),
  );

export const consultarHistorico = (filtro: FiltroDoHistorico): Promise<PaginaDoHistorico> => {
  const parametros = new URLSearchParams();

  if (filtro.aba !== null) parametros.set('aba', filtro.aba);
  if (filtro.empresaId !== null) parametros.set('empresaId', filtro.empresaId);
  if (filtro.inicio !== null) parametros.set('inicio', filtro.inicio);
  if (filtro.fim !== null) parametros.set('fim', filtro.fim);
  if (filtro.usuarioId !== null) parametros.set('usuarioId', filtro.usuarioId);
  if (filtro.campo !== null) parametros.set('campo', filtro.campo);

  parametros.set('limite', String(filtro.limite));
  parametros.set('deslocamento', String(filtro.deslocamento));

  return requisitar<PaginaDoHistorico>(`/historico?${parametros.toString()}`);
};

export const camposDoHistorico = (aba: AbaDoHistorico | null): Promise<readonly string[]> => {
  const parametros = new URLSearchParams();

  if (aba !== null) {
    parametros.set('aba', aba);
  }

  return requisitar<readonly string[]>(`/historico/campos?${parametros.toString()}`);
};
