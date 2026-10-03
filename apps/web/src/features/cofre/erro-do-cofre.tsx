/**
 * Falha ao carregar dado do cofre (PATTERNS.md §5), com o tratamento que cada
 * causa pede: sessão expirada manda entrar de novo, falta de permissão explica e
 * não oferece "tentar de novo" (não adianta), cofre indisponível diz que nada foi
 * alterado, e o resto mostra o que fazer com o `correlationId` para o suporte.
 */
'use client';

import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { mensagemDoCofre } from './apresentacao';

export const SemPermissaoNoCofre = ({ nivel = 2 }: { nivel?: 2 | 3 }) => (
  <EmptyState
    nivel={nivel}
    icone={<Lock />}
    titulo="Você não tem permissão para ver o cofre"
    descricao="O seu papel não inclui a consulta de certificados. Se você precisa dela, peça a um administrador do escritório."
  />
);

export const ErroDoCofre = ({
  erro,
  titulo,
  aoTentarDeNovo,
  nivel = 2,
}: {
  erro: unknown;
  titulo: string;
  aoTentarDeNovo: () => void;
  nivel?: 2 | 3;
}) => {
  const problema = erro instanceof ErroDaApi ? erro.problema : null;

  if (problema?.code === 'SEM_AUTORIZACAO') {
    return <SemPermissaoNoCofre nivel={nivel} />;
  }

  if (problema?.status === 401) {
    return (
      <ErroDeTela
        nivel={nivel}
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
      nivel={nivel}
      titulo={problema?.code === 'COFRE_INDISPONIVEL' ? 'O cofre está indisponível' : titulo}
      descricao={problema === null ? 'Tente novamente em instantes.' : mensagemDoCofre(problema.code)}
      correlationId={problema?.correlationId}
      acao={
        <Button variante="contorno" tamanho="compacto" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Button>
      }
    />
  );
};
