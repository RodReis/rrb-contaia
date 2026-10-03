/**
 * Das linhas do banco para o contrato público do cofre (`@contaia/shared`).
 *
 * É aqui que se garante que NADA sensível sai: o mapeador copia campo a campo, então
 * `referenciaSegredo` (UUID opaco do Vault) não vaza por spread acidental, e não existe
 * nenhum campo de arquivo, senha, chave ou token no tipo de saída.
 */
import type { ItemDoCofreBruto, VersaoDoCertificado } from '@contaia/db';
import {
  acoesDoCofre,
  type ChaveDePermissao,
  type PapelPadrao,
  type SituacaoDoResponsavel,
} from '@contaia/domain';
import type { CertificadoMetadados, ItemDoCofre } from '@contaia/shared';

export type SessaoDoCofre = Readonly<{
  tenantId: string;
  usuarioId: string;
  papeis: readonly PapelPadrao[];
  permissoes: readonly ChaveDePermissao[];
}>;

export const paraMetadados = (versao: VersaoDoCertificado): CertificadoMetadados => ({
  id: versao.id,
  versao: versao.versao,
  estado: versao.estado,
  titular: versao.titular,
  cnpjTitular: versao.cnpjTitular,
  autoridadeCertificadora: versao.autoridadeCertificadora,
  impressaoDigital: versao.impressaoDigital,
  numeroSerie: versao.numeroSerie,
  validoDe: versao.validoDe,
  validoAte: versao.validoAte,
  responsavelId: versao.responsavelId,
  cadastradoEm: versao.cadastradoEm,
  cadastradoPorId: versao.cadastradoPorId,
  encerradoEm: versao.encerradoEm,
  encerradoPorId: versao.encerradoPorId,
  motivoDoEncerramento: versao.motivoDoEncerramento,
  justificativa: versao.justificativa,
  substituidoPorId: versao.substituidoPorId,
});

export const paraItem = (
  bruto: ItemDoCofreBruto,
  sessao: SessaoDoCofre,
  situacaoDoResponsavel: SituacaoDoResponsavel | null,
): ItemDoCofre => ({
  empresaId: bruto.empresaId,
  empresaNome: bruto.empresaNome,
  cnpj: bruto.cnpj,
  regime: bruto.regime,
  estado: bruto.estado,
  diasParaVencer: bruto.diasParaVencer,
  semResponsavel: bruto.semResponsavel,
  certificado: bruto.certificado === null ? null : paraMetadados(bruto.certificado),
  responsavel:
    bruto.responsavel === null
      ? null
      : { ...bruto.responsavel, situacao: situacaoDoResponsavel ?? 'ATIVO' },
  acoes: acoesDoCofre({
    papeis: sessao.papeis,
    permissoes: sessao.permissoes,
    temVigente: bruto.certificado?.estado === 'VIGENTE',
    empresaArquivada: bruto.empresaArquivada || !bruto.empresaAtiva,
  }),
});
