/**
 * Aba de endereços da empresa ativa (SPEC-003 §3.4).
 *
 * As três regras que moldam esta tela: a empresa tem exatamente um endereço
 * padrão e ele é sempre o Fiscal; finalidade não se repete entre endereços
 * ativos — o que limita a empresa a quatro; e trocar o Fiscal exige escolher,
 * na mesma ação, para onde vai a finalidade do endereço que perde o posto.
 */
'use client';

import { FINALIDADES_DE_ENDERECO, formatarCep } from '@contaia/domain';
import type { FinalidadeDeEndereco } from '@contaia/domain';
import * as Dialog from '@radix-ui/react-dialog';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, MapPin, Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { CampoControlado } from '@/components/ui/campo-controlado';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { ResumoDeErros } from '../escritorio/resumo-de-erros';
import type { EnderecoDaEmpresa } from './manutencao-api';
import {
  useArquivarEndereco,
  useAtualizarEndereco,
  useCriarEndereco,
  useEnderecos,
  useTrocarEnderecoFiscal,
} from './manutencao-queries';
import { enderecoComFinalidadeFormSchema, type EnderecoComFinalidadeForm } from './schema';

const ROTULO_DA_FINALIDADE: Readonly<Record<FinalidadeDeEndereco, string>> = {
  FISCAL: 'Fiscal',
  COBRANCA: 'Cobrança',
  CORRESPONDENCIA: 'Correspondência',
  OUTRO: 'Outro',
};

const enderecoVazio = (finalidade: FinalidadeDeEndereco): EnderecoComFinalidadeForm => ({
  finalidade,
  descricao: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipio: '',
  uf: '',
});

const paraFormulario = (endereco: EnderecoDaEmpresa): EnderecoComFinalidadeForm => ({
  finalidade: endereco.finalidade,
  descricao: endereco.descricao ?? '',
  cep: endereco.cep,
  logradouro: endereco.logradouro,
  numero: endereco.numero,
  complemento: endereco.complemento ?? '',
  bairro: endereco.bairro,
  municipio: endereco.municipio,
  uf: endereco.uf,
});

const paraPayload = (dados: EnderecoComFinalidadeForm) => ({
  finalidade: dados.finalidade,
  descricao: dados.finalidade === 'OUTRO' ? (dados.descricao ?? '') : null,
  cep: dados.cep,
  logradouro: dados.logradouro,
  numero: dados.numero,
  complemento: (dados.complemento ?? '').length > 0 ? (dados.complemento ?? null) : null,
  bairro: dados.bairro,
  municipio: dados.municipio,
  uf: dados.uf,
});

