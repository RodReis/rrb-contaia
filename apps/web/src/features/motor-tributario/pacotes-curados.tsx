'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { Button } from '@/components/ui/button';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import {
  arquivarPacoteTributario, importarPacoteTributario, listarPacotesTributarios,
  publicarPacoteTributario, revisarPacoteTributario, validarPacoteTributario,
} from '../fiscal-documents/api';

const chavePacotes = ['motor-tributario', 'pacotes-curados'] as const;
const statusRotulo: Record<'IMPORTED' | 'VALIDATED' | 'REVIEWED' | 'PUBLISHED' | 'ARCHIVED', string> = {
  IMPORTED: 'Importado', VALIDATED: 'Validado', REVIEWED: 'Revisado', PUBLISHED: 'Publicado', ARCHIVED: 'Arquivado',
};

export const PainelDePacotesCurados = () => {
  const [conteudo, setConteudo] = useState('');
  const [declaracoes, setDeclaracoes] = useState<Record<string, string>>({});
  const [errosDeValidacao, setErrosDeValidacao] = useState<Record<string, string[]>>({});
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const cache = useQueryClient();
  const pacotes = useQuery({ queryKey: chavePacotes, queryFn: listarPacotesTributarios, retry: 0 });
  const invalidarLista = async () => cache.invalidateQueries({ queryKey: chavePacotes });
  const tratarErro = (erro: unknown) => {
    const problema = erro instanceof ErroDaApi ? erro.problema : null;
    toast.error(problema?.title ?? 'Não foi possível concluir a ação do pacote.');
  };
  const importar = useMutation({ mutationFn: importarPacoteTributario, onSuccess: async () => { setConteudo(''); setErroLocal(null); await invalidarLista(); toast.success('Pacote importado como rascunho.'); }, onError: tratarErro });
  const validar = useMutation({ mutationFn: validarPacoteTributario, onSuccess: async (result, id) => {
    await invalidarLista();
    if ('validation' in result && !result.validation.valid) {
      setErrosDeValidacao((current) => ({ ...current, [id]: result.validation.errors }));
      return;
    }
    setErrosDeValidacao((current) => ({ ...current, [id]: [] }));
    toast.success('Validação do pacote concluída.');
  }, onError: tratarErro });
  const revisar = useMutation({ mutationFn: ({ id, declaration }: { id: string; declaration: string }) => revisarPacoteTributario(id, declaration), onSuccess: async () => { await invalidarLista(); toast.success('Revisão registrada.'); }, onError: tratarErro });
  const publicar = useMutation({ mutationFn: publicarPacoteTributario, onSuccess: async () => { await invalidarLista(); toast.success('Pacote publicado e imutável.'); }, onError: tratarErro });
  const arquivar = useMutation({ mutationFn: arquivarPacoteTributario, onSuccess: async () => { await invalidarLista(); toast.success('Pacote arquivado; snapshots anteriores foram preservados.'); }, onError: tratarErro });

  if (pacotes.isPending) return <section aria-label="Pacotes normativos" aria-busy="true" className="rounded-lg border border-border bg-card p-md"><Skeleton className="h-20 w-full" /></section>;
  if (pacotes.isError || !pacotes.data) return <ErroDeTela titulo="Pacotes normativos indisponíveis" descricao="Tente novamente ou confirme o acesso ao catálogo tributário." />;
  if (!pacotes.data.canAdminister) return null;

  const enviarImportacao = () => {
    try {
      const parsed: unknown = JSON.parse(conteudo);
      setErroLocal(null);
      importar.mutate(parsed);
    } catch {
      setErroLocal('O conteúdo precisa ser um JSON válido.');
    }
  };

  return (
    <section aria-labelledby="titulo-pacotes-curados" className="space-y-md rounded-lg border border-border bg-card p-md">
      <header>
        <h3 id="titulo-pacotes-curados" className="font-display text-title-md text-foreground">Pacotes normativos curados</h3>
        <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">Importe uma versão, valide sua estrutura, registre revisão humana independente e publique. Pacote publicado é imutável; correções exigem nova versão.</p>
      </header>
      <div className="max-w-4xl space-y-sm">
        <AreaDeTexto rotulo="Conteúdo JSON do pacote" obrigatorio value={conteudo} onValorChange={setConteudo} maxLength={2_000_000} className="min-h-52 font-mono text-code-sm" ajuda="Use o schema versionado da F26. Fontes sem ato, dispositivo ou vigência específica não devem ser publicadas." />
        {erroLocal ? <p role="alert" className="text-body-sm text-danger-foreground">{erroLocal}</p> : null}
        <Button variante="primaria" disabled={!conteudo.trim() || importar.isPending} onClick={enviarImportacao}>Importar rascunho</Button>
      </div>
      {pacotes.data.items.length === 0 ? <p className="rounded-md border border-dashed border-border p-md text-body-sm text-muted-foreground">Nenhum pacote importado.</p> : (
        <ul className="space-y-sm">
          {pacotes.data.items.map((pacote) => {
            const declara = declaracoes[pacote.id] ?? '';
            return <li key={pacote.id} className="rounded-md border border-border/70 p-md">
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <div><h4 className="font-medium text-foreground">{pacote.packageId} · v{pacote.semanticVersion}</h4><p className="mt-xs text-label-sm text-muted-foreground">{pacote.jurisdiction} · {pacote.regimes.join(', ')} · vigência desde {pacote.validFrom}</p></div>
                <StatusBadge tom={pacote.status === 'PUBLISHED' ? 'conforme' : pacote.status === 'ARCHIVED' ? 'neutro' : 'atencao'} rotulo={statusRotulo[pacote.status]} />
              </div>
              <p className="mt-sm text-body-sm text-foreground">Cobertura: {pacote.coverage.join('; ')}</p>
              <p className="mt-xs text-body-sm text-muted-foreground">Exclusões: {pacote.exclusions.join('; ')}</p>
              <p className="mt-xs break-all font-mono text-label-sm text-muted-foreground">SHA-256 {pacote.sha256}</p>
              {errosDeValidacao[pacote.id]?.length ? <ul role="alert" aria-label={`Falhas de validação de ${pacote.packageId}`} className="mt-sm list-inside list-disc rounded-md border border-danger/40 bg-danger/10 p-sm text-body-sm text-danger-foreground">{errosDeValidacao[pacote.id]?.map((erro) => <li key={erro}>{erro}</li>)}</ul> : null}
              <div className="mt-md flex flex-wrap items-end gap-sm">
                {pacote.status === 'IMPORTED' ? <Button variante="contorno" disabled={validar.isPending} onClick={() => validar.mutate(pacote.id)}>Validar pacote</Button> : null}
                {pacote.status === 'VALIDATED' ? pacote.importedBy === pacotes.data.actorId ? <p className="text-body-sm text-muted-foreground">Outra conta super-admin precisa revisar este pacote.</p> : <div className="flex min-w-64 flex-1 flex-wrap items-end gap-sm"><div className="min-w-64 flex-1"><AreaDeTexto rotulo="Declaração de revisão" obrigatorio value={declara} onValorChange={(value) => setDeclaracoes((current) => ({ ...current, [pacote.id]: value }))} maxLength={1000} ajuda="Confirme a fonte oficial, o dispositivo e a vigência. Mínimo de 20 caracteres." /></div><Button variante="contorno" disabled={declara.trim().length < 20 || revisar.isPending} onClick={() => revisar.mutate({ id: pacote.id, declaration: declara.trim() })}>Registrar revisão</Button></div> : null}
                {pacote.status === 'REVIEWED' ? <ConfirmacaoDeAcao gatilho={<Button variante="primaria">Publicar versão</Button>} titulo={`Publicar ${pacote.packageId} v${pacote.semanticVersion}?`} descricao="O conteúdo e o hash ficarão imutáveis. Novos documentos só usarão o pacote quando regime e data estiverem cobertos." rotuloDeConfirmacao="Publicar versão" aoConfirmar={() => publicar.mutateAsync(pacote.id)} /> : null}
                {pacote.status === 'PUBLISHED' ? <ConfirmacaoDeAcao gatilho={<Button variante="contorno">Arquivar versão</Button>} titulo={`Arquivar ${pacote.packageId} v${pacote.semanticVersion}?`} descricao="Novas resoluções deixarão de selecionar este pacote. O conteúdo publicado e os snapshots que o referenciam serão preservados." rotuloDeConfirmacao="Arquivar versão" destrutivo aoConfirmar={() => arquivar.mutateAsync(pacote.id)} /> : null}
              </div>
            </li>;
          })}
        </ul>
      )}
    </section>
  );
};
