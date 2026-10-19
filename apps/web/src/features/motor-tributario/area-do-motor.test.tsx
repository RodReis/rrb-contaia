import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaDoMotor } from './area-do-motor';
import { BASE, Envolvido, instalarFetch, json, navegacao, pagina, problema, regra } from './motor-tributario.fixtures';

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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sessao = (permissoes: readonly string[]) => ({ papeis: ['contador'], permissoes, escopoDeEmpresas: 'CARTEIRA' });

const COMPLETA = ['fiscal.motor_tributario.consultar', 'fiscal.motor_tributario.simular'];

/** `null` = a sessão de escritório falha (o `super_admin` não tem linha em `app.usuario`: 401 em /usuarios/eu). */
const montar = (permissoes: readonly string[] | null, canAdminister = false) => {
  instalarFetch((url, init) => {
    if (url === '/api/proxy/usuarios/eu') {
      return permissoes === null ? problema(401, 'HTTP_401') : json(sessao(permissoes));
    }
    if (url === '/api/proxy/tax-packages') return json({ canAdminister: false, actorId: '123e4567-e89b-12d3-a456-426614174000', items: [] });

    return init?.method === undefined && url.startsWith(`${BASE}?`) ? json(pagina([regra()], { canAdminister })) : undefined;
  });

  return render(
    <main>
      <AreaDoMotor />
    </main>,
    { wrapper: Envolvido },
  );
};

