/**
 * Editor da matriz de permissões (SPEC-008 §3.3 e §5.2): módulos expansíveis,
 * funcionalidades agrupadas e ações elegíveis, sempre a partir do catálogo do
 * servidor. As regras de dependência são as do domínio (as mesmas que a API
 * aplica): conceder uma ação concede `Consultar`; retirar `Consultar` revoga as
 * dependentes; ocultar um módulo revoga a subárvore e pede confirmação.
 *
 * A área exclusiva do administrador aparece sempre, com cadeado, e nunca
 * entra na matriz: o servidor também a recusa (403).
 */
'use client';

import {
  concederPermissao,
  ehChaveDoCatalogo,
  moduloVisivel,
  ocultarModulo,
  revogarPermissao,
} from '@contaia/domain';
import type { ChaveDoCatalogo } from '@contaia/domain';
import { ChevronDown, Eye, EyeOff, Lock } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CaixaDeSelecao } from '@/components/ui/caixa-de-selecao';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import type { CatalogoDePermissoes, ModuloNoCatalogo } from './api';
import { contarPermissoesDoModulo } from './rotulos';

type Props = {
  catalogo: CatalogoDePermissoes;
  valor: readonly ChaveDoCatalogo[];
  aoMudar: (proximo: readonly ChaveDoCatalogo[]) => void;
  somenteLeitura?: boolean;
  /** Mensagem de erro da matriz (ex.: "Marque ao menos uma permissão"), anunciada ao leitor de tela. */
  erro?: string | undefined;
};

const chavesDeConsulta = (modulo: ModuloNoCatalogo): readonly ChaveDoCatalogo[] =>
  modulo.funcionalidades.flatMap((funcionalidade) =>
    funcionalidade.acoes
      .filter((acao) => acao.id === 'consultar')
      .map((acao) => acao.chave)
      .filter(ehChaveDoCatalogo),
  );

