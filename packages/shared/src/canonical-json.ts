const canonicalizarValor=(value:unknown):string=>{
  if(Array.isArray(value))return `[${value.map(canonicalizarValor).join(',')}]`;
  if(typeof value==='object'&&value!==null){
    const record=value as Record<string,unknown>;
    const keys=Object.keys(record).sort((a,b)=>a<b?-1:a>b?1:0);
    return `{${keys.map(key=>`${JSON.stringify(key)}:${canonicalizarValor(record[key])}`).join(',')}}`;
  }
  const serialized=JSON.stringify(value);
  if(serialized===undefined)throw new TypeError('Valor não representável como JSON canônico.');
  return serialized;
};

/** Serializa JSON com as chaves de objetos ordenadas, estável antes e depois de persistir em jsonb. */
export const canonicalizarJson=(value:unknown):string=>canonicalizarValor(value);
