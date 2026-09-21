/** Chamadas ao backend da empresa cliente. */
import type {
  CadastroDaEmpresa,
  EtapaDaEmpresa,
  RegimeTributario,
  SituacaoDeRegistro,
  StatusDaEmpresa,
} from '@contaia/domain';
import type { DadosPublicosDoCnpj, MotivoDeFalhaDaConsulta } from '@contaia/shared';

import { requisitar } from '@/lib/http';
import type {
  DadosFiscaisValidados,
  EnderecoDaEmpresaForm,
  IdentificacaoDaEmpresaForm,
} from './schema';

export type VisaoDaEmpresa = Readonly<{
  id: string;
  cadastro: CadastroDaEmpresa;
  situacao: SituacaoDeRegistro;
  etapasConcluidas: readonly EtapaDaEmpresa[];
  proximaEtapa: EtapaDaEmpresa | null;
  podeAtivar: boolean;
  exigeConfirmacaoDeSituacaoExterna: boolean;
}>;

export type EmpresaNaLista = Readonly<{
  id: string;
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  regimeTributario: RegimeTributario | null;
  status: StatusDaEmpresa;
  /** `arquivado` não é um status: é a situação do registro (SPEC-003 §3.1). */
  situacao: SituacaoDeRegistro;
  /** Contagem de pendências cadastrais abertas (SPEC-005, já enviada desde a Task 6a). */
  pendenciasAbertas: number;
}>;

/** O que a lista oferece como filtro; `ARQUIVADA` cruza status e situação. */
export type FiltroDeStatus = StatusDaEmpresa | 'ARQUIVADA';

export type ListaDeEmpresas = Readonly<{
  empresas: readonly EmpresaNaLista[];
  total: number;
}>;

export type FiltroDaLista = Readonly<{
  busca: string | null;
  status: FiltroDeStatus | null;
  limite: number;
  deslocamento: number;
}>;

export type ResultadoDaConsultaDeCnpj =
  | Readonly<{ situacao: 'existente'; empresaId: string; status: StatusDaEmpresa }>
  | Readonly<{ situacao: 'consultado'; cnpj: string; dados: DadosPublicosDoCnpj }>
  | Readonly<{ situacao: 'sem_fonte'; cnpj: string; motivo: MotivoDeFalhaDaConsulta }>;

const comJson = (corpo: unknown, method: 'PUT' | 'POST' = 'PUT'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

export const listarEmpresas = (filtro: FiltroDaLista): Promise<ListaDeEmpresas> => {
  const parametros = new URLSearchParams();

  if (filtro.busca !== null && filtro.busca.length > 0) {
    parametros.set('busca', filtro.busca);
  }

  if (filtro.status !== null) {
    parametros.set('status', filtro.status);
  }

  parametros.set('limite', String(filtro.limite));
  parametros.set('deslocamento', String(filtro.deslocamento));

  return requisitar(`/empresas?${parametros.toString()}`);
};

export const obterEmpresa = (empresaId: string): Promise<VisaoDaEmpresa> =>
  requisitar(`/empresas/${empresaId}`);

export const consultarCnpj = (cnpj: string): Promise<ResultadoDaConsultaDeCnpj> =>
  // O CNPJ vai sem máscara: o caractere `/` do formato mascarado quebraria a rota.
  requisitar(`/empresas/consulta-cnpj/${cnpj.replace(/\D/gu, '')}`);

export const criarEmpresa = (cnpj: string): Promise<VisaoDaEmpresa> =>
  requisitar('/empresas', comJson({ cnpj }, 'POST'));

export const salvarIdentificacaoDaEmpresa = (
  empresaId: string,
  dados: IdentificacaoDaEmpresaForm,
): Promise<VisaoDaEmpresa> =>
  requisitar(
    `/empresas/${empresaId}/identificacao`,
    comJson({
      razaoSocial: dados.razaoSocial,
      nomeFantasia: dados.nomeFantasia,
      telefone: dados.telefone === undefined || dados.telefone === '' ? null : dados.telefone,
      email: dados.email === undefined || dados.email === '' ? null : dados.email,
    }),
  );

export const salvarDadosFiscais = (
  empresaId: string,
  dados: DadosFiscaisValidados,
): Promise<VisaoDaEmpresa> =>
  requisitar(
    `/empresas/${empresaId}/fiscal`,
    comJson({
      regimeTributario: dados.regimeTributario,
      enquadramentoSimples: dados.enquadramentoSimples ?? null,
      cnaePrincipal: dados.cnaePrincipal,
      cnaesSecundarios: dados.cnaesSecundarios,
      inscricaoEstadual: {
        situacao: dados.inscricaoEstadual.situacao,
        numero: dados.inscricaoEstadual.numero ?? null,
      },
      inscricaoMunicipal: {
        situacao: dados.inscricaoMunicipal.situacao,
        numero: dados.inscricaoMunicipal.numero ?? null,
      },
    }),
  );

export const salvarEnderecoDaEmpresa = (
  empresaId: string,
  dados: EnderecoDaEmpresaForm,
): Promise<VisaoDaEmpresa> =>
  requisitar(
    `/empresas/${empresaId}/endereco`,
    comJson({ ...dados, complemento: dados.complemento ?? null }),
  );

export const ativarEmpresa = (
  empresaId: string,
  situacaoExternaConfirmada: boolean,
): Promise<VisaoDaEmpresa> =>
  requisitar(`/empresas/${empresaId}/ativar`, comJson({ situacaoExternaConfirmada }, 'POST'));
