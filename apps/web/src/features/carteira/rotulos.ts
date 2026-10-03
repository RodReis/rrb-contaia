/**
 * Textos e formatos da carteira (SPEC-009): tudo em PT-BR, nunca o identificador
 * técnico da origem ou do estado. Datas em `America/Sao_Paulo` (I-11).
 */
import { formatarCnpj } from '@contaia/domain';
import type { EstadoDoUsuario } from '@contaia/domain';

import type { TomDoStatus } from '@/components/ui/status-badge';
import type { EmpresaResumida, OrigemDoEvento, SituacaoDaCarteira } from './api';

export const ROTULO_DO_ESTADO: Readonly<Record<EstadoDoUsuario, { rotulo: string; tom: TomDoStatus }>> =
  {
    CONVIDADO: { rotulo: 'Convidado', tom: 'processando' },
    ATIVO: { rotulo: 'Ativo', tom: 'conforme' },
    SUSPENSO: { rotulo: 'Suspenso', tom: 'atencao' },
    ARQUIVADO: { rotulo: 'Arquivado', tom: 'neutro' },
  };

export const ROTULO_DA_ORIGEM: Readonly<Record<OrigemDoEvento, string>> = {
  INDIVIDUAL: 'Atribuição individual',
  LOTE: 'Operação em lote',
  AUTOATRIBUICAO: 'Autoatribuição na criação da empresa',
  ARQUIVAMENTO_USUARIO: 'Arquivamento do usuário',
  ARQUIVAMENTO_EMPRESA: 'Arquivamento da empresa',
};

export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDaCarteira, string>> = {
  COM_EMPRESAS: 'Com empresas',
  SEM_EMPRESAS: 'Sem empresas',
};

export const cnpjFormatado = (cnpj: string): string => formatarCnpj(cnpj);

export const nomeDaEmpresa = (empresa: EmpresaResumida): string =>
  `${empresa.nome} (${cnpjFormatado(empresa.cnpj)})`;

export const formatarQuando = (isoString: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString));

export const plural = (quantidade: number, singular: string, plural: string): string =>
  `${quantidade.toLocaleString('pt-BR')} ${quantidade === 1 ? singular : plural}`;

/** Resumo curto de uma lista de empresas: nomeia até `limite` e conta o resto. */
export const resumirEmpresas = (empresas: readonly EmpresaResumida[], limite = 3): string => {
  const nomeadas = empresas.slice(0, limite).map((empresa) => empresa.nome);
  const resto = empresas.length - nomeadas.length;

  return resto > 0 ? `${nomeadas.join(', ')} e mais ${resto}` : nomeadas.join(', ');
};
