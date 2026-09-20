'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ETAPAS_DO_CADASTRO, formatarCep, formatarCnpj, formatarCpf, formatarTelefone } from '@contaia/domain';
import type { EtapaDoCadastro } from '@contaia/domain';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/estados';
import { ErroDeTela } from '@/components/ui/estados';
import { Stepper, type SituacaoDaEtapa } from '@/components/ui/stepper';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { AbasDeEdicao } from './abas-de-edicao';
import { FormularioEndereco } from './formulario-endereco';
import { FormularioIdentificacao } from './formulario-identificacao';
import { FormularioResponsavel } from './formulario-responsavel';
import { UploadDeArquivo } from './upload-de-arquivo';
import { useCadastro, useConcluirCadastro } from './queries';
import type { VisaoDoCadastro } from './api';

const ROTULO_DA_ETAPA: Readonly<Record<EtapaDoCadastro, string>> = {
  identificacao: 'Identificação',
  responsavel: 'Responsável técnico',
  endereco: 'Endereço principal',
  documentos: 'Documentos',
  revisao: 'Revisão',
};

const situacaoDa = (
  etapa: EtapaDoCadastro,
  atual: EtapaDoCadastro,
  concluidas: readonly EtapaDoCadastro[],
): SituacaoDaEtapa => {
  if (etapa === atual) {
    return 'atual';
  }

  return concluidas.includes(etapa) ? 'concluida' : 'pendente';
};

const Cabecalho = ({ titulo, descricao }: { titulo: string; descricao: string }) => (
  <header className="flex flex-col gap-xs">
    <h1 className="font-display text-headline-lg text-foreground">{titulo}</h1>
    <p className="max-w-prose text-body-md text-muted-foreground">{descricao}</p>
  </header>
);

const Linha = ({ rotulo, valor }: { rotulo: string; valor: string; }) => (
  <div className="flex flex-col gap-xs border-b border-border py-sm last:border-b-0">
    <dt className="text-label-sm uppercase text-muted-foreground">{rotulo}</dt>
    <dd className="text-body-md text-foreground">{valor}</dd>
  </div>
);

const LinhaMono = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <div className="flex flex-col gap-xs border-b border-border py-sm last:border-b-0">
    <dt className="text-label-sm uppercase text-muted-foreground">{rotulo}</dt>
    <dd className="font-mono text-code-sm tabular-nums text-foreground">{valor}</dd>
  </div>
);

