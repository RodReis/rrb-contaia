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
  | `CERTIFICADO_${string}`;

export type EmpresaDoAviso = Readonly<{ id: string; nome: string; cnpj: string }>;

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