const SecaoDoModulo = ({
  modulo,
  valor,
  aoMudar,
  somenteLeitura,
  aberto,
  aoAlternar,
}: {
  modulo: ModuloNoCatalogo;
  valor: readonly ChaveDoCatalogo[];
  aoMudar: (proximo: readonly ChaveDoCatalogo[]) => void;
  somenteLeitura: boolean;
  aberto: boolean;
  aoAlternar: () => void;
}) => {
  const idDoCorpo = useId();
  const visivel = moduloVisivel(valor, modulo.id);
  const { marcadas, total } = contarPermissoesDoModulo(modulo, valor);

  const alternarAcao = (chave: ChaveDoCatalogo, marcada: boolean): void => {
    if (marcada) {
      aoMudar(concederPermissao(valor, chave));

      return;
    }

    const proximo = revogarPermissao(valor, chave);
    const dependentes = valor.length - proximo.length - 1;

    // Retirar Consultar leva junto as ações que dependem dele: avisa, não faz em silêncio.
    if (dependentes > 0) {
      toast.info(
        dependentes === 1
          ? 'Retirar “Consultar” também retirou 1 ação dependente.'
          : `Retirar “Consultar” também retirou ${dependentes} ações dependentes.`,
      );
    }

    aoMudar(proximo);
  };

  const liberarConsulta = (): void => {
    aoMudar(chavesDeConsulta(modulo).reduce(concederPermissao, valor));
  };

  return (
    <section
      aria-label={modulo.rotulo}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex flex-col gap-sm px-md py-sm tablet:flex-row tablet:items-center tablet:justify-between">
        <h3 className="min-w-0 flex-1 text-title-md text-foreground">
          <button
            type="button"
            aria-expanded={aberto}
            aria-controls={idDoCorpo}
            onClick={aoAlternar}
            className={cn(
              'flex w-full items-center gap-sm rounded-md py-xs text-left',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-icon-sm shrink-0 text-muted-foreground transition-transform duration-fast',
                aberto ? 'rotate-0' : '-rotate-90',
              )}
            />
            <span className="break-words">{modulo.rotulo}</span>
          </button>
        </h3>

        <div className="flex flex-wrap items-center gap-sm">
          <span className="text-body-sm tabular-nums text-muted-foreground">
            {marcadas} de {total} {total === 1 ? 'permissão' : 'permissões'}
          </span>
          {/* Visível/oculto é dito por texto e ícone, nunca só por cor. */}
          <StatusBadge
            tom={visivel ? 'conforme' : 'neutro'}
            rotulo={visivel ? 'Módulo visível' : 'Módulo oculto'}
          />

          {somenteLeitura ? null : visivel ? (
            <ConfirmacaoDeAcao
              gatilho={
                <Button
                  variante="contorno"
                  tamanho="compacto"
                  aria-label={`Ocultar módulo ${modulo.rotulo}`}
                >
                  <EyeOff aria-hidden="true" />
                  Ocultar
                </Button>
              }
              titulo={`Ocultar “${modulo.rotulo}”?`}
              descricao={
                marcadas === 1
                  ? 'Esta ação remove a única permissão marcada neste módulo. O papel deixa de ver o módulo, a navegação e o conteúdo dele.'
                  : `Esta ação remove as ${marcadas} permissões marcadas neste módulo. O papel deixa de ver o módulo, a navegação e o conteúdo dele.`
              }
              rotuloDeConfirmacao={`Ocultar e remover ${marcadas}`}
              destrutivo
              aoConfirmar={async () => aoMudar(ocultarModulo(valor, modulo.id).matriz)}
            />
          ) : (
            <Button
              variante="contorno"
              tamanho="compacto"
              aria-label={`Liberar consulta em ${modulo.rotulo}`}
              onClick={liberarConsulta}
            >
              <Eye aria-hidden="true" />
              Liberar consulta
            </Button>
          )}
        </div>
      </div>

      <div
        id={idDoCorpo}
        hidden={!aberto}
        className="flex flex-col gap-md border-t border-border bg-muted/30 px-md py-md"
      >
        {modulo.funcionalidades.map((funcionalidade) => (
          <fieldset
            key={funcionalidade.id}
            disabled={somenteLeitura}
            className="flex min-w-0 flex-col gap-sm"
          >
            <legend className="text-label-md text-foreground">{funcionalidade.rotulo}</legend>
            <div className="grid gap-sm tablet:grid-cols-2 desktop:grid-cols-3">
              {funcionalidade.acoes.map((acao) =>
                ehChaveDoCatalogo(acao.chave) ? (
                  <CaixaDeSelecao
                    key={acao.chave}
                    rotulo={acao.rotulo}
                    marcada={valor.includes(acao.chave)}
                    onMarcadaChange={(marcada) => alternarAcao(acao.chave as ChaveDoCatalogo, marcada)}
                    disabled={somenteLeitura}
                  />
                ) : null,
              )}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
};

const AreaExclusiva = ({ area }: { area: ModuloNoCatalogo }) => (
  <section
    aria-label={`${area.rotulo}, bloqueada`}
    className="flex flex-col gap-sm rounded-lg border border-dashed border-border bg-muted/40 px-md py-md"
  >
    <div className="flex flex-wrap items-center gap-sm">
      <Lock aria-hidden="true" className="size-icon-sm shrink-0 text-muted-foreground" />
      <h3 className="text-title-md text-foreground">{area.rotulo}</h3>
      <StatusBadge tom="neutro" rotulo="Bloqueado" />
    </div>
    <p className="max-w-prose text-body-sm text-muted-foreground">
      Gerenciar usuários e papéis é exclusivo do papel padrão Administrador do escritório. Esta área
      não pode ser concedida a um papel personalizado, mesmo que ele tenha sido criado a partir do
      administrador.
    </p>
    <fieldset disabled className="flex min-w-0 flex-col gap-sm">
      <legend className="sr-only">Permissões bloqueadas de {area.rotulo}</legend>
      <div className="grid gap-sm tablet:grid-cols-2 desktop:grid-cols-3">
        {area.funcionalidades.flatMap((funcionalidade) =>
          funcionalidade.acoes.map((acao) => (
            <CaixaDeSelecao
              key={acao.chave}
              rotulo={`${funcionalidade.rotulo}: ${acao.rotulo}`}
              marcada={false}
              onMarcadaChange={() => undefined}
              disabled
            />
          )),
        )}
      </div>
    </fieldset>
  </section>
);

export const MatrizDePermissoes = ({
  catalogo,
  valor,
  aoMudar,
  somenteLeitura = false,
  erro,
}: Props) => {
  // Módulos que já têm permissão começam abertos; o resto, recolhido: a matriz inicial
  // de um molde mostra de cara o que o papel enxerga.
  const [abertos, definirAbertos] = useState<ReadonlySet<string>>(
    () => new Set(catalogo.modulos.filter((m) => moduloVisivel(valor, m.id)).map((m) => m.id)),
  );

  const alternar = (id: string): void =>
    definirAbertos((atuais) => {
      const proximos = new Set(atuais);

      if (proximos.has(id)) {
        proximos.delete(id);
      } else {
        proximos.add(id);
      }

      return proximos;
    });

  return (
    <div className="flex flex-col gap-md">
      <h2 className="text-headline-sm text-foreground">Permissões do papel</h2>
      <p className="max-w-prose text-body-sm text-muted-foreground">
        Marque o que o papel pode fazer. Qualquer ação exige poder consultar a funcionalidade, então
        marcá-la já marca “Consultar”. Para um usuário com mais de um papel, vale a soma de todos.
      </p>

      {erro === undefined ? null : (
        <p role="alert" className="text-body-sm text-danger-foreground">
          {erro}
        </p>
      )}

      <div className="flex flex-col gap-sm">
        {catalogo.modulos.map((modulo) => (
          <SecaoDoModulo
            key={modulo.id}
            modulo={modulo}
            valor={valor}
            aoMudar={aoMudar}
            somenteLeitura={somenteLeitura}
            aberto={abertos.has(modulo.id)}
            aoAlternar={() => alternar(modulo.id)}
          />
        ))}
        <AreaExclusiva area={catalogo.areaExclusiva} />
      </div>
    </div>
  );
};
