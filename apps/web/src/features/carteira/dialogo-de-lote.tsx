/**
 * Operação em lote da Central de Carteiras (SPEC-009 §3.2, §5.1): escolher as
 * empresas e revisar — colaboradores, empresas e efeito — antes de salvar. A
 * remoção em lote é sempre confirmada, com o impacto dito por extenso.
 *
 * Usa `Dialog`, e não `AlertDialog`: o salvamento pode falhar no servidor (lote
 * inválido, carteira desatualizada) e fechar antes da resposta perderia a seleção.
 */
'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { ColaboradorNaCentral, EmpresaParaAtribuicao } from './api';
import { useAlterarCarteira } from './queries';
import { ProblemasDoLote, descreverProblemasDoLote } from './problemas-do-lote';
import { nomeDaEmpresa, plural, resumirEmpresas } from './rotulos';
import { SeletorDeEmpresas } from './seletor-de-empresas';

export type OperacaoDeLote = 'ADICIONAR' | 'REMOVER';

const TEXTO = {
  ADICIONAR: {
    titulo: 'Adicionar empresas às carteiras',
    escolha: 'Escolha as empresas que entram na carteira dos colaboradores selecionados.',
    efeito: 'passam a acessar',
    confirmar: 'Adicionar e salvar',
  },
  REMOVER: {
    titulo: 'Remover empresas das carteiras',
    escolha:
      'Escolha as empresas que saem da carteira dos colaboradores selecionados. Quem não tem o vínculo não é afetado.',
    efeito: 'deixam de acessar',
    confirmar: 'Remover e salvar',
  },
} as const;

