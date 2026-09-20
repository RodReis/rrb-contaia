'use client';

import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';

import { Campo, type PropsDoCampo } from './campo';

/**
 * Campo ligado ao React Hook Form pelo `Controller`.
 *
 * O `Controller` assina apenas o próprio campo; `watch()` no corpo do
 * componente re-renderiza o formulário inteiro a cada tecla e não é
 * memoizável pelo compilador do React.
 */
export const CampoControlado = <Formulario extends FieldValues>({
  control,
  name,
  ...props
}: Omit<PropsDoCampo, 'value' | 'onValorChange' | 'onBlur' | 'erro' | 'name'> & {
  control: Control<Formulario>;
  name: FieldPath<Formulario>;
}) => (
  <Controller
    control={control}
    name={name}
    render={({ field, fieldState }) => (
      <Campo
        {...props}
        value={typeof field.value === 'string' ? field.value : ''}
        onValorChange={field.onChange}
        onBlur={field.onBlur}
        erro={fieldState.error?.message}
      />
    )}
  />
);
