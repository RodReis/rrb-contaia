/**
 * Página "Fiscal → Motor tributário" (SPEC-016 §5): cabeçalho canônico (breadcrumb, um H1, descrição),
 * identidade do motor com o aviso permanente de dados de teste não oficiais, o catálogo global e o
 * simulador. A fronteira da F16 é só catálogo e simulação: nada aqui promete apuração, guia,
 * fechamento, escrituração ou carteira.
 *
 * A decisão de mostrar cada parte é da sessão (permissão do catálogo), mas quem decide de verdade é a
 * API: o 403 dela cai nos mesmos estados de "sem acesso". O administrador da plataforma não tem sessão
 * de escritório; a falha dela não bloqueia a tela, e a API decide cada comando.
 */
'use client';

import { Gavel, Lock, Scale } from 'lucide-react';

import { Breadcrumb } from '@/components/ui/breadcrumb';
import { EmptyState } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { useSessao } from '../usuarios/queries';
import { CatalogoDeRegras } from './catalogo-de-regras';
import { CONSULTA_DO_MOTOR, SIMULACAO_DO_MOTOR, concede } from './permissoes';
import { Simulador } from './simulador';

const Identidade = () => (
  <section
    aria-label="Identidade do motor"
    className="flex flex-col gap-md rounded-lg border border-border bg-card p-md desktop:flex-row desktop:items-center desktop:justify-between"
  >
    <div className="flex items-start gap-sm">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground" aria-hidden="true">
        <Scale className="size-icon-lg" />
      </span>
      <div className="flex flex-col gap-xs">
        <div className="flex flex-wrap items-center gap-sm">
          <p className="text-title-md text-foreground">Catálogo versionado e cálculo determinístico</p>
          <StatusBadge tom="neutro" rotulo="Ambiente local" />
          <StatusBadge tom="atencao" rotulo="Dados de teste não oficiais" />
        </div>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Mesma entrada e mesma versão da regra produzem sempre o mesmo resultado, com a memória de cálculo à mostra. A regra é
          escolhida pela vigência na data do fato gerador.
        </p>
      </div>
    </div>
    <p className="flex shrink-0 items-center gap-xs rounded-md bg-secondary px-sm py-xs text-code-xs text-muted-foreground">
      <Gavel className="size-icon-sm" aria-hidden="true" />
      Cálculo determinístico, sem LLM
    </p>
  </section>
);

export const AreaDoMotor = () => {
  const sessao = useSessao();
  const permissoes = sessao.data;
  const semConsulta = permissoes !== undefined && !concede(permissoes, CONSULTA_DO_MOTOR);
  const semSimulacao = permissoes !== undefined && !concede(permissoes, SIMULACAO_DO_MOTOR);

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <Breadcrumb itens={[{ rotulo: 'Início', href: '/empresas' }, { rotulo: 'Fiscal' }, { rotulo: 'Motor tributário' }]} />
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-headline-lg text-foreground">Motor tributário</h1>
          <p className="max-w-prose text-body-md text-muted-foreground">
            Regras tributárias versionadas por vigência e um simulador para comprovar qual versão vale numa data e como o valor foi
            calculado. Simular não cria nenhum registro.
          </p>
        </div>
      </header>

      <Identidade />

      {semConsulta ? (
        <EmptyState
          nivel={2}
          icone={<Lock />}
          titulo="Você não tem acesso ao motor tributário"
          descricao="O seu papel não inclui a consulta às regras tributárias. Se você precisa dela, peça a um administrador do escritório."
        />
      ) : (
        <>
          <CatalogoDeRegras />

          <section aria-labelledby="titulo-do-simulador" className="flex flex-col gap-md">
            <h2 id="titulo-do-simulador" className="font-display text-headline-md text-foreground">
              Simulador
            </h2>
            {semSimulacao ? (
              <EmptyState
                icone={<Lock />}
                titulo="Você não tem acesso ao simulador"
                descricao="O seu papel consulta as regras publicadas, mas não simula. Se você precisa simular, peça a um administrador do escritório."
              />
            ) : (
              <Simulador />
            )}
          </section>
        </>
      )}
    </div>
  );
};
