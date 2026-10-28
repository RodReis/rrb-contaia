export const CLASSES_CONTABEIS = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COMPENSATION', 'OTHER'] as const;
export type ClasseContabil = (typeof CLASSES_CONTABEIS)[number];
export type TipoCatalogo = 'ANALYTICAL' | 'SYNTHETIC';
export type PoliticaCentroCusto = 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN';

export type ItemHierarquico = Readonly<{ code: string; parentCode: string | null; type: TipoCatalogo; archived: boolean }>;

export type ErroCatalogo = 'ACCOUNTING_CATALOG_PARENT_INVALID' | 'ACCOUNTING_CATALOG_CYCLE' |
  'ACCOUNTING_CATALOG_ACTIVE_DESCENDANTS' | 'ACCOUNTING_ACCOUNT_HIERARCHY_INCOMPATIBLE' |
  'ACCOUNTING_ACCOUNT_COST_CENTER_POLICY_INVALID' | 'ACCOUNTING_ACCOUNT_CLASS_REQUIRED';

export const validarHierarquia = (
  item: ItemHierarquico,
  itens: readonly ItemHierarquico[],
  novaPolitica: PoliticaCentroCusto = 'FORBIDDEN',
): ErroCatalogo | null => {
  const pai = item.parentCode === null ? null : itens.find((candidato) => candidato.code === item.parentCode);
  if (item.parentCode !== null && (pai === null || pai === undefined || pai.archived)) return 'ACCOUNTING_CATALOG_PARENT_INVALID';
  if (pai !== null && pai !== undefined && pai.type === 'ANALYTICAL') return 'ACCOUNTING_ACCOUNT_HIERARCHY_INCOMPATIBLE';
  if (item.parentCode === item.code) return 'ACCOUNTING_CATALOG_CYCLE';

  const porCodigo = new Map(itens.map((candidato) => [candidato.code, candidato]));
  porCodigo.set(item.code, item);
  let ancestral = pai;
  const visitados = new Set([item.code]);
  while (ancestral !== null && ancestral !== undefined) {
    if (visitados.has(ancestral.code)) return 'ACCOUNTING_CATALOG_CYCLE';
    visitados.add(ancestral.code);
    ancestral = ancestral.parentCode === null ? null : porCodigo.get(ancestral.parentCode);
  }

  const descendentes = new Set([item.code]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const candidato of itens) {
      if (candidato.parentCode !== null && descendentes.has(candidato.parentCode) && !descendentes.has(candidato.code)) {
        descendentes.add(candidato.code);
        mudou = true;
      }
    }
  }
  const filhosAtivos = itens.some((candidato) => descendentes.has(candidato.code) && candidato.code !== item.code && !candidato.archived);
  if (item.type === 'ANALYTICAL' && filhosAtivos) return 'ACCOUNTING_ACCOUNT_HIERARCHY_INCOMPATIBLE';
  if (item.type === 'SYNTHETIC' && novaPolitica !== 'FORBIDDEN') return 'ACCOUNTING_ACCOUNT_COST_CENTER_POLICY_INVALID';
  return null;
};

export const statusDaConta = (classe: ClasseContabil | null, arquivada: boolean): 'ACTIVE' | 'INCOMPLETE' | 'ARCHIVED' =>
  arquivada ? 'ARCHIVED' : classe === null ? 'INCOMPLETE' : 'ACTIVE';