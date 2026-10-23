export type IcmsStC002Input = Readonly<{
  competence: string;
  returnDate: string;
  efdDate: string | null;
  returnDocumentNumber: string;
  returnAccessKey: string;
  returnModel: '55' | '65';
  returnSeries: string;
  returnCfop: string;
  ncm: string | null;
  itemNumber: number;
  productCode: string;
  productDescription: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  total: string;
  originalDocumentNumber: string | null;
  originalAccessKey: string | null;
  originalDate: string | null;
  reversedRestitutionCents: number;
  reversedComplementCents: number;
}>;

const dateCompact = (value: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value.replaceAll('-', '') : null;
};

const decimal = (value: string, scale: number): string | null => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  if (integer === undefined || fraction.length > scale) return null;
  return fraction.length === 0 ? integer : `${integer},${fraction}`;
};

const money = (cents: number): string | null => {
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
};

/** Serializes the official Goiás C002 return/reversal row; null means evidence is incomplete. */
export const renderIcmsStC002 = (input: IcmsStC002Input): string | null => {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(input.competence) || !/^\d{1,20}$/u.test(input.returnDocumentNumber) ||
      !/^\d{44}$/u.test(input.returnAccessKey) || !/^[A-Za-z0-9]{1,20}$/u.test(input.returnSeries) ||
      !/^\d{4}$/u.test(input.returnCfop) || input.ncm !== null && !/^\d{8}$/u.test(input.ncm) ||
      !Number.isSafeInteger(input.itemNumber) || input.itemNumber < 1 || input.itemNumber > 999 ||
      input.productCode.trim().length === 0 || input.productDescription.trim().length === 0 ||
      input.unit.trim().length === 0 || input.productCode.includes('|') || input.productDescription.includes('|') || input.unit.includes('|')) return null;
  const issueDate = dateCompact(input.returnDate);
  const efdDate = input.efdDate === null ? '' : dateCompact(input.efdDate);
  const originalDate = input.originalDate === null ? '' : dateCompact(input.originalDate);
  const quantity = decimal(input.quantity, 3);
  const unitPrice = decimal(input.unitPrice, 3);
  const total = decimal(input.total, 2);
  const restitution = money(input.reversedRestitutionCents);
  const complement = money(input.reversedComplementCents);
  if (issueDate === null || efdDate === null || originalDate === null || quantity === null || unitPrice === null ||
      total === null || restitution === null || complement === null ||
      (input.originalDocumentNumber !== null && !/^\d{1,20}$/u.test(input.originalDocumentNumber)) ||
      (input.originalAccessKey !== null && !/^\d{44}$/u.test(input.originalAccessKey))) return null;
  return ['C002', input.competence.replace('-', ''), issueDate, efdDate, input.returnDocumentNumber, input.returnAccessKey,
    input.returnModel, input.returnSeries, input.returnCfop, input.ncm ?? '', String(input.itemNumber), input.productCode,
    input.productDescription, input.unit, quantity, unitPrice, total, input.originalDocumentNumber ?? '',
    input.originalAccessKey ?? '', originalDate, restitution, complement].join('|').replace(/^/u, '|').concat('|');
};
