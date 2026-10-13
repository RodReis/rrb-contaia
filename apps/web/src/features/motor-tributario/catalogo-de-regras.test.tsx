import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogoDeRegras } from './catalogo-de-regras';
import {
  BASE,
  Envolvido,
  OUTRA_REGRA_ID,
  REGRA_ID,
  instalarFetch,
  json,
  navegacao,
  pagina,
  problema,
  rascunho,
  regra,
} from './motor-tributario.fixtures';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('./motor-tributario.fixtures');

  return {
    useRouter: () => ({ replace: url.replace, push: url.push }),
    useSearchParams: () => useSyncExternalStore(url.assinar, url.ler, url.ler),
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

beforeEach(() => {
  navegacao.definir('');
  navegacao.replace.mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Chamada = Readonly<{ url: string; metodo: string; corpo: unknown }>;

const montar = (roteador: (url: string, metodo: string) => Response | Promise<Response> | undefined) => {
  const chamadas: Chamada[] = [];
  instalarFetch((url, init) => {
    const metodo = init?.method ?? 'GET';
    chamadas.push({ url, metodo, corpo: init?.body === undefined ? null : JSON.parse(String(init.body)) });

    return roteador(url, metodo);
  });
  // Na página o catálogo fica dentro do `<main>` do shell (landmark exigido pelo axe).
  const resultado = render(
    <main>
      <CatalogoDeRegras />
    </main>,
    { wrapper: Envolvido },
  );

  return { ...resultado, chamadas };
};

const listagem = (itens = [regra()], sobrescritas = {}) => (url: string, metodo: string) => {
  if (metodo !== 'GET') {
    return undefined;
  }
  if (url.startsWith(`${BASE}?`)) {
    return json(pagina(itens, sobrescritas));
  }

  // Painel aberto pela URL: a versão pelo id (o painel tem testes próprios).
  return url.startsWith(`${BASE}/`) ? json(itens.find((item) => url.endsWith(item.id)) ?? regra()) : undefined;
};

describe('CatalogoDeRegras — estados da tela (SPEC-016 §5.3)', () => {
  it('carregando: skeleton com a forma da tabela, anunciado, nunca spinner', async () => {
    let liberar: (resposta: Response) => void = () => undefined;
    montar((url) => (url.startsWith(`${BASE}?`) ? new Promise<Response>((resolver) => void (liberar = resolver)) : undefined));

    expect(await screen.findByText('Carregando o catálogo de regras')).toBeInTheDocument();
    expect(screen.getByText('Carregando o catálogo de regras').closest('[aria-busy="true"]')).not.toBeNull();
    liberar(json(pagina([regra()])));
    expect(await screen.findByRole('table', { name: /Regras tributárias/u })).toBeInTheDocument();
  });

  it('sucesso: cada versão mostra regra, versão, vigência, alíquota e estado em texto', async () => {
    montar(listagem([regra(), rascunho({ id: OUTRA_REGRA_ID, versionNumber: 2, baseReductionBasisPoints: 3_333, validFrom: '2026-07-01', validUntil: '2026-12-31', rateBasisPoints: 2_000 })]));

    const tabela = await screen.findByRole('table', { name: /Regras tributárias/u });
    const publicada = within(tabela).getAllByRole('row')[1] as HTMLElement;
    const emRascunho = within(tabela).getAllByRole('row')[2] as HTMLElement;

    expect(publicada).toHaveTextContent('ICMS · Lucro Presumido · Venda de mercadoria');
    expect(publicada).toHaveTextContent('v1');
    expect(publicada).toHaveTextContent('A partir de 01/01/2026, sem data final');
    expect(publicada).toHaveTextContent('18,00%');
    expect(within(publicada).getByText('Publicada')).toBeInTheDocument();
    expect(emRascunho).toHaveTextContent('01/07/2026 a 31/12/2026');
    expect(emRascunho).toHaveTextContent('20,00%');
    expect(emRascunho).toHaveTextContent('redução de base 33,33%');
    expect(within(emRascunho).getByText('Rascunho')).toBeInTheDocument();
    expect(screen.getByText('2 versões no catálogo.')).toBeInTheDocument();
  });

  it('o aviso de dado de teste não oficial acompanha o catálogo', async () => {
    montar(listagem());

    expect(await screen.findByText(/dados de teste não oficiais/iu)).toBeInTheDocument();
  });

  it('vazio de verdade: explica o que aparecerá aqui e oferece criar, só para quem administra', async () => {
    montar(listagem([], { canAdminister: true }));

    expect(await screen.findByRole('heading', { name: 'Nenhuma regra no catálogo' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Nova regra' }).length).toBeGreaterThan(0);
  });

  it('vazio para o escritório: diz que a plataforma ainda não publicou, sem ação de criar', async () => {
    montar(listagem([], { canAdminister: false }));

    expect(await screen.findByRole('heading', { name: 'Nenhuma regra publicada ainda' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova regra' })).not.toBeInTheDocument();
  });

  it('filtro sem resultado é outro vazio, com ação de limpar', async () => {
    navegacao.definir('tributo=CBS');
    montar(listagem([]));

    expect(await screen.findByRole('heading', { name: 'Nenhuma regra encontrada' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(navegacao.replace).toHaveBeenLastCalledWith('/fiscal/motor-tributario', { scroll: false });
  });

  it('erro técnico: estado persistente com o código de suporte e nova tentativa', async () => {
    let falhar = true;
    const { chamadas } = montar((url) => {
      if (!url.startsWith(`${BASE}?`)) {
        return undefined;
      }

      return falhar ? problema(500, 'FALHA_TECNICA', {}, 'corr-catalogo-1') : json(pagina([regra()]));
    });

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível carregar o catálogo');
    expect(alerta).toHaveTextContent('corr-catalogo-1');
    expect(alerta).toHaveTextContent('O motor tributário falhou por um problema técnico');
    expect(alerta).not.toHaveTextContent(/importação|arquivo/iu);

    falhar = false;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table', { name: /Regras tributárias/u })).toBeInTheDocument();
    expect(chamadas.filter((c) => c.url.startsWith(`${BASE}?`)).length).toBeGreaterThan(1);
  });

  it('acesso negado: explica a falta de permissão e não oferece nova tentativa', async () => {
    montar((url) => (url.startsWith(`${BASE}?`) ? problema(403, 'SEM_AUTORIZACAO') : undefined));

    expect(await screen.findByRole('heading', { name: 'Você não tem acesso às regras tributárias' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });
});

describe('CatalogoDeRegras — filtros e paginação na URL (FRONTEND.md §7)', () => {
  it('lê os filtros da URL e os envia ao servidor', async () => {
    navegacao.definir('tributo=ICMS&regime=LUCRO_REAL&operacao=VENDA_MERCADORIA&estado=PUBLISHED&vigente=2026-06-15&pagina=2');
    const { chamadas } = montar(listagem([regra()], { page: 2, total: 30 }));

    await screen.findByRole('table', { name: /Regras tributárias/u });
    const consulta = new URL(`http://x${chamadas.find((c) => c.url.startsWith(`${BASE}?`))?.url ?? ''}`).searchParams;

    expect(Object.fromEntries(consulta)).toEqual({
      taxType: 'ICMS',
      regime: 'LUCRO_REAL',
      operationType: 'VENDA_MERCADORIA',
      status: 'PUBLISHED',
      validOn: '2026-06-15',
      page: '2',
      pageSize: '25',
    });
  });

  it('ignora valor de filtro inválido na URL em vez de enviá-lo', async () => {
    navegacao.definir('tributo=ISS&estado=APAGADA&vigente=2026-02-30&pagina=abc');
    const { chamadas } = montar(listagem());

    await screen.findByRole('table', { name: /Regras tributárias/u });
    const consulta = new URL(`http://x${chamadas[0]?.url ?? ''}`).searchParams;

    expect(Object.fromEntries(consulta)).toEqual({ page: '1', pageSize: '25' });
  });

  it('escolher um filtro publica na URL e volta à primeira página', async () => {
    navegacao.definir('pagina=3');
    montar(listagem([regra()], { page: 3, total: 90 }));
    await screen.findByRole('table', { name: /Regras tributárias/u });

    // Pelo teclado: o jsdom fecha o seletor do Radix ao abrir por clique depois de outro clique no mesmo arquivo.
    screen.getByRole('combobox', { name: 'Tributo' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('option', { name: 'CBS' }));

    expect(navegacao.replace).toHaveBeenLastCalledWith('/fiscal/motor-tributario?tributo=CBS', { scroll: false });
  });

  it('a data de vigência filtra pela data civil informada', async () => {
    montar(listagem());
    await screen.findByRole('table', { name: /Regras tributárias/u });

    await userEvent.type(screen.getByLabelText('Vigente em'), '2026-06-15');

    await waitFor(() => expect(navegacao.replace).toHaveBeenLastCalledWith('/fiscal/motor-tributario?vigente=2026-06-15', { scroll: false }));
  });

  it('pagina no servidor: mostra "Página X de Y" e navega pela URL', async () => {
    montar(listagem([regra()], { total: 60, page: 1 }));
    await screen.findByRole('table', { name: /Regras tributárias/u });

    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(navegacao.replace).toHaveBeenLastCalledWith('/fiscal/motor-tributario?pagina=2', { scroll: false });
  });
});

describe('CatalogoDeRegras — permissões da tela (SPEC-016 §3.7)', () => {
  it('quem só consulta vê "Ver" e nenhuma ação que altere o catálogo', async () => {
    montar(listagem([regra(), regra({ id: OUTRA_REGRA_ID, status: 'ARCHIVED' })], { canAdminister: false }));

    await screen.findByRole('table', { name: /Regras tributárias/u });

    expect(screen.getAllByRole('button', { name: /^Ver regra/u })).toHaveLength(2);
    for (const proibida of [/Publicar/u, /Arquivar/u, /Editar/u, /Nova regra/u]) {
      expect(screen.queryByRole('button', { name: proibida })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/Você vê as regras publicadas/u)).toBeInTheDocument();
  });

  it('o administrador vê as ações que cabem a cada estado', async () => {
    montar(
      listagem([
        rascunho({ id: REGRA_ID }),
        regra({ id: OUTRA_REGRA_ID, versionNumber: 2 }),
        regra({ id: '0198f3c2-0000-7000-8000-000000000005', versionNumber: 3, status: 'ARCHIVED' }),
      ]),
    );
    await screen.findByRole('table', { name: /Regras tributárias/u });
    const [, doRascunho, daPublicada, daArquivada] = screen.getAllByRole('row') as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    const acoes = (linha: HTMLElement): string[] => within(linha).getAllByRole('button').map((botao) => botao.getAttribute('aria-label') ?? botao.textContent ?? '');

    expect(acoes(doRascunho).map((nome) => nome.split(':')[0])).toEqual(['Editar rascunho', 'Publicar versão']);
    expect(acoes(daPublicada).map((nome) => nome.split(':')[0])).toEqual(['Ver regra', 'Arquivar versão']);
    expect(acoes(daArquivada).map((nome) => nome.split(':')[0])).toEqual(['Ver regra']);
    expect(screen.getAllByRole('button', { name: 'Nova regra' }).length).toBeGreaterThan(0);
  });

  it('abrir uma versão publica o id na URL, que é o que abre o painel', async () => {
    montar(listagem([regra()]));
    await screen.findByRole('table', { name: /Regras tributárias/u });

    await userEvent.click(screen.getByRole('button', { name: /^Ver regra/u }));

    expect(navegacao.replace).toHaveBeenLastCalledWith(`/fiscal/motor-tributario?regra=${REGRA_ID}`, { scroll: false });
  });
});

describe('CatalogoDeRegras — painel aberto pela URL', () => {
  it('?regra=nova abre o painel de criação para quem administra e Esc volta à lista', async () => {
    navegacao.definir('regra=nova&tributo=ICMS');
    montar(listagem([regra()]));

    expect(await screen.findByRole('dialog', { name: 'Nova regra' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    // Fecha preservando os filtros que já estavam na URL.
    expect(navegacao.replace).toHaveBeenLastCalledWith('/fiscal/motor-tributario?tributo=ICMS', { scroll: false });
  });

  it('?regra=nova não abre para quem só consulta', async () => {
    navegacao.definir('regra=nova');
    montar(listagem([regra()], { canAdminister: false }));
    await screen.findByRole('table', { name: /Regras tributárias/u });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('?regra=<id> abre a versão pelo servidor; id malformado na URL é ignorado', async () => {
    navegacao.definir(`regra=${REGRA_ID}`);
    const { chamadas, unmount } = montar(listagem([regra()]));

    expect(await screen.findByRole('dialog', { name: /Regra tributária, versão 1/u })).toBeInTheDocument();
    expect(chamadas.some((c) => c.url === `${BASE}/${REGRA_ID}`)).toBe(true);
    unmount();

    navegacao.definir('regra=nao-e-uuid');
    montar(listagem([regra()]));
    await screen.findByRole('table', { name: /Regras tributárias/u });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('CatalogoDeRegras — publicar e arquivar (ação com efeito jurídico, nunca otimista)', () => {
  it('publicar pede confirmação que nomeia a versão e envia a versão esperada', async () => {
    let publicada = false;
    const { chamadas } = montar((url, metodo) => {
      if (metodo === 'POST' && url === `${BASE}/${REGRA_ID}/publish`) {
        publicada = true;

        return json(regra({ lockVersion: 2 }));
      }

      return listagem([publicada ? regra({ lockVersion: 2 }) : rascunho({ lockVersion: 4 })])(url, metodo);
    });
    await screen.findByRole('table', { name: /Regras tributárias/u });

    await userEvent.click(screen.getByRole('button', { name: /^Publicar versão/u }));
    const dialogo = await screen.findByRole('alertdialog');
    expect(dialogo).toHaveTextContent('Publicar a versão 1');
    expect(dialogo).toHaveTextContent('ICMS · Lucro Presumido · Venda de mercadoria');
    expect(dialogo).toHaveTextContent('imutável');
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Publicar versão' }));

    await waitFor(() => expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toEqual({ expectedVersion: 4 }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Versão publicada. Ela agora é imutável.'));
    expect(await screen.findByText('Publicada')).toBeInTheDocument();
  });

  it('vigência sobreposta é explicada no próprio diálogo, sem toast, e nada muda', async () => {
    montar((url, metodo) =>
      metodo === 'POST' ? problema(409, 'TAX_RULE_OVERLAPPING_VALIDITY', {}, 'corr-sobreposta') : listagem([rascunho()])(url, metodo),
    );
    await screen.findByRole('table', { name: /Regras tributárias/u });

    await userEvent.click(screen.getByRole('button', { name: /^Publicar versão/u }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar versão' }));

    expect(await screen.findByText(/vigência sobreposta/iu)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entendi' })).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
  });

  it('conflito de versão manda recarregar, também sem toast', async () => {
    montar((url, metodo) => (metodo === 'POST' ? problema(409, 'TAX_RULE_VERSION_CONFLICT') : listagem([rascunho()])(url, metodo)));
    await screen.findByRole('table', { name: /Regras tributárias/u });

    await userEvent.click(screen.getByRole('button', { name: /^Publicar versão/u }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar versão' }));

    expect(await screen.findByText(/recarregue/iu)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('arquivar pede confirmação, diz que o histórico é preservado e envia a versão esperada', async () => {
    const { chamadas } = montar((url, metodo) =>
      metodo === 'POST' && url === `${BASE}/${REGRA_ID}/archive` ? json(regra({ status: 'ARCHIVED', lockVersion: 3 })) : listagem([regra({ lockVersion: 2 })])(url, metodo),
    );
    await screen.findByRole('table', { name: /Regras tributárias/u });

    await userEvent.click(screen.getByRole('button', { name: /^Arquivar versão/u }));
    const dialogo = await screen.findByRole('alertdialog');
    expect(dialogo).toHaveTextContent('Arquivar a versão 1');
    expect(dialogo).toHaveTextContent('histórico');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Arquivar versão' }));

    await waitFor(() => expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toEqual({ expectedVersion: 2 }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Versão arquivada. O histórico foi preservado.'));
  });

  it('falha técnica ao publicar vai ao toast persistente com o código de suporte', async () => {
    montar((url, metodo) => (metodo === 'POST' ? problema(500, 'FALHA_TECNICA', {}, 'corr-falha') : listagem([rascunho()])(url, metodo)));
    await screen.findByRole('table', { name: /Regras tributárias/u });

    await userEvent.click(screen.getByRole('button', { name: /^Publicar versão/u }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar versão' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.any(String), { duration: Infinity, description: 'Código de suporte: corr-falha' }),
    );
  });
});

describe('CatalogoDeRegras — acessibilidade', () => {
  it('a tabela tem legenda e cabeçalhos com escopo, e não tem violação de axe', async () => {
    const { container } = montar(listagem([regra(), rascunho({ id: OUTRA_REGRA_ID })]));

    const tabela = await screen.findByRole('table', { name: /Regras tributárias/u });
    for (const cabecalho of within(tabela).getAllByRole('columnheader')) {
      expect(cabecalho).toHaveAttribute('scope', 'col');
    }
    expect(await axe(container)).toHaveNoViolations();
  });
});
