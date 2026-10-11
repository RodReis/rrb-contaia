/**
 * Aba "Empregados" da empresa (SPEC-014 §3.1, §5.2): importação por CSV, regras do arquivo,
 * histórico e base importada em consulta, com o mesmo fluxo e a mesma aparência da aba "Plano de
 * contas" (`AbaDeImportacao`). A aba só aparece para quem consulta empregados; a API revalida.
 *
 * Se a API negar a consulta (papel sem a permissão, empresa que saiu da carteira), a aba troca o
 * conteúdo por esse estado em vez de mostrar seções vazias ou um erro técnico: nada da empresa é
 * revelado (SPEC §7).
 */
'use client';

import { Lock, ShieldOff } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { AbaDeImportacao } from '../importacao/aba-de-importacao';
import { useHistorico } from '../importacao/queries';
import { BaseDeEmpregados } from './base-de-empregados';
import { criarDominioDeEmpregados } from './dominio';

const CABECALHO = {
  titulo: 'Empregados',
  introducao:
    'Importe e reimporte a base cadastral de empregados desta empresa por CSV, no modelo do ContaIA ou mapeando as colunas de um arquivo legado. Nenhum empregado muda antes da sua confirmação.',
} as const;

const AcessoNegado = ({ codigo }: { codigo: string }) =>
  codigo === 'EMPRESA_FORA_DA_CARTEIRA' ? (
    <EmptyState
      icone={<Lock />}
      titulo="Esta empresa não está na sua carteira"
      descricao={mensagemDoCodigo(codigo)}
      acao={
        <Button asChild variante="contorno" tamanho="compacto">
          <Link href="/carteira">Ver minha carteira</Link>
        </Button>
      }
    />
  ) : (
    <EmptyState
      icone={<ShieldOff />}
      titulo="Seu papel não pode consultar os empregados desta empresa"
      descricao="A consulta, a importação e os relatórios de empregados dependem das permissões de Empresas → Empregados. Peça a um administrador do escritório para revisar o seu papel."
    />
  );

const CODIGOS_DE_ACESSO_NEGADO: readonly string[] = ['EMPRESA_FORA_DA_CARTEIRA', 'SEM_AUTORIZACAO'];

export const AbaEmpregados = ({
  empresaId,
  nomeDaEmpresa,
  somenteLeitura,
  comCabecalho = true,
}: {
  empresaId: string;
  nomeDaEmpresa: string;
  somenteLeitura: boolean;
  /** Falso quando quem hospeda a aba (a etapa do cadastro) já tem o próprio título e introdução. */
  comCabecalho?: boolean;
}) => {
  const dominio = criarDominioDeEmpregados(nomeDaEmpresa);
  // A primeira página do histórico é a mesma consulta do aviso de tentativa aberta (em cache):
  // é ela que diz se a API deixa esta pessoa ver os empregados desta empresa.
  const historico = useHistorico(dominio, empresaId, 1);
  const negado =
    historico.error instanceof ErroDaApi && CODIGOS_DE_ACESSO_NEGADO.includes(historico.error.problema.code)
      ? historico.error.problema.code
      : null;

  if (negado !== null) {
    return (
      <div className="flex flex-col gap-xl">
        {comCabecalho ? <h2 className="font-display text-headline-md text-foreground">{CABECALHO.titulo}</h2> : null}
        <AcessoNegado codigo={negado} />
      </div>
    );
  }

  return (
    <AbaDeImportacao
      dominio={dominio}
      empresaId={empresaId}
      somenteLeitura={somenteLeitura}
      parametroDaBase="empregados"
      cabecalho={comCabecalho ? CABECALHO : null}
      avisoDeSomenteLeitura="Empresa arquivada: os empregados e o histórico ficam para consulta, sem novas importações."
      base={(url) => <BaseDeEmpregados empresaId={empresaId} url={url} />}
    />
  );
};
