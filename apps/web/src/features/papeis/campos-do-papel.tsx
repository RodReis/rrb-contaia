/**
 * Campos de identificação do papel (SPEC-008 §3.1): nome e descrição. Compartilhado
 * pelo wizard de criação e pela aba `Resumo` da edição.
 */
'use client';

import { TAMANHO_MAXIMO_DA_DESCRICAO } from '@contaia/domain';
import { Controller, type Control } from 'react-hook-form';

import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { CampoControlado } from '@/components/ui/campo-controlado';
import type { DadosDoPapelForm } from './schema';

export const CamposDoPapel = ({ control }: { control: Control<DadosDoPapelForm> }) => (
  <div className="flex flex-col gap-md">
    <CampoControlado
      control={control}
      name="nome"
      rotulo="Nome do papel"
      obrigatorio
      autoComplete="off"
      placeholder="Revisor fiscal"
      ajuda="Único no escritório, sem diferenciar maiúsculas de minúsculas. Pode ser renomeado depois."
    />

    <Controller
      control={control}
      name="descricao"
      render={({ field, fieldState }) => (
        <AreaDeTexto
          rotulo="Descrição"
          value={field.value}
          onValorChange={field.onChange}
          onBlur={field.onBlur}
          erro={fieldState.error?.message}
          maxLength={TAMANHO_MAXIMO_DA_DESCRICAO + 50}
          placeholder="Para que serve este papel e quem deve recebê-lo"
          ajuda="Opcional."
        />
      )}
    />
  </div>
);
