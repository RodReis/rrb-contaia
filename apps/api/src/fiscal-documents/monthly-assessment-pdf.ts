const escapePdf = (value: string) => value.replace(/[—–]/gu, '-').replace(/[^\x20-\xff]/gu, '?').replace(/\\/gu, '\\\\').replace(/\(/gu, '\\(').replace(/\)/gu, '\\)');
const linesOf = (value: unknown, contribution?: 'PIS_PASEP' | 'COFINS'): string[] => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['Avaliação indisponível'];
  const data = value as Record<string, unknown>;
  const isF37 = data['kind'] === 'LUCRO_PRESUMIDO_PIS_COFINS';
  const payable = contribution === 'PIS_PASEP' ? data['pisPayableCents'] : contribution === 'COFINS' ? data['cofinsPayableCents'] : null;
  const components = Array.isArray(data['components']) ? data['components'].filter((raw) => {
    if (contribution === undefined || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return true;
    return (raw as Record<string, unknown>)['contribution'] === contribution;
  }) : [];
  const lines = [
    contribution === undefined ? 'ContaIA | Apuracao fiscal mensal | Rascunho local nao oficial' :
      `ContaIA | Rascunho local de DARF ${contribution} | NAO OFICIAL / SEM CODIGO PAGAVEL`,
    `Avaliacao ${String(data['assessmentId'] ?? '')} | Competencia ${String(data['competence'] ?? '')} | Estado ${String(data['status'] ?? '')}`,
    `Trilha ${String(data['kind'] ?? '')} | Pacote ${String(data['rulePackageVersion'] ?? '')} | Revisao criada UTC ${String(data['revisionCreatedAtUtc'] ?? '')}`,
    isF37 && contribution === undefined ? `PIS/Pasep: ${String(data['pisPayableCents'] ?? 'indeterminado')} centavos | Cofins: ${String(data['cofinsPayableCents'] ?? 'indeterminado')} centavos` :
      contribution !== undefined ? `Valor preliminar ${String(payable ?? 'indeterminado')} centavos | Nao pagavel` :
        `Total em centavos: ${String(data['totalCents'] ?? 'indeterminado')}`,
    `Hash SHA-256 ${String(data['canonicalJsonHash'] ?? '')}`,
    'Documento interno de revisao. Nao transmite, emite guia oficial ou habilita pagamento.',
    'Componentes:',
    ...(components.length > 0 ? components.map((raw) => {
      const item = raw as Record<string, unknown>;
      return `${String(item['code'])} | base ${String(item['baseCents'])} | taxa escalada ${String(item['rateScaled'] ?? 'n/a')} | valor ${String(item['amountCents'] ?? 'indeterminado')} centavos | regra ${String(item['ruleId'])} | fontes ${(Array.isArray(item['sourceIds']) ? item['sourceIds'] : []).join(', ')}`;
    }) : ['Nenhum componente calculado']),
    'Lacunas:', ...(Array.isArray(data['gapCodes']) ? data['gapCodes'].map(String) : ['Nenhuma']),
  ];
  return lines.flatMap((line) => {
    const words = line.split(' ');
    const wrapped: string[] = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > 90 && current) { wrapped.push(current); current = word; } else current = next;
    }
    if (current) wrapped.push(current);
    return wrapped;
  });
};

/** PDF estável derivado do JSON canônico; sem instante de download. */
const renderPdf = (value: unknown, contribution?: 'PIS_PASEP' | 'COFINS'): Buffer => {
  const lines = linesOf(value, contribution);
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 50) pages.push(lines.slice(index, index + 50));
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  for (const page of pages) {
    const stream = `BT\n/F1 9 Tf\n48 790 Td\n14 TL\n${page.map((line, index) => `${index ? 'T*\n' : ''}(${escapePdf(line)}) Tj`).join('\n')}\nET`;
    const pageId = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) { offsets.push(Buffer.byteLength(body, 'latin1')); body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'latin1');
};

export const renderMonthlyAssessmentPdf = (value: unknown): Buffer => renderPdf(value);
export const renderMonthlyDarfDraftPdf = (value: unknown, contribution: 'PIS_PASEP' | 'COFINS'): Buffer => renderPdf(value, contribution);
