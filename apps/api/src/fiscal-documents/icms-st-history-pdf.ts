import type { HistoricalIcmsStPackage } from '@contaia/domain';

const LINHAS_POR_PAGINA = 50;

const escapar = (line: string): string =>
  line.replace(/[—–]/gu, '-').replace(/[^\x20-\xff]/gu, '?').replace(/\\/gu, '\\\\').replace(/\(/gu, '\\(').replace(/\)/gu, '\\)');

const quebrarLinha = (line: string): readonly string[] => {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of line.split(' ')) {
    const candidata = atual === '' ? palavra : `${atual} ${palavra}`;
    if (candidata.length > 100 && atual !== '') {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = candidata;
    }
  }
  if (atual !== '') linhas.push(atual);
  return linhas;
};

export const renderHistoricalIcmsStPdf = (pkg: HistoricalIcmsStPackage, hash: string): Buffer => {
  const content = [
    'ContaIA | Dossie interno de ICMS-ST historico',
    `Empresa: ${pkg.companyId} | Regime: ${pkg.regime}`,
    `Periodo: ${pkg.periodStart} a ${pkg.periodEnd} | Status: ${pkg.status}`,
    `Restituicao bruta: ${pkg.grossRestitutionCents} centavos | Complemento bruto: ${pkg.grossComplementCents} centavos`,
    `Estorno de restituicao: ${pkg.reversedRestitutionCents} centavos | Estorno de complemento: ${pkg.reversedComplementCents} centavos`,
    `Principal liquido: ${pkg.netPrincipalBalanceCents} centavos | Linhas: ${pkg.lines.length}`,
    `Hash do pacote: ${hash}`,
    'Bloqueio: uso externo depende de acrescimos legais; destino F34/SPEC-034.',
    ...pkg.excludedCompetences.map((item) => `Competencia ${item.competence}: ${item.reasonCodes.join(', ')}`),
    ...pkg.lines.map((line) => `${line.competence} | ${line.sourceKind} | ${line.documentId ?? 'evento'} | item ${line.itemId ?? '-'} | rest ${line.restitutionPrincipalCents} | comp ${line.complementPrincipalCents}`),
    'Rascunho interno nao transmissivel. Nao e escrituracao, guia, apropriacao ou calculo de acrescimos.',
  ];
  const linhas = content.flatMap(quebrarLinha);
  const paginas: string[][] = [];
  for (let indice = 0; indice < linhas.length; indice += LINHAS_POR_PAGINA) {
    paginas.push(linhas.slice(indice, indice + LINHAS_POR_PAGINA));
  }

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${paginas.map((_, indice) => `${4 + indice * 2} 0 R`).join(' ')}] /Count ${paginas.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  for (const pagina of paginas) {
    const stream = `BT\n/F1 10 Tf\n48 790 Td\n14 TL\n${pagina.map((line, indice) => `${indice === 0 ? '' : 'T*\n'}(${escapar(line)}) Tj`).join('\n')}\nET`;
    const paginaId = objetos.length + 1;
    const streamId = paginaId + 1;
    objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    objetos.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }

  let corpo = '%PDF-1.4\n';
  const offsets = [0];
  for (let indice = 0; indice < objetos.length; indice += 1) {
    offsets.push(Buffer.byteLength(corpo, 'latin1'));
    corpo += `${indice + 1} 0 obj\n${objetos[indice]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(corpo, 'latin1');
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(corpo, 'latin1');
};
