/**
 * Edição de papel (SPEC-008 §3.5 e §5.2): abas `Resumo` e `Permissões` sobre um
 * único estado e um único "Salvar alterações" — a API grava nome, descrição e
 * matriz juntos, numa só revisão e num só conjunto de eventos de auditoria.
 *
 * - Redução de permissões num papel atribuído abre um `AlertDialog` com os
 *   usuários afetados e as permissões retiradas; a confirmação segue ao servidor.
 * - Papel atribuído a usuário não arquiva: o bloqueio é explicado no diálogo.
 * - Papel arquivado só volta por reativação com revisão obrigatória da matriz
 *   preservada contra o catálogo vigente; vínculos antigos não são restaurados.
 * - Quem só consulta vê tudo desabilitado, sem botão de gravar.
 * - Revisão desatualizada (outra pessoa mexeu) pede recarga, sem sobrescrever.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { diferencaDeMatriz, ehReducao } from '@contaia/domain';
import type { ChaveDoCatalogo } from '@contaia/domain';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Abas, ConteudoDeAba, GatilhoDeAba, ListaDeAbas } from '@/components/ui/abas';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { ErroDaConsulta, SemPermissao } from '../usuarios/erro-da-consulta';
import { ADMINISTRACAO_DE_USUARIOS, CONSULTA_DE_USUARIOS, pode } from '../usuarios/permissoes';
import { useSessao } from '../usuarios/queries';
import { ROTULO_DO_PAPEL } from '../usuarios/rotulos';
import type { CatalogoDePermissoes, DetalheDePapel } from './api';
import { CamposDoPapel } from './campos-do-papel';
import { DiferencaDaMatriz } from './diferenca-da-matriz';
import { MatrizDePermissoes } from './matriz-de-permissoes';
import { useArquivarPapel, useCatalogo, useEditarPapel, usePapel, useReativarPapel } from './queries';
import { ESTADO_DO_PAPEL, formatarInstante, rotuloDaChave, textoDeUsuarios } from './rotulos';
import { dadosDoPapelFormSchema, descricaoOuNula, erroDaMatriz, type DadosDoPapelForm } from './schema';

const LISTA = '/configuracoes/usuarios?aba=papeis';

type NomeDaAba = 'resumo' | 'permissoes';

const Cabecalho = ({ papel }: { papel: DetalheDePapel | null }) => {
  const estado = papel === null ? null : ESTADO_DO_PAPEL[papel.estado];

  return (
    <header className="flex flex-col gap-sm">
      <Breadcrumb
        itens={[
          { rotulo: 'Início', href: '/empresas' },
          { rotulo: 'Configurações' },
          { rotulo: 'Usuários e permissões', href: '/configuracoes/usuarios' },
          { rotulo: 'Papéis e permissões', href: LISTA },
          { rotulo: papel?.nome ?? 'Papel' },
        ]}
      />
      <div className="flex flex-col gap-xs">
        <div className="flex flex-wrap items-center gap-sm">
          <h1 className="break-words font-display text-headline-lg text-foreground">
            {papel?.nome ?? 'Papel'}
          </h1>
          {estado === null ? null : <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />}
          {papel === null ? null : (
            <StatusBadge tom="neutro" rotulo={`Revisão ${papel.revisao}`} />
          )}
        </div>
        {papel === null ? null : (
          <p className="break-words text-body-md text-muted-foreground">
            Baseado em {ROTULO_DO_PAPEL[papel.papelBase]} · Atualizado em{' '}
            {formatarInstante(papel.atualizadoEm)}
          </p>
        )}
      </div>
    </header>
  );
};

const Aviso = ({ children }: { children: string }) => (
  <p className="rounded-md border border-border bg-muted px-md py-md text-body-sm text-foreground">
    {children}
  </p>
);

const UsuariosVinculados = ({ papel }: { papel: DetalheDePapel }) => (
  <section
    aria-labelledby="usuarios-do-papel"
    className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg"
  >
    <h2 id="usuarios-do-papel" className="text-headline-sm text-foreground">
      Usuários vinculados
    </h2>
    {papel.usuarios.length === 0 ? (
      <p className="text-body-sm text-muted-foreground">
        Nenhum usuário tem este papel. Atribua-o em Usuários, na aba Papéis do usuário.
      </p>
    ) : (
      <>
        <p className="text-body-sm text-muted-foreground">
          {textoDeUsuarios(papel.usuarios.length)} {papel.usuarios.length === 1 ? 'tem' : 'têm'} este
          papel e sentem qualquer mudança nele na próxima requisição.
        </p>
        <ul className="flex flex-col gap-xs">
          {papel.usuarios.map((usuario) => (
            <li key={usuario.id} className="break-words text-body-md">
              <Link
                href={`/configuracoes/usuarios/${usuario.id}`}
                className="rounded-sm text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {usuario.nome}
              </Link>
            </li>
          ))}
        </ul>
      </>
    )}
  </section>
);

const Incompatibilidades = ({
  catalogo,
  chaves,
}: {
  catalogo: CatalogoDePermissoes;
  chaves: readonly string[];
}) => (
  <section
    aria-labelledby="incompatibilidades"
    className="flex flex-col gap-sm rounded-lg border border-warning-indicator/40 bg-warning px-md py-md"
  >
    <h2 id="incompatibilidades" className="text-title-md text-warning-foreground">
      {chaves.length === 1
        ? '1 permissão preservada não existe mais no catálogo'
        : `${chaves.length} permissões preservadas não existem mais no catálogo`}
    </h2>
    <p className="text-body-sm text-warning-foreground">
      Elas não serão restauradas ao reativar o papel. Revise a matriz abaixo e confirme a reativação.
    </p>
    <ul className="flex flex-col gap-xs text-body-sm text-warning-foreground">
      {chaves.map((chave) => (
        <li key={chave} className="break-words">
          {rotuloDaChave(catalogo, chave)}
        </li>
      ))}
    </ul>
  </section>
);

const Formulario = ({
  papel,
  catalogo,
  administra,
  aba,
  aoMudarAba,
  aoRecarregar,
}: {
  papel: DetalheDePapel;
  catalogo: CatalogoDePermissoes;
  administra: boolean;
  aba: NomeDaAba;
  aoMudarAba: (aba: NomeDaAba) => void;
  aoRecarregar: () => void;
}) => {
  const editar = useEditarPapel(papel.id);
  const arquivar = useArquivarPapel(papel.id);
  const reativar = useReativarPapel(papel.id);

  const arquivado = papel.estado === 'ARQUIVADO';
  const editavel = administra;

  const formulario = useForm<DadosDoPapelForm>({
    resolver: zodResolver(dadosDoPapelFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { nome: papel.nome, descricao: papel.descricao ?? '' },
  });

  const [matriz, definirMatriz] = useState<readonly ChaveDoCatalogo[]>(papel.permissoes);
  const [erroDaMatrizNaTela, definirErroDaMatriz] = useState<string | undefined>(undefined);
  const [desatualizado, definirDesatualizado] = useState(false);

  const diferenca = diferencaDeMatriz(papel.permissoes, matriz);
  const reduz = ehReducao(diferenca);
  // Só redução num papel atribuído exige confirmação; ampliar ou editar papel livre grava direto.
  const exigeConfirmacao = !arquivado && reduz && papel.usuariosVinculados > 0;

  const tratarErro = (erro: unknown): void => {
    if (!(erro instanceof ErroDaApi)) {
      return;
    }

    const { code } = erro.problema;

    if (code === 'CONFLITO_DE_VERSAO') {
      definirDesatualizado(true);
    } else if (code === 'PAPEL_NOME_DUPLICADO') {
      aoMudarAba('resumo');
      formulario.setError('nome', { type: 'server', message: mensagemDoCodigo(code) });
    } else if (code === 'MATRIZ_INVALIDA' || code === 'PERMISSAO_INEXISTENTE' || code === 'PERMISSAO_EXCLUSIVA') {
      aoMudarAba('permissoes');
      definirErroDaMatriz(mensagemDoCodigo(code));
    }
  };

  const gravar = async (dados: DadosDoPapelForm, confirmaReducao: boolean): Promise<void> => {
    const erro = erroDaMatriz(matriz);

    definirErroDaMatriz(erro);

    if (erro !== undefined) {
      aoMudarAba('permissoes');

      return;
    }

    try {
      await editar.mutateAsync({
        nome: dados.nome.trim(),
        descricao: descricaoOuNula(dados.descricao),
        permissoes: matriz,
        revisaoEsperada: papel.revisao,
        confirmaReducao,
      });
    } catch (falha) {
      tratarErro(falha);
      // Dentro do diálogo de confirmação o erro precisa voltar a ele.
      throw falha;
    }
  };

  const confirmarEGravar = async (): Promise<void> => {
    const valido = await formulario.trigger();

    if (!valido) {
      aoMudarAba('resumo');

      return;
    }

    await gravar(formulario.getValues(), true);
  };

  const reativarComRevisao = async (): Promise<void> => {
    const erro = erroDaMatriz(matriz);

    definirErroDaMatriz(erro);

    if (erro !== undefined) {
      aoMudarAba('permissoes');

      return;
    }

    try {
      await reativar.mutateAsync({
        revisaoEsperada: papel.revisao,
        permissoes: matriz,
        confirmaIncompatibilidades: papel.incompatibilidades.length > 0,
      });
    } catch (falha) {
      tratarErro(falha);
      throw falha;
    }
  };

  const ocupado = editar.isPending || reativar.isPending || arquivar.isPending;
  const explicarBloqueio = (erro: unknown): string | null =>
    erro instanceof ErroDaApi && erro.problema.code === 'REDUCAO_NAO_CONFIRMADA'
      ? mensagemDoCodigo(erro.problema.code)
      : null;

  return (
    <form
      noValidate
      onSubmit={formulario.handleSubmit(
        (dados) => {
          // Enter num campo não pode atalhar a confirmação de redução: o botão dela é o único caminho.
          if (exigeConfirmacao) {
            toast.info('Esta alteração reduz permissões. Use “Salvar alterações” para confirmar.');

            return;
          }

          void gravar(dados, false).catch(() => undefined);
        },
        () => aoMudarAba('resumo'),
      )}
      className="flex flex-col gap-lg"
    >
      {desatualizado ? (
        <div
          role="alert"
          className="flex flex-col gap-sm rounded-lg border border-warning-indicator/40 bg-warning px-md py-md"
        >
          <p className="text-body-sm text-warning-foreground">
            {mensagemDoCodigo('CONFLITO_DE_VERSAO')} As suas alterações não foram aplicadas.
          </p>
          <div>
            <Button variante="contorno" tamanho="compacto" onClick={aoRecarregar}>
              Recarregar a última revisão
            </Button>
          </div>
        </div>
      ) : null}

      {arquivado && administra ? (
        <Aviso>
          Este papel está arquivado e não pode ser atribuído. Revise as permissões na aba Permissões e
          reative-o: vínculos anteriores com usuários não são restaurados, e o histórico é mantido.
        </Aviso>
      ) : null}

      {administra ? null : <Aviso>Você tem acesso somente leitura a este papel.</Aviso>}

      {arquivado && papel.incompatibilidades.length > 0 ? (
        <Incompatibilidades catalogo={catalogo} chaves={papel.incompatibilidades} />
      ) : null}

      <Abas
        value={aba}
        onValueChange={(valor) => aoMudarAba(valor as NomeDaAba)}
        className="flex flex-col gap-lg"
      >
        <ListaDeAbas aria-label="Seções do papel">
          <GatilhoDeAba value="resumo">Resumo</GatilhoDeAba>
          <GatilhoDeAba value="permissoes">Permissões</GatilhoDeAba>
        </ListaDeAbas>

        <ConteudoDeAba value="resumo">
          {/* `fieldset disabled` desabilita todos os campos de uma vez. */}
          <fieldset disabled={!editavel || arquivado} className="min-w-0">
            <legend className="sr-only">Identificação do papel</legend>
            <CamposDoPapel control={formulario.control} />
          </fieldset>

          <dl className="grid gap-sm rounded-lg border border-border bg-card p-lg tablet:grid-cols-2">
            <div className="flex flex-col gap-xs">
              <dt className="text-label-md text-muted-foreground">Papel padrão de origem</dt>
              <dd className="text-body-md text-foreground">{ROTULO_DO_PAPEL[papel.papelBase]}</dd>
            </div>
            <div className="flex flex-col gap-xs">
              <dt className="text-label-md text-muted-foreground">Situação</dt>
              <dd className="text-body-md text-foreground">{ESTADO_DO_PAPEL[papel.estado].rotulo}</dd>
            </div>
            <div className="flex flex-col gap-xs">
              <dt className="text-label-md text-muted-foreground">Revisão atual</dt>
              <dd className="tabular-nums text-body-md text-foreground">{papel.revisao}</dd>
            </div>
            <div className="flex flex-col gap-xs">
              <dt className="text-label-md text-muted-foreground">Criado em</dt>
              <dd className="text-body-md text-foreground">{formatarInstante(papel.criadoEm)}</dd>
            </div>
          </dl>

          <UsuariosVinculados papel={papel} />
        </ConteudoDeAba>

        <ConteudoDeAba value="permissoes">
          <MatrizDePermissoes
            catalogo={catalogo}
            valor={matriz}
            aoMudar={(proxima) => {
              definirMatriz(proxima);
              definirErroDaMatriz(undefined);
            }}
            somenteLeitura={!editavel}
            erro={erroDaMatrizNaTela}
          />
        </ConteudoDeAba>
      </Abas>

      {administra ? (
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div className="flex flex-wrap gap-sm">
            <Button asChild variante="fantasma">
              <Link href={LISTA}>Cancelar</Link>
            </Button>

            {arquivado ? null : (
              <ConfirmacaoDeAcao
                gatilho={<Button variante="contorno">Arquivar papel</Button>}
                titulo={`Arquivar “${papel.nome}”?`}
                descricao={
                  papel.usuariosVinculados > 0
                    ? `Este papel está atribuído a ${textoDeUsuarios(papel.usuariosVinculados)}. Só é possível arquivar depois de remover ou substituir o papel neles.`
                    : 'O papel deixa de poder ser atribuído. A definição, as revisões e o histórico são mantidos: nada é excluído, e você pode reativá-lo depois, revisando as permissões.'
                }
                rotuloDeConfirmacao="Arquivar papel"
                destrutivo
                explicarBloqueio={(erro) =>
                  erro instanceof ErroDaApi && erro.problema.code === 'PAPEL_EM_USO'
                    ? `Este papel está atribuído a ${textoDeUsuarios(papel.usuariosVinculados)}. Remova ou substitua o papel nesses usuários antes de arquivar.`
                    : null
                }
                aoConfirmar={() => arquivar.mutateAsync(papel.revisao).catch((falha: unknown) => {
                  tratarErro(falha);
                  throw falha;
                })}
              />
            )}
          </div>

          {arquivado ? (
            <ConfirmacaoDeAcao
              gatilho={<Button disabled={ocupado}>Reativar papel</Button>}
              titulo={`Reativar “${papel.nome}”?`}
              descricao={`O papel volta a poder ser atribuído com a matriz revisada (${matriz.length} ${matriz.length === 1 ? 'permissão' : 'permissões'}). Nenhum vínculo anterior com usuários é restaurado.${
                papel.incompatibilidades.length > 0
                  ? ` ${papel.incompatibilidades.length} ${papel.incompatibilidades.length === 1 ? 'permissão que não existe mais no catálogo será descartada' : 'permissões que não existem mais no catálogo serão descartadas'}.`
                  : ''
              }`}
              rotuloDeConfirmacao="Reativar papel"
              aoConfirmar={reativarComRevisao}
            />
          ) : exigeConfirmacao ? (
            <ConfirmacaoDeAcao
              gatilho={<Button disabled={ocupado}>Salvar alterações</Button>}
              titulo="Confirmar redução de permissões?"
              descricao={`Este papel está atribuído a ${textoDeUsuarios(papel.usuariosVinculados)}: ${papel.usuarios
                .slice(0, 5)
                .map((usuario) => usuario.nome)
                .join(', ')}${papel.usuarios.length > 5 ? ' e outros' : ''}. Serão retiradas ${diferenca.retiradas.length} ${diferenca.retiradas.length === 1 ? 'permissão' : 'permissões'}, e a mudança vale na próxima requisição de cada um. Quem tiver outro papel que conceda a mesma ação continua podendo executá-la.`}
              rotuloDeConfirmacao="Confirmar e salvar"
              destrutivo
              explicarBloqueio={explicarBloqueio}
              aoConfirmar={confirmarEGravar}
            />
          ) : (
            <Button type="submit" disabled={ocupado}>
              {editar.isPending ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          )}
        </div>
      ) : (
        <div>
          <Button asChild variante="contorno">
            <Link href={LISTA}>Voltar para a lista</Link>
          </Button>
        </div>
      )}

      {administra && !arquivado && (diferenca.adicionadas.length > 0 || diferenca.retiradas.length > 0) ? (
        <section
          aria-labelledby="alteracoes-pendentes"
          className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg"
        >
          <h2 id="alteracoes-pendentes" className="text-headline-sm text-foreground">
            Alterações ainda não salvas
          </h2>
          <DiferencaDaMatriz
            catalogo={catalogo}
            antes={papel.permissoes}
            depois={matriz}
            rotuloDaBase={`a revisão ${papel.revisao}`}
          />
        </section>
      ) : null}
    </form>
  );
};

