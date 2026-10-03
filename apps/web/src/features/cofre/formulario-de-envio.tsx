/**
 * Cadastro e substituição do certificado A1 (SPEC-011 §3.1, §3.3 e §5.2).
 *
 * Fluxo, sempre nesta ordem:
 *  1. a API emite um ticket de uso único (`POST /empresas/:id/certificados/ingestoes`);
 *  2. o navegador envia arquivo + senha + ticket DIRETO ao cofre, sem cookies e
 *     sem passar pelo proxy do Next (`envio.ts`);
 *  3. o cofre valida, guarda e devolve só metadados.
 *
 * A senha vive no estado do formulário, em memória, e é limpa assim que o cofre
 * responde — com sucesso ou recusa. Nunca vai à URL, ao armazenamento do
 * navegador, a log ou a uma mutação do cache (por isso o envio não é um
 * `useMutation`: o cache retém as variáveis da mutação).
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ItemDoCofre } from '@contaia/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CampoDeSenha } from '@/components/ui/campo-de-senha';
import { ErroDeTela } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { cnpjFormatado } from '../carteira/rotulos';
import { solicitarTicketDeIngestao } from './api';
import {
  campoDaRecusa,
  formatarDataCivil,
  mensagemDoCofre,
  podeEnviar,
  temAcao,
  type CampoDoEnvio,
} from './apresentacao';
import { enviarAoCofre, validarArquivoDoCertificado } from './envio';
import { focarCampo, rolarAte } from './foco';
import { invalidarSuperficiesDoCofre } from './queries';
import {
  CAMPO_DO_FORMULARIO,
  ORDEM_DOS_CAMPOS,
  VALORES_VAZIOS,
  envioSchema,
  type ValoresDoEnvio,
} from './schema';
import { SeletorDeEmpresa } from './seletor-de-empresa';
import { SelecaoDeResponsavel } from './selecao-de-responsavel';
import { ZonaDeArquivo } from './zona-de-arquivo';

type Etapa =
  | Readonly<{ fase: 'ocioso' }>
  | Readonly<{ fase: 'autorizando' }>
  | Readonly<{ fase: 'enviando'; fracao: number }>
  | Readonly<{ fase: 'validando' }>;

type Falha = Readonly<{ titulo: string; descricao: string; correlationId: string }>;

const OCIOSO: Etapa = { fase: 'ocioso' };

const MENSAGEM_DA_ETAPA: Readonly<Record<Exclude<Etapa['fase'], 'ocioso'>, string>> = {
  autorizando: 'Autorizando o envio…',
  enviando: 'Enviando o arquivo ao cofre…',
  validando: 'Validando o certificado no cofre…',
};

/** Responsável que já está no certificado, se ainda for elegível: o ponto de partida mais provável. */
const responsavelPadrao = (item: ItemDoCofre | null): string =>
  item?.responsavel !== null && item?.responsavel?.situacao === 'ATIVO' && !item.semResponsavel
    ? item.responsavel.id
    : '';

const valoresIniciais = (item: ItemDoCofre | null): ValoresDoEnvio => ({
  ...VALORES_VAZIOS,
  empresaId: item?.empresaId ?? '',
  responsavelId: responsavelPadrao(item),
});

const tituloDa = (empresa: ItemDoCofre | null): string => {
  if (empresa === null) {
    return 'Enviar certificado A1 ao cofre';
  }

  return temAcao(empresa, 'SUBSTITUIR') ? 'Substituir o certificado A1' : 'Cadastrar o certificado A1';
};

/** O que vai acontecer com o certificado que já existe, dito antes de a pessoa enviar. */
const avisoDaEmpresa = (empresa: ItemDoCofre): string => {
  if (empresa.certificado !== null && temAcao(empresa, 'SUBSTITUIR')) {
    return `Esta empresa já tem um certificado vigente, válido até ${formatarDataCivil(empresa.certificado.validoAte)}. O novo só o substitui depois de validado e guardado; se algo falhar, o atual continua valendo.`;
  }

  return empresa.estado === 'DESATIVADO'
    ? 'O certificado anterior foi desativado e fica no histórico. O novo passa a ser o vigente.'
    : 'Esta empresa ainda não tem certificado no cofre.';
};

