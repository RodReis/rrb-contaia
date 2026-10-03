/**
 * Anti-drift da autorização (SPEC-007 §3.1): toda rota autenticada precisa
 * declarar a ação que exige. Rota nova sem `@ExigeAcao`/`@AcaoLivre` falha aqui
 * — e, se escapasse, o `GuardDeAcao` a negaria em runtime (falha fechada).
 */
import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio, type PapelPadrao } from '@contaia/domain';

import { AppModule } from '../app.module';
import { DocumentosDaEmpresaController } from '../empresa/documentos.controller';
import { EmpresaController } from '../empresa/empresa.controller';
import { HistoricoController, ManutencaoDaEmpresaController } from '../empresa/manutencao.controller';
import { EscritorioController } from '../escritorio/escritorio.controller';
import { NotificacoesController } from '../notificacoes/notificacoes.controller';
import {
  PendenciasController,
  PendenciasDaEmpresaController,
} from '../pendencias/pendencias.controller';
import { HistoricoDeUsuariosController } from '../usuarios/historico-de-usuarios.controller';
import { UsuariosController } from '../usuarios/usuarios.controller';
import { ACAO_EXIGIDA, GuardDeAcao } from './acao.guard';
import { GuardDeSessao } from './sessao.guard';

type Classe = new (...argumentos: never[]) => object;
type Metodo = (...argumentos: never[]) => unknown;

const controllersDoModulo = (): readonly Classe[] =>
  Reflect.getMetadata('controllers', AppModule) as Classe[];

const guardsDe = (alvo: object): readonly unknown[] =>
  (Reflect.getMetadata('__guards__', alvo) as unknown[] | undefined) ?? [];

const manipuladoresDe = (controller: Classe): ReadonlyArray<readonly [string, Metodo]> =>
  Object.getOwnPropertyNames(controller.prototype)
    .filter((nome) => nome !== 'constructor')
    .map((nome) => [nome, (controller.prototype as Record<string, Metodo>)[nome]] as const)
    .filter(
      (par): par is readonly [string, Metodo] =>
        typeof par[1] === 'function' && Reflect.hasMetadata('path', par[1]),
    );

// Controllers sem sessão são decisão explícita: qualquer um novo precisa entrar aqui de propósito.
const PUBLICOS = new Set(['HealthController', 'ConvitesController']);

describe('cobertura de ações nas rotas autenticadas', () => {
  it('só os controllers públicos conhecidos dispensam GuardDeSessao', () => {
    const semSessao = controllersDoModulo()
      .filter((controller) => !guardsDe(controller).includes(GuardDeSessao))
      .map((controller) => controller.name)
      .filter((nome) => !PUBLICOS.has(nome));

    expect(semSessao).toEqual([]);
  });

  it('todo controller com GuardDeSessao também usa GuardDeAcao', () => {
    const semGuardDeAcao = controllersDoModulo()
      .filter((controller) => guardsDe(controller).includes(GuardDeSessao))
      .filter((controller) => !guardsDe(controller).includes(GuardDeAcao))
      .map((controller) => controller.name);

    expect(semGuardDeAcao).toEqual([]);
  });

  it('toda rota de controller com GuardDeAcao declara a ação exigida', () => {
    const semAcao: string[] = [];

    for (const controller of controllersDoModulo()) {
      if (!guardsDe(controller).includes(GuardDeAcao)) {
        continue;
      }

      for (const [nome, manipulador] of manipuladoresDe(controller)) {
        const declarada =
          Reflect.getMetadata(ACAO_EXIGIDA, manipulador) ?? Reflect.getMetadata(ACAO_EXIGIDA, controller);

        if (declarada === undefined) {
          semAcao.push(`${controller.name}.${nome}`);
        }
      }
    }

    expect(semAcao).toEqual([]);
  });
});

const guard = new GuardDeAcao(new Reflector());

