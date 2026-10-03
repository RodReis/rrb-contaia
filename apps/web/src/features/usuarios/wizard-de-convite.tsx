/**
 * Wizard de convite (SPEC-007 §3.2 e §5.1): `Dados` → `Papéis e revisão`.
 *
 * Diferente dos wizards de cadastro, nada é gravado por etapa: o convite só
 * existe no envio da segunda. Por isso o estado das duas etapas vive aqui, e
 * "Voltar" não perde nada.
 *
 * O servidor decide a unicidade do e-mail e a validade dos papéis; o erro dele
 * volta para a etapa e o campo a que pertence, sem apagar o resto do que foi
 * preenchido.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { formatarTelefone } from '@contaia/domain';
import type { CodigoDeErro } from '@contaia/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';

import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Stepper, type SituacaoDaEtapa } from '@/components/ui/stepper';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { CamposDoUsuario } from './campos-do-usuario';
import { ErroDaConsulta, SemPermissao } from './erro-da-consulta';
import { ADMINISTRACAO_DE_USUARIOS, pode } from './permissoes';
import { useConvidarUsuario, useSessao } from './queries';
import { ROTULO_DO_PAPEL } from './rotulos';
import {
  dadosDoUsuarioFormSchema,
  erroDosPapeis,
  paraDadosDoConvite,
  type DadosDoUsuarioForm,
  type PapeisEscolhidos,
} from './schema';
import { SeletorDePapeis, usePapeisAtivos } from './seletor-de-papeis';

type Etapa = 'dados' | 'papeis';

const VAZIO: DadosDoUsuarioForm = { nome: '', email: '', telefone: '', crc: '' };

const CAMPOS_DA_ETAPA_DE_DADOS = ['nome', 'email', 'telefone', 'crc'] as const;

type ErrosDoServidor = FieldErrors<DadosDoUsuarioForm>;

const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <div className="flex flex-col gap-xs tablet:flex-row tablet:gap-md">
    <dt className="text-label-md text-muted-foreground tablet:w-[10rem]">{rotulo}</dt>
    <dd className="break-words text-body-md text-foreground">{valor}</dd>
  </div>
);

const Cabecalho = () => (
  <header className="flex flex-col gap-sm">
    <Breadcrumb
      itens={[
        { rotulo: 'Início', href: '/empresas' },
        { rotulo: 'Configurações' },
        { rotulo: 'Usuários e permissões', href: '/configuracoes/usuarios' },
        { rotulo: 'Convidar usuário' },
      ]}
    />
    <div className="flex flex-col gap-xs">
      <h1 className="font-display text-headline-lg text-foreground">Convidar usuário</h1>
      <p className="max-w-prose text-body-md text-muted-foreground">
        A pessoa recebe um e-mail com um link de uso único, válido por 48 horas, para definir a
        senha e entrar. Até lá ela fica como convidada e não acessa nada.
      </p>
    </div>
  </header>
);

/** O erro que o servidor atribuiu a um campo vira erro daquele campo, na etapa de dados. */
const errosDeCampo = (erro: ErroDaApi): ErrosDoServidor => {
  const resultado: ErrosDoServidor = {};

  for (const { campo, codigo } of erro.problema.campos ?? []) {
    if ((CAMPOS_DA_ETAPA_DE_DADOS as readonly string[]).includes(campo)) {
      resultado[campo as keyof DadosDoUsuarioForm] = {
        type: 'server',
        message: mensagemDoCodigo(codigo as CodigoDeErro),
      };
    }
  }

  return resultado;
};

