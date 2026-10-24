const escapePdf=(value:string)=>value.replace(/[—–]/gu,'-').replace(/[^\x20-\xff]/gu,'?').replace(/\\/gu,'\\\\').replace(/\(/gu,'\\(').replace(/\)/gu,'\\)');
const wrap=(value:string)=>{const words=value.split(' '),rows:string[]=[];let row='';for(const word of words){const next=row?`${row} ${word}`:word;if(next.length>100&&row){rows.push(row);row=word;}else row=next;}if(row)rows.push(row);return rows;};
const text=(value:unknown)=>value===null||value===undefined?'indeterminado':String(value);
const object=(value:unknown):Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** PDF interno com totais, lacunas e memória de cada trecho, sem sugerir efeito fiscal. */
export const renderIcmsStLegalAccrualsPdf=(result:unknown,hash:string):Buffer=>{
  const data=object(result),restitution=object(data['restitution']),complement=object(data['complement']);
  const lines=[
    'ContaIA | Acrescimos legais do ICMS-ST historico',
    `Fonte F33: ${text(data['sourcePackageId'])} | Regime: ${text(data['regime'])}`,
    `Data de referencia: ${text(data['referenceDate'])} | Estado: ${text(data['status'])}`,
    `Restituicao | Principal ${text(restitution['principalCents'])} | Atualizacao ${text(restitution['monetaryUpdateCents'])} | Juros ${text(restitution['lateInterestCents'])} | Total ${text(restitution['totalCents'])}`,
    `Complemento | Principal ${text(complement['principalCents'])} | Atualizacao ${text(complement['monetaryUpdateCents'])} | Juros ${text(complement['lateInterestCents'])} | Multa ${text(complement['latePaymentFineCents'])} | Penalidade ${text(complement['infractionPenaltyCents'])} | Total ${text(complement['totalCents'])}`,
    `Hash SHA-256: ${hash}`,
    'Rascunho exclusivamente interno para revisao. Sem escrituracao, apropriacao, guia, pagamento ou lancamento financeiro.',
    ...((Array.isArray(data['gaps'])?data['gaps']:[]).map((raw)=>{const gap=object(raw);return `Lacuna ${text(gap['track'])} / ${text(gap['component'])} ${text(gap['from'])} a ${text(gap['through'])}: ${text(gap['reason'])}`;})),
    'Memoria causal por trecho:',
    ...((Array.isArray(data['memory'])?data['memory']:[]).map((raw)=>{const item=object(raw);return `${text(item['track'])} ${text(item['component'])} ${text(item['from'])} a ${text(item['through'])} | regra ${text(item['ruleId'])} v${text(item['ruleVersion'])} | principal ${text(item['principalCents'])} | valor ${text(item['amountCents'])} | fonte ${text(item['sourceSha256'])}`;})),
  ].flatMap(wrap);
  const pages:string[][]=[];for(let index=0;index<lines.length;index+=50)pages.push(lines.slice(index,index+50));
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  for(const page of pages){const stream=`BT\n/F1 10 Tf\n48 790 Td\n14 TL\n${page.map((line,index)=>`${index?'T*\n':''}(${escapePdf(line)}) Tj`).join('\n')}\nET`;
    const pageId=objects.length+1;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId+1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`);}
  let body='%PDF-1.4\n';const offsets=[0];for(let index=0;index<objects.length;index++){offsets.push(Buffer.byteLength(body,'latin1'));body+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}
  const xref=Buffer.byteLength(body,'latin1');body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body,'latin1');
};
