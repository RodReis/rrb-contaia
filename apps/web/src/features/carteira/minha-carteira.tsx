/**
 * Minha carteira (SPEC-009 §3.1, §3.6): as empresas atribuídas ao próprio usuário.
 * É para onde o aviso do sino leva. Qualquer usuário ativo a vê — e só a própria:
 * quem não tem carteira lê a orientação de ausência de alçada, não uma tela vazia.
 */
'use client';

import { Building2 } from 'lucide-react';
import Link from 'next/link';

import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/estados';
import { SemCarteira } from '@/components/ui/sem-carteira';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaConsulta } from '../usuarios/erro-da-consulta';
import { useMinhaCarteira } from './queries';
import { cnpjFormatado, plural } from './rotulos';

export const MinhaCarteira = () => {
  const { data, isPending, isError, error, refetch } = useMinhaCarteira();

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <Breadcrumb itens={[{ rotulo: 'Início', href: '/empresas' }, { rotulo: 'Minha carteira' }]} />
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-headline-lg text-foreground">Minha carteira</h1>
          <p className="max-w-prose text-body-md text-muted-foreground">
            As empresas em que você atua. Seu papel define o que você faz em cada uma; a carteira
            define em quais. Quem atribui é o administrador do escritório.
          </p>
        </div>
      </header>

      {isPending ? (
        <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando a sua carteira</span>
          {Array.from({ length: 4 }, (_, indice) => (
            <Skeleton key={indice} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível carregar a sua carteira"
          aoTentarDeNovo={() => void refetch()}
        />
      ) : data.empresas.length === 0 ? (
        <SemCarteira />
      ) : (
        <section className="flex flex-col gap-md">
          <p className="text-body-sm text-muted-foreground" aria-live="polite">
            {plural(data.empresas.length, 'empresa na sua carteira', 'empresas na sua carteira')}.
          </p>
          <ul
            aria-label="Empresas da sua carteira"
            className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
          >
            {data.empresas.map((empresa) => (
              <li
                key={empresa.id}
                className="flex flex-wrap items-center justify-between gap-sm px-md py-sm"
              >
                <div className="flex min-w-0 flex-col gap-xs">
                  <span className="break-words text-title-sm text-foreground">{empresa.nome}</span>
                  <span className="text-body-sm text-muted-foreground">
                    CNPJ {cnpjFormatado(empresa.cnpj)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-sm">
                  {empresa.status === 'CADASTRO_INCOMPLETO' ? (
                    <StatusBadge tom="atencao" rotulo="Cadastro incompleto" />
                  ) : empresa.situacao === 'arquivado' ? (
                    <StatusBadge tom="neutro" rotulo="Arquivada" />
                  ) : (
                    <StatusBadge tom="conforme" rotulo="Ativa" />
                  )}
                  <Button asChild variante="contorno" tamanho="compacto">
                    <Link href={`/empresas/${empresa.id}`} aria-label={`Abrir ${empresa.nome}`}>
                      <Building2 aria-hidden="true" />
                      Abrir empresa
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
