/**
 * Etapa de dados fiscais (SPEC-002 §4.3).
 *
 * Dois condicionais aqui são regra de negócio, não conveniência de layout:
 * enquadramento só aparece no Simples Nacional, e o número da inscrição só
 * aparece quando a situação é "Possui". Esconder o campo não basta — o schema
 * e o servidor validam o mesmo condicional.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, X } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { Select } from '@/components/ui/select';
import { ResumoDeErros } from '../escritorio/resumo-de-erros';
import {
  dadosFiscaisFormSchema,
  type DadosFiscaisForm,
  type DadosFiscaisValidados,
} from './schema';
import { useSalvarDadosFiscais } from './queries';
import type { VisaoDaEmpresa } from './api';

const OPCOES_DE_REGIME = [
  { valor: 'SIMPLES_NACIONAL', rotulo: 'Simples Nacional' },
  { valor: 'LUCRO_PRESUMIDO', rotulo: 'Lucro Presumido' },
  { valor: 'LUCRO_REAL', rotulo: 'Lucro Real' },
] as const;

const OPCOES_DE_ENQUADRAMENTO = [
  { valor: 'MEI', rotulo: 'MEI' },
  { valor: 'NAO_MEI', rotulo: 'Não MEI' },
] as const;

const OPCOES_DE_INSCRICAO = [
  { valor: 'POSSUI', rotulo: 'Possui' },
  { valor: 'ISENTO', rotulo: 'Isento' },
  { valor: 'NAO_SE_APLICA', rotulo: 'Não se aplica' },
] as const;

export const FormularioFiscal = ({
  visao,
  aoAvancar,
  rotuloDeEnvio = 'Salvar e continuar',
  exigeVigencia = false,
  somenteLeitura = false,
  aoSalvar,
  ocupado,
}: {
  visao: VisaoDaEmpresa;
  aoAvancar?: () => void;
  rotuloDeEnvio?: string;
  /**
   * Na manutenção (SPEC-003 §3.2), mudar regime ou CNAE exige data de vigência
   * passada ou atual. No wizard da SPEC-002 o conceito não existe: a empresa
   * está nascendo e não há mudança a datar.
   */
  exigeVigencia?: boolean;
  somenteLeitura?: boolean;
  /** Substitui o salvamento do wizard pelo da manutenção, que gera histórico. */
  aoSalvar?: (dados: DadosFiscaisValidados, vigencia: string) => void;
  ocupado?: boolean;
}) => {
  const salvar = useSalvarDadosFiscais(visao.id, aoAvancar);
  const fiscais = visao.cadastro.dadosFiscais;
  const [cnaeNovo, definirCnaeNovo] = useState('');
  const [vigencia, definirVigencia] = useState('');
  const [erroDaVigencia, definirErroDaVigencia] = useState<string | undefined>(undefined);
  const enviando = ocupado ?? salvar.isPending;

  const formulario = useForm<DadosFiscaisForm, unknown, DadosFiscaisValidados>({
    resolver: zodResolver(dadosFiscaisFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      // `exactOptionalPropertyTypes` distingue "chave ausente" de "chave com
      // undefined": regime e enquadramento não escolhidos precisam estar
      // ausentes, senão o tipo do enum obrigatório não fecha.
      ...(fiscais?.regimeTributario != null
        ? { regimeTributario: fiscais.regimeTributario }
        : {}),
      ...(fiscais?.enquadramentoSimples != null
        ? { enquadramentoSimples: fiscais.enquadramentoSimples }
        : {}),
      cnaePrincipal: fiscais?.cnaePrincipal ?? '',
      cnaesSecundarios: [...(fiscais?.cnaesSecundarios ?? [])],
      inscricaoEstadual: {
        situacao: fiscais?.inscricaoEstadual.situacao ?? 'NAO_SE_APLICA',
        numero: fiscais?.inscricaoEstadual.numero ?? '',
      },
      inscricaoMunicipal: {
        situacao: fiscais?.inscricaoMunicipal.situacao ?? 'NAO_SE_APLICA',
        numero: fiscais?.inscricaoMunicipal.numero ?? '',
      },
    },
  });

  // `useWatch` em vez de `formulario.watch()`: o `watch` devolve função nova a
  // cada render e o React Compiler desiste de memoizar o componente inteiro —
  // num formulário com campos condicionais isso custa re-render a cada tecla.
  const controle = formulario.control;
  const regime = useWatch({ control: controle, name: 'regimeTributario' });
  const situacaoEstadual = useWatch({ control: controle, name: 'inscricaoEstadual.situacao' });
  const situacaoMunicipal = useWatch({ control: controle, name: 'inscricaoMunicipal.situacao' });
  // `?? []` porque o campo é opcional na entrada do schema: o `.default([])` só
  // se aplica depois da validação.
  const secundarios = useWatch({ control: controle, name: 'cnaesSecundarios' }) ?? [];

  const adicionarCnae = (): void => {
    const codigo = cnaeNovo.replace(/\D/gu, '');

    if (codigo.length === 0 || secundarios.includes(codigo)) {
      definirCnaeNovo('');

      return;
    }

    formulario.setValue('cnaesSecundarios', [...secundarios, codigo], { shouldDirty: true });
    definirCnaeNovo('');
  };

  return (
    <form
      noValidate
      onSubmit={formulario.handleSubmit((dados) => {
        if (aoSalvar === undefined) {
          salvar.mutate(dados);

          return;
        }

        if (exigeVigencia && vigencia.length === 0) {
          definirErroDaVigencia('Informe a data de vigência.');

          return;
        }

        aoSalvar(dados, vigencia);
      })}
      className="flex flex-col gap-lg"
    >
      <ResumoDeErros erros={formulario.formState.errors} />

      {/* `fieldset disabled` desliga todos os controles de uma vez, nativamente,
          e é o que a empresa arquivada exige: consulta sem edição (§3.5). */}
      <fieldset disabled={somenteLeitura} className="flex flex-col gap-md border-0 p-0">
        <div className="grid gap-md tablet:grid-cols-2">
          <Controller
            control={formulario.control}
            name="regimeTributario"
            render={({ field, fieldState }) => (
              <Select
                rotulo="Regime tributário"
                obrigatorio
                opcoes={OPCOES_DE_REGIME}
                valor={field.value}
                onValorChange={(valor) => {
                  field.onChange(valor);

                  // Sair do Simples limpa o enquadramento: deixar o valor
                  // antigo no formulário mandaria MEI junto com Lucro Real.
                  if (valor !== 'SIMPLES_NACIONAL') {
                    formulario.setValue('enquadramentoSimples', undefined, {
                      shouldValidate: true,
                    });
                  }
                }}
                onBlur={field.onBlur}
                erro={fieldState.error?.message}
                ajuda="O regime não é inferido: escolha conforme o enquadramento da empresa."
              />
            )}
          />

          {regime === 'SIMPLES_NACIONAL' ? (
            <Controller
              control={formulario.control}
              name="enquadramentoSimples"
              render={({ field, fieldState }) => (
                <Select
                  rotulo="Enquadramento no Simples"
                  obrigatorio
                  opcoes={OPCOES_DE_ENQUADRAMENTO}
                  valor={field.value}
                  onValorChange={field.onChange}
                  onBlur={field.onBlur}
                  erro={fieldState.error?.message}
                  ajuda="MEI é enquadramento do Simples, não um regime separado."
                />
              )}
            />
          ) : null}
        </div>

        <CampoControlado
          control={formulario.control}
          name="cnaePrincipal"
          rotulo="CNAE principal"
          obrigatorio
          inputMode="numeric"
          placeholder="0000000"
          ajuda="Apenas números, sem pontuação."
        />

        <fieldset className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg">
          <legend className="px-xs text-label-md text-foreground">
            CNAEs secundários <span className="text-muted-foreground">(opcional)</span>
          </legend>

          {secundarios.length > 0 ? (
            <ul className="flex flex-wrap gap-xs">
              {secundarios.map((codigo) => (
                <li key={codigo}>
                  <span className="inline-flex items-center gap-xs rounded-sm bg-muted px-sm py-xs font-mono text-code-sm tabular-nums text-foreground">
                    {codigo}
                    <button
                      type="button"
                      onClick={() =>
                        formulario.setValue(
                          'cnaesSecundarios',
                          secundarios.filter((atual) => atual !== codigo),
                          { shouldDirty: true },
                        )
                      }
                      aria-label={`Remover o CNAE ${codigo}`}
                      className="rounded-sm text-muted-foreground transition-colors duration-fast hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-icon-xs" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-muted-foreground">Nenhum CNAE secundário informado.</p>
          )}

          <div className="flex flex-col gap-sm tablet:flex-row tablet:items-end">
            <div className="flex-1">
              <Campo
                rotulo="Adicionar CNAE secundário"
                value={cnaeNovo}
                onValorChange={definirCnaeNovo}
                inputMode="numeric"
                placeholder="0000000"
                // Enter dentro do campo adiciona o código em vez de enviar a
                // etapa inteira, que é o que o usuário espera aqui.
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter') {
                    evento.preventDefault();
                    adicionarCnae();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variante="contorno"
              onClick={adicionarCnae}
              disabled={cnaeNovo.replace(/\D/gu, '').length === 0}
            >
              <Plus aria-hidden="true" />
              Adicionar
            </Button>
          </div>
        </fieldset>

        <div className="grid gap-md tablet:grid-cols-2">
          <div className="flex flex-col gap-md">
            <Controller
              control={formulario.control}
              name="inscricaoEstadual.situacao"
              render={({ field, fieldState }) => (
                <Select
                  rotulo="Inscrição estadual"
                  obrigatorio
                  opcoes={OPCOES_DE_INSCRICAO}
                  valor={field.value}
                  onValorChange={(valor) => {
                    field.onChange(valor);

                    if (valor !== 'POSSUI') {
                      formulario.setValue('inscricaoEstadual.numero', '', {
                        shouldValidate: true,
                      });
                    }
                  }}
                  onBlur={field.onBlur}
                  erro={fieldState.error?.message}
                />
              )}
            />

            {situacaoEstadual === 'POSSUI' ? (
              <CampoControlado
                control={formulario.control}
                name="inscricaoEstadual.numero"
                rotulo="Número da inscrição estadual"
                obrigatorio
                inputMode="numeric"
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-md">
            <Controller
              control={formulario.control}
              name="inscricaoMunicipal.situacao"
              render={({ field, fieldState }) => (
                <Select
                  rotulo="Inscrição municipal"
                  obrigatorio
                  opcoes={OPCOES_DE_INSCRICAO}
                  valor={field.value}
                  onValorChange={(valor) => {
                    field.onChange(valor);

                    if (valor !== 'POSSUI') {
                      formulario.setValue('inscricaoMunicipal.numero', '', {
                        shouldValidate: true,
                      });
                    }
                  }}
                  onBlur={field.onBlur}
                  erro={fieldState.error?.message}
                />
              )}
            />

            {situacaoMunicipal === 'POSSUI' ? (
              <CampoControlado
                control={formulario.control}
                name="inscricaoMunicipal.numero"
                rotulo="Número da inscrição municipal"
                obrigatorio
                inputMode="numeric"
              />
            ) : null}
          </div>
        </div>
      </fieldset>

      {exigeVigencia ? (
        <div className="tablet:max-w-[16rem]">
          <Campo
            rotulo="Vigência da alteração"
            obrigatorio
            type="date"
            value={vigencia}
            onValorChange={(valor) => {
              definirVigencia(valor);
              definirErroDaVigencia(undefined);
            }}
            erro={erroDaVigencia}
            // O teto é a data de hoje: vigência futura é recusada pelo servidor,
            // e oferecer a data no seletor prometeria o que não se cumpre.
            max={new Date().toLocaleDateString('en-CA', {
              timeZone: 'America/Sao_Paulo',
            })}
            ajuda="Regime e CNAE exigem vigência passada ou atual."
          />
        </div>
      ) : null}

      {somenteLeitura ? null : (
        <div className="flex justify-end">
          <Button type="submit" disabled={enviando}>
            {enviando ? 'Salvando…' : rotuloDeEnvio}
          </Button>
        </div>
      )}
    </form>
  );
};
