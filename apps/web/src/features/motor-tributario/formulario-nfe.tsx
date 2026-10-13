/**
 * Simulação por NF-e de teste (SPEC-016 §3.6). Fluxo em dois passos sobre o MESMO endpoint:
 *   1. ao escolher o XML, a API ANALISA (sem complemento) e devolve o que extraiu e o que falta;
 *   2. o usuário completa só o que o XML não traz (tipo de operação, regime ambíguo, base de item
 *      sem grupo IBS/CBS) e a tela reenvia o mesmo arquivo com o complemento para calcular.
 * O arquivo vive só no estado desta tela, em memória: nunca vai a armazenamento do navegador, e o
 * servidor também não o guarda. O complemento é dinâmico (depende da análise), por isso o estado é
 * controlado aqui em vez de um schema fixo de React Hook Form; a validação é a do contrato.
 */
'use client';

import { Calculator, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CampoDeValor } from '@/components/ui/campo-de-valor';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/estados';
import { OPCOES_DE_OPERACAO, OPCOES_DE_REGIME } from './apresentacao';
import { ErroDoMotor } from './erro-do-motor';
import { focarPrimeiroCampoInvalido } from './foco';
import { useSimularNfe } from './queries';
import { ResultadoDaNfe } from './resultado-da-nfe';
import { ResumoDaNfe } from './resumo-da-nfe';
import { validarComplementoDaNfe, type Erros } from './schema';
import { ZonaDeXml } from './zona-de-xml';

export const FormularioNfe = () => {
  const analisar = useSimularNfe();
  const simular = useSimularNfe();
  const [arquivo, definirArquivo] = useState<File | null>(null);
  const [erroDoArquivo, definirErroDoArquivo] = useState<string | undefined>(undefined);
  const [operacao, definirOperacao] = useState('');
  const [regime, definirRegime] = useState('');
  const [bases, definirBases] = useState<Readonly<Record<string, number | null>>>({});
  const [erros, definirErros] = useState<Erros>({});
  const referenciaDoFormulario = useRef<HTMLFormElement>(null);
  const emEnvio = useRef(false);

  const analise = analisar.data;
  const pendencias = analise?.complementsRequired ?? [];

  const limpar = (): void => {
    analisar.reset();
    simular.reset();
    definirOperacao('');
    definirRegime('');
    definirBases({});
    definirErros({});
  };

  const escolher = (novo: File): void => {
    limpar();
    definirErroDoArquivo(undefined);
    definirArquivo(novo);
    analisar.mutate({ arquivo: novo, complemento: null });
  };

  const remover = (): void => {
    limpar();
    definirArquivo(null);
    definirErroDoArquivo(undefined);
  };

  const rejeitar = (mensagem: string): void => {
    limpar();
    definirArquivo(null);
    definirErroDoArquivo(mensagem);
  };

  const limparErro = (campo: string): void =>
    definirErros((atuais) => Object.fromEntries(Object.entries(atuais).filter(([chave]) => chave !== campo)));

  const enviar = (evento: React.FormEvent<HTMLFormElement>): void => {
    evento.preventDefault();

    if (arquivo === null || emEnvio.current) {
      return;
    }

    const resultado = validarComplementoDaNfe({ operationType: operacao, regime, itemBases: bases }, pendencias);

    if (!resultado.ok) {
      definirErros(resultado.erros);
      focarPrimeiroCampoInvalido(referenciaDoFormulario.current);

      return;
    }

    emEnvio.current = true;
    void simular
      .mutateAsync({ arquivo, complemento: resultado.dados })
      .catch(() => undefined)
      .finally(() => {
        emEnvio.current = false;
      });
  };

  const pedeRegime = pendencias.some((pendencia) => pendencia.field === 'regime');
  const itensSemBase = pendencias.filter((pendencia) => pendencia.field.startsWith('itemBases.')).map((pendencia) => pendencia.field.slice('itemBases.'.length));

  return (
    <div className="flex flex-col gap-lg">
      <ZonaDeXml
        arquivo={arquivo}
        erro={erroDoArquivo}
        desabilitada={analisar.isPending || simular.isPending}
        aoEscolher={escolher}
        aoRemover={remover}
        aoRejeitar={rejeitar}
      />

      {analisar.isPending ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-sm">
          <span className="text-body-sm text-muted-foreground">Analisando a NF-e…</span>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {analisar.isError ? <ErroDoMotor erro={analisar.error} titulo="Não foi possível ler a NF-e" /> : null}

      {analise === undefined ? null : (
        <>
          <ResumoDaNfe extracao={analise.extraction} />

          <form
            ref={referenciaDoFormulario}
            onSubmit={enviar}
            noValidate
            aria-label="Complemento da simulação"
            className="flex flex-col gap-md rounded-lg border border-border bg-card p-md"
          >
            <p className="text-body-sm text-muted-foreground">
              Informe só o que o XML não traz ou não mapeia de forma inequívoca. O que a NF-e já informa não pode ser alterado aqui.
            </p>

            <Select
              rotulo="Tipo de operação"
              obrigatorio
              opcoes={OPCOES_DE_OPERACAO}
              valor={operacao}
              onValorChange={(valor) => {
                definirOperacao(valor);
                limparErro('operationType');
              }}
              erro={erros['operationType']}
              ajuda="O XML não informa a operação de forma que o motor possa usar."
            />

            {pedeRegime ? (
              <Select
                rotulo="Regime"
                obrigatorio
                opcoes={OPCOES_DE_REGIME}
                valor={regime}
                onValorChange={(valor) => {
                  definirRegime(valor);
                  limparErro('regime');
                }}
                erro={erros['regime']}
              />
            ) : null}

            {itensSemBase.map((item) => (
              <CampoDeValor
                key={item}
                rotulo={`Base de cálculo do item ${item}`}
                tipo="moeda"
                obrigatorio
                valor={bases[item] ?? null}
                onValorChange={(valor) => {
                  definirBases((atuais) => ({ ...atuais, [item]: valor }));
                  limparErro(`itemBases.${item}`);
                }}
                erro={erros[`itemBases.${item}`]}
              />
            ))}

            <div className="flex justify-end">
              <Button type="submit" disabled={simular.isPending}>
                {simular.isPending ? (
                  <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Calculator aria-hidden="true" />
                )}
                Simular NF-e
              </Button>
            </div>
          </form>
        </>
      )}

      <div aria-live="polite" className="flex flex-col gap-lg">
        {simular.isError ? <ErroDoMotor erro={simular.error} titulo="Não foi possível simular a NF-e" /> : null}
        {simular.data?.result == null ? null : <ResultadoDaNfe resultado={simular.data.result} />}
      </div>
    </div>
  );
};
