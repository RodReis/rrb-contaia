/**
 * Ações sobre uma versão (SPEC-016 §3.2): publicar e arquivar são comandos explícitos atrás de
 * `AlertDialog` que NOMEIA a versão (FRONTEND.md §10.4) e nunca são otimistas. Falha que a tela
 * explica (sobreposição, conflito de versão, versão já imutável) fica no próprio diálogo, com um
 * "Entendi", em vez de um toast que some (SPEC-016 §5.3).
 */
'use client';

import type { TaxRuleVersionDto } from '@contaia/shared';
import { Archive, Eye, Pencil, Rocket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { formatarVigencia } from './apresentacao';
import { CODIGOS_EXPLICADOS_NO_PAINEL, useArquivarRegra, usePublicarRegra } from './queries';
import { rotuloDaRegra } from './resultado-da-simulacao';

/** O que o diálogo explica no lugar de um toast; o resto vai ao toast persistente. */
export const explicarBloqueioDoCatalogo = (erro: unknown): string | null =>
  erro instanceof ErroDaApi && CODIGOS_EXPLICADOS_NO_PAINEL.has(erro.problema.code) ? mensagemDoCodigo(erro.problema.code) : null;

const nomeDaVersao = (regra: TaxRuleVersionDto): string => `${rotuloDaRegra(regra)} (versão ${regra.versionNumber})`;

export const PublicarRegra = ({ regra, gatilho }: { regra: TaxRuleVersionDto; gatilho?: React.ReactNode }) => {
  const publicar = usePublicarRegra();

  return (
    <ConfirmacaoDeAcao
      gatilho={
        gatilho ?? (
          <Button variante="fantasma" tamanho="compacto" aria-label={`Publicar versão: ${nomeDaVersao(regra)}`}>
            <Rocket aria-hidden="true" />
            Publicar
          </Button>
        )
      }
      titulo={`Publicar a versão ${regra.versionNumber}?`}
      descricao={`${nomeDaVersao(regra)}, vigência: ${formatarVigencia(regra.validFrom, regra.validUntil)}. Depois de publicada a versão é imutável: para corrigir, será preciso criar um novo rascunho. A publicação é recusada se a vigência se sobrepuser a outra versão publicada da mesma regra.`}
      rotuloDeConfirmacao="Publicar versão"
      aoConfirmar={() => publicar.mutateAsync({ id: regra.id, expectedVersion: regra.lockVersion })}
      explicarBloqueio={explicarBloqueioDoCatalogo}
    />
  );
};

export const ArquivarRegra = ({ regra, gatilho }: { regra: TaxRuleVersionDto; gatilho?: React.ReactNode }) => {
  const arquivar = useArquivarRegra();

  return (
    <ConfirmacaoDeAcao
      gatilho={
        gatilho ?? (
          <Button variante="fantasma" tamanho="compacto" aria-label={`Arquivar versão: ${nomeDaVersao(regra)}`}>
            <Archive aria-hidden="true" />
            Arquivar
          </Button>
        )
      }
      titulo={`Arquivar a versão ${regra.versionNumber}?`}
      descricao={`${nomeDaVersao(regra)}. A versão deixa de ser usada em simulações novas e libera o intervalo para uma substituta. O histórico e as simulações anteriores são preservados: nada é apagado nem reescrito.`}
      rotuloDeConfirmacao="Arquivar versão"
      destrutivo
      aoConfirmar={() => arquivar.mutateAsync({ id: regra.id, expectedVersion: regra.lockVersion })}
      explicarBloqueio={explicarBloqueioDoCatalogo}
    />
  );
};

/** Abrir o painel: editar o rascunho (administrador) ou ver a versão (qualquer outro caso). */
export const AbrirRegra = ({
  regra,
  podeEditar,
  aoAbrir,
}: {
  regra: TaxRuleVersionDto;
  podeEditar: boolean;
  aoAbrir: (id: string) => void;
}) =>
  podeEditar ? (
    <Button variante="fantasma" tamanho="compacto" aria-label={`Editar rascunho: ${nomeDaVersao(regra)}`} onClick={() => aoAbrir(regra.id)}>
      <Pencil aria-hidden="true" />
      Editar
    </Button>
  ) : (
    <Button variante="fantasma" tamanho="compacto" aria-label={`Ver regra: ${nomeDaVersao(regra)}`} onClick={() => aoAbrir(regra.id)}>
      <Eye aria-hidden="true" />
      Ver
    </Button>
  );
