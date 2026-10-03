/**
 * Ações de um item do cofre: cadastrar/substituir, trocar responsável e
 * desativar (SPEC-011 §5.2). O que aparece vem de `item.acoes`, que a API já
 * calculou com permissão, papel e carteira — esconder botão não é controle de
 * acesso, o servidor recusa de qualquer jeito.
 *
 * Na linha da lista, as ações frequentes ficam visíveis: o envio com texto e as
 * outras duas como botões de ícone com `aria-label` que nomeia a empresa
 * (FRONTEND.md §10.5). No detalhe, as mesmas ações aparecem por extenso.
 */
'use client';

import type { ItemDoCofre } from '@contaia/shared';
import { Ban, UserRoundCog, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { podeEnviar, rotuloCurtoDoEnvio, rotuloDoEnvio, temAcao } from './apresentacao';
import { DialogoDeDesativacao } from './dialogo-de-desativacao';
import { DialogoDeResponsavel } from './dialogo-de-responsavel';

export const AcoesDoItem = ({
  item,
  variante,
  aoEnviar,
}: {
  item: ItemDoCofre;
  variante: 'linha' | 'detalhe';
  aoEnviar: (item: ItemDoCofre) => void;
}) => {
  const naLinha = variante === 'linha';
  const trocar = temAcao(item, 'TROCAR_RESPONSAVEL');
  const desativar = temAcao(item, 'DESATIVAR');
  // Só o que não pode esperar ganha destaque na linha: nunca dois botões primários na mesma área.
  const urgente = item.estado === 'VENCIDO' || item.estado === 'VENCE_D7';

  if (!podeEnviar(item) && !trocar && !desativar) {
    return <span className="text-body-sm text-muted-foreground">Somente consulta</span>;
  }

  return (
    <div className={naLinha ? 'flex flex-wrap items-center gap-xs desktop:justify-end' : 'flex flex-wrap gap-sm'}>
      {podeEnviar(item) ? (
        <Button
          variante={naLinha && !urgente ? 'contorno' : 'primaria'}
          tamanho="compacto"
          onClick={() => aoEnviar(item)}
          aria-label={naLinha ? `${rotuloDoEnvio(item)} de ${item.empresaNome}` : undefined}
        >
          <Upload aria-hidden="true" />
          {naLinha ? rotuloCurtoDoEnvio(item) : rotuloDoEnvio(item)}
        </Button>
      ) : null}

      {trocar ? (
        <DialogoDeResponsavel
          item={item}
          gatilho={
            naLinha && !item.semResponsavel ? (
              <Button
                variante="fantasma"
                tamanho="icone"
                aria-label={`Trocar responsável do certificado de ${item.empresaNome}`}
                title="Trocar responsável"
              >
                <UserRoundCog aria-hidden="true" />
              </Button>
            ) : (
              <Button
                variante="contorno"
                tamanho="compacto"
                {...(naLinha ? { 'aria-label': `Escolher responsável do certificado de ${item.empresaNome}` } : {})}
              >
                <UserRoundCog aria-hidden="true" />
                {naLinha ? 'Responsável' : item.semResponsavel ? 'Escolher responsável' : 'Trocar responsável'}
              </Button>
            )
          }
        />
      ) : null}

      {desativar ? (
        <DialogoDeDesativacao
          empresaId={item.empresaId}
          empresaNome={item.empresaNome}
          cnpj={item.cnpj}
          gatilho={
            naLinha ? (
              <Button
                variante="fantasma"
                tamanho="icone"
                aria-label={`Desativar o certificado de ${item.empresaNome}`}
                title="Desativar certificado"
                className="text-destructive hover:bg-danger"
              >
                <Ban aria-hidden="true" />
              </Button>
            ) : (
              <Button variante="contorno" tamanho="compacto" className="text-destructive">
                <Ban aria-hidden="true" />
                Desativar certificado
              </Button>
            )
          }
        />
      ) : null}
    </div>
  );
};
