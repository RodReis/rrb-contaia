export const VERSAO_DO_CATALOGO_RFB = 1 as const;

export const CATALOGO_DE_PODERES_RFB = [
  { code: 'RFB_CNPJ_STATUS_READ', label: 'Consultar situação cadastral do CNPJ' },
  { code: 'RFB_TAX_CLEARANCE_CERTIFICATE_READ', label: 'Consultar certidão de regularidade fiscal' },
  { code: 'RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE', label: 'Emitir certidão de regularidade fiscal' },
] as const;

export type PoderRfb = (typeof CATALOGO_DE_PODERES_RFB)[number]['code'];
export type EstadoDaProcuracao = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type MarcoDaProcuracao = 'D30' | 'D7' | 'VENCIMENTO';

export type ProcuracaoParaAutorizacao = Readonly<{
  tenantId: string;
  empresaId: string;
  status: EstadoDaProcuracao;
  arquivada: boolean;
  validFrom: string;
  validUntil: string;
  poderes: readonly PoderRfb[];
}>;

type FalhaDaProcuracao = Readonly<{ ok: false; code: string }>;
type SucessoDaProcuracao = Readonly<{ ok: true }>;

const PODERES_VALIDOS: ReadonlySet<string> = new Set(CATALOGO_DE_PODERES_RFB.map(({ code }) => code));

const diaUtc = (data: string): number => {
  const [ano, mes, dia] = data.split('-').map(Number);
  return Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1);
};

export const validarPoderesRfb = (
  poderes: readonly string[],
): SucessoDaProcuracao | FalhaDaProcuracao => {
  if (
    poderes.length === 0 ||
    new Set(poderes).size !== poderes.length ||
    poderes.some((poder) => !PODERES_VALIDOS.has(poder))
  ) {
    return { ok: false, code: 'PODER_RFB_INVALIDO' };
  }

  return { ok: true };
};

export const periodosSobrepostos = (
  inicio: string,
  fim: string,
  outroInicio: string,
  outroFim: string,
): boolean => inicio <= outroFim && fim >= outroInicio;

export const estadoDaProcuracao = (
  estado: EstadoDaProcuracao,
  validFrom: string,
  validUntil: string,
  hoje: string,
): EstadoDaProcuracao => {
  if (estado === 'DRAFT' || estado === 'REVOKED' || estado === 'EXPIRED') return estado;
  if (hoje < validFrom) return 'SCHEDULED';
  if (hoje > validUntil) return 'EXPIRED';
  return 'ACTIVE';
};

export const autorizarOperacaoRfb = (entrada: Readonly<{
  procuracao: ProcuracaoParaAutorizacao;
  tenantId: string;
  empresaId: string;
  usuarioNaCarteira: boolean;
  poder: PoderRfb;
  hoje: string;
}>): SucessoDaProcuracao | FalhaDaProcuracao => {
  const { procuracao, tenantId, empresaId, usuarioNaCarteira, poder, hoje } = entrada;
  if (procuracao.tenantId !== tenantId || procuracao.empresaId !== empresaId) {
    return { ok: false, code: 'ESCOPO_DIVERGENTE' };
  }
  if (!usuarioNaCarteira) return { ok: false, code: 'SEM_ACESSO_A_CARTEIRA' };

  if (hoje < procuracao.validFrom || hoje > procuracao.validUntil) {
    return { ok: false, code: 'PROCURACAO_FORA_DA_VIGENCIA' };
  }
  const estado = estadoDaProcuracao(
    procuracao.status,
    procuracao.validFrom,
    procuracao.validUntil,
    hoje,
  );
  if (estado !== 'ACTIVE' || procuracao.arquivada) {
    return { ok: false, code: 'PROCURACAO_INATIVA' };
  }
  if (!procuracao.poderes.includes(poder)) {
    return { ok: false, code: 'PODER_NAO_CONCEDIDO' };
  }

  return { ok: true };
};

export const marcosDeAlertaDaProcuracao = (validUntil: string, hoje: string): readonly MarcoDaProcuracao[] => {
  const diasRestantes = (diaUtc(validUntil) - diaUtc(hoje)) / 86_400_000;
  if (diasRestantes === 30) return ['D30'];
  if (diasRestantes === 7) return ['D7'];
  if (diasRestantes === 0) return ['VENCIMENTO'];
  return [];
};
