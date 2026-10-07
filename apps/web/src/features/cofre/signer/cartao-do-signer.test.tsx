/**
 * Cartão geral `Microserviço Signer` (SPEC-012 §5.2, §5.4): estado agregado, última verificação,
 * latência da última resposta válida, incidente e a falha de comunicação com manutenção do último
 * estado conhecido. A API é dublada no `fetch`, por rota.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { instalarFetch, json, problema, type Roteador } from '../cofre.fixtures';
import { CartaoDoSigner } from './cartao-do-signer';
import {
  PAINEL_DEGRADADO,
  PAINEL_INDISPONIVEL,
  PAINEL_OPERACIONAL,
} from './signer.fixtures';

let painel: () => Response | Promise<Response> = () => json(PAINEL_OPERACIONAL);

const roteador: Roteador = (url) => (url.endsWith('/signer/painel') ? painel() : undefined);

const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const Provedor = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
);

const renderizar = () => render(<CartaoDoSigner />, { wrapper: Provedor });

beforeEach(() => {
  cliente.clear();
  painel = () => json(PAINEL_OPERACIONAL);
  instalarFetch(roteador);
});

describe('CartaoDoSigner', () => {
  it('carregando: skeleton anunciado por texto', async () => {
    let liberar: () => void = () => undefined;

    painel = () =>
      new Promise<Response>((resolver) => {
        liberar = () => resolver(json(PAINEL_OPERACIONAL));
      });
    renderizar();

    expect(screen.getByText('Carregando o estado do Signer')).toBeInTheDocument();

    liberar();
    expect(await screen.findByText('Operacional')).toBeInTheDocument();
    expect(screen.queryByText('Carregando o estado do Signer')).not.toBeInTheDocument();
  });

  it('operacional: rótulo textual, última verificação em São Paulo e latência da última resposta válida', async () => {
    renderizar();

    expect(await screen.findByText('Operacional')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Microserviço Signer' })).toBeInTheDocument();
    expect(screen.getByText('Verificado em 07/10/2026 12:04')).toBeInTheDocument();
    expect(screen.getByText('9 ms')).toBeInTheDocument();
    expect(screen.queryByText(/incidente/iu)).not.toBeInTheDocument();
    expect(screen.queryByText('Desatualizado')).not.toBeInTheDocument();
  });

  it('degradado: o rótulo muda e não depende só de cor', async () => {
    painel = () => json(PAINEL_DEGRADADO);
    renderizar();

    expect(await screen.findByText('Degradado')).toBeInTheDocument();
    expect(screen.getByText('11 ms')).toBeInTheDocument();
  });

  it('indisponível com incidente: o detalhe abre pelo teclado e explica o que acontece', async () => {
    painel = () => json(PAINEL_INDISPONIVEL);
    renderizar();

    expect(await screen.findByText('Indisponível')).toBeInTheDocument();
    const botao = screen.getByRole('button', { name: 'Ver detalhe do incidente' });

    expect(botao).toHaveAttribute('aria-expanded', 'false');

    await userEvent.setup().click(botao);

    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/três verificações seguidas sem resposta/iu)).toBeInTheDocument();
    expect(screen.getByText(/administradores/iu)).toBeInTheDocument();
  });

  it('o monitor parado: sem verificação recente o cartão diz que está desatualizado', async () => {
    painel = () => json({ ...PAINEL_DEGRADADO, desatualizado: true });
    renderizar();

    expect(await screen.findByText('Desatualizado')).toBeInTheDocument();
    expect(screen.getByText(/monitor não confirmou/iu)).toBeInTheDocument();
  });

  it('sem nenhuma verificação ainda: diz isso em vez de inventar um horário', async () => {
    painel = () =>
      json({ ...PAINEL_DEGRADADO, desatualizado: true, ultimaVerificacaoEm: null, ultimaLatenciaMs: null });
    renderizar();

    expect(await screen.findByText('Nenhuma verificação registrada ainda.')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('falha de comunicação sem estado anterior: erro com o código de suporte e nova tentativa', async () => {
    painel = () => problema(503, 'SIGNER_INDISPONIVEL', {}, 'corr-painel-falha');
    renderizar();

    expect(await screen.findByText('Não foi possível ler o estado do Signer')).toBeInTheDocument();
    expect(screen.getByText(/corr-painel-falha/u)).toBeInTheDocument();

    painel = () => json(PAINEL_OPERACIONAL);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByText('Operacional')).toBeInTheDocument();
  });

  it('falha de comunicação com estado anterior: mantém o último estado conhecido e marca como desatualizado', async () => {
    renderizar();
    expect(await screen.findByText('Operacional')).toBeInTheDocument();

    painel = () => problema(503, 'SIGNER_INDISPONIVEL', {}, 'corr-painel-falha');
    await cliente.invalidateQueries();

    expect(await screen.findByText('Desatualizado')).toBeInTheDocument();
    expect(screen.getByText('Operacional')).toBeInTheDocument();
    expect(screen.getByText(/sem resposta da API/iu)).toBeInTheDocument();
  });

  it('acesso negado pela API: estado próprio, sem oferecer tentar de novo', async () => {
    painel = () => problema(403, 'SEM_AUTORIZACAO');
    renderizar();

    expect(await screen.findByText('Você não tem permissão para ver o Signer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('a região de status só muda quando o estado muda (sem releitura a cada atualização)', async () => {
    renderizar();
    const regiao = await screen.findByRole('status');

    expect(regiao).toHaveTextContent('Signer operacional');

    painel = () => json(PAINEL_INDISPONIVEL);
    await cliente.invalidateQueries();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Signer indisponível'));
  });

  it('não alega o que a fatia não entrega: HSM, KMS, AWS, VPC, uptime nem produção', async () => {
    renderizar();
    await screen.findByText('Operacional');

    expect(document.body.textContent).not.toMatch(/HSM|KMS|AWS|VPC|uptime|produ[cç][aã]o/iu);
  });

  it('acessível: sem violações do axe nos estados operacional e indisponível', async () => {
    const { container, unmount } = renderizar();

    await screen.findByText('Operacional');
    expect(await axe(container)).toHaveNoViolations();
    unmount();

    cliente.clear();
    painel = () => json(PAINEL_INDISPONIVEL);
    const { container: outro } = renderizar();

    await screen.findByText('Indisponível');
    expect(await axe(outro)).toHaveNoViolations();
  });
});
