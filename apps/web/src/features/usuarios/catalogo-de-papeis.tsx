/**
 * Aba "Papéis e permissões" (SPEC-007 §5.1): os quatro papéis padrão, somente
 * leitura, com o que cada um concede. Os dados vêm do servidor — a mesma matriz
 * que ele aplica —, nunca de uma cópia no cliente que pudesse divergir.
 */
'use client';

import { Skeleton } from '@/components/ui/estados';
import { ErroDaConsulta } from './erro-da-consulta';
import { usePapeis } from './queries';
import { DESCRICAO_DO_PAPEL, ROTULO_DO_PAPEL, descreverPermissoes } from './rotulos';

export const CatalogoDePapeis = () => {
  const { data, isPending, isError, error, refetch } = usePapeis();

  if (isPending) {
    return (
      <div className="grid gap-md tablet:grid-cols-2" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando os papéis padrão</span>
        {Array.from({ length: 4 }, (_, indice) => (
          <Skeleton key={indice} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErroDaConsulta
        erro={error}
        titulo="Não foi possível carregar os papéis"
        aoTentarDeNovo={() => void refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <p className="max-w-prose text-body-md text-muted-foreground">
        Estes são os papéis padrão do escritório e não podem ser editados aqui. Quando um usuário
        tem mais de um papel, as permissões se somam: vale tudo o que qualquer um deles concede.
      </p>

      <ul className="grid gap-md tablet:grid-cols-2">
        {data.map((item) => {
          const permissoes = descreverPermissoes(item.permissoes);

          return (
            <li key={item.papel}>
              <section
                aria-labelledby={`papel-${item.papel}`}
                className="flex h-full flex-col gap-md rounded-lg border border-border bg-card p-lg"
              >
                <header className="flex flex-col gap-xs">
                  <h2 id={`papel-${item.papel}`} className="text-headline-sm text-foreground">
                    {ROTULO_DO_PAPEL[item.papel]}
                  </h2>
                  <p className="text-body-sm text-muted-foreground">{DESCRICAO_DO_PAPEL[item.papel]}</p>
                </header>

                {permissoes.length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">Nenhuma permissão concedida.</p>
                ) : (
                  <dl className="flex flex-col gap-sm">
                    {permissoes.map((permissao) => (
                      <div key={permissao.capacidade} className="flex flex-col gap-xs">
                        <dt className="text-label-md text-foreground">{permissao.capacidade}</dt>
                        <dd className="text-body-sm text-muted-foreground">
                          {permissao.acoes.join(', ')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
