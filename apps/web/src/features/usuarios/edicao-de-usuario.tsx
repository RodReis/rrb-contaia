/**
 * Edição de usuário (SPEC-007 §3.3 e §5.1): abas `Dados` e `Papéis` sobre um
 * único estado, e um único "Salvar alterações" — a API grava dados e papéis
 * juntos, na mesma transação e no mesmo evento de auditoria.
 *
 * - E-mail só muda enquanto o convite não foi aceito; depois é imutável.
 * - Usuário arquivado só volta por novo convite: dados e papéis são revisados
 *   aqui e o botão passa a ser "Enviar novo convite".
 * - Quem só consulta vê tudo desabilitado, sem botão de gravar.
 * - O bloqueio do último administrador abre um `AlertDialog`, não um toast.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CodigoDeErro, PapelPadrao } from '@contaia/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Abas, ConteudoDeAba, GatilhoDeAba, ListaDeAbas } from '@/components/ui/abas';
import { AvisoBloqueante } from '@/components/ui/aviso-bloqueante';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { VisaoDeUsuario } from './api';
import { CamposDoUsuario } from './campos-do-usuario';
import { ErroDaConsulta, SemPermissao } from './erro-da-consulta';
import { useEditarUsuario, useNovoConvite, useSessao, useUsuario } from './queries';
import { SITUACAO } from './rotulos';
import {
  dadosDoUsuarioFormSchema,
  erroDosPapeis,
  paraDadosDeEdicao,
  type DadosDoUsuarioForm,
} from './schema';
import { SeletorDePapeis } from './seletor-de-papeis';

const LISTA = '/configuracoes/usuarios';

type NomeDaAba = 'dados' | 'papeis';

/** Data e hora em `America/Sao_Paulo` (I-11). */
const formatarInstante = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

const AJUDA_DO_EMAIL = {
  editavel: 'Corrigir o e-mail invalida o link anterior e envia um novo convite.',
  imutavel: 'O e-mail só pode ser corrigido antes de o convite ser aceito.',
} as const;

const Cabecalho = ({
  usuario,
  administra,
}: {
  usuario: VisaoDeUsuario | null;
  administra: boolean;
}) => {
  const situacao = usuario === null ? null : SITUACAO[usuario.situacao];

  return (
    <header className="flex flex-col gap-sm">
      <Breadcrumb
        itens={[
          { rotulo: 'Início', href: '/empresas' },
          { rotulo: 'Configurações' },
          { rotulo: 'Usuários e permissões', href: LISTA },
          { rotulo: usuario?.nome ?? 'Usuário' },
        ]}
      />
      <div className="flex flex-col gap-xs">
        <div className="flex flex-wrap items-center gap-sm">
          <h1 className="break-words font-display text-headline-lg text-foreground">
            {usuario?.nome ?? 'Usuário'}
          </h1>
          {situacao === null ? null : <StatusBadge tom={situacao.tom} rotulo={situacao.rotulo} />}
          {administra && usuario?.envioFalhou === true ? (
            <StatusBadge tom="atencao" rotulo="E-mail não enviado" />
          ) : null}
        </div>
        {usuario === null ? null : (
          <p className="break-words text-body-md text-muted-foreground">
            {usuario.email}
            {/* Prazo do convite é dado técnico: só quem administra o vê. */}
            {administra && usuario.conviteExpiraEm !== null
              ? ` · Convite válido até ${formatarInstante(usuario.conviteExpiraEm)}`
              : ''}
          </p>
        )}
      </div>
    </header>
  );
};

const valoresIniciais = (usuario: VisaoDeUsuario): DadosDoUsuarioForm => ({
  nome: usuario.nome,
  email: usuario.email,
  telefone: usuario.telefone ?? '',
  crc: usuario.crc ?? '',
});

