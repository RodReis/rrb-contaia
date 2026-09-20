/**
 * Entrada do cadastro: consulta por CNPJ (SPEC-002 §3.3 e §3.4).
 *
 * Todos os desfechos da fonte externa têm estado próprio na tela — consultando,
 * encontrado, não encontrado, limite excedido, indisponível, resposta inválida.
 * Em nenhum deles o cadastro para: falha externa libera o preenchimento manual
 * com aviso de que o dado não foi validado na fonte.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, CircleCheck, Info, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useState } from 'react';

import { formatarCnpj } from '@contaia/domain';
import { mensagemDaFalhaDaConsulta } from '@contaia/shared';

import { Button } from '@/components/ui/button';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { cnpjFormSchema, type CnpjForm } from './schema';
import { useConsultarCnpj, useCriarEmpresa } from './queries';
import type { ResultadoDaConsultaDeCnpj } from './api';

const Aviso = ({
  tom,
  titulo,
  descricao,
  acao,
}: {
  tom: 'sucesso' | 'atencao' | 'informacao';
  titulo: string;
  descricao: string;
  acao?: React.ReactNode;
}) => {
  const estilos = {
    sucesso: {
      caixa: 'border-success-indicator/40 bg-success',
      titulo: 'text-success-foreground',
      texto: 'text-success-foreground/90',
      icone: <CircleCheck className="size-icon-md text-success-indicator" aria-hidden="true" />,
    },
    atencao: {
      caixa: 'border-warning-indicator/40 bg-warning',
      titulo: 'text-warning-foreground',
      texto: 'text-warning-foreground/90',
      icone: <CircleAlert className="size-icon-md text-warning-indicator" aria-hidden="true" />,
    },
    informacao: {
      caixa: 'border-info-indicator/40 bg-info',
      titulo: 'text-info-foreground',
      texto: 'text-info-foreground/90',
      icone: <Info className="size-icon-md text-info-indicator" aria-hidden="true" />,
    },
  }[tom];

  return (
    <div
      role="status"
      className={`flex flex-col gap-sm rounded-md border px-md py-md ${estilos.caixa}`}
    >
      <div className="flex items-start gap-sm">
        {estilos.icone}
        <div className="flex flex-col gap-xs">
          <p className={`text-title-sm ${estilos.titulo}`}>{titulo}</p>
          <p className={`text-body-sm ${estilos.texto}`}>{descricao}</p>
        </div>
      </div>
      {acao}
    </div>
  );
};

export const ConsultaDeCnpj = () => {
  const navegador = useRouter();
  const [resultado, definirResultado] = useState<ResultadoDaConsultaDeCnpj | null>(null);

  const consultar = useConsultarCnpj();
  const criar = useCriarEmpresa((visao) => navegador.push(`/empresas/${visao.id}`));

  const formulario = useForm<CnpjForm>({
    resolver: zodResolver(cnpjFormSchema),
    // Validar a cada tecla acusaria erro de um CNPJ pela metade.
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { cnpj: '' },
  });

  const consultando = consultar.isPending;
  const criando = criar.isPending;

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-headline-lg text-foreground">Cadastrar empresa</h1>
        <p className="max-w-prose text-body-md text-muted-foreground">
          Informe o CNPJ para buscarmos os dados públicos da empresa. Você confere e edita tudo
          antes de salvar.
        </p>
      </header>

      <form
        noValidate
        onSubmit={formulario.handleSubmit(({ cnpj }) => {
          definirResultado(null);
          consultar.mutate(cnpj, { onSuccess: definirResultado });
        })}
        className="flex flex-col gap-lg"
      >
        {/* Largura em valor explícito: este projeto define `--spacing-*` mas
            não a escala de containers do Tailwind, então `max-w-sm` resolve
            pela escala de spacing e vira 0.5rem — o campo colapsa para 8px. */}
        <div className="w-full tablet:max-w-[24rem]">
          <CampoControlado
            control={formulario.control}
            name="cnpj"
            rotulo="CNPJ da empresa"
            obrigatorio
            mascara="cnpj"
            inputMode="text"
            placeholder="00.000.000/0000-00"
            ajuda="Aceita o formato alfanumérico vigente."
          />
        </div>

        <div className="flex flex-wrap gap-sm">
          <Button type="submit" disabled={consultando || criando}>
            <Search aria-hidden="true" />
            {consultando ? 'Consultando…' : 'Consultar CNPJ'}
          </Button>
        </div>

        {consultando ? (
          <p className="text-body-sm text-muted-foreground" aria-live="polite">
            Consultando a base pública de CNPJ…
          </p>
        ) : null}
      </form>

      {resultado?.situacao === 'existente' ? (
        <Aviso
          tom="informacao"
          titulo="Esta empresa já está neste escritório"
          descricao={
            resultado.status === 'ATIVA'
              ? 'A empresa já está ativa. Abra o cadastro para consultar os dados.'
              : 'O cadastro está incompleto. Continue de onde parou.'
          }
          acao={
            <div className="flex flex-wrap gap-sm">
              <Button asChild variante="contorno" tamanho="compacto">
                <a href={`/empresas/${resultado.empresaId}`}>
                  {resultado.status === 'ATIVA' ? 'Abrir cadastro' : 'Continuar cadastro'}
                </a>
              </Button>
            </div>
          }
        />
      ) : null}

      {resultado?.situacao === 'consultado' ? (
        <div className="flex flex-col gap-lg">
          <Aviso
            tom="sucesso"
            titulo="Dados encontrados na base pública"
            descricao="Os campos abaixo vêm da consulta e continuam editáveis. Nada é salvo até você iniciar o cadastro."
          />

          <dl className="grid gap-md rounded-lg border border-border bg-card p-lg tablet:grid-cols-2">
            <div className="flex flex-col gap-xs">
              <dt className="text-label-sm uppercase text-muted-foreground">CNPJ</dt>
              <dd className="font-mono text-code-sm tabular-nums text-foreground">
                {formatarCnpj(resultado.cnpj)}
              </dd>
            </div>
            <div className="flex flex-col gap-xs">
              <dt className="text-label-sm uppercase text-muted-foreground">Situação cadastral</dt>
              <dd className="text-body-md text-foreground">
                {resultado.dados.situacaoCadastral ?? 'Não informada'}
              </dd>
            </div>
            <div className="flex flex-col gap-xs tablet:col-span-2">
              <dt className="text-label-sm uppercase text-muted-foreground">Razão social</dt>
              <dd className="text-body-md text-foreground">
                {resultado.dados.razaoSocial ?? 'Não informada'}
              </dd>
            </div>
            <div className="flex flex-col gap-xs">
              <dt className="text-label-sm uppercase text-muted-foreground">Nome fantasia</dt>
              <dd className="text-body-md text-foreground">
                {resultado.dados.nomeFantasia ?? 'Não informado'}
              </dd>
            </div>
            <div className="flex flex-col gap-xs">
              <dt className="text-label-sm uppercase text-muted-foreground">CNAE principal</dt>
              <dd className="font-mono text-code-sm tabular-nums text-foreground">
                {resultado.dados.cnaePrincipal ?? '—'}
              </dd>
            </div>
          </dl>

          {resultado.dados.situacaoCadastral !== null &&
          resultado.dados.situacaoCadastral.trim().toLowerCase() !== 'ativa' ? (
            <Aviso
              tom="atencao"
              titulo={`Situação cadastral: ${resultado.dados.situacaoCadastral}`}
              descricao="A empresa pode ser cadastrada, mas a ativação vai exigir confirmação explícita desta situação."
            />
          ) : null}

          <div className="flex justify-end">
            <Button
              onClick={() => criar.mutate(resultado.cnpj)}
              disabled={criando || consultando}
            >
              {criando ? 'Iniciando…' : 'Iniciar cadastro'}
            </Button>
          </div>
        </div>
      ) : null}

      {resultado?.situacao === 'sem_fonte' ? (
        <div className="flex flex-col gap-lg">
          <Aviso
            tom="atencao"
            titulo="Dados não validados pela fonte externa"
            descricao={mensagemDaFalhaDaConsulta(resultado.motivo)}
          />

          <div className="flex justify-end">
            <Button
              onClick={() => criar.mutate(resultado.cnpj)}
              disabled={criando || consultando}
            >
              {criando ? 'Iniciando…' : 'Preencher manualmente'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
