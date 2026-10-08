/**
 * Aba "Plano de contas" da empresa (SPEC-013 §3.1, §5.2): importação por CSV, histórico e plano
 * vigente num lugar só.
 *
 * Direção do protótipo `contaia_onboarding_de_clientes_importa_o_de_legados_rf_01` preservada —
 * cartão com ladrilho de ícone, faixa de metadados do arquivo, totais e tabela de inconsistências,
 * pipeline em etapas — com as correções de escopo da SPEC §5.1: o título trata só do plano de
 * contas (sem centro de custo), não há correção inline nem solução/sugestão de IA, nem vetorização,
 * percentuais de garantia ou acoplamento com DF-e/Ciência e etapas seguintes. Estado vive em React
 * e na URL, não em manipulação de DOM (DEBITO.md §D-16).
 */
'use client';

import { FileUp, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useSessao } from '../usuarios/queries';
import { Acompanhamento } from './acompanhamento';
import { HistoricoDeImportacoes } from './historico';
import { NovaImportacao } from './nova-importacao';
import { Secao } from './pecas';
import { permissoesDoPlano } from './permissoes';
import { PlanoVigente } from './plano-vigente';
import { RegrasDoArquivo } from './regras-do-arquivo';
import { useEstadoNaUrl } from './use-estado-na-url';

export const AbaPlanoDeContas = ({
  empresaId,
  somenteLeitura,
}: {
  empresaId: string;
  somenteLeitura: boolean;
}) => {
  const { data: sessao } = useSessao();
  const permissoes = permissoesDoPlano(sessao, somenteLeitura);
  const url = useEstadoNaUrl(empresaId);

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-xs">
        <h2 className="font-display text-headline-md text-foreground">Plano de contas</h2>
        <p className="max-w-3xl text-body-md text-muted-foreground">
          Importe e reimporte o plano de contas desta empresa por CSV, no modelo do ContaIA ou mapeando as colunas
          de um arquivo legado. Nenhuma conta muda antes da sua confirmação.
        </p>
      </header>

      {somenteLeitura ? (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-md py-sm text-body-sm text-muted-foreground">
          Empresa arquivada: o plano e o histórico ficam para consulta, sem novas importações.
        </p>
      ) : null}

      <div className="grid items-start gap-lg desktop:grid-cols-12">
        <Secao
          id="importacao-por-csv"
          className="desktop:col-span-8"
          icone={<FileUp />}
          titulo={url.tentativaId === null ? 'Importação por CSV' : 'Importação em revisão'}
          descricao={
            url.tentativaId === null
              ? 'Escolha o arquivo, associe as colunas e valide. A prévia mostra o que entra, o que muda e o que foi rejeitado.'
              : 'Resumo, rejeições e decisão desta tentativa.'
          }
          acoes={
            url.tentativaId === null ? undefined : (
              <Button variante="fantasma" tamanho="compacto" onClick={url.fecharTentativa}>
                <X aria-hidden="true" />
                Fechar tentativa
              </Button>
            )
          }
        >
          {url.tentativaId === null ? (
            <NovaImportacao
              empresaId={empresaId}
              podeImportar={permissoes.importar}
              aoAbrirTentativa={url.abrirTentativa}
            />
          ) : (
            <Acompanhamento
              key={url.tentativaId}
              empresaId={empresaId}
              tentativaId={url.tentativaId}
              permissoes={permissoes}
              url={url}
            />
          )}
        </Secao>

        <div className="desktop:col-span-4">
          <RegrasDoArquivo empresaId={empresaId} podeBaixar={permissoes.baixar} />
        </div>
      </div>

      <HistoricoDeImportacoes empresaId={empresaId} url={url} />
      <PlanoVigente empresaId={empresaId} url={url} />
    </div>
  );
};