const FormularioDeEndereco = ({
  valorInicial,
  finalidadesDisponiveis,
  finalidadeTravada,
  ocupado,
  rotuloDeEnvio,
  aoEnviar,
  aoCancelar,
}: {
  valorInicial: EnderecoComFinalidadeForm;
  finalidadesDisponiveis: readonly FinalidadeDeEndereco[];
  finalidadeTravada: boolean;
  ocupado: boolean;
  rotuloDeEnvio: string;
  aoEnviar: (dados: EnderecoComFinalidadeForm) => void;
  aoCancelar: () => void;
}) => {
  const formulario = useForm<EnderecoComFinalidadeForm>({
    resolver: zodResolver(enderecoComFinalidadeFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: valorInicial,
  });

  const finalidade = formulario.watch('finalidade');

  return (
    <form
      noValidate
      onSubmit={formulario.handleSubmit(aoEnviar)}
      className="flex flex-col gap-lg"
    >
      <ResumoDeErros erros={formulario.formState.errors} />

      <div className="grid gap-md tablet:grid-cols-2">
        <Select
          rotulo="Finalidade"
          obrigatorio
          opcoes={finalidadesDisponiveis.map((item) => ({
            valor: item,
            rotulo: ROTULO_DA_FINALIDADE[item],
          }))}
          valor={finalidade}
          onValorChange={(valor) =>
            formulario.setValue('finalidade', valor as FinalidadeDeEndereco, {
              shouldValidate: true,
            })
          }
          disabled={finalidadeTravada}
          ajuda={
            finalidadeTravada
              ? 'Para mudar a finalidade, use a transferência do endereço Fiscal.'
              : 'Cada finalidade pertence a um único endereço ativo.'
          }
        />

        {/* Descrição só aparece em `OUTRO`: nas demais finalidades ela é
            recusada pelo servidor, e um campo visível que não pode ser
            preenchido é uma armadilha. */}
        {finalidade === 'OUTRO' ? (
          <CampoControlado
            control={formulario.control}
            name="descricao"
            rotulo="Descrição"
            obrigatorio
            placeholder="Depósito, filial, obra…"
          />
        ) : null}
      </div>

      <div className="grid gap-md tablet:grid-cols-[12rem_1fr]">
        <CampoControlado
          control={formulario.control}
          name="cep"
          rotulo="CEP"
          obrigatorio
          mascara="cep"
          inputMode="numeric"
          placeholder="00000-000"
        />
        <CampoControlado
          control={formulario.control}
          name="logradouro"
          rotulo="Logradouro"
          obrigatorio
          placeholder="Avenida Paulista"
        />
      </div>

      <div className="grid gap-md tablet:grid-cols-[10rem_1fr]">
        <CampoControlado
          control={formulario.control}
          name="numero"
          rotulo="Número"
          obrigatorio
          placeholder="1000"
        />
        <CampoControlado
          control={formulario.control}
          name="complemento"
          rotulo="Complemento"
          placeholder="Conjunto 101"
        />
      </div>

      <div className="grid gap-md tablet:grid-cols-[1fr_1fr_6rem]">
        <CampoControlado
          control={formulario.control}
          name="bairro"
          rotulo="Bairro"
          obrigatorio
          placeholder="Bela Vista"
        />
        <CampoControlado
          control={formulario.control}
          name="municipio"
          rotulo="Município"
          obrigatorio
          placeholder="São Paulo"
        />
        <CampoControlado
          control={formulario.control}
          name="uf"
          rotulo="UF"
          obrigatorio
          maxLength={2}
          placeholder="SP"
        />
      </div>

      <div className="flex flex-wrap justify-end gap-sm">
        <Button variante="contorno" tamanho="compacto" onClick={aoCancelar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button type="submit" tamanho="compacto" disabled={ocupado}>
          {ocupado ? 'Salvando…' : rotuloDeEnvio}
        </Button>
      </div>
    </form>
  );
};

const DialogoDeTrocaDeFiscal = ({
  empresaId,
  fiscalAtual,
  candidatos,
  finalidadesLivres,
}: {
  empresaId: string;
  fiscalAtual: EnderecoDaEmpresa;
  candidatos: readonly EnderecoDaEmpresa[];
  finalidadesLivres: readonly FinalidadeDeEndereco[];
}) => {
  const [aberto, definirAberto] = useState(false);
  const [novoFiscalId, definirNovoFiscalId] = useState(candidatos[0]?.id ?? '');
  const trocar = useTrocarEnderecoFiscal(empresaId);

  // A finalidade do endereço promovido fica livre na troca, então ela também é
  // destino válido para o Fiscal anterior — é a troca simples entre os dois.
  const promovido = candidatos.find((item) => item.id === novoFiscalId);
  const destinos: readonly FinalidadeDeEndereco[] = [
    ...finalidadesLivres,
    ...(promovido === undefined ? [] : [promovido.finalidade]),
  ].filter((item) => item !== 'FISCAL');

  const [finalidadeDoAnterior, definirFinalidade] = useState<FinalidadeDeEndereco | ''>('');
  const destinoEscolhido: FinalidadeDeEndereco | '' =
    finalidadeDoAnterior !== '' && destinos.includes(finalidadeDoAnterior)
      ? finalidadeDoAnterior
      : (destinos[0] ?? '');

  const confirmar = (): void => {
    if (novoFiscalId === '' || destinoEscolhido === '') {
      return;
    }

    trocar.mutate(
      { novoFiscalId, finalidadeDoAnterior: destinoEscolhido },
      { onSuccess: () => definirAberto(false) },
    );
  };

  return (
    <Dialog.Root open={aberto} onOpenChange={definirAberto}>
      <Dialog.Trigger asChild>
        <Button variante="contorno" tamanho="compacto">
          <Star aria-hidden="true" />
          Transferir Fiscal
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-primary/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[34rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-md rounded-lg border border-border bg-popover p-lg text-popover-foreground shadow-lg">
          <Dialog.Title className="text-headline-sm text-foreground">
            Transferir a finalidade Fiscal
          </Dialog.Title>
          <Dialog.Description className="text-body-md text-muted-foreground">
            O endereço Fiscal é o endereço padrão da empresa. Escolha quem assume a
            finalidade e para onde vai a finalidade do endereço atual.
          </Dialog.Description>

          <Select
            rotulo="Novo endereço Fiscal"
            obrigatorio
            opcoes={candidatos.map((item) => ({
              valor: item.id,
              rotulo: `${ROTULO_DA_FINALIDADE[item.finalidade]} — ${item.logradouro}, ${item.numero}`,
            }))}
            valor={novoFiscalId}
            onValorChange={definirNovoFiscalId}
          />

          <Select
            rotulo={`Nova finalidade do endereço atual (${fiscalAtual.logradouro}, ${fiscalAtual.numero})`}
            obrigatorio
            opcoes={destinos.map((item) => ({
              valor: item,
              rotulo: ROTULO_DA_FINALIDADE[item],
            }))}
            valor={destinoEscolhido}
            onValorChange={(valor) => definirFinalidade(valor as FinalidadeDeEndereco)}
            ajuda="O endereço Fiscal atual precisa de uma finalidade disponível."
          />

          <div className="flex flex-wrap justify-end gap-sm">
            <Dialog.Close asChild>
              <Button variante="contorno" tamanho="compacto" disabled={trocar.isPending}>
                Cancelar
              </Button>
            </Dialog.Close>
            <Button tamanho="compacto" onClick={confirmar} disabled={trocar.isPending}>
              {trocar.isPending ? 'Transferindo…' : 'Transferir'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const CartaoDoEndereco = ({
  empresaId,
  endereco,
  somenteLeitura,
  podeArquivar,
  emEdicao,
  aoEditar,
  aoFecharEdicao,
}: {
  empresaId: string;
  endereco: EnderecoDaEmpresa;
  somenteLeitura: boolean;
  podeArquivar: boolean;
  emEdicao: boolean;
  aoEditar: () => void;
  aoFecharEdicao: () => void;
}) => {
  const atualizar = useAtualizarEndereco(empresaId);
  const arquivar = useArquivarEndereco(empresaId);

  return (
    <li className="flex flex-col gap-md rounded-lg border border-border bg-card p-md">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-sm">
            <span className="text-title-sm text-foreground">
              {ROTULO_DA_FINALIDADE[endereco.finalidade]}
            </span>
            {endereco.principal ? (
              <StatusBadge tom="conforme" rotulo="Padrão" />
            ) : null}
          </div>
          {endereco.descricao !== null ? (
            <span className="text-body-sm text-muted-foreground">{endereco.descricao}</span>
          ) : null}
        </div>

        {somenteLeitura ? null : (
          <div className="flex flex-wrap gap-sm">
            <Button variante="fantasma" tamanho="compacto" onClick={aoEditar}>
              Editar
            </Button>
            {/* O Fiscal não é arquivável sem substituto: em vez de deixar o
                botão falhar no servidor, ele não é oferecido (§3.4). */}
            {podeArquivar ? (
              <Button
                variante="fantasma"
                tamanho="compacto"
                onClick={() => arquivar.mutate(endereco.id)}
                disabled={arquivar.isPending}
              >
                <Archive aria-hidden="true" />
                Arquivar
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {emEdicao ? (
        <FormularioDeEndereco
          valorInicial={paraFormulario(endereco)}
          finalidadesDisponiveis={[endereco.finalidade]}
          finalidadeTravada
          ocupado={atualizar.isPending}
          rotuloDeEnvio="Salvar endereço"
          aoCancelar={aoFecharEdicao}
          aoEnviar={(dados) =>
            atualizar.mutate(
              { enderecoId: endereco.id, dados: paraPayload(dados) },
              { onSuccess: aoFecharEdicao },
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-xs">
          <span className="font-mono text-code-sm tabular-nums text-muted-foreground">
            {formatarCep(endereco.cep)}
          </span>
          <span className="text-body-md text-foreground">
            {endereco.logradouro}, {endereco.numero}
            {endereco.complemento === null ? '' : `, ${endereco.complemento}`}
          </span>
          <span className="text-body-sm text-muted-foreground">
            {endereco.bairro} — {endereco.municipio}/{endereco.uf}
          </span>
        </div>
      )}
    </li>
  );
};

export const AbaDeEnderecos = ({
  empresaId,
  somenteLeitura,
}: {
  empresaId: string;
  somenteLeitura: boolean;
}) => {
  const { data, isPending, isError, error, refetch } = useEnderecos(empresaId);
  const criar = useCriarEndereco(empresaId);
  const [incluindo, definirIncluindo] = useState(false);
  const [editandoId, definirEditandoId] = useState<string | null>(null);

  if (isPending) {
    return (
      <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando os endereços da empresa</span>
        {Array.from({ length: 2 }, (_, indice) => (
          <Skeleton key={indice} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <ErroDeTela
        nivel={3}
        titulo="Não foi possível carregar os endereços"
        descricao={
          problema === null ? 'Tente novamente em instantes.' : mensagemDoCodigo(problema.code)
        }
        correlationId={problema?.correlationId}
        acao={
          <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const ocupadas = new Set(data.map((item) => item.finalidade));
  const livres = FINALIDADES_DE_ENDERECO.filter((item) => !ocupadas.has(item));
  const fiscal = data.find((item) => item.finalidade === 'FISCAL');
  const candidatosAFiscal = data.filter((item) => item.finalidade !== 'FISCAL');
  // Quatro finalidades, quatro endereços ativos no máximo — a consequência é da
  // regra de finalidade única, não um limite escolhido à parte (§3.4).
  const podeIncluir = livres.length > 0;

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
        <div className="flex flex-col gap-xs">
          {/* `h2` pelo mesmo motivo da seção da CNPJá: irmã do conteúdo da
              aba, logo abaixo do `h1` da empresa. */}
          <h2 className="text-headline-sm text-foreground">Endereços</h2>
          <p className="max-w-prose text-body-sm text-muted-foreground">
            A empresa mantém exatamente um endereço padrão, que é sempre o Fiscal. Cada
            finalidade pertence a um único endereço ativo.
          </p>
        </div>

        {somenteLeitura ? null : (
          <div className="flex flex-wrap gap-sm">
            {fiscal !== undefined && candidatosAFiscal.length > 0 ? (
              <DialogoDeTrocaDeFiscal
                empresaId={empresaId}
                fiscalAtual={fiscal}
                candidatos={candidatosAFiscal}
                finalidadesLivres={livres}
              />
            ) : null}

            {podeIncluir && !incluindo ? (
              <Button tamanho="compacto" onClick={() => definirIncluindo(true)}>
                <Plus aria-hidden="true" />
                Incluir endereço
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {incluindo && livres[0] !== undefined ? (
        <div className="rounded-lg border border-border bg-card p-md">
          <FormularioDeEndereco
            valorInicial={enderecoVazio(livres[0])}
            finalidadesDisponiveis={livres}
            finalidadeTravada={false}
            ocupado={criar.isPending}
            rotuloDeEnvio="Incluir endereço"
            aoCancelar={() => definirIncluindo(false)}
            aoEnviar={(dados) =>
              criar.mutate(paraPayload(dados), {
                onSuccess: () => definirIncluindo(false),
              })
            }
          />
        </div>
      ) : null}

      {data.length === 0 ? (
        <EmptyState
          nivel={3}
          icone={<MapPin />}
          titulo="Nenhum endereço cadastrado"
          descricao="A empresa ativa precisa de um endereço Fiscal, que também é o endereço padrão."
        />
      ) : (
        <ul className="flex flex-col gap-md">
          {data.map((endereco) => (
            <CartaoDoEndereco
              key={endereco.id}
              empresaId={empresaId}
              endereco={endereco}
              somenteLeitura={somenteLeitura}
              podeArquivar={endereco.finalidade !== 'FISCAL'}
              emEdicao={editandoId === endereco.id}
              aoEditar={() => definirEditandoId(endereco.id)}
              aoFecharEdicao={() => definirEditandoId(null)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