const decide = (
  controller: Classe,
  metodo: string,
  papeis: readonly PapelPadrao[],
): 'permitido' | 'negado' => {
  const manipulador = (controller.prototype as Record<string, Metodo>)[metodo];

  if (manipulador === undefined) {
    throw new Error(`${controller.name}.${metodo} não existe`);
  }

  const contexto = {
    switchToHttp: () => ({ getRequest: () => ({ sessao: { papeis } }) }),
    getHandler: () => manipulador,
    getClass: () => controller,
  } as unknown as ExecutionContext;

  try {
    return guard.canActivate(contexto) ? 'permitido' : 'negado';
  } catch (erro) {
    if (erro instanceof ErroDeDominio && erro.codigo === CODIGOS_DE_ERRO.SEM_AUTORIZACAO) {
      return 'negado';
    }

    throw erro;
  }
};

describe('matriz da SPEC-007 §3.1 nas rotas reais', () => {
  const TODOS: readonly PapelPadrao[] = ['admin_escritorio', 'contador', 'auxiliar', 'auditor_readonly'];
  const so = (...papeis: PapelPadrao[]): ReadonlyArray<PapelPadrao> => papeis;

  // [controller, método, quem pode]
  const ROTAS: ReadonlyArray<readonly [Classe, string, ReadonlyArray<PapelPadrao>]> = [
    // Cadastro do escritório
    [EscritorioController, 'obter', so('admin_escritorio', 'auditor_readonly')],
    [EscritorioController, 'salvarIdentificacao', so('admin_escritorio')],
    [EscritorioController, 'concluir', so('admin_escritorio')],
    // Empresas
    [EmpresaController, 'listar', TODOS],
    [EmpresaController, 'obter', TODOS],
    [EmpresaController, 'criar', so('admin_escritorio', 'contador', 'auxiliar')],
    [EmpresaController, 'salvarIdentificacao', so('admin_escritorio', 'contador', 'auxiliar')],
    [ManutencaoDaEmpresaController, 'salvarIdentificacao', so('admin_escritorio', 'contador', 'auxiliar')],
    [ManutencaoDaEmpresaController, 'arquivar', so('admin_escritorio', 'contador')],
    [ManutencaoDaEmpresaController, 'reativar', so('admin_escritorio', 'contador')],
    [ManutencaoDaEmpresaController, 'listarEnderecos', TODOS],
    // Documentos
    [DocumentosDaEmpresaController, 'consultar', TODOS],
    [DocumentosDaEmpresaController, 'aprovar', so('admin_escritorio', 'contador', 'auxiliar')],
    // Central de Pendências
    [PendenciasController, 'consultarCentral', TODOS],
    [PendenciasDaEmpresaController, 'dispensar', so('admin_escritorio', 'contador', 'auxiliar')],
    // Notificações
    [NotificacoesController, 'consultarPainel', TODOS],
    [NotificacoesController, 'marcarComoLida', so('admin_escritorio', 'contador', 'auxiliar')],
    // Histórico de Informações
    [HistoricoController, 'listar', so('admin_escritorio', 'contador', 'auditor_readonly')],
    // Aba "Usuários e acessos": exige ler o Histórico E ler usuários (contador só tem o primeiro).
    [HistoricoDeUsuariosController, 'listar', so('admin_escritorio', 'auditor_readonly')],
    // Usuários e papéis padrão
    [UsuariosController, 'listar', so('admin_escritorio', 'auditor_readonly')],
    [UsuariosController, 'papeis', so('admin_escritorio', 'auditor_readonly')],
    [UsuariosController, 'eu', TODOS],
    [UsuariosController, 'convidar', so('admin_escritorio')],
    [UsuariosController, 'editar', so('admin_escritorio')],
    [UsuariosController, 'suspender', so('admin_escritorio')],
    [UsuariosController, 'arquivar', so('admin_escritorio')],
    [UsuariosController, 'novoConvite', so('admin_escritorio')],
  ];

  for (const [controller, metodo, quemPode] of ROTAS) {
    for (const papel of TODOS) {
      const esperado = quemPode.includes(papel) ? 'permitido' : 'negado';

      it(`${controller.name}.${metodo}: ${papel} → ${esperado}`, () => {
        expect(decide(controller, metodo, [papel])).toBe(esperado);
      });
    }
  }
});
