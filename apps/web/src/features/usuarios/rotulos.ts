/**
 * Textos e tons da área de usuários (SPEC-007 §5): tudo em PT-BR, nunca o
 * identificador técnico do papel, da ação ou do evento.
 */
import type { Acao, Capacidade, PapelPadrao, SituacaoApresentada } from '@contaia/domain';

import type { TomDoStatus } from '@/components/ui/status-badge';
import type { PermissoesPorCapacidade } from './api';

export const ROTULO_DO_PAPEL: Readonly<Record<PapelPadrao, string>> = {
  admin_escritorio: 'Administrador do escritório',
  contador: 'Contador',
  auxiliar: 'Auxiliar',
  auditor_readonly: 'Auditor (somente leitura)',
};

export const DESCRICAO_DO_PAPEL: Readonly<Record<PapelPadrao, string>> = {
  admin_escritorio:
    'Convida e administra usuários, edita o cadastro do escritório e responde por todas as empresas.',
  contador: 'Cria e mantém empresas clientes, documentos e pendências; consulta o histórico.',
  auxiliar: 'Cria e edita empresas e trabalha documentos e pendências; não arquiva empresas.',
  auditor_readonly: 'Consulta tudo o que o escritório registra, sem alterar nada.',
};

export const ROTULO_DA_CAPACIDADE: Readonly<Record<Capacidade, string>> = {
  CADASTRO_ESCRITORIO: 'Cadastro do escritório',
  EMPRESAS: 'Empresas',
  DOCUMENTOS: 'Documentos da empresa',
  PENDENCIAS: 'Central de Pendências',
  NOTIFICACOES: 'Notificações de pendências',
  HISTORICO: 'Histórico de Informações',
  USUARIOS: 'Usuários e papéis',
};

export const ROTULO_DA_ACAO: Readonly<Record<Acao, string>> = {
  consultar: 'Consultar',
  criar: 'Criar',
  editar: 'Editar',
  arquivar: 'Arquivar e reativar',
  administrar: 'Administrar',
};

export const TIPOS_DE_EVENTO = [
  'CONVITE_CRIADO',
  'CONVITE_REENVIADO',
  'CONVITE_ACEITO',
  'CONVITE_EXPIRADO',
  'EMAIL_DE_CONVITE_CORRIGIDO',
  'DADOS_E_PAPEIS_ALTERADOS',
  'SUSPENSO',
  'REATIVADO',
  'ARQUIVADO',
  'NOVO_CONVITE_INICIADO',
] as const;

export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

export const ROTULO_DO_EVENTO: Readonly<Record<TipoDeEvento, string>> = {
  CONVITE_CRIADO: 'Convite criado',
  CONVITE_REENVIADO: 'Convite reenviado',
  CONVITE_ACEITO: 'Convite aceito',
  CONVITE_EXPIRADO: 'Convite expirado',
  EMAIL_DE_CONVITE_CORRIGIDO: 'E-mail do convite corrigido',
  DADOS_E_PAPEIS_ALTERADOS: 'Dados e papéis alterados',
  SUSPENSO: 'Usuário suspenso',
  REATIVADO: 'Usuário reativado',
  ARQUIVADO: 'Usuário arquivado',
  NOVO_CONVITE_INICIADO: 'Novo convite iniciado',
};

export const SITUACAO: Readonly<Record<SituacaoApresentada, { rotulo: string; tom: TomDoStatus }>> =
  {
    CONVIDADO: { rotulo: 'Convidado', tom: 'processando' },
    CONVITE_EXPIRADO: { rotulo: 'Convite expirado', tom: 'atencao' },
    ATIVO: { rotulo: 'Ativo', tom: 'conforme' },
    SUSPENSO: { rotulo: 'Suspenso', tom: 'critico' },
    ARQUIVADO: { rotulo: 'Arquivado', tom: 'neutro' },
  };

export type AcaoDaLinha = 'editar' | 'reenviar' | 'suspender' | 'reativar' | 'arquivar' | 'novo-convite';

/** O que cada situação permite ao administrador, na ordem em que aparece na linha. */
export const acoesDaLinha = (situacao: SituacaoApresentada): readonly AcaoDaLinha[] => {
  switch (situacao) {
    case 'CONVIDADO':
    case 'CONVITE_EXPIRADO':
      return ['editar', 'reenviar'];
    case 'ATIVO':
      return ['editar', 'suspender', 'arquivar'];
    case 'SUSPENSO':
      return ['editar', 'reativar', 'arquivar'];
    case 'ARQUIVADO':
      return ['novo-convite'];
  }
};

const CAPACIDADES: readonly Capacidade[] = [
  'CADASTRO_ESCRITORIO',
  'EMPRESAS',
  'DOCUMENTOS',
  'PENDENCIAS',
  'NOTIFICACOES',
  'HISTORICO',
  'USUARIOS',
];

/** Só o que o papel concede, com os nomes por extenso: a aba de papéis é leitura. */
export const descreverPermissoes = (
  permissoes: PermissoesPorCapacidade,
): ReadonlyArray<{ capacidade: string; acoes: readonly string[] }> =>
  CAPACIDADES.filter((capacidade) => permissoes[capacidade].length > 0).map((capacidade) => ({
    capacidade: ROTULO_DA_CAPACIDADE[capacidade],
    acoes: permissoes[capacidade].map((acao) => ROTULO_DA_ACAO[acao]),
  }));
