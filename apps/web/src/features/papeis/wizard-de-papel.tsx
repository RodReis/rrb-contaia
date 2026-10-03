/**
 * Wizard de criação de papel (SPEC-008 §5.2): `Identificação e base` →
 * `Permissões` → `Revisão e criação`.
 *
 * Nada é gravado por etapa: o papel nasce `ATIVO` só no envio da última, com
 * nome e matriz completa, de uma vez (não existe rascunho). O estado das três
 * etapas vive aqui, e "Voltar" não perde nada. Trocar a base recarrega a matriz
 * do molde; mexer na matriz depois não muda a base.
 *
 * O servidor decide a unicidade do nome e a validade da matriz; o erro dele volta
 * para a etapa e o campo a que pertence, sem apagar o resto do que foi preenchido.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PAPEIS_PADRAO, moldeDoPapelPadrao } from '@contaia/domain';
import type { ChaveDoCatalogo, PapelPadrao } from '@contaia/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { CaixaDeOpcao } from '@/components/ui/caixa-de-opcao';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Stepper, type SituacaoDaEtapa } from '@/components/ui/stepper';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { ErroDaConsulta, SemPermissao } from '../usuarios/erro-da-consulta';
import { ADMINISTRACAO_DE_USUARIOS, pode } from '../usuarios/permissoes';
import { useSessao } from '../usuarios/queries';
import { DESCRICAO_DO_PAPEL, ROTULO_DO_PAPEL } from '../usuarios/rotulos';
import type { CatalogoDePermissoes } from './api';
import { CamposDoPapel } from './campos-do-papel';
import { DiferencaDaMatriz } from './diferenca-da-matriz';
import { MatrizDePermissoes } from './matriz-de-permissoes';
import { useCatalogo, useCriarPapel } from './queries';
import { ResumoDaMatriz } from './resumo-da-matriz';
import {
  dadosDoPapelFormSchema,
  descricaoOuNula,
  erroDaMatriz,
  type DadosDoPapelForm,
} from './schema';

type Etapa = 'identificacao' | 'permissoes' | 'revisao';

const ETAPAS: ReadonlyArray<Readonly<{ id: Etapa; rotulo: string }>> = [
  { id: 'identificacao', rotulo: 'Identificação e base' },
  { id: 'permissoes', rotulo: 'Permissões' },
  { id: 'revisao', rotulo: 'Revisão e criação' },
];

const LISTA = '/configuracoes/usuarios?aba=papeis';
const VAZIO: DadosDoPapelForm = { nome: '', descricao: '' };

const Cabecalho = () => (
  <header className="flex flex-col gap-sm">
    <Breadcrumb
      itens={[
        { rotulo: 'Início', href: '/empresas' },
        { rotulo: 'Configurações' },
        { rotulo: 'Usuários e permissões', href: '/configuracoes/usuarios' },
        { rotulo: 'Papéis e permissões', href: LISTA },
        { rotulo: 'Criar papel' },
      ]}
    />
    <div className="flex flex-col gap-xs">
      <h1 className="font-display text-headline-lg text-foreground">Criar papel</h1>
      <p className="max-w-prose text-body-md text-muted-foreground">
        O novo papel nasce como uma cópia de um papel padrão. Depois disso os dois são
        independentes: mudar o padrão não altera o seu papel, e mudar o seu papel nunca altera o
        padrão.
      </p>
    </div>
  </header>
);

const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <div className="flex flex-col gap-xs tablet:flex-row tablet:gap-md">
    <dt className="text-label-md text-muted-foreground tablet:w-[10rem]">{rotulo}</dt>
    <dd className="break-words text-body-md text-foreground">{valor}</dd>
  </div>
);

const EtapaDeIdentificacao = ({
  inicial,
  base,
  erroDaBase,
  errosDoServidor,
  aoEscolherBase,
  aoContinuar,
  aoInvalido,
}: {
  inicial: DadosDoPapelForm;
  base: PapelPadrao | null;
  erroDaBase: string | undefined;
  errosDoServidor: Partial<Record<keyof DadosDoPapelForm, string>>;
  aoEscolherBase: (base: PapelPadrao) => void;
  aoContinuar: (dados: DadosDoPapelForm) => void;
  aoInvalido: () => void;
}) => {
  // Referência estável: o RHF zera os erros de validação quando o objeto `errors` muda de identidade.
  const errosDoFormulario = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(errosDoServidor).map(([campo, message]) => [campo, { type: 'server', message }]),
      ),
    [errosDoServidor],
  );

  const formulario = useForm<DadosDoPapelForm>({
    resolver: zodResolver(dadosDoPapelFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: inicial,
    // Erro devolvido pelo servidor entra no campo sem apagar o que foi digitado.
    errors: errosDoFormulario,
  });

  return (
    <form
      noValidate
      // Nome inválido não esconde a base que falta: os dois erros aparecem de uma vez.
      onSubmit={formulario.handleSubmit(aoContinuar, aoInvalido)}
      className="flex flex-col gap-lg"
    >
      <CamposDoPapel control={formulario.control} />

      <fieldset className="flex min-w-0 flex-col gap-md">
        <legend className="text-label-md text-foreground">
          Papel padrão de origem <span className="text-danger-foreground" aria-hidden="true">*</span>
        </legend>
        <p className="text-body-sm text-muted-foreground">
          Define só a matriz inicial de permissões. Você ajusta tudo na próxima etapa.
        </p>
        <div className="grid gap-sm tablet:grid-cols-2" role="radiogroup" aria-required="true">
          {PAPEIS_PADRAO.map((papel) => (
            <CaixaDeOpcao
              key={papel}
              name="papel-base"
              value={papel}
              rotulo={ROTULO_DO_PAPEL[papel]}
              descricao={DESCRICAO_DO_PAPEL[papel]}
              marcada={base === papel}
              onSelecionar={(valor) => aoEscolherBase(valor as PapelPadrao)}
            />
          ))}
        </div>
        {erroDaBase === undefined ? null : (
          <p role="alert" className="text-body-sm text-danger-foreground">
            {erroDaBase}
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap justify-between gap-sm">
        <Button variante="fantasma" asChild>
          <Link href={LISTA}>Cancelar</Link>
        </Button>
        <Button type="submit">Continuar</Button>
      </div>
    </form>
  );
};

const EtapaDeRevisao = ({
  catalogo,
  dados,
  base,
  matriz,
  molde,
  enviando,
  aoVoltar,
  aoCriar,
}: {
  catalogo: CatalogoDePermissoes;
  dados: DadosDoPapelForm;
  base: PapelPadrao;
  matriz: readonly ChaveDoCatalogo[];
  molde: readonly ChaveDoCatalogo[];
  enviando: boolean;
  aoVoltar: () => void;
  aoCriar: () => void;
}) => (
  <div className="flex flex-col gap-lg">
    <section
      aria-labelledby="revisao-do-papel"
      className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg"
    >
      <h2 id="revisao-do-papel" className="text-headline-sm text-foreground">
        Revisão do papel
      </h2>
      <dl className="flex flex-col gap-sm">
        <Linha rotulo="Nome" valor={dados.nome} />
        <Linha rotulo="Descrição" valor={dados.descricao === '' ? '—' : dados.descricao} />
        <Linha rotulo="Papel de origem" valor={ROTULO_DO_PAPEL[base]} />
        <Linha
          rotulo="Permissões"
          valor={`${matriz.length} ${matriz.length === 1 ? 'permissão' : 'permissões'}`}
        />
      </dl>
    </section>

    <section
      aria-labelledby="diferenca-do-papel"
      className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg"
    >
      <h2 id="diferenca-do-papel" className="text-headline-sm text-foreground">
        Diferenças em relação ao papel de origem
      </h2>
      <DiferencaDaMatriz
        catalogo={catalogo}
        antes={molde}
        depois={matriz}
        rotuloDaBase={`o molde “${ROTULO_DO_PAPEL[base]}”`}
      />
    </section>

    <section
      aria-labelledby="matriz-do-papel"
      className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg"
    >
      <h2 id="matriz-do-papel" className="text-headline-sm text-foreground">
        O que o papel poderá fazer
      </h2>
      <ResumoDaMatriz catalogo={catalogo} permissoes={matriz} />
    </section>

    <div className="flex flex-wrap justify-between gap-sm">
      <Button variante="fantasma" onClick={aoVoltar} disabled={enviando}>
        Voltar
      </Button>
      <Button onClick={aoCriar} disabled={enviando}>
        {enviando ? 'Criando…' : 'Criar papel'}
      </Button>
    </div>
  </div>
);

export const WizardDePapel = () => {
  const navegador = useRouter();
  const sessao = useSessao();
  const catalogo = useCatalogo();
  const criar = useCriarPapel();

  const [etapa, definirEtapa] = useState<Etapa>('identificacao');
  const [dados, definirDados] = useState<DadosDoPapelForm>(VAZIO);
  const [base, definirBase] = useState<PapelPadrao | null>(null);
  const [matriz, definirMatriz] = useState<readonly ChaveDoCatalogo[]>([]);
  // De qual base a matriz atual foi semeada: só trocar a base recarrega o molde.
  const [matrizSemeadaDe, definirMatrizSemeadaDe] = useState<PapelPadrao | null>(null);
  const [erroDaBase, definirErroDaBase] = useState<string | undefined>(undefined);
  const [erroDaMatrizNaTela, definirErroDaMatriz] = useState<string | undefined>(undefined);
  const [errosDoServidor, definirErrosDoServidor] = useState<
    Partial<Record<keyof DadosDoPapelForm, string>>
  >({});

  if (sessao.isPending || catalogo.isPending) {
    return (
      <div className="flex flex-col gap-xl" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando o formulário de papel</span>
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

  if (!pode(sessao.data, ADMINISTRACAO_DE_USUARIOS)) {
    return <SemPermissao />;
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

  const molde = base === null ? [] : moldeDoPapelPadrao(base);

  const escolherBase = (escolhida: PapelPadrao): void => {
    definirBase(escolhida);
    definirErroDaBase(undefined);
  };

  const irParaPermissoes = (valido: DadosDoPapelForm): void => {
    if (base === null) {
      definirErroDaBase('Escolha o papel padrão de origem.');

      return;
    }

    definirDados(valido);
    definirErrosDoServidor({});

    if (matrizSemeadaDe !== base) {
      definirMatriz(moldeDoPapelPadrao(base));
      definirMatrizSemeadaDe(base);
    }

    definirEtapa('permissoes');
  };

  const irParaRevisao = (): void => {
    const erro = erroDaMatriz(matriz);

    definirErroDaMatriz(erro);

    if (erro === undefined) {
      definirEtapa('revisao');
    }
  };

  const enviar = async (): Promise<void> => {
    if (base === null) {
      return;
    }

    try {
      await criar.mutateAsync({
        nome: dados.nome.trim(),
        descricao: descricaoOuNula(dados.descricao),
        papelBase: base,
        permissoes: matriz,
      });
      navegador.push(LISTA);
    } catch (erro) {
      // O toast de falha já saiu da camada de query; aqui só se leva o erro ao lugar certo.
      if (!(erro instanceof ErroDaApi)) {
        return;
      }

      const { code } = erro.problema;

      if (code === 'PAPEL_NOME_DUPLICADO') {
        definirErrosDoServidor({ nome: mensagemDoCodigo(code) });
        definirEtapa('identificacao');
      } else if (code === 'MATRIZ_INVALIDA' || code === 'PERMISSAO_INEXISTENTE' || code === 'PERMISSAO_EXCLUSIVA') {
        definirErroDaMatriz(mensagemDoCodigo(code));
        definirEtapa('permissoes');
      } else if (code === 'PAPEL_INVALIDO') {
        definirErroDaBase(mensagemDoCodigo(code));
        definirEtapa('identificacao');
      } else {
        for (const { campo, codigo } of erro.problema.campos ?? []) {
          if (campo === 'nome' || campo === 'descricao') {
            definirErrosDoServidor({ [campo]: mensagemDoCodigo(codigo) });
            definirEtapa('identificacao');
          }
        }
      }
    }
  };

  const situacao = (id: Etapa): SituacaoDaEtapa => {
    const atual = ETAPAS.findIndex((item) => item.id === etapa);
    const indice = ETAPAS.findIndex((item) => item.id === id);

    return indice === atual ? 'atual' : indice < atual ? 'concluida' : 'pendente';
  };

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho />

      <Stepper
        rotulo="Etapas da criação do papel"
        etapas={ETAPAS.map((item) => ({ ...item, situacao: situacao(item.id) }))}
        onSelecionar={(id) => {
          // Só se volta: avançar passa pela validação de cada etapa.
          if (situacao(id as Etapa) === 'concluida') {
            definirEtapa(id as Etapa);
          }
        }}
      />

      {etapa === 'identificacao' ? (
        <EtapaDeIdentificacao
          inicial={dados}
          base={base}
          erroDaBase={erroDaBase}
          errosDoServidor={errosDoServidor}
          aoEscolherBase={escolherBase}
          aoContinuar={irParaPermissoes}
          aoInvalido={() => {
            if (base === null) {
              definirErroDaBase('Escolha o papel padrão de origem.');
            }
          }}
        />
      ) : etapa === 'permissoes' ? (
        <div className="flex flex-col gap-lg">
          <MatrizDePermissoes
            catalogo={catalogo.data}
            valor={matriz}
            aoMudar={(proxima) => {
              definirMatriz(proxima);
              definirErroDaMatriz(undefined);
            }}
            erro={erroDaMatrizNaTela}
          />
          <div className="flex flex-wrap justify-between gap-sm">
            <Button variante="fantasma" onClick={() => definirEtapa('identificacao')}>
              Voltar
            </Button>
            <Button onClick={irParaRevisao}>Continuar</Button>
          </div>
        </div>
      ) : base === null ? (
        <ErroDeTela
          titulo="Escolha o papel de origem"
          descricao="Volte à primeira etapa e escolha o papel padrão que servirá de molde."
          acao={
            <Button variante="contorno" tamanho="compacto" onClick={() => definirEtapa('identificacao')}>
              Voltar à identificação
            </Button>
          }
        />
      ) : (
        <EtapaDeRevisao
          catalogo={catalogo.data}
          dados={dados}
          base={base}
          matriz={matriz}
          molde={molde}
          enviando={criar.isPending}
          aoVoltar={() => definirEtapa('permissoes')}
          aoCriar={() => void enviar()}
        />
      )}
    </div>
  );
};
