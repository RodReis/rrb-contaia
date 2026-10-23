export type RegistroDevolucaoEfd = Readonly<{
  accessKey: string;
  documentNumber: string;
  series: string;
  date: string;
  efdDate: string | null;
  itemNumber: string;
  productCode: string;
  description: string;
  ncm: string | null;
  cest: string | null;
  unit: string;
  quantity: string;
  total: string;
  cfop: string;
  referencedOutputKeys: readonly string[];
}>;

export type FalhaEfdDevolucao =
  | 'EFD_FILE_INVALID'
  | 'EFD_LAYOUT_INVALID'
  | 'EFD_RETURN_NOT_FOUND'
  | 'EFD_RETURN_AMBIGUOUS';

const dataEfdParaIso = (value: string | undefined): string | null => {
  if (!value || !/^\d{8}$/u.test(value)) return null;
  const result = `${value.slice(4, 8)}-${value.slice(2, 4)}-${value.slice(0, 2)}`;
  const date = new Date(`${result}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === result ? result : null;
};

const decimalEfdValido = (value: string | undefined): string | null => {
  if (!value || !/^\d+(?:,\d+)?$/u.test(value)) return null;
  const normalized = value.replace(',', '.');
  return /^\d+(?:\.\d+)?$/u.test(normalized) ? normalized : null;
};

/**
 * Lê registros C100/C113/C170 e cadastros 0190/0200 de um TXT EFD.
 * Não interpreta imposto nem declara o arquivo autenticado; preserva somente
 * identidade e quantidade para posterior conferência humana.
 */
export const localizarDevolucaoEfd = (
  bytes: Uint8Array,
  input: Readonly<{ accessKey: string; itemNumber: string; originalOutputAccessKey: string }>,
): RegistroDevolucaoEfd => {
  if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) throw new Error('EFD_FILE_INVALID' satisfies FalhaEfdDevolucao);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  if (text.includes('\0') || !text.includes('|')) throw new Error('EFD_FILE_INVALID' satisfies FalhaEfdDevolucao);
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length > 250_000 || lines.some((line) => line.length > 16_384)) throw new Error('EFD_FILE_INVALID' satisfies FalhaEfdDevolucao);

  const products = new Map<string, Readonly<{ ncm: string | null; cest: string | null }>>();
  const units = new Set<string>();
  let current: { model: string; accessKey: string; number: string; series: string; date: string; efdDate: string | null; refs: string[]; items: RegistroDevolucaoEfd[] } | null = null;
  const matches: RegistroDevolucaoEfd[] = [];
  let sawRecord = false;
  for (const line of lines) {
    const fields = line.split('|');
    if (fields[0] !== '' || fields.at(-1) !== '' || !fields[1]) throw new Error('EFD_LAYOUT_INVALID' satisfies FalhaEfdDevolucao);
    const record = fields[1];
    sawRecord = true;
    if (record === '0190') {
      if (!fields[2]) throw new Error('EFD_LAYOUT_INVALID' satisfies FalhaEfdDevolucao);
      units.add(fields[2]);
    } else if (record === '0200') {
      const code = fields[2];
      if (!code) throw new Error('EFD_LAYOUT_INVALID' satisfies FalhaEfdDevolucao);
      products.set(code, { ncm: /^\d{8}$/u.test(fields[8] ?? '') ? fields[8]! : null, cest: /^\d{7}$/u.test(fields[13] ?? '') ? fields[13]! : null });
    } else if (record === 'C100') {
      if (current) matches.push(...current.items.filter((item) => current?.model === '55' && item.accessKey === input.accessKey &&
        item.itemNumber === input.itemNumber).map((item) => ({ ...item, referencedOutputKeys: [...current!.refs] })));
      if ((fields[5] ?? '') !== '55') { current = null; continue; }
      const key = fields[9] ?? '';
      const date = dataEfdParaIso(fields[10]);
      const efdDate = dataEfdParaIso(fields[11]);
      if (!/^\d{44}$/u.test(key) || !date || !(fields[8] ?? '').trim()) throw new Error('EFD_LAYOUT_INVALID' satisfies FalhaEfdDevolucao);
      current = { model: fields[5] ?? '', accessKey: key, number: fields[8]!, series: fields[7] ?? '', date, efdDate, refs: [], items: [] };
    } else if (record === 'C113' && current) {
      const reference = fields[10] ?? '';
      if (/^\d{44}$/u.test(reference)) current.refs.push(reference);
    } else if (record === 'C170' && current) {
      const itemNumber = fields[2] ?? '';
      const productCode = fields[3] ?? '';
      const unit = fields[6] ?? '';
      const quantity = decimalEfdValido(fields[5]);
      const total = decimalEfdValido(fields[7]);
      const cfop = fields[11] ?? '';
      if (!/^\d{1,3}$/u.test(itemNumber) || !productCode || !unit || !units.has(unit) ||
          quantity === null || total === null || !/^\d{4}$/u.test(cfop)) throw new Error('EFD_LAYOUT_INVALID' satisfies FalhaEfdDevolucao);
      const product = products.get(productCode);
      current.items.push({
        accessKey: current.accessKey, documentNumber: current.number, series: current.series, date: current.date, efdDate: current.efdDate,
        itemNumber, productCode, description: fields[4] ?? productCode, ncm: product?.ncm ?? null, cest: product?.cest ?? null,
        unit, quantity, total, cfop, referencedOutputKeys: [],
      });
    }
  }
  if (current) matches.push(...current.items.filter((item) => current?.model === '55' && item.accessKey === input.accessKey &&
    item.itemNumber === input.itemNumber).map((item) => ({ ...item, referencedOutputKeys: [...current!.refs] })));
  if (!sawRecord) throw new Error('EFD_LAYOUT_INVALID' satisfies FalhaEfdDevolucao);
  const selected = matches.filter((item) => item.referencedOutputKeys.includes(input.originalOutputAccessKey));
  if (matches.length === 0) throw new Error('EFD_RETURN_NOT_FOUND' satisfies FalhaEfdDevolucao);
  if (matches.length !== 1 || selected.length !== 1) throw new Error('EFD_RETURN_AMBIGUOUS' satisfies FalhaEfdDevolucao);
  return selected[0]!;
};
