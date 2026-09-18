const SERVICOS = [
  { nome: 'Web', porta: 'WEB_PORT' },
  { nome: 'API', porta: 'API_PORT' },
  { nome: 'Workers', porta: 'WORKERS_PORT' },
  { nome: 'Signer', porta: 'SIGNER_PORT' },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-xl px-lg py-xl">
      <header className="flex flex-col gap-sm">
        <h1 className="font-display text-display-lg text-foreground">ContaIA</h1>
        <p className="text-body-lg text-muted-foreground">
          <span className="text-foreground">Ambiente local</span>: fundação do MVP-1, ainda sem
          funcionalidade de produto.
        </p>
      </header>

      <section
        aria-labelledby="servicos-titulo"
        className="rounded-lg border border-border bg-card p-lg shadow-elevation-1"
      >
        <h2 id="servicos-titulo" className="text-headline-sm text-card-foreground">
          Serviços da fundação
        </h2>
        <ul className="mt-md flex flex-col gap-sm">
          {SERVICOS.map((servico) => (
            <li
              key={servico.nome}
              className="flex items-center justify-between border-b border-border pb-sm last:border-b-0 last:pb-0"
            >
              <span className="text-body-md text-card-foreground">{servico.nome}</span>
              <span className="tabular font-mono text-code-sm text-muted-foreground">
                {servico.porta}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