const FormularioDeEdicao = ({
  usuario,
  administra,
  aba,
  aoMudarAba,
}: {
  usuario: VisaoDeUsuario;
  administra: boolean;
  aba: NomeDaAba;
  aoMudarAba: (aba: NomeDaAba) => void;
}) => {
  const navegador = useRouter();
  const editar = useEditarUsuario(usuario.id);
  const novoConvite = useNovoConvite(usuario.id);

  const arquivado = usuario.estado === 'ARQUIVADO';
  // Corrigir o e-mail só faz sentido antes do aceite; depois ele é a identidade da pessoa.
  const emailEditavel = administra && usuario.estado === 'CONVIDADO';

  const formulario = useForm<DadosDoUsuarioForm>({
    resolver: zodResolver(dadosDoUsuarioFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: valoresIniciais(usuario),
  });

  const [papeis, definirPapeis] = useState<readonly PapelPadrao[]>(usuario.papeis);
  const [erroDePapel, definirErroDePapel] = useState<string | undefined>(undefined);
  const [bloqueio, definirBloqueio] = useState<string | null>(null);

  const gravar = async (dados: DadosDoUsuarioForm): Promise<void> => {
    const erroDoPapel = erroDosPapeis(papeis);

    definirErroDePapel(erroDoPapel);

    if (erroDoPapel !== undefined) {
      aoMudarAba('papeis');

      return;
    }

    const corpo = paraDadosDeEdicao(dados, papeis, emailEditavel);

    try {
      if (arquivado) {
        await novoConvite.mutateAsync(corpo);
        navegador.push(LISTA);
      } else {
        await editar.mutateAsync(corpo);
      }
    } catch (erro) {
      if (!(erro instanceof ErroDaApi)) {
        return;
      }

      const { code } = erro.problema;

      if (code === 'ULTIMO_ADMIN') {
        definirBloqueio(mensagemDoCodigo(code));
      } else if (code === 'EMAIL_JA_UTILIZADO') {
        aoMudarAba('dados');
        formulario.setError('email', { type: 'server', message: mensagemDoCodigo(code) });
      } else {
        for (const { campo, codigo } of erro.problema.campos ?? []) {
          if (campo === 'nome' || campo === 'email' || campo === 'telefone' || campo === 'crc') {
            aoMudarAba('dados');
            formulario.setError(campo, {
              type: 'server',
              message: mensagemDoCodigo(codigo as CodigoDeErro),
            });
          }
        }
      }
    }
  };

  const ocupado = editar.isPending || novoConvite.isPending;

  return (
    <form
      noValidate
      onSubmit={formulario.handleSubmit(gravar, () => aoMudarAba('dados'))}
      className="flex flex-col gap-lg"
    >
      {arquivado && administra ? (
        <p className="rounded-md border border-border bg-muted px-md py-md text-body-sm text-foreground">
          Este usuário está arquivado e sem acesso. Revise os dados e os papéis e envie um novo
          convite para ele voltar: o histórico anterior é mantido.
        </p>
      ) : null}

      {administra ? null : (
        <p className="rounded-md border border-border bg-muted px-md py-md text-body-sm text-foreground">
          Você tem acesso somente leitura a este usuário.
        </p>
      )}

      <Abas value={aba} onValueChange={(valor) => aoMudarAba(valor as NomeDaAba)}>
        <ListaDeAbas aria-label="Seções do usuário">
          <GatilhoDeAba value="dados">Dados</GatilhoDeAba>
          <GatilhoDeAba value="papeis">Papéis</GatilhoDeAba>
        </ListaDeAbas>

        <ConteudoDeAba value="dados">
          {/* `fieldset disabled` desabilita todos os campos de uma vez para quem só consulta. */}
          <fieldset disabled={!administra} className="min-w-0">
            <legend className="sr-only">Dados do usuário</legend>
            <CamposDoUsuario
              control={formulario.control}
              emailEditavel={emailEditavel}
              ajudaDoEmail={emailEditavel ? AJUDA_DO_EMAIL.editavel : AJUDA_DO_EMAIL.imutavel}
            />
          </fieldset>
        </ConteudoDeAba>

        <ConteudoDeAba value="papeis">
          <SeletorDePapeis
            valor={papeis}
            aoMudar={(proximos) => {
              definirPapeis(proximos);
              definirErroDePapel(undefined);
            }}
            erro={erroDePapel}
            somenteLeitura={!administra}
          />
        </ConteudoDeAba>
      </Abas>

      {administra ? (
        <div className="flex flex-wrap justify-between gap-sm">
          <Button asChild variante="fantasma">
            <Link href={LISTA}>Cancelar</Link>
          </Button>
          <Button type="submit" disabled={ocupado}>
            {ocupado ? 'Salvando…' : arquivado ? 'Enviar novo convite' : 'Salvar alterações'}
          </Button>
        </div>
      ) : (
        <div>
          <Button asChild variante="contorno">
            <Link href={LISTA}>Voltar para a lista</Link>
          </Button>
        </div>
      )}

      <AvisoBloqueante
        aberto={bloqueio !== null}
        titulo="Não é possível continuar"
        descricao={bloqueio ?? ''}
        aoFechar={() => definirBloqueio(null)}
      />
    </form>
  );
};

export const EdicaoDeUsuario = ({ usuarioId }: { usuarioId: string }) => {
  const sessao = useSessao();
  const usuario = useUsuario(usuarioId);
  const [aba, definirAba] = useState<NomeDaAba>('dados');

  if (sessao.isPending || usuario.isPending) {
    return (
      <div className="flex flex-col gap-xl" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando o usuário</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (sessao.isError) {
    return (
      <ErroDaConsulta
        erro={sessao.error}
        titulo="Não foi possível verificar o seu acesso"
        aoTentarDeNovo={() => void sessao.refetch()}
      />
    );
  }

  if (!sessao.data.permissoes.USUARIOS.includes('consultar')) {
    return <SemPermissao />;
  }

  if (usuario.isError) {
    const problema = usuario.error instanceof ErroDaApi ? usuario.error.problema : null;

    if (problema?.code === 'USUARIO_NAO_ENCONTRADO') {
      return (
        <ErroDeTela
          nivel={2}
          titulo="Usuário não encontrado"
          descricao={mensagemDoCodigo(problema.code)}
          correlationId={problema.correlationId}
          acao={
            <Button asChild variante="contorno" tamanho="compacto">
              <Link href={LISTA}>Voltar para a lista</Link>
            </Button>
          }
        />
      );
    }

    return (
      <ErroDaConsulta
        erro={usuario.error}
        titulo="Não foi possível carregar o usuário"
        aoTentarDeNovo={() => void usuario.refetch()}
      />
    );
  }

  const administra = sessao.data.permissoes.USUARIOS.includes('administrar');

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho usuario={usuario.data} administra={administra} />
      {/* `key` na versão: depois de salvar, o formulário recomeça dos dados gravados. */}
      <FormularioDeEdicao
        key={usuario.data.versao}
        usuario={usuario.data}
        administra={administra}
        aba={aba}
        aoMudarAba={definirAba}
      />
    </div>
  );
};
