const safe=(value:string)=>value.replace(/[—–]/gu,'-').replace(/[^\x20-\xff]/gu,'?').replace(/\\/gu,'\\\\').replace(/\(/gu,'\\(').replace(/\)/gu,'\\)');
const record=(value:unknown):Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>value===undefined||value===null?'indeterminado':String(value);
const wrapped=(value:string)=>{const words=value.split(' ');const result:string[]=[];let line='';for(const word of words){const next=line?`${line} ${word}`:word;if(next.length>96&&line){result.push(line);line=word;}else line=next;}if(line)result.push(line);return result;};
/** PDF válido com linhas separadas, hash canônico, evidências e decisões humanas. */
export const renderIcmsStDossierPdf=(value:unknown,canonicalHash:string,events:readonly unknown[]):Buffer=>{
 const data=record(value),tracks=['restitution','complement'] as const,lines=[
  'ContaIA | Dossie interno de decisao ICMS-ST historico',
  `Dossie ${text(data['dossierId'])} | Contrato ${text(data['contractVersion'])} | Estado ${text(data['status'])}`,
  `Fonte F33 ${text(data['sourceReconstructionPackageId'])} | Fonte F34 ${text(data['sourceLegalAccrualResultId'])}`,
  `Periodo original ${JSON.stringify(data['originalPeriod']??'indeterminado')} | data de referencia ${text(data['referenceDate'])}`,
  `Hashes de origem F33/F34 ${JSON.stringify(data['sourceHashes']??{})}`,
  `Regime ${text(data['regime'])} | Gerado em UTC ${text(data['generatedAtUtc'])}`,
  `Hash canonico SHA-256 ${canonicalHash}`,
  'O documento registra intencao e aprovacao interna. Nenhum efeito fiscal, contabil, financeiro ou processual e executado.',
  ...tracks.flatMap(key=>{const t=record(data[key]),rule=record(t['rulePackageSnapshot']);return [`Trilha ${key==='restitution'?'RESTITUICAO':'COMPLEMENTO'} | estado ${text(t['status'])}`,`Principal ${text(t['principalCents'])} centavos | acrescimos ${text(t['legalAccrualsCents'])} centavos | total ${text(t['totalCents'])} centavos`,`Destino ${text(t['destination'])} | pacote ${text(t['rulePackageId'])} | versao ${text(t['rulePackageVersion'])}`,...(rule['id']?[`Fundamento ${text(rule['officialBasis'])} | URL ${text(rule['sourceUrl'])}`,`Vigencia ${text(rule['validFrom'])} a ${text(rule['validThrough'])} | SHA-256 ${text(rule['sourceSha256'])}`,`Condicoes da regra ${JSON.stringify(rule['conditions']??[])}`]:[]),`Condicoes confirmadas ${Array.isArray(t['conditionConfirmations'])?t['conditionConfirmations'].join(', '):'nenhuma'}`,`Justificativa ${text(t['reason'])}`,`Evidencias ${Array.isArray(t['evidenceIds'])?t['evidenceIds'].map(String).join(', '):'nenhuma'}`,`Preparador ${text(t['preparedBy'])} | decisor ${text(t['decidedBy'])} | decidido UTC ${text(t['decidedAtUtc'])}`];}),
  'Manifesto de evidencias:',...(Array.isArray(data['evidenceManifest'])?data['evidenceManifest'].map(item=>{const e=record(item);return `${text(e['track'])} | ${text(e['kind'])} | ${text(e['fileName'])} | SHA-256 ${text(e['contentSha256'])} | ${text(e['description'])}`;}):['Nenhuma']),
  'Historico append-only:',...events.map(event=>{const e=record(event);return `${text(e['occurred_at'])} | ${text(e['track'])} | ${text(e['action'])} | ator ${text(e['actor_id'])} | ${JSON.stringify(e['details']??{})}`;}),
 ].flatMap(wrapped);const pages:string[][]=[];for(let i=0;i<lines.length;i+=48)pages.push(lines.slice(i,i+48));
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
 for(const page of pages){const stream=`BT\n/F1 9 Tf\n48 790 Td\n14 TL\n${page.map((line,i)=>`${i?'T*\n':''}(${safe(line)}) Tj`).join('\n')}\nET`;const pageId=objects.length+1;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId+1} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`);}
 let body='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(body,'latin1'));body+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(body,'latin1');body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(body,'latin1');
};
