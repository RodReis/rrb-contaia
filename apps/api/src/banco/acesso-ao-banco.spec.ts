/**
 * Guarda estática do caminho de acesso ao banco (SPEC-010 §3, §8.3, §11).
 *
 * Todo SQL da API passa pelo helper único de transação (`comContextoHumano`,
 * `comContexto`, `semContexto`), que grava o contexto antes da primeira consulta.
 * Pool cru, o papel administrativo e a finalidade escolhida por controller são
 * exatamente o que esta guarda impede de voltar por esquecimento.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..');

const arquivosDeProducao = (pasta: string): string[] =>
  readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);

    if (statSync(caminho).isDirectory()) {
      return arquivosDeProducao(caminho);
    }

    return nome.endsWith('.ts') && !nome.endsWith('.spec.ts') && nome !== 'banco-em-memoria.ts'
      ? [caminho]
      : [];
  });

const codigo = (arquivo: string): string =>
  readFileSync(arquivo, 'utf8')
    // Comentário não é uso: o que importa é código executável.
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');

const nome = (arquivo: string): string => relative(RAIZ, arquivo).replaceAll('\\', '/');

const ARQUIVOS = arquivosDeProducao(RAIZ);

describe('acesso ao banco da API', () => {
  it('encontra os arquivos de produção', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(20);
  });

  it('nenhum arquivo usa o pool direto: só os helpers de contexto recebem `instancia`', () => {
    // O provider é o único dono do pool: ele mesmo confere o papel conectado ao subir.
    const violacoes = ARQUIVOS.filter((arquivo) => nome(arquivo) !== 'banco/pool.provider.ts')
      .filter((arquivo) =>
        /\.instancia\.(query|connect)\b|\bpool\.(query|connect)\(/u.test(codigo(arquivo)),
      )
      .map(nome);

    expect(violacoes).toEqual([]);
  });

  it('só o provider abre pool, e abre o do papel da aplicação', () => {
    const abrem = ARQUIVOS.filter((arquivo) => /\bcriarPool(DaAplicacao)?\(/u.test(codigo(arquivo)))
      .map(nome)
      .sort();

    expect(abrem).toEqual(['banco/pool.provider.ts']);
    expect(codigo(join(RAIZ, 'banco', 'pool.provider.ts'))).toContain('criarPoolDaAplicacao()');
    expect(codigo(join(RAIZ, 'banco', 'pool.provider.ts'))).not.toMatch(/\bcriarPool\(/u);
  });

  it('o contexto de tenant sem usuário não existe mais', () => {
    const violacoes = ARQUIVOS.filter((arquivo) => /comContextoDeTenant/u.test(codigo(arquivo))).map(
      nome,
    );

    expect(violacoes).toEqual([]);
  });

  it('controller e DTO nunca escolhem finalidade nem montam contexto de banco', () => {
    const violacoes = ARQUIVOS.filter((arquivo) => /\.(controller|dto)\.ts$/u.test(arquivo))
      .filter((arquivo) =>
        /comContexto|comFinalidade|comEmpresaEmCriacao|ADMIN_ACESSO|LOCALIZACAO_BASICA_EMPRESA|contextoHumano\(|contextoTecnico\(/u.test(
          codigo(arquivo),
        ),
      )
      .map(nome);

    expect(violacoes).toEqual([]);
  });
});
