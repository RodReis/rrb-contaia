/**
 * Instrução do arquivo e download do modelo (SPEC-013/014 §5.2 item 2). Só o que a SPEC decide:
 * limites, campos obrigatórios e o que a reimportação faz e não faz. Nada de promessa de
 * classificação, vetorização ou garantia de aceite — o protótipo tinha as três (§5.1).
 */
import { FileSpreadsheet } from 'lucide-react';

import { caminhoDoModelo } from './api';
import type { DominioDaImportacao } from './dominio';
import { BotaoDeDownload } from './pecas';

export const RegrasDoArquivo = ({
  dominio,
  empresaId,
  podeBaixar,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  podeBaixar: boolean;
}) => (
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
      {dominio.campos.map((campo) => (
        <div key={campo} className="flex flex-col gap-xs px-md py-sm">
          <dt className="flex items-center gap-xs text-title-sm text-foreground">
            {dominio.rotuloDoCampo(campo)}
            <code className="rounded-sm bg-muted px-xs font-mono text-code-xs text-muted-foreground">{campo}</code>
          </dt>
          <dd className="text-body-sm text-muted-foreground">{dominio.ajudaDoCampo(campo)}</dd>
        </div>
      ))}
    </dl>

    <ul className="flex list-disc flex-col gap-xs pl-lg text-body-sm text-muted-foreground marker:text-border">
      {dominio.regras.map((regra) => (
        <li key={regra}>{regra}</li>
      ))}
    </ul>

    {podeBaixar ? (
      <BotaoDeDownload
        rotulo="Baixar modelo CSV"
        caminho={caminhoDoModelo(dominio, empresaId)}
        nomePadrao={dominio.nomeDoModelo}
        indisponivel="O modelo não está disponível agora."
        rotuloDeNovaTentativa="Tentar baixar de novo o modelo"
      />
    ) : null}
  </aside>
);
