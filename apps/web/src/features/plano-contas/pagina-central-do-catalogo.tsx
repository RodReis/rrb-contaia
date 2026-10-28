'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { useMinhaCarteira } from '../carteira/queries';
import { CatalogoOperacional } from './catalogo-operacional';
import { concede } from './permissoes';
import { useSessao } from '../usuarios/queries';

export const PaginaCentralDoCatalogo = () => {
  const [busca, setBusca] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  const { data: sessao } = useSessao();
  const consulta = useMinhaCarteira();
  const empresas = (consulta.data?.empresas ?? []).filter((empresa) => `${empresa.nome} ${empresa.cnpj}`.toLocaleLowerCase('pt-BR').includes(busca.trim().toLocaleLowerCase('pt-BR')));
  const empresa = empresas.find((item) => item.id === empresaId);
  const somenteLeitura = sessao === undefined || ![
    'contabil.estrutura_contabil.consultar', 'contabil.estrutura_contabil.manter_plano_contas',
    'contabil.estrutura_contabil.manter_centros_custo', 'contabil.estrutura_contabil.arquivar',
    'contabil.estrutura_contabil.reativar',
  ].some((chave) => concede(sessao, chave));

  return <main className="mx-auto w-full max-w-screen-2xl p-lg"><header className="mb-lg"><p className="text-label-sm uppercase tracking-wide text-muted-foreground">Contábil</p><h1 className="text-title-xl">Estrutura contábil</h1><p className="mt-xs max-w-3xl text-body-md text-muted-foreground">Consulte e mantenha plano de contas e centros de custo dentro da carteira permitida.</p></header>
    <div className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-[minmax(15rem,1fr)_minmax(18rem,2fr)] tablet:items-end"><label className="grid gap-xs text-label-md">Buscar empresa<input value={busca} onChange={(event)=>{setBusca(event.target.value);setEmpresaId('');}} className="h-11 rounded-md border border-input bg-background px-md" placeholder="Razão social ou CNPJ" /></label><Select rotulo="Empresa da carteira" valor={empresaId} onValorChange={setEmpresaId} disabled={consulta.isPending} placeholder="Selecione empresa" opcoes={empresas.map((item)=>({valor:item.id,rotulo:`${item.nome} · ${item.cnpj}`}))} /></div>
    {consulta.isError ? <p role="alert" className="mt-md text-body-md">Falha ao carregar empresas da carteira.</p> : null}
    {empresa ? <CatalogoOperacional key={empresa.id} empresaId={empresa.id} somenteLeitura={somenteLeitura} /> : <p className="mt-md rounded-md bg-muted/40 p-md text-body-sm text-muted-foreground">Selecione uma empresa para abrir os catálogos.</p>}
  </main>;
};
