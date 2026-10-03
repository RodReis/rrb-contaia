/**
 * O que uma matriz concede, por módulo e funcionalidade, com os nomes por
 * extenso (SPEC-007 §5.1 "papéis padrão" e SPEC-008 §5.1). Somente leitura.
 */
import type { ChaveDePermissao } from '@contaia/domain';

import type { CatalogoDePermissoes } from './api';
import { resumirMatriz } from './rotulos';

export const ResumoDaMatriz = ({
  catalogo,
  permissoes,
}: {
  catalogo: CatalogoDePermissoes;
  permissoes: readonly ChaveDePermissao[];
}) => {
  const modulos = resumirMatriz(catalogo, permissoes);

  if (modulos.length === 0) {
    return <p className="text-body-sm text-muted-foreground">Nenhuma permissão concedida.</p>;
  }

  return (
    <dl className="flex flex-col gap-sm">
      {modulos.map((modulo) => (
        <div key={modulo.id} className="flex flex-col gap-xs">
          <dt className="text-label-md text-foreground">{modulo.rotulo}</dt>
          {modulo.funcionalidades.map((funcionalidade) => (
            <dd key={funcionalidade.rotulo} className="text-body-sm text-muted-foreground">
              <span className="text-foreground">{funcionalidade.rotulo}:</span>{' '}
              {funcionalidade.acoes.join(', ')}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
};
