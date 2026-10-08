/**
 * Chamadas ao backend de Notificações (SPEC-006).
 */
import { requisitar } from '@/lib/http';

export type TipoDeNotificacao =
  | 'NOVA_PENDENCIA'
  | 'DOCUMENTO_REJEITADO'
  | 'DOCUMENTO_VENCIDO'
  | 'NOVA_EXIGENCIA'
  // Aviso consolidado de mudança de carteira (SPEC-009): sem empresa, com o resumo da operação.
  | 'CARTEIRA_ALTERADA'
  // Alertas do cofre de certificados (SPEC-011 §3.6): um por marco e por certificado
  // (`CERTIFICADO_D30`, `CERTIFICADO_VENCIDO`, `CERTIFICADO_RESPONSAVEL_INCONSISTENTE`…).
  // Tolerante a marcos novos: o prefixo é o contrato, o sufixo só escolhe o rótulo.
  | `CERTIFICADO_${string}`
  // Incidente do Signer (SPEC-012 §3.10): aviso ao administrador, sem empresa; o de recuperação
  // traz a duração do incidente.
  | 'SIGNER_INDISPONIVEL'
  | 'SIGNER_RECUPERADO'
  // Fim do processamento de uma importação do plano de contas (SPEC-013 §3.10): só para quem
  // iniciou; traz a tentativa, o estado terminal e os totais em `importacao`.
  | 'IMPORTACAO_PLANO_CONTAS_CONCLUIDA';

export type EmpresaDoAviso = Readonly<{ id: string; nome: string; cnpj: string }>;

export type TotaisDaImportacaoNoAviso = Readonly<{
  lidas: number;
  novas: number;
  atualizadas: number;
  rejeitadas: number;
}>;

/** Desfecho da tentativa que o aviso abre; `totais` é nulo quando ela terminou em FALHA. */
export type ImportacaoNoAviso = Readonly<{
  tentativaId: string;
  /** CONCLUIDA, CONCLUIDA_COM_REJEICOES, REJEITADA ou FALHA; tolerante a estado novo. */
  estado: string;
  totais: TotaisDaImportacaoNoAviso | null;
}>;

export type Notificacao = Readonly<{
  id: string;
  empresaId: string | null;
  empresaNome: string | null;
  adicionadas: readonly EmpresaDoAviso[] | null;
  removidas: readonly EmpresaDoAviso[] | null;
  tipo: TipoDeNotificacao;
  chave: string;
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
  /** Só no `SIGNER_RECUPERADO`: quanto o incidente durou, em milissegundos. */
  duracaoMs?: number | null;
  /** Só no `IMPORTACAO_PLANO_CONTAS_CONCLUIDA`: a tentativa, o estado e os totais. */
  importacao?: ImportacaoNoAviso | null;
}>;

export type PainelDeNotificacoes = Readonly<{
  notificacoes: readonly Notificacao[];
  naoLidas: number;
  escopoDeEmpresas?: 'NENHUMA';
}>;

export type PaginaDeNotificacoes = Readonly<{
  notificacoes: readonly Notificacao[];
  total: number;
  escopoDeEmpresas?: 'NENHUMA';
}>;

const comJson = (corpo: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

export const buscarPainelDeNotificacoes = (): Promise<PainelDeNotificacoes> =>
  requisitar('/notificacoes/painel');

export const buscarHistoricoDeNotificacoes = (
  limite: number,
  deslocamento: number,
): Promise<PaginaDeNotificacoes> =>
  requisitar(`/notificacoes/historico?limite=${limite}&deslocamento=${deslocamento}`);

export const marcarNotificacaoComoLida = (notificacaoId: string): Promise<Notificacao> =>
  requisitar(`/notificacoes/${notificacaoId}/leitura`, comJson({}));

export const marcarNotificacoesComoLidas = (
  ids: readonly string[],
): Promise<{ marcadas: number }> =>
  requisitar('/notificacoes/leitura-em-lote', comJson({ ids }));
