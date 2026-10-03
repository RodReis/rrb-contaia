/**
 * Textos e tons da área de usuários (SPEC-007 §5, SPEC-008 §5): tudo em PT-BR,
 * nunca o identificador técnico do papel, da ação ou do evento. Os rótulos de
 * módulo, funcionalidade e ação vêm do catálogo do servidor, não daqui.
 */
import type { PapelPadrao, SituacaoApresentada } from '@contaia/domain';

import type { TomDoStatus } from '@/components/ui/status-badge';

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
  'PAPEL_CRIADO',
  'PAPEL_DADOS_ALTERADOS',
  'PAPEL_MATRIZ_ALTERADA',
  'PAPEL_ARQUIVADO',
  'PAPEL_REATIVADO',
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
  PAPEL_CRIADO: 'Papel criado',
  PAPEL_DADOS_ALTERADOS: 'Dados do papel alterados',
  PAPEL_MATRIZ_ALTERADA: 'Permissões do papel alteradas',
  PAPEL_ARQUIVADO: 'Papel arquivado',
  PAPEL_REATIVADO: 'Papel reativado',
};

/** Evento de papel nomeia o papel; os demais nomeiam o usuário (SPEC-008 §3.6). */
export const ehEventoDePapel = (tipo: string): boolean => tipo.startsWith('PAPEL_');

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