const Progresso = ({ etapa }: { etapa: Etapa }) => {
  const fracao = etapa.fase === 'enviando' ? etapa.fracao : etapa.fase === 'validando' ? 1 : 0;
  const percentual = Math.round(fracao * 100);

  return (
    <div className="flex flex-col gap-xs">
      {/* Só a mudança de etapa é anunciada: anunciar cada ponto percentual afogaria o leitor de tela. */}
      <p role="status" aria-live="polite" className="text-body-sm text-foreground">
        {etapa.fase === 'ocioso' ? null : MENSAGEM_DA_ETAPA[etapa.fase]}
      </p>
      {etapa.fase === 'ocioso' ? null : (
        <div
          role="progressbar"
          aria-label="Progresso do envio"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentual}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          {/* `scaleX` e não `width`: anima na GPU, sem recalcular layout. */}
          <div
            className="h-full origin-left rounded-full bg-primary transition-transform duration-normal ease-out"
            style={{ transform: `scaleX(${fracao})` }}
          />
        </div>
      )}
    </div>
  );
};

export const FormularioDeEnvio = ({
  empresaInicial = null,
  focarAoMontar = false,
}: {
  empresaInicial?: ItemDoCofre | null;
  /** O envio foi pedido por uma ação da lista: leva a pessoa até o formulário. */
  focarAoMontar?: boolean;
}) => {
  const cliente = useQueryClient();
  const base = useId();
  const secao = useRef<HTMLElement>(null);
  const [empresa, definirEmpresa] = useState<ItemDoCofre | null>(empresaInicial);
  const [etapa, definirEtapa] = useState<Etapa>(OCIOSO);
  const [falha, definirFalha] = useState<Falha | null>(null);
  const [sucesso, definirSucesso] = useState<string | null>(null);

  const formulario = useForm<ValoresDoEnvio>({
    resolver: zodResolver(envioSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: valoresIniciais(empresaInicial),
  });

  useEffect(() => {
    if (focarAoMontar) {
      rolarAte(secao.current);
      focarCampo(secao.current ?? document, 'arquivo');
    }
  }, [focarAoMontar]);

  const ocupado = etapa.fase !== 'ocioso';
  const empresaId = useWatch({ control: formulario.control, name: 'empresaId' });

  const escolherEmpresa = (item: ItemDoCofre): void => {
    definirEmpresa(item);
    definirFalha(null);
    definirSucesso(null);
    formulario.setValue('empresaId', item.empresaId, { shouldDirty: true, shouldValidate: true });
    // A lista de elegíveis muda com a empresa: a escolha anterior deixa de valer.
    formulario.setValue('responsavelId', responsavelPadrao(item), { shouldDirty: true });
    formulario.clearErrors(['responsavelId']);
  };

  const limpar = (): void => {
    definirEmpresa(null);
    definirFalha(null);
    definirSucesso(null);
    formulario.reset(VALORES_VAZIOS);
  };

  const aoInvalidar = (erros: FieldErrors<ValoresDoEnvio>): void => {
    const primeiro = ORDEM_DOS_CAMPOS.find((campo) => erros[CAMPO_DO_FORMULARIO[campo]] !== undefined);

    if (primeiro !== undefined && secao.current !== null) {
      focarCampo(secao.current, primeiro);
    }
  };

  const escolherArquivo = (arquivo: File): void => {
    const motivo = validarArquivoDoCertificado(arquivo);

    if (motivo !== null) {
      formulario.setValue('arquivo', null);
      formulario.setError('arquivo', { type: 'validate', message: motivo });

      return;
    }

    formulario.setValue('arquivo', arquivo, { shouldDirty: true });
    formulario.clearErrors('arquivo');
    definirSucesso(null);
  };

  const tratarFalha = (erro: unknown): void => {
    const problema = erro instanceof ErroDaApi ? erro.problema : null;
    const codigo = problema?.code ?? 'ERRO_DESCONHECIDO';
    const campo: CampoDoEnvio | null = campoDaRecusa(codigo);
    const mensagem = mensagemDoCofre(codigo);

    if (campo === null) {
      // Cofre indisponível, ticket vencido ou erro da API: é do envio como um todo, não de um campo.
      definirFalha({
        titulo:
          codigo === 'COFRE_INDISPONIVEL'
            ? 'O cofre está indisponível'
            : 'Não foi possível enviar o certificado',
        descricao: mensagem,
        correlationId: problema?.correlationId ?? 'sem-correlacao',
      });
      toast.error(mensagem, {
        duration: Infinity,
        description: `Código de suporte: ${problema?.correlationId ?? 'sem-correlacao'}`,
      });

      return;
    }

    // Recusa do cofre: o erro mora no campo que a pessoa precisa corrigir (SPEC-011 §3.1).
    formulario.setError(CAMPO_DO_FORMULARIO[campo], { type: 'server', message: mensagem });
    definirFalha({
      titulo: 'O cofre não aceitou o certificado',
      descricao: 'Nada foi alterado. Corrija o campo indicado e envie de novo.',
      correlationId: problema?.correlationId ?? 'sem-correlacao',
    });

    if (secao.current !== null) {
      focarCampo(secao.current, campo);
    }
  };

  const enviar = async (valores: ValoresDoEnvio): Promise<void> => {
    const { arquivo } = valores;

    if (ocupado || arquivo === null || empresa === null) {
      return;
    }

    definirFalha(null);
    definirSucesso(null);
    definirEtapa({ fase: 'autorizando' });

    let chegouAoCofre = false;

    try {
      const ticket = await solicitarTicketDeIngestao(valores.empresaId, valores.responsavelId);

      chegouAoCofre = true;
      definirEtapa({ fase: 'enviando', fracao: 0 });

      const { certificado } = await enviarAoCofre({
        cofreUrl: ticket.cofreUrl,
        ticket: ticket.ticket,
        senha: valores.senha,
        arquivo,
        aoProgredir: (fracao) =>
          definirEtapa(fracao >= 1 ? { fase: 'validando' } : { fase: 'enviando', fracao }),
      });

      const resumo = `${empresa.empresaNome} · válido até ${formatarDataCivil(certificado.validoAte)}`;

      toast.success(
        ticket.operacao === 'SUBSTITUICAO' ? 'Certificado substituído.' : 'Certificado guardado no cofre.',
        { description: resumo },
      );
      definirSucesso(
        `${ticket.operacao === 'SUBSTITUICAO' ? 'Certificado substituído' : 'Certificado guardado no cofre'}: ${resumo}.`,
      );
      definirEmpresa(null);
      formulario.reset(VALORES_VAZIOS);
    } catch (erro) {
      tratarFalha(erro);
    } finally {
      // Depois que o cofre respondeu, a senha não tem mais serventia — e nunca fica na tela.
      if (chegouAoCofre) {
        formulario.setValue('senha', '');
      }

      definirEtapa(OCIOSO);
      await invalidarSuperficiesDoCofre(cliente);
    }
  };

  return (
    <section
      ref={secao}
      id="enviar-certificado"
      aria-labelledby={`${base}-titulo`}
      className="scroll-mt-lg rounded-xl border border-border bg-card p-lg shadow-[var(--elevation-1)]"
    >
      <div className="flex flex-col gap-xs pb-md tablet:flex-row tablet:items-start tablet:justify-between">
        <div className="flex flex-col gap-xs">
          <div className="flex items-center gap-sm">
            <Lock className="size-icon-lg text-foreground" aria-hidden="true" />
            <h2 id={`${base}-titulo`} className="font-display text-headline-sm text-foreground">
              {tituloDa(empresa)}
            </h2>
          </div>
          <p className="max-w-prose text-body-sm text-muted-foreground">
            Só certificado A1 de e-CNPJ ICP-Brasil, do mesmo CNPJ da empresa e dentro da validade. O
            arquivo é conferido por inteiro antes de ser guardado.
          </p>
        </div>
        <p className="shrink-0 rounded-md bg-muted px-sm py-xs font-mono text-code-xs text-foreground">
          .pfx / .p12 · até 10 MB
        </p>
      </div>

      <form
        noValidate
        onSubmit={(evento) => void formulario.handleSubmit(enviar, aoInvalidar)(evento)}
        className="grid gap-lg desktop:grid-cols-12"
      >
        <div className="desktop:col-span-5" data-campo="arquivo">
          <Controller
            control={formulario.control}
            name="arquivo"
            render={({ field, fieldState }) => (
              <ZonaDeArquivo
                arquivo={field.value}
                erro={fieldState.error?.message}
                desabilitada={ocupado}
                aoEscolher={escolherArquivo}
                aoRemover={() => {
                  formulario.setValue('arquivo', null, { shouldDirty: true });
                  formulario.clearErrors('arquivo');
                }}
                aoRejeitar={(mensagem) => {
                  formulario.setError('arquivo', { type: 'validate', message: mensagem });
                }}
              />
            )}
          />
        </div>

        <div className="flex flex-col gap-md desktop:col-span-7">
          <div data-campo="empresa" className="flex flex-col gap-xs">
            <Controller
              control={formulario.control}
              name="empresaId"
              render={({ fieldState }) => (
                <SeletorDeEmpresa
                  id={`${base}-empresa`}
                  empresa={empresa}
                  erro={fieldState.error?.message}
                  desabilitado={ocupado}
                  aoEscolher={escolherEmpresa}
                />
              )}
            />
            {empresa === null ? null : (
              <p className="text-body-sm text-muted-foreground">
                <span className="font-mono text-code-sm tabular-nums">{cnpjFormatado(empresa.cnpj)}</span>
                {empresa.regime === null ? '' : ` · ${empresa.regime}`}. {avisoDaEmpresa(empresa)}
                {podeEnviar(empresa) ? '' : ' Você não tem permissão para enviar certificado desta empresa.'}
              </p>
            )}
          </div>

          <div className="grid gap-md tablet:grid-cols-2">
            <div data-campo="senha">
              <Controller
                control={formulario.control}
                name="senha"
                render={({ field, fieldState }) => (
                  <CampoDeSenha
                    rotulo="Senha do certificado"
                    nomeParaOBotao="senha do certificado"
                    obrigatorio
                    value={field.value}
                    onValorChange={field.onChange}
                    onBlur={field.onBlur}
                    autoComplete="off"
                    erro={fieldState.error?.message}
                    ajuda="Segue direto ao cofre, junto com o arquivo."
                  />
                )}
              />
            </div>

            <div data-campo="responsavel">
              <Controller
                control={formulario.control}
                name="responsavelId"
                render={({ field, fieldState }) => (
                  <SelecaoDeResponsavel
                    empresaId={empresaId === '' ? null : empresaId}
                    valor={field.value}
                    aoMudar={field.onChange}
                    aoSair={field.onBlur}
                    erro={fieldState.error?.message}
                  />
                )}
              />
            </div>
          </div>

          <p className="flex items-start gap-sm text-body-sm text-muted-foreground">
            <ShieldCheck className="mt-xs size-icon-sm shrink-0" aria-hidden="true" />
            O arquivo e a senha seguem direto do navegador para o cofre local. A API do escritório
            recebe apenas os metadados do certificado.
          </p>

          <Progresso etapa={etapa} />

          {falha === null ? null : (
            <ErroDeTela
              titulo={falha.titulo}
              descricao={falha.descricao}
              correlationId={falha.correlationId}
            />
          )}

          {sucesso === null ? null : (
            <p
              role="status"
              className="rounded-md bg-success px-md py-sm text-body-sm text-success-foreground"
            >
              {sucesso}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-sm">
            <Button variante="fantasma" onClick={limpar} disabled={ocupado}>
              Cancelar
            </Button>
            <Button type="submit" disabled={ocupado} aria-busy={ocupado}>
              {ocupado ? (
                <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              Validar e guardar no cofre
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
};

