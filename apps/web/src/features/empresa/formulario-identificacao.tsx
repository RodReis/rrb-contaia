'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { formatarCnpj } from '@contaia/domain';

import { Button } from '@/components/ui/button';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { ResumoDeErros } from '../escritorio/resumo-de-erros';
import { identificacaoDaEmpresaFormSchema, type IdentificacaoDaEmpresaForm } from './schema';
import { useSalvarIdentificacaoDaEmpresa } from './queries';
import type { VisaoDaEmpresa } from './api';

export const FormularioIdentificacao = ({
  visao,
  aoAvancar,
  rotuloDeEnvio = 'Salvar e continuar',
  somenteLeitura = false,
  aoSalvar,
  ocupado,
}: {
  visao: VisaoDaEmpresa;
  aoAvancar?: () => void;
  rotuloDeEnvio?: string;
  somenteLeitura?: boolean;
  /** Substitui o salvamento do wizard pelo da manutenção, que gera histórico. */
  aoSalvar?: (dados: IdentificacaoDaEmpresaForm) => void;
  ocupado?: boolean;
}) => {
  const salvar = useSalvarIdentificacaoDaEmpresa(visao.id, aoAvancar);
  const enviando = ocupado ?? salvar.isPending;
  const identificacao = visao.cadastro.identificacao;

  const formulario = useForm<IdentificacaoDaEmpresaForm>({
    resolver: zodResolver(identificacaoDaEmpresaFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      razaoSocial: identificacao?.razaoSocial ?? '',
      nomeFantasia: identificacao?.nomeFantasia ?? '',
      telefone: identificacao?.telefone ?? '',
      email: identificacao?.email ?? '',
    },
  });

  return (
    <form
      noValidate
      onSubmit={formulario.handleSubmit((dados) =>
        aoSalvar === undefined ? salvar.mutate(dados) : aoSalvar(dados),
      )}
      className="flex flex-col gap-lg"
    >
      <ResumoDeErros erros={formulario.formState.errors} />

      {/* `fieldset disabled` desliga todos os controles de uma vez, nativamente,
          e é o que a empresa arquivada exige: consulta sem edição (§3.5). */}
      <fieldset disabled={somenteLeitura} className="flex flex-col gap-md border-0 p-0">
        {/* O CNPJ define a identidade da empresa e a unicidade no escritório:
            trocá-lo seria outra empresa, então é exibido e não editado. */}
        <div className="flex flex-col gap-xs">
          <span className="text-label-md text-foreground">CNPJ</span>
          <p className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-md font-mono text-code-sm tabular-nums text-foreground tablet:h-10">
            {identificacao === null ? '—' : formatarCnpj(identificacao.cnpj)}
          </p>
          <p className="text-body-sm text-muted-foreground">
            O CNPJ não muda depois de iniciado o cadastro.
          </p>
        </div>

        <CampoControlado
          control={formulario.control}
          name="razaoSocial"
          rotulo="Razão social"
          obrigatorio
          placeholder="Empresa Comércio de Alimentos Ltda."
        />

        <CampoControlado
          control={formulario.control}
          name="nomeFantasia"
          rotulo="Nome fantasia"
          obrigatorio
          placeholder="Nome usado no dia a dia"
        />

        <div className="grid gap-md tablet:grid-cols-2">
          <CampoControlado
            control={formulario.control}
            name="telefone"
            rotulo="Telefone"
            mascara="telefone"
            inputMode="tel"
            placeholder="(00) 00000-0000"
            ajuda="Opcional."
          />

          <CampoControlado
            control={formulario.control}
            name="email"
            rotulo="E-mail"
            type="email"
            inputMode="email"
            placeholder="contato@empresa.com.br"
            ajuda="Opcional."
          />
        </div>
      </fieldset>

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