const EtapaDeDados = ({
  inicial,
  errosDoServidor,
  aoContinuar,
}: {
  inicial: DadosDoUsuarioForm;
  errosDoServidor: ErrosDoServidor;
  aoContinuar: (dados: DadosDoUsuarioForm) => void;
}) => {
  const formulario = useForm<DadosDoUsuarioForm>({
    resolver: zodResolver(dadosDoUsuarioFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: inicial,
    // Erro devolvido pelo servidor entra no campo sem apagar o que foi digitado.
    errors: errosDoServidor,
  });

  return (
    <form noValidate onSubmit={formulario.handleSubmit(aoContinuar)} className="flex flex-col gap-lg">
      <CamposDoUsuario
        control={formulario.control}
        emailEditavel
        ajudaDoEmail="O convite é enviado para este endereço."
      />
      <div className="flex justify-end">
        <Button type="submit">Continuar</Button>
      </div>
    </form>
  );
};

const EtapaDePapeis = ({
  dados,
  papeis,
  aoMudarPapeis,
  erroDePapel,
  avisoDoServidor,
  enviando,
  aoVoltar,
  aoEnviar,
}: {
  dados: DadosDoUsuarioForm;
  papeis: PapeisEscolhidos;
  aoMudarPapeis: (papeis: PapeisEscolhidos) => void;
  erroDePapel: string | undefined;
  avisoDoServidor: string | null;
  enviando: boolean;
  aoVoltar: () => void;
  aoEnviar: () => void;
}) => {
  const ativos = usePapeisAtivos();
  const nomes = [
    ...papeis.padrao.map((papel) => ROTULO_DO_PAPEL[papel]),
    ...papeis.personalizados.map(
      (id) => ativos.data?.papeis.find((papel) => papel.id === id)?.nome ?? 'Papel personalizado',
    ),
  ];

  return (
  <div className="flex flex-col gap-lg">
    <SeletorDePapeis valor={papeis} aoMudar={aoMudarPapeis} erro={erroDePapel} />

    <section
      aria-labelledby="revisao-do-convite"
      className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg"
    >
      <h2 id="revisao-do-convite" className="text-headline-sm text-foreground">
        Revisão do convite
      </h2>
      <dl className="flex flex-col gap-sm">
        <Linha rotulo="Nome" valor={dados.nome} />
        <Linha rotulo="E-mail" valor={dados.email} />
        <Linha
          rotulo="Telefone"
          valor={dados.telefone === '' ? '—' : formatarTelefone(dados.telefone)}
        />
        <Linha rotulo="Registro no CRC" valor={dados.crc === '' ? '—' : dados.crc} />
        <Linha
          rotulo="Papéis"
          valor={
            nomes.length === 0 ? '—' : nomes.join(', ')
          }
        />
      </dl>
    </section>

    {avisoDoServidor === null ? null : (
      <ErroDeTela
        titulo="Este usuário já existe"
        descricao={avisoDoServidor}
        acao={
          <Button asChild variante="contorno" tamanho="compacto">
            <Link href="/configuracoes/usuarios?estado=ARQUIVADO">Ver usuários arquivados</Link>
          </Button>
        }
      />
    )}

    <div className="flex flex-wrap justify-between gap-sm">
      <Button variante="fantasma" onClick={aoVoltar} disabled={enviando}>
        Voltar
      </Button>
      {/* O botão nunca é desabilitado por validação: clicar mostra o que falta (PATTERNS.md §6). */}
      <Button onClick={aoEnviar} disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar convite'}
      </Button>
    </div>
  </div>
  );
};

export const WizardDeConvite = () => {
  const navegador = useRouter();
  const { data: sessao, isPending, isError, error, refetch } = useSessao();
  const convidar = useConvidarUsuario();

  const [etapa, definirEtapa] = useState<Etapa>('dados');
  const [dados, definirDados] = useState<DadosDoUsuarioForm>(VAZIO);
  const [papeis, definirPapeis] = useState<PapeisEscolhidos>({ padrao: [], personalizados: [] });
  const [erroDePapel, definirErroDePapel] = useState<string | undefined>(undefined);
  const [errosDoServidor, definirErrosDoServidor] = useState<ErrosDoServidor>({});
  const [avisoDoServidor, definirAvisoDoServidor] = useState<string | null>(null);

  if (isPending) {
    return (
      <div className="flex flex-col gap-xl" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando o formulário de convite</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErroDaConsulta
        erro={error}
        titulo="Não foi possível verificar o seu acesso"
        aoTentarDeNovo={() => void refetch()}
      />
    );
  }

  if (!pode(sessao, ADMINISTRACAO_DE_USUARIOS)) {
    return <SemPermissao />;
  }

  const enviar = async (): Promise<void> => {
    const erroDoPapel = erroDosPapeis(papeis);

    definirErroDePapel(erroDoPapel);
    definirAvisoDoServidor(null);

    if (erroDoPapel !== undefined) {
      return;
    }

    try {
      await convidar.mutateAsync(paraDadosDoConvite(dados, papeis));
      navegador.push('/configuracoes/usuarios');
    } catch (erro) {
      // O toast de falha já saiu da camada de query; aqui só se leva o erro ao lugar certo.
      if (!(erro instanceof ErroDaApi)) {
        return;
      }

      const { code } = erro.problema;
      const doCampo = errosDeCampo(erro);

      if (code === 'EMAIL_JA_UTILIZADO') {
        definirErrosDoServidor({
          email: { type: 'server', message: mensagemDoCodigo(code) },
        });
        definirEtapa('dados');
      } else if (Object.keys(doCampo).length > 0) {
        definirErrosDoServidor(doCampo);
        definirEtapa('dados');
      } else if (code === 'USUARIO_ARQUIVADO_USE_NOVO_CONVITE') {
        definirAvisoDoServidor(mensagemDoCodigo(code));
      } else if (code === 'PAPEL_OBRIGATORIO' || code === 'PAPEL_INVALIDO') {
        definirErroDePapel(mensagemDoCodigo(code));
      }
    }
  };

  const situacao = (id: Etapa): SituacaoDaEtapa =>
    id === etapa ? 'atual' : id === 'dados' && etapa === 'papeis' ? 'concluida' : 'pendente';

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho />

      <Stepper
        rotulo="Etapas do convite"
        etapas={[
          { id: 'dados', rotulo: 'Dados', situacao: situacao('dados') },
          { id: 'papeis', rotulo: 'Papéis e revisão', situacao: situacao('papeis') },
        ]}
        onSelecionar={(id) => id === 'dados' && definirEtapa('dados')}
      />

      {etapa === 'dados' ? (
        <EtapaDeDados
          inicial={dados}
          errosDoServidor={errosDoServidor}
          aoContinuar={(validos) => {
            definirDados(validos);
            definirErrosDoServidor({});
            definirEtapa('papeis');
          }}
        />
      ) : (
        <EtapaDePapeis
          dados={dados}
          papeis={papeis}
          aoMudarPapeis={(proximos) => {
            definirPapeis(proximos);
            definirErroDePapel(undefined);
          }}
          erroDePapel={erroDePapel}
          avisoDoServidor={avisoDoServidor}
          enviando={convidar.isPending}
          aoVoltar={() => definirEtapa('dados')}
          aoEnviar={() => void enviar()}
        />
      )}
    </div>
  );
};
