/**
 * Aceite do convite (SPEC-007 §3.2): a pessoa chega só com o link, confere que é
 * o convite dela, define a senha e entra.
 *
 * Não há sessão aqui — tudo passa pela rota pública estreita da web. O link
 * inválido responde sempre igual, qualquer que seja o motivo (inexistente,
 * usado, invalidado por reenvio, vencido): a tela não pode virar oráculo.
 *
 * A senha vai direto ao servidor e nunca é gravada, logada nem guardada no
 * navegador; o Keycloak é quem a define e aplica a política.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { CampoDeSenha } from '@/components/ui/campo-de-senha';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { avisarFalha } from '../escritorio/queries';
import { useAceitarConvite, useConvite } from './queries';

const TAMANHO_MINIMO = 10;
const DESTINO_DO_ACESSO = '/api/auth/entrar?destino=%2Fempresas';

const senhaFormSchema = z
  .object({
    senha: z
      .string()
      .min(TAMANHO_MINIMO, `A senha precisa ter ao menos ${TAMANHO_MINIMO} caracteres.`)
      .max(256, 'Use no máximo 256 caracteres.'),
    confirmacao: z.string(),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    message: 'As senhas não conferem.',
    path: ['confirmacao'],
  });

type SenhaForm = z.infer<typeof senhaFormSchema>;

/** Data e hora em `America/Sao_Paulo` (I-11). */
const formatarInstante = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

const Titulo = ({ children }: { children: string }) => (
  <h1 className="font-display text-headline-lg text-foreground">{children}</h1>
);

const ConviteIndisponivel = ({
  titulo,
  descricao,
  correlationId,
  aoTentarDeNovo,
}: {
  titulo: string;
  descricao: string;
  correlationId?: string | undefined;
  aoTentarDeNovo?: () => void;
}) => (
  <div className="flex flex-col gap-lg">
    <Titulo>Convite indisponível</Titulo>
    <ErroDeTela
      nivel={2}
      titulo={titulo}
      descricao={descricao}
      correlationId={correlationId}
      acao={
        aoTentarDeNovo === undefined ? undefined : (
          <Button variante="contorno" tamanho="compacto" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Button>
        )
      }
    />
  </div>
);

export const AceiteDeConvite = ({ token }: { token: string }) => {
  const convite = useConvite(token);
  const aceitar = useAceitarConvite(token);

  const formulario = useForm<SenhaForm>({
    resolver: zodResolver(senhaFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { senha: '', confirmacao: '' },
  });

  const enviar = async ({ senha }: SenhaForm): Promise<void> => {
    try {
      await aceitar.mutateAsync(senha);
    } catch (erro) {
      if (erro instanceof ErroDaApi && erro.problema.code === 'SENHA_FRACA') {
        formulario.setError('senha', {
          type: 'server',
          message: mensagemDoCodigo(erro.problema.code),
        });
      } else if (!(erro instanceof ErroDaApi && erro.problema.code === 'CONVITE_INVALIDO')) {
        avisarFalha(erro);
      }
    }
  };

  if (convite.isPending) {
    return (
      <div className="flex flex-col gap-lg" aria-busy="true" aria-live="polite">
        <span className="sr-only">Verificando o seu convite</span>
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const conviteInvalidoNoEnvio =
    aceitar.error instanceof ErroDaApi && aceitar.error.problema.code === 'CONVITE_INVALIDO';

  if (convite.isError || conviteInvalidoNoEnvio) {
    const problema =
      convite.error instanceof ErroDaApi ? convite.error.problema : null;
    const invalido = conviteInvalidoNoEnvio || problema?.code === 'CONVITE_INVALIDO';

    return (
      <ConviteIndisponivel
        titulo={invalido ? 'Este convite não é válido' : 'Não foi possível abrir o convite'}
        descricao={
          invalido
            ? mensagemDoCodigo('CONVITE_INVALIDO')
            : problema === null
              ? 'Tente novamente em instantes.'
              : mensagemDoCodigo(problema.code)
        }
        correlationId={invalido ? undefined : problema?.correlationId}
        {...(invalido ? {} : { aoTentarDeNovo: () => void convite.refetch() })}
      />
    );
  }

  if (aceitar.isSuccess) {
    return (
      <div className="flex flex-col gap-lg">
        <Titulo>Senha definida</Titulo>
        <div className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg">
          <p className="flex items-center gap-sm text-title-sm text-foreground">
            <CheckCircle2 className="size-icon-md text-success-foreground" aria-hidden="true" />
            Seu acesso está ativo.
          </p>
          <p className="text-body-md text-muted-foreground">
            Use o e-mail do convite e a senha que você acabou de definir para entrar.
          </p>
          <Button asChild>
            <a href={DESTINO_DO_ACESSO}>Entrar no ContaIA</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-xs">
        <Titulo>Defina a sua senha</Titulo>
        <p className="text-body-md text-muted-foreground">
          Olá, {convite.data.nome}. Este convite é para{' '}
          <strong className="font-medium text-foreground">{convite.data.emailMascarado}</strong> e
          vale até{' '}
          <time dateTime={convite.data.expiraEm} className="tabular-nums text-foreground">
            {formatarInstante(convite.data.expiraEm)}
          </time>{' '}
          (horário de São Paulo).
        </p>
      </div>

      <form
        noValidate
        onSubmit={formulario.handleSubmit(enviar)}
        className="flex flex-col gap-lg rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]"
      >
        <Controller
          control={formulario.control}
          name="senha"
          render={({ field, fieldState }) => (
            <CampoDeSenha
              rotulo="Nova senha"
              nomeParaOBotao="senha"
              obrigatorio
              value={field.value}
              onValorChange={field.onChange}
              onBlur={field.onBlur}
              erro={fieldState.error?.message}
              ajuda={`Use ao menos ${TAMANHO_MINIMO} caracteres.`}
            />
          )}
        />

        <Controller
          control={formulario.control}
          name="confirmacao"
          render={({ field, fieldState }) => (
            <CampoDeSenha
              rotulo="Confirme a senha"
              nomeParaOBotao="confirmação da senha"
              obrigatorio
              value={field.value}
              onValorChange={field.onChange}
              onBlur={field.onBlur}
              erro={fieldState.error?.message}
            />
          )}
        />

        {/* O botão nunca é desabilitado por validação: clicar mostra o que falta (PATTERNS.md §6). */}
        <Button type="submit" className="w-full" disabled={aceitar.isPending}>
          {aceitar.isPending ? 'Enviando…' : 'Definir senha e entrar'}
        </Button>
      </form>
    </div>
  );
};
