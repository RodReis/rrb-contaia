/**
 * Campos de dados do usuário (SPEC-007 §3.2): nome e e-mail obrigatórios;
 * telefone e CRC opcionais; sem CPF. Compartilhado pelo wizard de convite e pela
 * edição, para os dois dizerem a mesma coisa do mesmo jeito.
 */
'use client';

import type { Control } from 'react-hook-form';

import { CampoControlado } from '@/components/ui/campo-controlado';
import type { DadosDoUsuarioForm } from './schema';

export const CamposDoUsuario = ({
  control,
  emailEditavel,
  ajudaDoEmail,
}: {
  control: Control<DadosDoUsuarioForm>;
  emailEditavel: boolean;
  ajudaDoEmail: string;
}) => (
  <div className="flex flex-col gap-md">
    <CampoControlado
      control={control}
      name="nome"
      rotulo="Nome completo"
      obrigatorio
      autoComplete="off"
      placeholder="Maria Souza"
    />

    <CampoControlado
      control={control}
      name="email"
      rotulo="E-mail"
      obrigatorio
      type="email"
      inputMode="email"
      autoComplete="off"
      disabled={!emailEditavel}
      ajuda={ajudaDoEmail}
      placeholder="maria@escritorio.com.br"
    />

    <div className="grid gap-md tablet:grid-cols-2">
      <CampoControlado
        control={control}
        name="telefone"
        rotulo="Telefone"
        mascara="telefone"
        inputMode="tel"
        ajuda="Opcional."
        placeholder="(11) 98765-4321"
      />

      <CampoControlado
        control={control}
        name="crc"
        rotulo="Registro no CRC"
        ajuda="Opcional."
        placeholder="SP-123456/O"
      />
    </div>
  </div>
);
