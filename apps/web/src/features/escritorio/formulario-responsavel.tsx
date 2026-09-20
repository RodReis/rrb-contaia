'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { ResumoDeErros } from './resumo-de-erros';
import { responsavelFormSchema, type ResponsavelForm } from './schema';
import { useSalvarResponsavel } from './queries';
import type { VisaoDoCadastro } from './api';

export const FormularioResponsavel = ({
  visao,
  aoAvancar,
  rotuloDeEnvio = 'Salvar e continuar',
}: {
  visao: VisaoDoCadastro;
  aoAvancar?: () => void;
  rotuloDeEnvio?: string;
}) => {
  const salvar = useSalvarResponsavel(aoAvancar);

  const formulario = useForm<ResponsavelForm>({
    resolver: zodResolver(responsavelFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      nomeCompleto: visao.cadastro.responsavel?.nomeCompleto ?? '',
      cpf: visao.cadastro.responsavel?.cpf ?? '',
      crc: visao.cadastro.responsavel?.crc ?? '',
      email: visao.cadastro.responsavel?.email ?? '',
      telefone: visao.cadastro.responsavel?.telefone ?? '',
    },
  });

  return (
    <form
      noValidate
      onSubmit={formulario.handleSubmit((dados) => salvar.mutate(dados))}
      className="flex flex-col gap-lg"
    >
      <ResumoDeErros erros={formulario.formState.errors} />

      <div className="flex flex-col gap-md">
        <CampoControlado
          control={formulario.control}
          name="nomeCompleto"
          rotulo="Nome completo"
          obrigatorio
          placeholder="Maria Souza"
        />

        <div className="grid gap-md tablet:grid-cols-2">
          <CampoControlado
            control={formulario.control}
            name="cpf"
            rotulo="CPF"
            obrigatorio
            mascara="cpf"
            inputMode="numeric"
            placeholder="000.000.000-00"
          />

          <CampoControlado
            control={formulario.control}
            name="crc"
            rotulo="Registro no CRC"
            obrigatorio
            placeholder="1SP123456/O-5"
          />
        </div>

        <div className="grid gap-md tablet:grid-cols-2">
          <CampoControlado
            control={formulario.control}
            name="email"
            rotulo="E-mail"
            obrigatorio
            type="email"
            inputMode="email"
            placeholder="responsavel@escritorio.cnt.br"
          />

          <CampoControlado
            control={formulario.control}
            name="telefone"
            rotulo="Telefone"
            obrigatorio
            mascara="telefone"
            inputMode="tel"
            placeholder="(11) 98765-4321"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : rotuloDeEnvio}
        </Button>
      </div>
    </form>
  );
};