export const EdicaoDePapel = ({ papelId }: { papelId: string }) => {
  const sessao = useSessao();
  const catalogo = useCatalogo();
  const papel = usePapel(papelId);
  const [aba, definirAba] = useState<NomeDaAba>('resumo');

  if (sessao.isPending || catalogo.isPending || papel.isPending) {
    return (
      <div className="flex flex-col gap-xl" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando o papel</span>
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

  if (!pode(sessao.data, CONSULTA_DE_USUARIOS)) {
    return <SemPermissao />;
  }

  if (papel.isError) {
    const problema = papel.error instanceof ErroDaApi ? papel.error.problema : null;

    if (problema?.code === 'PAPEL_NAO_ENCONTRADO') {
      return (
        <ErroDeTela
          nivel={2}
          titulo="Papel não encontrado"
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
        erro={papel.error}
        titulo="Não foi possível carregar o papel"
        aoTentarDeNovo={() => void papel.refetch()}
      />
    );
  }

  if (catalogo.isError) {
    return (
      <ErroDaConsulta
        erro={catalogo.error}
        titulo="Não foi possível carregar o catálogo de permissões"
        aoTentarDeNovo={() => void catalogo.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho papel={papel.data} />
      {/* `key` na revisão: depois de salvar ou recarregar, o formulário recomeça dos dados gravados. */}
      <Formulario
        key={papel.data.revisao}
        papel={papel.data}
        catalogo={catalogo.data}
        administra={pode(sessao.data, ADMINISTRACAO_DE_USUARIOS)}
        aba={aba}
        aoMudarAba={definirAba}
        aoRecarregar={() => void papel.refetch()}
      />
    </div>
  );
};
