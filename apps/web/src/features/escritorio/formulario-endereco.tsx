'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { ResumoDeErros } from './resumo-de-erros';
import { enderecoFormSchema, type EnderecoForm } from './schema';
import { useSalvarEndereco } from './queries';
import type { VisaoDoCadastro } from './api';

export const FormularioEndereco = ({
  visao,
  aoAvancar,
  rotuloDeEnvio = 'Salvar e continuar',
}: {
  visao: VisaoDoCadastro;
  aoAvancar?: () => void;
  rotuloDeEnvio?: string;
}) => {
  const salvar = useSalvarEndereco(aoAvancar);
  const principal = visao.cadastro.enderecoPrincipal;

  const formulario = useForm<EnderecoForm>({
    resolver: zodResolver(enderecoFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      cep: principal?.cep ?? '',
      logradouro: principal?.logradouro ?? '',
      numero: principal?.numero ?? '',
      complemento: principal?.complemento ?? '',
      bairro: principal?.bairro ?? '',
      municipio: principal?.municipio ?? '',
      uf: principal?.uf ?? '',
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
        <div className="grid gap-md tablet:grid-cols-[12rem_1fr]">
          <CampoControlado
            control={formulario.control}
            name="cep"
            rotulo="CEP"
            obrigatorio
            mascara="cep"
            inputMode="numeric"
            placeholder="00000-000"
          />
          <CampoControlado
            control={formulario.control}
            name="logradouro"
            rotulo="Logradouro"
            obrigatorio
            placeholder="Avenida Paulista"
          />
        </div>

        <div className="grid gap-md tablet:grid-cols-2">
          <CampoControlado
            control={formulario.control}
            name="numero"
            rotulo="Número"
            obrigatorio
            placeholder="1000"
          />
          <CampoControlado
            control={formulario.control}
            name="complemento"
            rotulo="Complemento"
            placeholder="Conjunto 101"
            ajuda="Opcional."
          />
        </div>

        <div className="grid gap-md tablet:grid-cols-[1fr_1fr_8rem]">
          <CampoControlado
            control={formulario.control}
            name="bairro"
            rotulo="Bairro"
            obrigatorio
            placeholder="Bela Vista"
          />
          <CampoControlado
            control={formulario.control}
            name="municipio"
            rotulo="Município"
            obrigatorio
            placeholder="São Paulo"
          />
          <CampoControlado
            control={formulario.control}
            name="uf"
            rotulo="UF"
            obrigatorio
            maxLength={2}
            placeholder="SP"
            className="uppercase"
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
