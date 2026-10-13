/**
 * Formulário da versão de regra (SPEC-016 §3.1–3.3, §5.2 item 3). Criação leva a identidade
 * (tributo, regime, operação); a edição de um rascunho a mostra como FIXA, com o motivo, e envia só
 * vigência, operação e fonte com a versão otimista. Versão publicada ou arquivada, e qualquer perfil
 * sem permissão de administrar, veem os mesmos campos em somente leitura, com a explicação visível.
 *
 * Conflito de versão (409) não descarta o que foi digitado: a tela explica, recarrega o lock atual
 * do servidor e mantém o conteúdo para a pessoa conferir e salvar de novo (FRONTEND.md §10.3).
 */
'use client';

import type { TaxRuleVersionDto } from '@contaia/shared';
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import { LoaderCircle, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { CampoDeValor } from '@/components/ui/campo-de-valor';
import { Select } from '@/components/ui/select';
import { ErroDaApi } from '@/lib/http';
import { ResumoDeErros } from '../escritorio/resumo-de-erros';
import { ArquivarRegra, PublicarRegra } from './acoes-da-regra';
import {
  OPCOES_DE_OPERACAO,
  OPCOES_DE_REGIME,
  OPCOES_DE_TRIBUTO,
  formatarInstante,
} from './apresentacao';
import { ErroDoMotor } from './erro-do-motor';
import { focarPrimeiroCampoInvalido } from './foco';
import { useCriarRegra, useEditarRegra } from './queries';
import { rotuloDaRegra } from './resultado-da-simulacao';
import { validarEdicaoDaRegra, validarRegra } from './schema';

type Valores = {
  taxType: string;
  regime: string;
  operationType: string;
  validFrom: string;
  validUntil: string;
  baseReductionBasisPoints: number | null;
  rateBasisPoints: number | null;
  source: string;
  fixtureNote: string;
};

const CAMPOS = [
  'taxType',
  'regime',
  'operationType',
  'validFrom',
  'validUntil',
  'baseReductionBasisPoints',
  'rateBasisPoints',
  'source',
  'fixtureNote',
] as const;

const VAZIO: Valores = {
  taxType: '',
  regime: '',
  operationType: '',
  validFrom: '',
  validUntil: '',
  baseReductionBasisPoints: null,
  rateBasisPoints: null,
  source: '',
  fixtureNote: '',
};

const valoresDe = (regra: TaxRuleVersionDto | null): Valores =>
  regra === null
    ? VAZIO
    : {
        taxType: regra.taxType,
        regime: regra.regime,
        operationType: regra.operationType,
        validFrom: regra.validFrom,
        validUntil: regra.validUntil ?? '',
        baseReductionBasisPoints: regra.baseReductionBasisPoints,
        rateBasisPoints: regra.rateBasisPoints,
        source: regra.source,
        fixtureNote: regra.fixtureNote,
      };

const NUMERICO = 'font-mono text-code-sm tabular-nums';

/** Por que o formulário está bloqueado: a regra de negócio, dita na tela (FRONTEND.md §8, item 6). */
const explicacaoDoBloqueio = (regra: TaxRuleVersionDto, podeAdministrar: boolean): string | null => {
  const base =
    regra.status === 'PUBLISHED'
      ? 'Versão publicada é imutável. Para corrigir, crie um novo rascunho, arquive esta versão e publique o novo.'
      : regra.status === 'ARCHIVED'
        ? 'Versão arquivada: somente leitura. O histórico foi preservado.'
        : null;

  return podeAdministrar ? base : `${base ?? ''} Somente o administrador da plataforma altera o catálogo.`.trim();
};

const Auditoria = ({ regra }: { regra: TaxRuleVersionDto }) => (
  <dl className="grid gap-xs rounded-md bg-secondary p-md text-body-sm">
    <div className="flex justify-between gap-md">
      <dt className="text-muted-foreground">Criada em</dt>
      <dd className={NUMERICO}>{formatarInstante(regra.createdAt)}</dd>
    </div>
    {regra.publishedAt === null ? null : (
      <div className="flex justify-between gap-md">
        <dt className="text-muted-foreground">Publicada em</dt>
        <dd className={NUMERICO}>{formatarInstante(regra.publishedAt)}</dd>
      </div>
    )}
    {regra.archivedAt === null ? null : (
      <div className="flex justify-between gap-md">
        <dt className="text-muted-foreground">Arquivada em</dt>
        <dd className={NUMERICO}>{formatarInstante(regra.archivedAt)}</dd>
      </div>
    )}
    <div className="flex justify-between gap-md">
      <dt className="text-muted-foreground">Autor</dt>
      <dd className={NUMERICO}>{`${regra.createdBy.slice(0, 8)}…${regra.createdBy.slice(-4)}`}</dd>
    </div>
  </dl>
);

export const FormularioDaRegra = ({
  regra,
  podeAdministrar,
  aoConcluir,
  aoRecarregar,
}: {
  /** `null` = nova regra. */
  regra: TaxRuleVersionDto | null;
  podeAdministrar: boolean;
  aoConcluir: () => void;
  aoRecarregar: () => Promise<TaxRuleVersionDto | undefined>;
}) => {
  const criar = useCriarRegra();
  const editar = useEditarRegra();
  const [versaoEsperada, definirVersaoEsperada] = useState(regra?.lockVersion ?? 1);
  const [recarregada, definirRecarregada] = useState(false);
  const referenciaDoFormulario = useRef<HTMLFormElement>(null);
  const emEnvio = useRef(false);

  const somenteLeitura = regra !== null && (regra.status !== 'DRAFT' || !podeAdministrar);
  const salvar = regra === null ? criar : editar;
  const bloqueio = regra === null ? null : explicacaoDoBloqueio(regra, podeAdministrar);

  /** A edição leva só vigência, operação e fonte: a identidade é fixa e o contrato estrito a recusaria. */
  const paraEdicao = (valores: Valores) => ({
    validFrom: valores.validFrom,
    validUntil: valores.validUntil,
    baseReductionBasisPoints: valores.baseReductionBasisPoints,
    rateBasisPoints: valores.rateBasisPoints,
    source: valores.source,
    fixtureNote: valores.fixtureNote,
    expectedVersion: versaoEsperada,
  });

  const resolver: Resolver<Valores> = (valores) => {
    const resultado = regra === null ? validarRegra(valores) : validarEdicaoDaRegra(paraEdicao(valores));

    if (resultado.ok) {
      return { values: valores, errors: {} };
    }

    const errors: FieldErrors<Valores> = {};

    for (const campo of CAMPOS) {
      const message = resultado.erros[campo];

      if (message !== undefined) {
        errors[campo] = { type: 'validate', message };
      }
    }

    return { values: {}, errors };
  };

  const formulario = useForm<Valores>({
    resolver,
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: valoresDe(regra),
  });
  const alterado = formulario.formState.isDirty;

  const gravar = async (valores: Valores): Promise<void> => {
    try {
      if (regra === null) {
        const resultado = validarRegra(valores);

        if (resultado.ok) {
          await criar.mutateAsync(resultado.dados);
          aoConcluir();
        }
      } else {
        const resultado = validarEdicaoDaRegra(paraEdicao(valores));

        if (resultado.ok) {
          await editar.mutateAsync({ id: regra.id, corpo: resultado.dados });
          aoConcluir();
        }
      }
    } catch {
      // O erro fica em `salvar.error`: o painel o mostra como estado persistente.
    }
  };

  const aoEnviar = (evento: React.FormEvent<HTMLFormElement>): void => {
    evento.preventDefault();

    if (emEnvio.current) {
      return;
    }

    emEnvio.current = true;
    // `handleSubmit` nasce dentro do evento: só aqui é permitido ler a referência do formulário.
    void formulario
      .handleSubmit(gravar, () => focarPrimeiroCampoInvalido(referenciaDoFormulario.current))(evento)
      .finally(() => {
        emEnvio.current = false;
      });
  };

  const recarregar = async (): Promise<void> => {
    const atual = await aoRecarregar();

    if (atual !== undefined) {
      definirVersaoEsperada(atual.lockVersion);
      definirRecarregada(true);
      salvar.reset();
    }
  };

  const erroDoPainel = salvar.isError ? salvar.error : null;
  const conflito = erroDoPainel instanceof ErroDaApi && erroDoPainel.problema.code === CODIGOS_DE_ERRO.TAX_RULE_VERSION_CONFLICT;

  return (
    <form
      ref={referenciaDoFormulario}
      onSubmit={aoEnviar}
      noValidate
      aria-label={regra === null ? 'Nova regra' : 'Dados da regra'}
      className="flex flex-col gap-md"
    >
      {bloqueio === null ? null : (
        <p role="note" className="rounded-md bg-muted p-sm text-body-sm text-foreground">
          {bloqueio}
        </p>
      )}
      {regra === null ? (
        <p className="text-body-sm text-muted-foreground">
          O rascunho só passa a valer depois de publicado, e a publicação é recusada se a vigência se sobrepuser a outra versão
          publicada da mesma regra. Dados de teste não oficiais.
        </p>
      ) : null}

      <ResumoDeErros erros={formulario.formState.errors} />

      {regra === null ? (
        <>
          <Controller
            control={formulario.control}
            name="taxType"
            render={({ field, fieldState }) => (
              <Select rotulo="Tributo" obrigatorio opcoes={OPCOES_DE_TRIBUTO} valor={field.value} onValorChange={field.onChange} onBlur={field.onBlur} erro={fieldState.error?.message} />
            )}
          />
          <div className="grid gap-md tablet:grid-cols-2">
            <Controller
              control={formulario.control}
              name="regime"
              render={({ field, fieldState }) => (
                <Select rotulo="Regime" obrigatorio opcoes={OPCOES_DE_REGIME} valor={field.value} onValorChange={field.onChange} onBlur={field.onBlur} erro={fieldState.error?.message} />
              )}
            />
            <Controller
              control={formulario.control}
              name="operationType"
              render={({ field, fieldState }) => (
                <Select rotulo="Tipo de operação" obrigatorio opcoes={OPCOES_DE_OPERACAO} valor={field.value} onValorChange={field.onChange} onBlur={field.onBlur} erro={fieldState.error?.message} />
              )}
            />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-xs rounded-md bg-secondary p-md">
          <p className="text-label-sm uppercase text-muted-foreground">Identidade da regra</p>
          <p className="text-body-md text-foreground">{rotuloDaRegra(regra)}</p>
          <p className="text-body-sm text-muted-foreground">
            A identidade não muda depois de criada. Para outra combinação de tributo, regime e operação, crie um novo rascunho.
          </p>
        </div>
      )}

      <div className="grid gap-md tablet:grid-cols-2">
        <CampoControlado
          control={formulario.control}
          name="validFrom"
          rotulo="Início da vigência"
          type="date"
          obrigatorio
          readOnly={somenteLeitura}
        />
        <CampoControlado
          control={formulario.control}
          name="validUntil"
          rotulo="Fim da vigência"
          type="date"
          readOnly={somenteLeitura}
          ajuda="Em branco: sem data final. Os dois limites são inclusivos."
        />
      </div>

      <div className="grid gap-md tablet:grid-cols-2">
        <Controller
          control={formulario.control}
          name="rateBasisPoints"
          render={({ field, fieldState }) => (
            <CampoDeValor
              rotulo="Alíquota"
              tipo="percentual"
              obrigatorio
              valor={field.value}
              onValorChange={field.onChange}
              somenteLeitura={somenteLeitura}
              erro={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={formulario.control}
          name="baseReductionBasisPoints"
          render={({ field, fieldState }) => (
            <CampoDeValor
              rotulo="Redução de base"
              tipo="percentual"
              valor={field.value}
              onValorChange={field.onChange}
              somenteLeitura={somenteLeitura}
              erro={fieldState.error?.message}
              ajuda="Opcional. Aplicada antes da alíquota."
            />
          )}
        />
      </div>

      <CampoControlado control={formulario.control} name="source" rotulo="Fonte da regra" obrigatorio readOnly={somenteLeitura} ajuda="De onde vem este dado de teste." />

      <Controller
        control={formulario.control}
        name="fixtureNote"
        render={({ field, fieldState }) => (
          <AreaDeTexto
            rotulo="Aviso de fixture"
            value={field.value}
            onValorChange={field.onChange}
            onBlur={field.onBlur}
            readOnly={somenteLeitura}
            erro={fieldState.error?.message}
            ajuda="Opcional. Explica que o dado não é oficial."
          />
        )}
      />

      {regra === null ? null : <Auditoria regra={regra} />}

      {erroDoPainel === null ? null : (
        <ErroDoMotor
          erro={erroDoPainel}
          titulo={conflito ? 'A versão mudou' : 'Não foi possível salvar'}
          acao={
            conflito ? (
              <div>
                <Button variante="contorno" tamanho="compacto" onClick={() => void recarregar()}>
                  Recarregar versão atual
                </Button>
              </div>
            ) : undefined
          }
        />
      )}
      {recarregada && erroDoPainel === null ? (
        <p role="status" className="rounded-md bg-info p-sm text-body-sm text-info-foreground">
          A versão atual foi carregada. O que você digitou foi mantido: confira e salve de novo.
        </p>
      ) : null}

      {somenteLeitura ? (
        regra !== null && podeAdministrar && regra.status === 'PUBLISHED' ? (
          <div className="flex justify-end">
            <ArquivarRegra
              regra={regra}
              gatilho={
                <Button variante="contorno" tamanho="compacto">
                  Arquivar versão
                </Button>
              }
            />
          </div>
        ) : null
      ) : (
        <div className="sticky bottom-0 -mx-lg -mb-lg flex flex-wrap items-center justify-end gap-sm border-t border-border bg-popover px-lg py-md">
          {regra === null ? null : (
            <>
              {alterado ? <span className="text-body-sm text-muted-foreground">Salve as alterações antes de publicar.</span> : null}
              <PublicarRegra
                regra={regra}
                gatilho={
                  <Button variante="contorno" disabled={alterado}>
                    Publicar
                  </Button>
                }
              />
            </>
          )}
          <Button type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            {regra === null ? 'Criar rascunho' : 'Salvar rascunho'}
          </Button>
        </div>
      )}
    </form>
  );
};
