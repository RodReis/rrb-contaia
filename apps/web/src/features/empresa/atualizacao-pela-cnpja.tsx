/**
 * Atualização seletiva pela CNPJá (SPEC-003 §3.3).
 *
 * O ponto da tela: a consulta **nunca** aplica nada. Ela mostra o que difere,
 * campo a campo, e só o que a pessoa marcar e confirmar é salvo. Situação
 * cadastral irregular alerta e não bloqueia; falha externa preserva os dados e
 * mantém a edição manual disponível.
 */
'use client';

import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/estados';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { ComparacaoComAFonte } from './manutencao-api';
import { useAplicarDaFonte, useCompararComAFonte } from './manutencao-queries';

const ROTULO_DO_CAMPO: Readonly<Record<string, string>> = {
  razaoSocial: 'Razão social',
  nomeFantasia: 'Nome fantasia',
  telefone: 'Telefone',
  email: 'E-mail',
  cnaePrincipal: 'CNAE principal',
};

const MOTIVO: Readonly<Record<string, string>> = {
  nao_encontrado: 'A base pública não encontrou este CNPJ.',
  limite_excedido: 'A base pública atingiu o limite de consultas. Tente mais tarde.',
  indisponivel: 'A base pública está indisponível no momento.',
  resposta_invalida: 'A base pública devolveu uma resposta que não pôde ser lida.',
};

const Vazio = ({ valor }: { valor: string | null }) =>
  valor === null || valor.length === 0 ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span>{valor}</span>
  );

export const AtualizacaoPelaCnpja = ({
  empresaId,
  somenteLeitura,
}: {
  empresaId: string;
  somenteLeitura: boolean;
}) => {
  const comparar = useCompararComAFonte(empresaId);
  const [selecionados, definirSelecionados] = useState<readonly string[]>([]);
  const aplicar = useAplicarDaFonte(empresaId, () => {
    definirSelecionados([]);
    comparar.reset();
  });

  const comparacao: ComparacaoComAFonte | undefined = comparar.data;

  const alternar = (campo: string): void => {
    definirSelecionados((atuais) =>
      atuais.includes(campo)
        ? atuais.filter((item) => item !== campo)
        : [...atuais, campo],
    );
  };

  return (
    <section className="flex flex-col gap-md rounded-lg border border-border bg-card p-md">
      <div className="flex flex-col gap-md tablet:flex-row tablet:items-start tablet:justify-between">
        <div className="flex flex-col gap-xs">
          {/* `h2`: a seção é irmã do conteúdo da aba, e o `h1` da página é o
              nome da empresa — pular de 1 para 3 quebra a ordem de títulos. */}
          <h2 className="text-title-sm text-foreground">Atualizar dados pela CNPJá</h2>
          <p className="max-w-prose text-body-sm text-muted-foreground">
            A consulta compara o cadastro com a base pública e não altera nada sozinha:
            você escolhe campo a campo o que aplicar.
          </p>
        </div>

        {somenteLeitura ? null : (
          <Button
            variante="contorno"
            tamanho="compacto"
            onClick={() => comparar.mutate()}
            disabled={comparar.isPending}
          >
            <RefreshCw aria-hidden="true" />
            {comparar.isPending ? 'Consultando…' : 'Consultar CNPJá'}
          </Button>
        )}
      </div>

      {comparar.isPending ? (
        <p className="text-body-sm text-muted-foreground" aria-live="polite">
          Consultando a base pública. Os dados atuais permanecem inalterados.
        </p>
      ) : null}

      {comparacao === undefined ? null : (
        <div className="flex flex-col gap-md">
          {comparacao.alertaDeSituacaoExterna ? (
            // Alerta, nunca bloqueio: a situação externa não arquiva a empresa
            // nem impede a edição (§3.3).
            <p
              role="status"
              className="flex items-start gap-sm rounded-md border border-warning bg-warning/10 px-md py-sm text-body-sm text-foreground"
            >
              <AlertTriangle aria-hidden="true" className="mt-[0.125rem] size-icon-sm" />
              <span>
                A base pública indica situação cadastral{' '}
                <strong>{comparacao.situacaoCadastralExterna}</strong>. Isso é um aviso: a
                empresa continua ativa e editável no ContaIA.
              </span>
            </p>
          ) : null}

          {comparacao.situacao === 'sem_fonte' ? (
            <EmptyState
              nivel={3}
              icone={<CloudOff />}
              titulo="Não foi possível consultar a CNPJá"
              descricao={`${
                MOTIVO[comparacao.motivo ?? ''] ?? mensagemDoCodigo(comparacao.motivo ?? '')
              } Os dados atuais continuam íntegros e a edição manual segue disponível.`}
            />
          ) : null}

          {comparacao.situacao === 'sem_diferencas' ? (
            <EmptyState
              nivel={3}
              icone={<CheckCircle2 />}
              titulo="Os dados já estão atualizados"
              descricao="Não há diferença entre o cadastro e a base pública."
            />
          ) : null}

          {comparacao.situacao === 'comparado' ? (
            <div className="flex flex-col gap-md">
              <fieldset className="flex flex-col gap-sm border-0 p-0">
                <legend className="text-label-md text-foreground">
                  Diferenças encontradas
                </legend>

                {comparacao.diferencas.map((diferenca) => {
                  const marcado = selecionados.includes(diferenca.campo);

                  return (
                    <label
                      key={diferenca.campo}
                      className="flex cursor-pointer items-start gap-sm rounded-md border border-border px-md py-sm transition-colors duration-fast ease-out hover:bg-accent/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(diferenca.campo)}
                        disabled={somenteLeitura || aplicar.isPending}
                        className="mt-[0.2rem] size-icon-sm accent-[var(--color-primary)] focus-visible:outline-none"
                      />
                      <span className="flex flex-1 flex-col gap-xs">
                        <span className="text-label-md text-foreground">
                          {ROTULO_DO_CAMPO[diferenca.campo] ?? diferenca.campo}
                        </span>
                        <span className="flex flex-col gap-xs text-body-sm tablet:flex-row tablet:items-center tablet:gap-md">
                          <span className="text-muted-foreground">
                            Atual: <Vazio valor={diferenca.valorAtual} />
                          </span>
                          <span className="text-foreground">
                            CNPJá: <Vazio valor={diferenca.valorExterno} />
                          </span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              {somenteLeitura ? null : (
                <div className="flex flex-wrap items-center justify-end gap-sm">
                  <span aria-live="polite" className="text-body-sm text-muted-foreground">
                    {selecionados.length === 0
                      ? 'Nenhum campo selecionado.'
                      : selecionados.length === 1
                        ? '1 campo selecionado.'
                        : `${selecionados.length} campos selecionados.`}
                  </span>
                  <Button
                    tamanho="compacto"
                    onClick={() => aplicar.mutate(selecionados)}
                    disabled={selecionados.length === 0 || aplicar.isPending}
                  >
                    {aplicar.isPending ? 'Salvando…' : 'Aplicar selecionados'}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
};