export const DialogoDeLote = ({
  operacao,
  colaboradores,
  gatilho,
  aoConcluir,
}: {
  operacao: OperacaoDeLote;
  colaboradores: readonly ColaboradorNaCentral[];
  gatilho: ReactNode;
  aoConcluir: () => void;
}) => {
  const alterar = useAlterarCarteira();
  const [aberto, definirAberto] = useState(false);
  const [etapa, definirEtapa] = useState<'escolha' | 'revisao'>('escolha');
  const [escolhidas, definirEscolhidas] = useState<ReadonlyMap<string, EmpresaParaAtribuicao>>(
    new Map(),
  );

  const [problemas, definirProblemas] = useState<readonly string[] | null>(null);

  const texto = TEXTO[operacao];
  const empresas = [...escolhidas.values()];

  // Reabrir começa do zero: a seleção de uma operação não vale para a seguinte.
  const alternar = (proximo: boolean): void => {
    if (alterar.isPending) {
      return;
    }

    definirAberto(proximo);

    if (proximo) {
      definirProblemas(null);
      definirEtapa('escolha');
      definirEscolhidas(new Map());
    }
  };

  const alternarEmpresa = (empresa: EmpresaParaAtribuicao): void =>
    definirEscolhidas((anteriores) => {
      const proximas = new Map(anteriores);

      if (proximas.has(empresa.id)) {
        proximas.delete(empresa.id);
      } else {
        proximas.set(empresa.id, empresa);
      }

      return proximas;
    });

  const salvar = async (): Promise<void> => {
    const ids = empresas.map((empresa) => empresa.id);
    definirProblemas(null);

    try {
      await alterar.mutateAsync({
        origem: 'LOTE',
        usuarios: colaboradores.map((c) => ({ id: c.id, revisao: c.revisaoCarteira })),
        adicionar: operacao === 'ADICIONAR' ? ids : [],
        remover: operacao === 'REMOVER' ? ids : [],
      });
      definirAberto(false);
      aoConcluir();
    } catch (erro) {
      // Lote inválido: a lista de itens aparece aqui e nada foi aplicado. Qualquer outra
      // falha já saiu como aviso pela camada de query. O diálogo segue aberto, com a
      // seleção preservada, para a pessoa corrigir ou tentar de novo.
      const nomes = new Map<string, string>([
        ...empresas.map((e) => [e.id, e.nome] as const),
        ...colaboradores.map((c) => [c.id, c.nome] as const),
      ]);
      definirProblemas(descreverProblemasDoLote(erro, nomes));
      definirEtapa('escolha');
    }
  };

  const referencia = colaboradores[0];

  return (
    <Dialog.Root open={aberto} onOpenChange={alternar}>
      <Dialog.Trigger asChild>{gatilho}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-primary/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[40rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-md overflow-y-auto rounded-lg border border-border bg-popover p-lg text-popover-foreground shadow-lg">
          <div className="flex items-start justify-between gap-md">
            <div className="flex flex-col gap-xs">
              <Dialog.Title className="text-headline-sm text-foreground">
                {etapa === 'escolha' ? texto.titulo : 'Revise antes de salvar'}
              </Dialog.Title>
              <Dialog.Description className="text-body-md text-muted-foreground">
                {etapa === 'escolha'
                  ? `${texto.escolha} (${plural(colaboradores.length, 'colaborador selecionado', 'colaboradores selecionados')}.)`
                  : 'Nada é gravado até você confirmar. A operação vale inteira ou não vale.'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variante="fantasma" tamanho="icone" aria-label="Fechar" disabled={alterar.isPending}>
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>

          {problemas === null ? null : <ProblemasDoLote problemas={problemas} />}

          {etapa === 'escolha' && referencia !== undefined ? (
            <>
              <SeletorDeEmpresas
                usuarioId={referencia.id}
                estaMarcada={(empresa) => escolhidas.has(empresa.id)}
                aoAlternar={alternarEmpresa}
                mostrarSituacao={false}
              />
              <div className="flex flex-wrap items-center justify-between gap-sm border-t border-border pt-md">
                <p className="text-body-sm text-muted-foreground" aria-live="polite">
                  {empresas.length === 0
                    ? 'Nenhuma empresa escolhida.'
                    : `${plural(empresas.length, 'empresa escolhida', 'empresas escolhidas')}.`}
                </p>
                <Button
                  tamanho="compacto"
                  disabled={empresas.length === 0}
                  onClick={() => definirEtapa('revisao')}
                >
                  Revisar
                </Button>
              </div>
            </>
          ) : (
            <>
              <section
                aria-label="Efeito da operação"
                className="flex flex-col gap-md rounded-md border border-border bg-card p-md"
              >
                <p className="text-body-md text-foreground">
                  {plural(colaboradores.length, 'colaborador', 'colaboradores')} {texto.efeito}{' '}
                  {plural(empresas.length, 'empresa', 'empresas')} na próxima requisição. Cada
                  colaborador recebe um único aviso no sino com o resumo.
                </p>
                <div className="grid gap-md tablet:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <h3 className="text-label-md text-foreground">Colaboradores</h3>
                    <ul className="flex max-h-40 flex-col gap-xs overflow-y-auto">
                      {colaboradores.map((c) => (
                        <li key={c.id} className="break-words text-body-sm text-foreground">
                          {c.nome}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-xs">
                    <h3 className="text-label-md text-foreground">Empresas</h3>
                    {/* Poucas empresas são listadas por inteiro; muitas, resumidas — o volume decide. */}
                    {empresas.length <= 6 ? (
                      <ul className="flex flex-col gap-xs">
                        {empresas.map((empresa) => (
                          <li key={empresa.id} className="break-words text-body-sm text-foreground">
                            {nomeDaEmpresa(empresa)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-body-sm text-foreground">{resumirEmpresas(empresas, 5)}</p>
                    )}
                  </div>
                </div>
                {operacao === 'REMOVER' ? (
                  <p className="text-body-sm text-muted-foreground" role="note">
                    O histórico fica registrado e o acesso só volta com uma nova atribuição.
                  </p>
                ) : null}
              </section>

              <div className="flex flex-wrap justify-end gap-sm">
                <Button
                  variante="contorno"
                  tamanho="compacto"
                  disabled={alterar.isPending}
                  onClick={() => definirEtapa('escolha')}
                >
                  Voltar
                </Button>
                <Button
                  tamanho="compacto"
                  variante={operacao === 'REMOVER' ? 'destrutiva' : 'primaria'}
                  disabled={alterar.isPending}
                  onClick={() => void salvar()}
                >
                  {alterar.isPending ? 'Salvando…' : texto.confirmar}
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
