import {
  VERSAO_DO_CONTRATO_DO_SIGNER,
  type ComandoAssinar,
  type ComandoDiagnosticar,
  type ComandoExecutarMtls,
  type ConsultaEstados,
  type ConsultaHistorico,
  type RespostaDeAssinatura,
  type RespostaDeExecucaoMtls,
  type RespostaDeSaude,
} from '@contaia/shared';

import type { IdentidadeDeServico } from './alcada.js';
import { ErroDoSigner } from './erro.js';
import type { LeitorDoVault } from './vault.js';

/**
 * As seis operações do contrato interno (SPEC-012 §6.2). O servidor HTTP só autentica, autoriza e
 * valida o contrato; tudo o que toca banco, Vault, XML e rede mora atrás desta interface.
 */
export type ServicosDoSigner = Readonly<{
  saude(): Promise<RespostaDeSaude>;
  assinar(identidade: IdentidadeDeServico, comando: ComandoAssinar): Promise<RespostaDeAssinatura>;
  executarMtls(identidade: IdentidadeDeServico, comando: ComandoExecutarMtls): Promise<RespostaDeExecucaoMtls>;
  diagnosticar(identidade: IdentidadeDeServico, comando: ComandoDiagnosticar): Promise<RespostaDeExecucaoMtls>;
  estados(identidade: IdentidadeDeServico, consulta: ConsultaEstados): Promise<unknown>;
  historico(identidade: IdentidadeDeServico, consulta: ConsultaHistorico): Promise<unknown>;
}>;

const naoImplementada = (): Promise<never> => Promise.reject(new ErroDoSigner('SIGNER_INDISPONIVEL', 501));

export type OpcoesDosServicosDeSaude = Readonly<{
  vault: Pick<LeitorDoVault, 'pronto'>;
  agora: () => Date;
}>;

/** Saúde real; as demais operações entram nas tarefas seguintes e até lá falham de forma explícita. */
export const criarServicosDeSaude = ({ vault, agora }: OpcoesDosServicosDeSaude): ServicosDoSigner => ({
  async saude() {
    const pronto = await vault.pronto();

    return {
      versaoDoContrato: VERSAO_DO_CONTRATO_DO_SIGNER,
      estado: pronto ? 'OPERACIONAL' : 'DEGRADADO',
      verificadoEm: agora().toISOString(),
    };
  },
  assinar: naoImplementada,
  executarMtls: naoImplementada,
  diagnosticar: naoImplementada,
  estados: naoImplementada,
  historico: naoImplementada,
});
