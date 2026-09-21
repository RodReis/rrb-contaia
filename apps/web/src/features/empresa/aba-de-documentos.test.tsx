/**
 * Provas de tela da aba Documentos (TESTING.md §3.5, SPEC-004 §7).
 *
 * A API é dublada no nível do `fetch`: o que se prova aqui é a tela — os
 * quatro estados, o checklist com os seis estados documentais, a análise
 * separada do envio, as versões preservadas, a empresa arquivada em consulta
 * e a acessibilidade.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaDeDocumentos } from './aba-de-documentos';
import type { ExigenciaDocumental, VisaoDosDocumentos } from './documentos-api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const versao = (sobrescrita: Partial<ExigenciaDocumental['versoes'][number]> = {}) => ({
  id: 'versao-1',
  numero: 1,
  nomeOriginal: 'cartao-cnpj.pdf',
  tipoConteudo: 'application/pdf',
  tamanhoBytes: 2 * 1024 * 1024,
  validade: null,
  vigente: true,
  criadoEm: '2026-09-18T12:00:00.000Z',
  ...sobrescrita,
});

const exigencia = (sobrescrita: Partial<ExigenciaDocumental> = {}): ExigenciaDocumental => ({
  id: 'exigencia-1',
  codigo: 'CARTAO_CNPJ',
  nome: 'Cartão CNPJ',
  descricao: null,
  dataLimite: null,
  estado: 'PENDENTE',
  justificativa: null,
  aplicavel: true,
  versao: 0,
  versoes: [],
  ...sobrescrita,
});

const visao = (exigencias: readonly ExigenciaDocumental[]): VisaoDosDocumentos => ({
  empresaId: 'empresa-1',
  exigencias,
});

const respostaJson = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
    },
  });

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const renderizar = (somenteLeitura = false) =>
  render(<AbaDeDocumentos empresaId="empresa-1" somenteLeitura={somenteLeitura} />, {
    wrapper: Envolvido,
  });

const responderCom = (...respostas: Response[]): void => {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  for (const resposta of respostas) {
    mock.mockResolvedValueOnce(resposta);
  }
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('os quatro estados de tela (FRONTEND.md §20)', () => {
  it('mostra skeleton enquanto carrega, sem spinner', () => {
    responderCom(respostaJson(visao([])));
    renderizar();

    expect(screen.getByText(/carregando os documentos/iu)).toBeInTheDocument();
  });

  it('mostra o vazio quando a empresa não tem exigência alguma', async () => {
    responderCom(respostaJson(visao([])));
    renderizar();

    expect(
      await screen.findByRole('heading', { name: /nenhuma exigência documental/iu }),
    ).toBeInTheDocument();
  });

  it('mostra o erro com o código de suporte e oferece nova tentativa', async () => {
    responderCom(
      respostaJson(
        {
          type: 'https://contaia.local/erros/empresa',
          title: 'Empresa não encontrada.',
          status: 404,
          code: 'EMPRESA_NAO_ENCONTRADA',
          correlationId: 'corr-404',
        },
        404,
      ),
    );
    renderizar();

    const alerta = await screen.findByRole('alert');

    expect(alerta).toHaveTextContent(/não foi possível carregar os documentos/iu);
    expect(alerta).toHaveTextContent('corr-404');
    expect(screen.getByRole('button', { name: /tentar de novo/iu })).toBeInTheDocument();
  });

  it('mostra o checklist quando há exigências', async () => {
    responderCom(respostaJson(visao([exigencia()])));
    renderizar();

    expect(await screen.findByRole('heading', { name: 'Cartão CNPJ' })).toBeInTheDocument();
  });
});

describe('estados do documento (§2.4)', () => {
  it('cada estado aparece com rótulo textual, não só cor', async () => {
    // Os nomes das exigências não repetem os rótulos de estado: um documento
    // chamado "Pendente" tornaria o teste ambíguo e provaria menos.
    responderCom(
      respostaJson(
        visao([
          exigencia({ id: 'e1', nome: 'Contrato social', estado: 'PENDENTE' }),
          exigencia({ id: 'e2', nome: 'Cartão CNPJ', estado: 'ENVIADO', versoes: [versao()] }),
          exigencia({
            id: 'e3',
            nome: 'Inscrição estadual',
            estado: 'APROVADO',
            versoes: [versao()],
          }),
          exigencia({
            id: 'e4',
            nome: 'Inscrição municipal',
            estado: 'REJEITADO',
            justificativa: 'Documento ilegível.',
            versoes: [versao()],
          }),
          exigencia({
            id: 'e5',
            nome: 'Alvará de funcionamento',
            estado: 'DISPENSADO',
            justificativa: 'Liberada pelo escritório.',
          }),
          exigencia({
            id: 'e6',
            nome: 'Comprovante de endereço',
            estado: 'VENCIDO',
            versoes: [versao({ validade: '2026-01-31' })],
          }),
        ]),
      ),
    );
    renderizar();

    for (const rotulo of [
      'Pendente',
      'Enviado',
      'Aprovado',
      'Rejeitado',
      'Dispensado',
      'Vencido',
    ]) {
      expect(await screen.findByText(rotulo)).toBeInTheDocument();
    }
  });

  it('mostra a justificativa da rejeição na própria linha', async () => {
    responderCom(
      respostaJson(
        visao([
          exigencia({
            estado: 'REJEITADO',
            justificativa: 'Documento ilegível.',
            versoes: [versao()],
          }),
        ]),
      ),
    );
    renderizar();

    expect(await screen.findByText(/documento ilegível/iu)).toBeInTheDocument();
  });

  it('avisa que o arquivo enviado ainda depende de análise', async () => {
    responderCom(respostaJson(visao([exigencia({ estado: 'ENVIADO', versoes: [versao()] })])));
    renderizar();

    expect(await screen.findByText(/depende de análise/iu)).toBeInTheDocument();
  });
});

describe('análise é explícita e separada do envio (§2.3)', () => {
  it('não oferece aprovar enquanto não há arquivo enviado', async () => {
    responderCom(respostaJson(visao([exigencia()])));
    renderizar();

    await screen.findByRole('heading', { name: 'Cartão CNPJ' });

    expect(screen.queryByRole('button', { name: /aprovar/iu })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar arquivo/iu })).toBeInTheDocument();
  });

  it('oferece aprovar e rejeitar só no estado Enviado', async () => {
    responderCom(respostaJson(visao([exigencia({ estado: 'ENVIADO', versoes: [versao()] })])));
    renderizar();

    expect(await screen.findByRole('button', { name: /aprovar/iu })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rejeitar/iu })).toBeInTheDocument();
  });

  it('não oferece aprovar num documento já aprovado', async () => {
    responderCom(respostaJson(visao([exigencia({ estado: 'APROVADO', versoes: [versao()] })])));
    renderizar();

    await screen.findByText('Aprovado');

    expect(screen.queryByRole('button', { name: /^aprovar$/iu })).not.toBeInTheDocument();
  });

  it('aprovar envia a versão lida, que é o que detecta análise concorrente', async () => {
    responderCom(
      respostaJson(visao([exigencia({ estado: 'ENVIADO', versao: 7, versoes: [versao()] })])),
      respostaJson(visao([exigencia({ estado: 'APROVADO', versao: 8, versoes: [versao()] })])),
    );
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /aprovar/iu }));

    await waitFor(() => {
      const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const chamada = mock.mock.calls.find((argumentos) =>
        String(argumentos[0]).includes('/aprovacao'),
      );

      expect(chamada).toBeDefined();
      expect(JSON.parse(String((chamada?.[1] as RequestInit).body))).toEqual({ versao: 7 });
    });
  });

  it('rejeitar exige justificativa antes de chamar a API', async () => {
    responderCom(respostaJson(visao([exigencia({ estado: 'ENVIADO', versoes: [versao()] })])));
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /rejeitar/iu }));

    const dialogo = await screen.findByRole('dialog');

    await userEvent.click(
      within(dialogo).getByRole('button', { name: /rejeitar documento/iu }),
    );

    expect(await within(dialogo).findByText(/informe a justificativa/iu)).toBeInTheDocument();

    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      mock.mock.calls.some((argumentos) => String(argumentos[0]).includes('/rejeicao')),
    ).toBe(false);
  });

  it('dispensar exige justificativa e não pede arquivo', async () => {
    responderCom(respostaJson(visao([exigencia()])));
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /dispensar/iu }));

    const dialogo = await screen.findByRole('dialog');

    expect(dialogo).toHaveTextContent(/justificativa/iu);
    expect(dialogo).toHaveTextContent(/deixa de ser cobrada/iu);
  });
});

describe('envio de arquivo (§2.3)', () => {
  it('informa formatos e limite antes de escolher o arquivo', async () => {
    responderCom(respostaJson(visao([exigencia()])));
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /enviar arquivo/iu }));

    const dialogo = await screen.findByRole('dialog');

    expect(dialogo).toHaveTextContent(/pdf, jpg ou png de até 20 mb/iu);
    expect(dialogo).toHaveTextContent(/depende de análise/iu);
  });

  it('limita a escolha do seletor aos formatos aceitos', async () => {
    responderCom(respostaJson(visao([exigencia()])));
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /enviar arquivo/iu }));

    const dialogo = await screen.findByRole('dialog');
    const entrada = dialogo.querySelector('input[type="file"]');

    expect(entrada).toHaveAttribute('accept', 'application/pdf,image/png,image/jpeg');
  });

  it('recusa formato não aceito arrastado para a zona, sem chamar a API', async () => {
    responderCom(respostaJson(visao([exigencia()])));
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /enviar arquivo/iu }));

    const dialogo = await screen.findByRole('dialog');
    const entrada = dialogo.querySelector('input[type="file"]');
    const zona = entrada?.parentElement;

    expect(zona).toBeDefined();

    // Pelo arrasto, e não pelo seletor: o `accept` do input já filtra a
    // escolha por mouse, mas o arquivo arrastado chega sem filtro nenhum —
    // é o caminho em que a validação da tela precisa existir de verdade.
    const arquivo = new File(['conteudo'], 'contrato.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    fireEvent.drop(zona as HTMLElement, { dataTransfer: { files: [arquivo] } });

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/formato não aceito/iu);

    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      mock.mock.calls.some((argumentos) => String(argumentos[0]).includes('/versoes')),
    ).toBe(false);
  });

  it('recusa arquivo acima de 20 MB arrastado para a zona', async () => {
    responderCom(respostaJson(visao([exigencia()])));
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /enviar arquivo/iu }));

    const dialogo = await screen.findByRole('dialog');
    const zona = dialogo.querySelector('input[type="file"]')?.parentElement;

    const grande = new File(['x'], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(grande, 'size', { value: 20 * 1024 * 1024 + 1 });

    fireEvent.drop(zona as HTMLElement, { dataTransfer: { files: [grande] } });

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/20 MB/iu);
  });

  it('avisa que substituir arquiva a versão atual', async () => {
    responderCom(respostaJson(visao([exigencia({ estado: 'APROVADO', versoes: [versao()] })])));
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /substituir/iu }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(/será arquivada/iu);
  });
});

describe('versões preservadas (§2.3 e §3.2)', () => {
  it('lista as anteriores sob demanda, sem nenhuma ação de exclusão', async () => {
    responderCom(
      respostaJson(
        visao([
          exigencia({
            estado: 'APROVADO',
            versoes: [
              versao({ id: 'v2', numero: 2, nomeOriginal: 'novo.pdf', vigente: true }),
              versao({ id: 'v1', numero: 1, nomeOriginal: 'antigo.pdf', vigente: false }),
            ],
          }),
        ]),
      ),
    );
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: /1 versão anterior/iu }));

    expect(await screen.findByText('antigo.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /excluir/iu })).not.toBeInTheDocument();
  });

  it('oferece visualizar e baixar a versão vigente', async () => {
    responderCom(respostaJson(visao([exigencia({ estado: 'APROVADO', versoes: [versao()] })])));
    renderizar();

    const visualizar = await screen.findByRole('link', { name: /visualizar/iu });
    const baixar = screen.getByRole('link', { name: /baixar/iu });

    expect(visualizar).toHaveAttribute(
      'href',
      '/api/proxy/empresas/empresa-1/documentos/exigencias/exigencia-1/versoes/versao-1/conteudo',
    );
    expect(baixar).toHaveAttribute('download', 'cartao-cnpj.pdf');
  });
});

describe('empresa arquivada é somente consulta', () => {
  it('não oferece envio, análise nem nova exigência', async () => {
    responderCom(respostaJson(visao([exigencia({ estado: 'ENVIADO', versoes: [versao()] })])));
    renderizar(true);

    await screen.findByRole('heading', { name: 'Cartão CNPJ' });

    expect(screen.queryByRole('button', { name: /enviar arquivo/iu })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /aprovar/iu })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nova exigência/iu })).not.toBeInTheDocument();
    // Consulta continua disponível: visualizar e baixar não são escrita.
    expect(screen.getByRole('link', { name: /visualizar/iu })).toBeInTheDocument();
  });
});

describe('aplicabilidade das inscrições (§2.2)', () => {
  it('separa o que não se aplica e explica que os arquivos ficam preservados', async () => {
    responderCom(
      respostaJson(
        visao([
          exigencia(),
          exigencia({
            id: 'e2',
            codigo: 'INSCRICAO_ESTADUAL',
            nome: 'Inscrição estadual',
            aplicavel: false,
          }),
        ]),
      ),
    );
    renderizar();

    expect(
      await screen.findByRole('heading', { name: /não se aplicam a esta empresa/iu }),
    ).toBeInTheDocument();
    expect(screen.getByText(/continuam preservados/iu)).toBeInTheDocument();
  });
});

describe('acessibilidade', () => {
  it('não tem violação no checklist carregado', async () => {
    responderCom(
      respostaJson(
        visao([
          exigencia({ estado: 'ENVIADO', versoes: [versao()] }),
          exigencia({ id: 'e2', nome: 'Contrato social', estado: 'PENDENTE' }),
        ]),
      ),
    );
    const { container } = renderizar();

    await screen.findByRole('heading', { name: 'Cartão CNPJ' });

    expect(await axe(container)).toHaveNoViolations();
  });

  it('não tem violação no estado vazio', async () => {
    responderCom(respostaJson(visao([])));
    const { container } = renderizar();

    await screen.findByRole('heading', { name: /nenhuma exigência documental/iu });

    expect(await axe(container)).toHaveNoViolations();
  });
});
