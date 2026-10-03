/**
 * Diferença entre duas matrizes (SPEC-008 §5.2): adicionadas e retiradas, com o
 * nome por extenso de cada permissão. Sinal e texto dizem o que mudou — a cor
 * nunca é o único sinal.
 */
import type { ChaveDoCatalogo } from '@contaia/domain';
import { diferencaDeMatriz } from '@contaia/domain';
import { Minus, Plus } from 'lucide-react';

import type { CatalogoDePermissoes } from './api';
import { rotuloDaChave } from './rotulos';

const Lista = ({
  titulo,
  chaves,
  catalogo,
  sinal,
}: {
  titulo: string;
  chaves: readonly string[];
  catalogo: CatalogoDePermissoes;
  sinal: 'mais' | 'menos';
}) => {
  const Icone = sinal === 'mais' ? Plus : Minus;

  return (
    <div className="flex flex-col gap-xs">
      <h3 className="text-label-md text-foreground">
        {titulo} <span className="tabular-nums text-muted-foreground">({chaves.length})</span>
      </h3>
      <ul className="flex flex-col gap-xs">
        {chaves.map((chave) => (
          <li key={chave} className="flex items-start gap-xs text-body-sm text-foreground">
            <Icone aria-hidden="true" className="mt-[0.2rem] size-icon-xs shrink-0 text-muted-foreground" />
            <span className="break-words">
              <span className="sr-only">{sinal === 'mais' ? 'Adicionada: ' : 'Retirada: '}</span>
              {rotuloDaChave(catalogo, chave)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const DiferencaDaMatriz = ({
  catalogo,
  antes,
  depois,
  rotuloDaBase,
}: {
  catalogo: CatalogoDePermissoes;
  antes: readonly ChaveDoCatalogo[];
  depois: readonly ChaveDoCatalogo[];
  /** De onde se compara: "o molde selecionado" na criação, "a revisão atual" na edição. */
  rotuloDaBase: string;
}) => {
  const { adicionadas, retiradas } = diferencaDeMatriz(antes, depois);

  if (adicionadas.length === 0 && retiradas.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        Nenhuma diferença em relação a {rotuloDaBase}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-sm text-muted-foreground">Em relação a {rotuloDaBase}:</p>
      {adicionadas.length > 0 ? (
        <Lista titulo="Permissões adicionadas" chaves={adicionadas} catalogo={catalogo} sinal="mais" />
      ) : null}
      {retiradas.length > 0 ? (
        <Lista titulo="Permissões retiradas" chaves={retiradas} catalogo={catalogo} sinal="menos" />
      ) : null}
    </div>
  );
};
