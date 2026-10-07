/**
 * Dados e atalhos de prova das telas do Signer (SPEC-012 §5). Só os testes importam daqui.
 * Nenhum valor imita segredo: o contrato do painel não tem campo para isso, e as provas
 * conferem exatamente essa ausência.
 */
import type {
  EstadoDaEmpresaNoSigner,
  EstadoPorFinalidade,
  HistoricoPublicoDoSigner,
  ItemDoHistoricoPublico,
  PainelDoServicoSigner,
  ResultadoDoTesteManual,
} from '@contaia/shared';

import { SESSAO_DO_COFRE } from '../cofre.fixtures';

export const SESSAO_COM_SIGNER = {
  ...SESSAO_DO_COFRE,
  permissoes: [
    ...SESSAO_DO_COFRE.permissoes,
    'certificados.signer.consultar',
    'certificados.signer.testar',
  ],
} as const;

export const SESSAO_SIGNER_SO_CONSULTA = {
  ...SESSAO_DO_COFRE,
  papeis: ['auxiliar'],
  permissoes: [...SESSAO_DO_COFRE.permissoes, 'certificados.signer.consultar'],
} as const;

export const PAINEL_OPERACIONAL: PainelDoServicoSigner = {
  estado: 'OPERACIONAL',
  desatualizado: false,
  ultimaVerificacaoEm: '2026-10-07T15:04:00.000Z',
  ultimaLatenciaMs: 9,
  incidenteAberto: false,
};

export const PAINEL_DEGRADADO: PainelDoServicoSigner = {
  ...PAINEL_OPERACIONAL,
  estado: 'DEGRADADO',
  ultimaLatenciaMs: 11,
};

export const PAINEL_INDISPONIVEL: PainelDoServicoSigner = {
  ...PAINEL_OPERACIONAL,
  estado: 'INDISPONIVEL',
  incidenteAberto: true,
  ultimaLatenciaMs: 7,
};

export const finalidade = (
  sobrescritas: Partial<EstadoPorFinalidade> & Pick<EstadoPorFinalidade, 'finalidade'>,
): EstadoPorFinalidade => ({
  estado: 'OPERACIONAL',
  ultimoTesteEm: '2026-10-07T14:30:00.000Z',
  latenciaMs: 12,
  codigo: null,
  ...sobrescritas,
});

export const estadoDaEmpresa = (
  empresaId: string,
  sobrescritas: Partial<EstadoDaEmpresaNoSigner> = {},
): EstadoDaEmpresaNoSigner => ({
  empresaId,
  finalidades: [finalidade({ finalidade: 'DFE_TESTE' }), finalidade({ finalidade: 'ESOCIAL_TESTE', latenciaMs: 15 })],
  resumo: 'OPERACIONAL',
  ...sobrescritas,
});

export const estadoComFalhaNoEsocial = (empresaId: string): EstadoDaEmpresaNoSigner =>
  estadoDaEmpresa(empresaId, {
    resumo: 'FALHA',
    finalidades: [
      finalidade({ finalidade: 'DFE_TESTE' }),
      finalidade({
        finalidade: 'ESOCIAL_TESTE',
        estado: 'FALHA',
        codigo: 'SIGNER_MTLS_RECUSADO',
        latenciaMs: null,
      }),
    ],
  });

export const estadoSemCertificado = (empresaId: string): EstadoDaEmpresaNoSigner =>
  estadoDaEmpresa(empresaId, {
    resumo: 'SEM_CERTIFICADO',
    finalidades: [
      finalidade({ finalidade: 'DFE_TESTE', estado: 'SEM_CERTIFICADO', ultimoTesteEm: null, latenciaMs: null }),
      finalidade({ finalidade: 'ESOCIAL_TESTE', estado: 'SEM_CERTIFICADO', ultimoTesteEm: null, latenciaMs: null }),
    ],
  });

export const estadoNaoTestado = (empresaId: string): EstadoDaEmpresaNoSigner =>
  estadoDaEmpresa(empresaId, {
    resumo: 'NAO_TESTADO',
    finalidades: [
      finalidade({ finalidade: 'DFE_TESTE', estado: 'NAO_TESTADO', ultimoTesteEm: null, latenciaMs: null }),
      finalidade({ finalidade: 'ESOCIAL_TESTE', estado: 'NAO_TESTADO', ultimoTesteEm: null, latenciaMs: null }),
    ],
  });

export const itemDoHistorico = (
  sobrescritas: Partial<ItemDoHistoricoPublico> & Pick<ItemDoHistoricoPublico, 'id'>,
): ItemDoHistoricoPublico => ({
  finalidade: 'DFE_TESTE',
  resultado: 'SUCESSO',
  codigo: null,
  iniciadoEm: '2026-10-07T14:30:00.000Z',
  latenciaMs: 12,
  reutilizado: false,
  origemDiagnostico: 'MANUAL',
  identidadeTecnica: 'urn:contaia:servico:api',
  correlationId: 'corr-historico-0001',
  ...sobrescritas,
});

export const historico = (
  itens: readonly ItemDoHistoricoPublico[],
  sobrescritas: Partial<HistoricoPublicoDoSigner> = {},
): HistoricoPublicoDoSigner => ({
  pagina: 1,
  itensPorPagina: 15,
  total: itens.length,
  itens,
  ...sobrescritas,
});

export const resultadoDoTeste = (
  sobrescritas: Partial<ResultadoDoTesteManual> & Pick<ResultadoDoTesteManual, 'finalidade'>,
): ResultadoDoTesteManual => ({
  resultado: 'SUCESSO',
  codigo: null,
  correlationId: 'corr-teste-0001',
  ...sobrescritas,
});
