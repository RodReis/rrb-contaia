/**
 * Instrução do arquivo e download do modelo (SPEC-013 §5.2 item 2). Só o que a SPEC decide: limites,
 * campos obrigatórios e o que a reimportação faz e não faz. Nada de promessa de classificação,
 * vetorização ou garantia de aceite — o protótipo tinha as três (§5.1).
 */
import { FileSpreadsheet } from 'lucide-react';

import { CAMPOS_DO_CONTRATO } from '@contaia/domain';

import { caminhoDoModelo } from './api';
import { AJUDA_DO_CAMPO, ROTULO_DO_CAMPO } from './apresentacao';
import { BotaoDeDownload } from './pecas';

const REGRAS: readonly string[] = [
  'A ordem das linhas não importa: a conta-pai pode vir depois da filha.',
  'Código repetido no arquivo rejeita todas as linhas com esse código.',
  'Código novo inclui a conta; código existente atualiza nome, tipo, natureza e conta-pai.',
  'Contas que não estão no arquivo continuam como estão.',
  'Conta arquivada não é alterada nem reativada pela importação.',
];

export const RegrasDoArquivo = ({ empresaId, podeBaixar }: { empresaId: string; podeBaixar: boolean }) => (
  <aside
    aria-labelledby="regras-do-arquivo"
    className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg shadow-elevation-1"
  >
    <div className="flex items-start gap-sm">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&_svg]:size-icon-lg"
        aria-hidden="true"
      >
        <FileSpreadsheet />
      </span>
      <div className="flex flex-col gap-xs">
        <h3 id="regras-do-arquivo" className="font-display text-headline-sm text-foreground">
          Como preparar o CSV
        </h3>
        <p className="text-body-sm text-muted-foreground">
          Até <span className="font-mono text-code-sm tabular-nums">10 MB</span> e{' '}
          <span className="font-mono text-code-sm tabular-nums">10.000</span> linhas de dados, com cabeçalho na
          primeira linha.
        </p>
      </div>
    </div>

    <dl className="flex flex-col divide-y divide-border rounded-md border border-border">
      {CAMPOS_DO_CONTRATO.map((campo) => (
        <div key={campo} className="flex flex-col gap-xs px-md py-sm">
          <dt className="flex items-center gap-xs text-title-sm text-foreground">
            {ROTULO_DO_CAMPO[campo]}
            <code className="rounded-sm bg-muted px-xs font-mono text-code-xs text-muted-foreground">{campo}</code>
          </dt>
          <dd className="text-body-sm text-muted-foreground">{AJUDA_DO_CAMPO[campo]}</dd>
        </div>
      ))}
    </dl>

    <ul className="flex list-disc flex-col gap-xs pl-lg text-body-sm text-muted-foreground marker:text-border">
      {REGRAS.map((regra) => (
        <li key={regra}>{regra}</li>
      ))}
    </ul>

    {podeBaixar ? (
      <BotaoDeDownload
        rotulo="Baixar modelo CSV"
        caminho={caminhoDoModelo(empresaId)}
        nomePadrao="modelo-plano-de-contas.csv"
        indisponivel="O modelo não está disponível agora."
      />
    ) : null}
  </aside>
);
