/**
 * Falha ao carregar dado remoto da área de usuários (PATTERNS.md §5), com o
 * tratamento que cada causa pede: sessão expirada manda entrar de novo, falta de
 * permissão explica e não oferece "tentar de novo" (não adianta), o resto mostra
 * o que fazer e o `correlationId` para o suporte.
 */
'use client';

import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';

export const SemPermissao = () => (
  <EmptyState
    nivel={2}
    icone={<Lock />}
    titulo="Você não tem permissão para ver esta área"
    descricao="O seu papel não inclui o acesso a usuários e permissões. Se você precisa dele, peça a um administrador do escritório."
  />
);

export const ErroDaConsulta = ({
  erro,
  titulo,
  aoTentarDeNovo,
}: {
  erro: unknown;
  titulo: string;
  aoTentarDeNovo: () => void;
}) => {
  const problema = erro instanceof ErroDaApi ? erro.problema : null;

  if (problema?.code === 'SEM_AUTORIZACAO') {
    return <SemPermissao />;
  }

  if (problema?.status === 401) {
    return (
      <ErroDeTela
        nivel={2}
        titulo="Sessão expirada"
        descricao={mensagemDoCodigo('HTTP_401')}
        acao={
          <Button asChild tamanho="compacto">
            <a href="/api/auth/entrar">Entrar novamente</a>
          </Button>
        }
      />
    );
  }

  return (
    <ErroDeTela
      nivel={2}
      titulo={titulo}
      descricao={problema === null ? 'Tente novamente em instantes.' : mensagemDoCodigo(problema.code)}
      correlationId={problema?.correlationId}
      acao={
        <Button variante="contorno" tamanho="compacto" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Button>
      }
    />
  );
};
