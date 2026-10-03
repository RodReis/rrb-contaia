/**
 * Ações de uma linha da lista (SPEC-007 §5.1). Suspender e arquivar encerram
 * sessões, então pedem confirmação que nomeia o usuário e o efeito; reenviar
 * convite e reativar são reversíveis e agem direto.
 *
 * Cada botão carrega o nome do usuário no rótulo acessível ("Suspender — Ana"):
 * numa lista, "Suspender" sozinho não diz a quem se refere.
 *
 * Quem só consulta recebe apenas "Ver": o servidor recusaria qualquer mutação,
 * mas a tela não oferece o que não vai funcionar.
 */
'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { VisaoDeUsuario } from './api';
import { useAcaoDeUsuario } from './queries';
import { acoesDaLinha, type AcaoDaLinha } from './rotulos';

const ROTULO: Readonly<Record<AcaoDaLinha, string>> = {
  editar: 'Editar',
  reenviar: 'Reenviar convite',
  suspender: 'Suspender',
  reativar: 'Reativar',
  arquivar: 'Arquivar',
  'novo-convite': 'Novo convite',
};

/** O último administrador é o bloqueio que o produto explica dentro do próprio diálogo. */
const explicarBloqueio = (erro: unknown): string | null =>
  erro instanceof ErroDaApi && erro.problema.code === 'ULTIMO_ADMIN'
    ? mensagemDoCodigo(erro.problema.code)
    : null;

export const AcoesDoUsuario = ({
  usuario,
  podeAdministrar,
}: {
  usuario: VisaoDeUsuario;
  podeAdministrar: boolean;
}) => {
  const acao = useAcaoDeUsuario();
  const destino = `/configuracoes/usuarios/${usuario.id}`;

  if (!podeAdministrar) {
    return (
      <Button asChild variante="fantasma" tamanho="compacto">
        <Link href={destino} aria-label={`Ver — ${usuario.nome}`}>
          Ver
        </Link>
      </Button>
    );
  }

  const rotuloDe = (tipo: AcaoDaLinha): string => `${ROTULO[tipo]} — ${usuario.nome}`;

  const renderizar = (tipo: AcaoDaLinha) => {
    switch (tipo) {
      case 'editar':
      case 'novo-convite':
        return (
          <Button key={tipo} asChild variante="fantasma" tamanho="compacto">
            <Link href={destino} aria-label={rotuloDe(tipo)}>
              {ROTULO[tipo]}
            </Link>
          </Button>
        );

      case 'reenviar':
      case 'reativar':
        return (
          <Button
            key={tipo}
            variante="fantasma"
            tamanho="compacto"
            aria-label={rotuloDe(tipo)}
            disabled={acao.isPending}
            onClick={() => acao.mutate({ acao: tipo, usuarioId: usuario.id })}
          >
            {ROTULO[tipo]}
          </Button>
        );

      case 'suspender':
        return (
          <ConfirmacaoDeAcao
            key={tipo}
            gatilho={
              <Button variante="fantasma" tamanho="compacto" aria-label={rotuloDe(tipo)}>
                {ROTULO[tipo]}
              </Button>
            }
            titulo={`Suspender ${usuario.nome}?`}
            descricao={`${usuario.nome} perde o acesso agora e todas as sessões abertas são encerradas. Os dados e o histórico ficam preservados, e você pode reativar o usuário depois.`}
            rotuloDeConfirmacao="Suspender usuário"
            destrutivo
            explicarBloqueio={explicarBloqueio}
            aoConfirmar={() => acao.mutateAsync({ acao: 'suspender', usuarioId: usuario.id })}
          />
        );

      case 'arquivar':
        return (
          <ConfirmacaoDeAcao
            key={tipo}
            gatilho={
              <Button variante="fantasma" tamanho="compacto" aria-label={rotuloDe(tipo)}>
                {ROTULO[tipo]}
              </Button>
            }
            titulo={`Arquivar ${usuario.nome}?`}
            descricao={`${usuario.nome} perde o acesso e todas as sessões são encerradas. O cadastro e o histórico são mantidos: nada é excluído. Para voltar, será preciso revisar os dados e os papéis e enviar um novo convite.`}
            rotuloDeConfirmacao="Arquivar usuário"
            destrutivo
            explicarBloqueio={explicarBloqueio}
            aoConfirmar={() => acao.mutateAsync({ acao: 'arquivar', usuarioId: usuario.id })}
          />
        );
    }
  };

  return <div className="flex flex-wrap items-center justify-end gap-xs">{acoesDaLinha(usuario.situacao).map(renderizar)}</div>;
};