const Revisao = ({
  visao,
  aoEditar,
  aoConcluir,
  concluindo,
}: {
  visao: VisaoDoCadastro;
  aoEditar: (etapa: EtapaDoCadastro) => void;
  aoConcluir: () => void;
  concluindo: boolean;
}) => {
  const { identificacao, responsavel, enderecoPrincipal } = visao.cadastro;
  const documentos = visao.arquivos.filter((arquivo) => arquivo.tipo === 'DOCUMENTO');
  const pendencias = ETAPAS_DO_CADASTRO.filter(
    (etapa) => etapa !== 'revisao' && !visao.etapasConcluidas.includes(etapa),
  );

  return (
    <div className="flex flex-col gap-lg">
      {pendencias.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-xs rounded-md border border-warning-indicator/40 bg-warning px-md py-md"
        >
          <p className="text-title-sm text-warning-foreground">
            Faltam etapas para concluir o cadastro
          </p>
          <ul className="list-inside list-disc text-body-sm text-warning-foreground/90">
            {pendencias.map((etapa) => (
              <li key={etapa}>{ROTULO_DA_ETAPA[etapa]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg">
        <div className="flex items-center justify-between gap-sm">
          <h3 className="text-headline-sm text-foreground">Identificação</h3>
          <Button variante="fantasma" tamanho="compacto" onClick={() => aoEditar('identificacao')}>
            Editar
          </Button>
        </div>
        <dl>
          <LinhaMono
            rotulo="CNPJ"
            valor={identificacao?.cnpj !== undefined && identificacao.cnpj.length > 0 ? formatarCnpj(identificacao.cnpj) : '—'}
          />
          <Linha rotulo="Razão social" valor={identificacao?.razaoSocial || '—'} />
          <Linha
            rotulo="Logo"
            valor={identificacao?.logoArquivoId !== null && identificacao?.logoArquivoId !== undefined ? 'Enviado' : 'Pendente'}
          />
        </dl>
      </section>

      <section className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg">
        <div className="flex items-center justify-between gap-sm">
          <h3 className="text-headline-sm text-foreground">Responsável técnico</h3>
          <Button variante="fantasma" tamanho="compacto" onClick={() => aoEditar('responsavel')}>
            Editar
          </Button>
        </div>
        <dl>
          <Linha rotulo="Nome" valor={responsavel?.nomeCompleto || '—'} />
          <LinhaMono
            rotulo="CPF"
            valor={responsavel?.cpf !== undefined && responsavel.cpf.length > 0 ? formatarCpf(responsavel.cpf) : '—'}
          />
          <Linha rotulo="CRC" valor={responsavel?.crc || '—'} />
          <Linha rotulo="E-mail" valor={responsavel?.email || '—'} />
          <LinhaMono
            rotulo="Telefone"
            valor={responsavel?.telefone !== undefined && responsavel.telefone.length > 0 ? formatarTelefone(responsavel.telefone) : '—'}
          />
        </dl>
      </section>

      <section className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg">
        <div className="flex items-center justify-between gap-sm">
          <h3 className="text-headline-sm text-foreground">Endereço principal</h3>
          <Button variante="fantasma" tamanho="compacto" onClick={() => aoEditar('endereco')}>
            Editar
          </Button>
        </div>
        <dl>
          <LinhaMono
            rotulo="CEP"
            valor={enderecoPrincipal?.cep !== undefined && enderecoPrincipal.cep.length > 0 ? formatarCep(enderecoPrincipal.cep) : '—'}
          />
          <Linha
            rotulo="Logradouro"
            valor={
              enderecoPrincipal === null
                ? '—'
                : `${enderecoPrincipal.logradouro}, ${enderecoPrincipal.numero}${
                    enderecoPrincipal.complemento !== null &&
                    enderecoPrincipal.complemento.length > 0
                      ? ` — ${enderecoPrincipal.complemento}`
                      : ''
                  }`
            }
          />
          <Linha
            rotulo="Município"
            valor={
              enderecoPrincipal === null
                ? '—'
                : `${enderecoPrincipal.bairro}, ${enderecoPrincipal.municipio}/${enderecoPrincipal.uf}`
            }
          />
        </dl>
      </section>

      <section className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg">
        <div className="flex items-center justify-between gap-sm">
          <h3 className="text-headline-sm text-foreground">Documentos</h3>
          <Button variante="fantasma" tamanho="compacto" onClick={() => aoEditar('documentos')}>
            Editar
          </Button>
        </div>
        {documentos.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">Nenhum documento enviado.</p>
        ) : (
          <ul className="flex flex-col gap-xs">
            {documentos.map((documento) => (
              <li key={documento.id} className="text-body-sm text-foreground">
                {documento.nomeOriginal}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex justify-end">
        <Button onClick={aoConcluir} disabled={concluindo}>
          {concluindo ? 'Concluindo…' : 'Concluir cadastro'}
        </Button>
      </div>
    </div>
  );
};

export const WizardDoEscritorio = () => {
  const navegador = useRouter();
  const { data: visao, isPending, isError, error, refetch } = useCadastro();
  // `null` significa "ainda não navegou": a etapa exibida é derivada da
  // primeira incompleta que o servidor informa (SPEC-001 §3.1). Guardar a
  // escolha só quando o usuário navega evita sincronizar estado com efeito.
  const [etapaEscolhida, definirEtapa] = useState<EtapaDoCadastro | null>(null);

  const concluir = useConcluirCadastro(() => navegador.push('/painel'));

  if (isPending) {
    return (
      <div className="flex flex-col gap-lg" aria-busy="true" aria-live="polite">
        <Cabecalho
          titulo="Cadastro do escritório"
          descricao="Carregando os dados do escritório."
        />
        <span className="sr-only">Carregando o cadastro do escritório</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <div className="flex flex-col gap-lg">
        <Cabecalho
          titulo="Cadastro do escritório"
          descricao="Dados de identificação, responsável técnico, endereços e arquivos."
        />
        <ErroDeTela
          titulo="Não foi possível carregar o cadastro"
          descricao={
            problema === null
              ? 'Tente novamente em instantes.'
              : mensagemDoCodigo(problema.code)
          }
          correlationId={problema?.correlationId}
          acao={
            <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    );
  }

  // Depois da ativação o cadastro é editado por abas: alteração posterior não
  // reabre o wizard (SPEC-001 §3.3).
  if (visao.cadastro.status === 'ATIVO') {
    return (
      <div className="flex flex-col gap-lg">
        <Cabecalho
          titulo="Cadastro do escritório"
          descricao="Consulte e atualize identificação, responsável técnico, endereços e arquivos do escritório."
        />
        <AbasDeEdicao visao={visao} />
      </div>
    );
  }

  const atual = etapaEscolhida ?? visao.proximaEtapa ?? 'revisao';
  const documentos = visao.arquivos.filter((arquivo) => arquivo.tipo === 'DOCUMENTO');

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho
        titulo="Cadastro do escritório"
        descricao="Conclua as cinco etapas para liberar o acesso às áreas operacionais. O progresso é salvo a cada etapa e pode ser retomado depois."
      />

      <Stepper
        etapas={ETAPAS_DO_CADASTRO.map((etapa) => ({
          id: etapa,
          rotulo: ROTULO_DA_ETAPA[etapa],
          situacao: situacaoDa(etapa, atual, visao.etapasConcluidas),
        }))}
        onSelecionar={(id) => definirEtapa(id as EtapaDoCadastro)}
      />

      <section aria-label={ROTULO_DA_ETAPA[atual]} className="flex flex-col gap-lg">
        <h2 className="text-headline-md text-foreground">{ROTULO_DA_ETAPA[atual]}</h2>

        {atual === 'identificacao' ? (
          <FormularioIdentificacao visao={visao} aoAvancar={() => definirEtapa('responsavel')} />
        ) : null}

        {atual === 'responsavel' ? (
          <FormularioResponsavel visao={visao} aoAvancar={() => definirEtapa('endereco')} />
        ) : null}

        {atual === 'endereco' ? (
          <FormularioEndereco visao={visao} aoAvancar={() => definirEtapa('documentos')} />
        ) : null}

        {atual === 'documentos' ? (
          <div className="flex flex-col gap-lg">
            <UploadDeArquivo
              tipo="DOCUMENTO"
              rotulo="Documentos do escritório"
              descricao="PDF, PNG, JPG ou DOCX, até 10 MB por arquivo."
              obrigatorio
              arquivos={documentos}
              permiteRemover
            />
            <div className="flex justify-end">
              <Button onClick={() => definirEtapa('revisao')} disabled={documentos.length === 0}>
                Salvar e continuar
              </Button>
            </div>
          </div>
        ) : null}

        {atual === 'revisao' ? (
          <Revisao
            visao={visao}
            aoEditar={definirEtapa}
            aoConcluir={() => concluir.mutate(undefined)}
            concluindo={concluir.isPending}
          />
        ) : null}
      </section>
    </div>
  );
};
