'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { ResumoDeErros } from './resumo-de-erros';
import { UploadDeArquivo } from './upload-de-arquivo';
import { identificacaoFormSchema, type IdentificacaoForm } from './schema';
import { useSalvarIdentificacao } from './queries';
import type { VisaoDoCadastro } from './api';

export const FormularioIdentificacao = ({
  visao,
  aoAvancar,
  rotuloDeEnvio = 'Salvar e continuar',
}: {
  visao: VisaoDoCadastro;
  aoAvancar?: () => void;
  rotuloDeEnvio?: string;
}) => {
  const salvar = useSalvarIdentificacao(aoAvancar);
  const logo = visao.arquivos.find((arquivo) => arquivo.tipo === 'LOGO');

  const formulario = useForm<IdentificacaoForm>({
    resolver: zodResolver(identificacaoFormSchema),
    // Validar a cada tecla acusaria erro de um CNPJ pela metade.
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      cnpj: visao.cadastro.identificacao?.cnpj ?? '',
      razaoSocial: visao.cadastro.identificacao?.razaoSocial ?? '',
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
          name="cnpj"
          rotulo="CNPJ do escritório"
          obrigatorio
          mascara="cnpj"
          inputMode="text"
          placeholder="00.000.000/0000-00"
          ajuda="Aceita o formato alfanumérico vigente."
        />

        <CampoControlado
          control={formulario.control}
          name="razaoSocial"
          rotulo="Razão social"
          obrigatorio
          placeholder="Escritório Contábil Ltda."
        />

        <UploadDeArquivo
          tipo="LOGO"
          rotulo="Logo do escritório"
          descricao="PNG, JPG, SVG ou WEBP, até 2 MB."
          obrigatorio
          arquivos={logo === undefined ? [] : [logo]}
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : rotuloDeEnvio}
        </Button>
      </div>
    </form>
  );
};