describe('AreaDoMotor — página do motor tributário (SPEC-016 §5)', () => {
  it('cabeçalho canônico: breadcrumb, um único H1 e a descrição do que a tela faz', async () => {
    montar(COMPLETA);

    expect(screen.getByRole('heading', { level: 1, name: 'Motor tributário' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const trilha = screen.getByRole('navigation', { name: 'Trilha de navegação' });
    expect(within(trilha).getByText('Fiscal')).toBeInTheDocument();
    expect(within(trilha).getByText('Motor tributário')).toHaveAttribute('aria-current', 'page');
    await screen.findByRole('table', { name: /Regras tributárias/u });
  });

  it('identifica o ambiente local, o aviso de fixtures não oficiais e que o cálculo é determinístico', async () => {
    montar(COMPLETA);

    const identidade = screen.getByRole('region', { name: 'Identidade do motor' });
    expect(within(identidade).getByText('Ambiente local')).toBeInTheDocument();
    expect(within(identidade).getByText('Dados de teste não oficiais')).toBeInTheDocument();
    expect(within(identidade).getByText(/sem LLM/iu)).toBeInTheDocument();
    expect(within(identidade).getByText(/mesma entrada e mesma versão/iu)).toBeInTheDocument();
    await screen.findByRole('table', { name: /Regras tributárias/u });
  });

  it('consulta o catálogo curado e não confunde pacote publicado com cobertura automática', async () => {
    instalarFetch((url, init) => {
      if (url === '/api/proxy/usuarios/eu') return json(sessao(COMPLETA));
      if (url === '/api/proxy/tax-packages') return json({ canAdminister: false, actorId: '123e4567-e89b-12d3-a456-426614174000', items: [{
        id: '123e4567-e89b-12d3-a456-426614174000', packageId: 'go-entry-v1', semanticVersion: '1.0.0', status: 'PUBLISHED', jurisdiction: 'GO',
        regimes: ['SIMPLES_NACIONAL'], validFrom: '2026-01-01', validUntil: null, coverage: ['revenda'], exclusions: ['ST'], sha256: 'a'.repeat(64),
        importedBy: '223e4567-e89b-12d3-a456-426614174000', importedAt: '2026-10-18T13:00:00.000Z', reviewedBy: '323e4567-e89b-12d3-a456-426614174000', reviewedAt: '2026-10-18T13:00:00.000Z',
        publishedBy: '323e4567-e89b-12d3-a456-426614174000', publishedAt: '2026-10-18T13:00:00.000Z', archivedAt: null,
      }] });
      return init?.method === undefined && url.startsWith(`${BASE}?`) ? json(pagina([regra()])) : undefined;
    });
    render(<main><AreaDoMotor /></main>, { wrapper: Envolvido });

    expect(await screen.findByText('Pacote publicado')).toBeInTheDocument();
    expect(screen.getByText(/regime histórico, finalidade, vigência e fonte precisam coincidir/u)).toBeInTheDocument();
    await screen.findByRole('table', { name: /Regras tributárias/u });
  });

  it('não promete apuração, guia, fechamento, SPED nem carteira (fora da fronteira da F16)', async () => {
    montar(COMPLETA);
    await screen.findByRole('table', { name: /Regras tributárias/u });

    for (const fora of [/Apuração/u, /Guia/u, /Fechamento/u, /SPED/u, /Partidas/u, /DARF/u, /Malha/u]) {
      expect(screen.queryByText(fora)).not.toBeInTheDocument();
    }
  });

  it('mostra o catálogo e o simulador, nessa ordem, cada um com seu H2', async () => {
    montar(COMPLETA);

    const titulos = screen.getAllByRole('heading', { level: 2 }).map((titulo) => titulo.textContent);
    expect(titulos).toEqual(['Resolução tributária de entradas — Goiás', 'Catálogo de regras', 'Simulador']);
    await screen.findByRole('table', { name: /Regras tributárias/u });
  });

  it('o simulador abre no preenchimento manual e troca para a NF-e de teste pela URL', async () => {
    montar(COMPLETA);

    const manual = screen.getByRole('tab', { name: 'Preenchimento manual' });
    expect(manual).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('form', { name: 'Simulação manual' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'NF-e de teste' }));
    expect(navegacao.replace).toHaveBeenLastCalledWith('/fiscal/motor-tributario?simulador=nfe', { scroll: false });
    expect(await screen.findByLabelText('Arquivo XML da NF-e')).toBeInTheDocument();
    await screen.findByRole('table', { name: /Regras tributárias/u });
  });

  it('a aba da URL é respeitada ao abrir a página, e valor desconhecido cai no manual', async () => {
    navegacao.definir('simulador=nfe');
    const { unmount } = montar(COMPLETA);
    expect(screen.getByRole('tab', { name: 'NF-e de teste' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByRole('table', { name: /Regras tributárias/u });
    unmount();

    navegacao.definir('simulador=outra');
    montar(COMPLETA);
    expect(screen.getByRole('tab', { name: 'Preenchimento manual' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByRole('table', { name: /Regras tributárias/u });
  });
});

describe('AreaDoMotor — permissões (SPEC-016 §3.7)', () => {
  it('quem consulta e não simula vê o catálogo e uma explicação no lugar do simulador', async () => {
    montar(['fiscal.motor_tributario.consultar']);

    expect(await screen.findByRole('table', { name: /Regras tributárias/u })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Você não tem acesso ao simulador' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Preenchimento manual' })).not.toBeInTheDocument();
  });

  it('sem a chave de consulta a página toda explica a falta de permissão e não exibe nada do catálogo', async () => {
    // Enquanto a sessão carrega o catálogo já pode pedir dados: a API é quem nega, e esperar a
    // sessão atrasaria o administrador da plataforma, cuja sessão de escritório sempre falha.
    instalarFetch((url) => (url === '/api/proxy/usuarios/eu' ? json(sessao(['empresas.cadastro.consultar'])) : problema(403, 'SEM_AUTORIZACAO')));
    render(
      <main>
        <AreaDoMotor />
      </main>,
      { wrapper: Envolvido },
    );

    expect(await screen.findByRole('heading', { name: 'Você não tem acesso ao motor tributário' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Catálogo de regras' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Simulador' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('o administrador da plataforma, sem sessão de escritório, usa a tela e a API decide', async () => {
    montar(null, true);

    expect(await screen.findByRole('button', { name: 'Nova regra' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Preenchimento manual' })).toBeInTheDocument();
  });

  it('o escritório que só consulta não ganha nenhuma ação de administração', async () => {
    montar(COMPLETA, false);

    await screen.findByRole('table', { name: /Regras tributárias/u });
    expect(screen.queryByRole('button', { name: 'Nova regra' })).not.toBeInTheDocument();
  });
});

describe('AreaDoMotor — acessibilidade', () => {
  it('a página não tem violação de axe', async () => {
    const { container } = montar(COMPLETA, true);
    await screen.findByRole('table', { name: /Regras tributárias/u });

    expect(await axe(container)).toHaveNoViolations();
  });
});
