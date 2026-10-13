/**
 * Simulador manual (SPEC-016 §3.5): data do fato, regime, tributo, operação e base monetária. É
 * independente de empresa e de competência e não cria apuração, guia, lançamento nem obrigação.
 * O formulário valida com o contrato da API e envia a base em centavos inteiros; a regra, a
 * alíquota e o cálculo são sempre do servidor.
 */
'use client';

import { Calculator, LoaderCircle } from 'lucide-react';
import { useRef } from 'react';
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { CampoDeValor } from '@/components/ui/campo-de-valor';
import { Select } from '@/components/ui/select';
import { ResumoDeErros } from '../escritorio/resumo-de-erros';
import { OPCOES_DE_OPERACAO, OPCOES_DE_REGIME, OPCOES_DE_TRIBUTO } from './apresentacao';
import { ErroDoMotor } from './erro-do-motor';
import { focarPrimeiroCampoInvalido } from './foco';
import { useSimularManual } from './queries';
import { ResultadoDaSimulacao } from './resultado-da-simulacao';
import { validarSimulacaoManual } from './schema';

type Valores = {
  factDate: string;
  regime: string;
  taxType: string;
  operationType: string;
  baseCents: number | null;
};

const VALORES_INICIAIS: Valores = { factDate: '', regime: '', taxType: '', operationType: '', baseCents: null };

const CAMPOS = ['factDate', 'regime', 'taxType', 'operationType', 'baseCents'] as const;

const resolver: Resolver<Valores> = (valores) => {
  const resultado = validarSimulacaoManual(valores);

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

export const FormularioManual = () => {
  const simular = useSimularManual();
  const formulario = useForm<Valores>({
    resolver,
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: VALORES_INICIAIS,
  });
  const referenciaDoFormulario = useRef<HTMLFormElement>(null);
  // Trava síncrona: dois cliques no mesmo instante não podem virar duas simulações (FRONTEND.md §6.3).
  const emEnvio = useRef(false);

  const aoEnviar = (evento: React.FormEvent<HTMLFormElement>): void => {
    evento.preventDefault();

    if (emEnvio.current) {
      return;
    }

    emEnvio.current = true;
    // `handleSubmit` nasce dentro do evento: só aqui é permitido ler a referência do formulário.
    void formulario
      .handleSubmit(
        async (valores) => {
          const resultado = validarSimulacaoManual(valores);

          if (resultado.ok) {
            await simular.mutateAsync(resultado.dados).catch(() => undefined);
          }
        },
        () => focarPrimeiroCampoInvalido(referenciaDoFormulario.current),
      )(evento)
      .finally(() => {
        emEnvio.current = false;
      });
  };

  const erros = formulario.formState.errors;

  return (
    <div className="grid gap-lg desktop:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <form
        ref={referenciaDoFormulario}
        onSubmit={aoEnviar}
        noValidate
        aria-label="Simulação manual"
        className="flex flex-col gap-md self-start rounded-lg border border-border bg-card p-md"
      >
        <p className="text-body-sm text-muted-foreground">
          Os campos com <span className="text-danger-foreground">*</span> são obrigatórios. A simulação não cria apuração, guia
          nem lançamento.
        </p>

        <ResumoDeErros erros={erros} />

        <CampoControlado
          control={formulario.control}
          name="factDate"
          rotulo="Data do fato gerador"
          type="date"
          obrigatorio
          ajuda="A regra é escolhida pela vigência nesta data, nunca pela data de hoje."
        />

        <div className="grid gap-md tablet:grid-cols-2">
          <Controller
            control={formulario.control}
            name="regime"
            render={({ field, fieldState }) => (
              <Select
                rotulo="Regime"
                obrigatorio
                opcoes={OPCOES_DE_REGIME}
                valor={field.value}
                onValorChange={field.onChange}
                onBlur={field.onBlur}
                erro={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={formulario.control}
            name="taxType"
            render={({ field, fieldState }) => (
              <Select
                rotulo="Tributo"
                obrigatorio
                opcoes={OPCOES_DE_TRIBUTO}
                valor={field.value}
                onValorChange={field.onChange}
                onBlur={field.onBlur}
                erro={fieldState.error?.message}
              />
            )}
          />
        </div>

        <Controller
          control={formulario.control}
          name="operationType"
          render={({ field, fieldState }) => (
            <Select
              rotulo="Tipo de operação"
              obrigatorio
              opcoes={OPCOES_DE_OPERACAO}
              valor={field.value}
              onValorChange={field.onChange}
              onBlur={field.onBlur}
              erro={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={formulario.control}
          name="baseCents"
          render={({ field, fieldState }) => (
            <CampoDeValor
              rotulo="Base de cálculo"
              tipo="moeda"
              obrigatorio
              valor={field.value}
              onValorChange={field.onChange}
              erro={fieldState.error?.message}
              ajuda="Valor da operação em reais, com até duas casas."
            />
          )}
        />

        <div className="flex justify-end">
          <Button type="submit" disabled={simular.isPending}>
            {simular.isPending ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : <Calculator aria-hidden="true" />}
            Simular
          </Button>
        </div>
      </form>

      <div className="min-w-0" aria-live="polite">
        {simular.isError ? <ErroDoMotor erro={simular.error} titulo="Não foi possível simular" /> : null}
        {simular.isSuccess && !simular.isPending ? <ResultadoDaSimulacao resultado={simular.data} /> : null}
      </div>
    </div>
  );
};
