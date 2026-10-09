/**
 * Anti-drift da autorização (SPEC-007 §3.1, SPEC-008 §3.4): toda rota autenticada
 * precisa declarar a permissão que exige. Rota nova sem `@ExigePermissao`/
 * `@AcaoLivre` falha aqui — e, se escapasse, o `GuardDeAcao` a negaria em runtime
 * (falha fechada).
 */
import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  normalizarMatriz,
  permissoesDosPapeisPadrao,
  type ChaveDePermissao,
  type PapelPadrao,
} from '@contaia/domain';

import { AppModule } from '../app.module';
import {
  CertificadosController,
  CertificadosDaEmpresaController,
  CofreInternoController,
  HistoricoDeCertificadosController,
} from '../certificados/certificados.controller';
import { GuardDeServicoInterno } from '../certificados/servico-interno.guard';
import { CarteirasController, HistoricoDeCarteirasController } from '../carteira/carteira.controller';
import { DocumentosDaEmpresaController } from '../empresa/documentos.controller';
import { EmpresaController } from '../empresa/empresa.controller';
import { HistoricoController, ManutencaoDaEmpresaController } from '../empresa/manutencao.controller';
import { EscritorioController } from '../escritorio/escritorio.controller';
import { NotificacoesController } from '../notificacoes/notificacoes.controller';
import { PapeisController } from '../papeis/papeis.controller';
import { PlanoContasDaEmpresaController } from '../plano-contas/plano-contas.controller';
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
// Rotas internas (cofre → API): sem sessão de usuário, mas SÓ com o Bearer de serviço. Falha fechado.
const INTERNOS = new Set([CofreInternoController.name]);

describe('cobertura de ações nas rotas autenticadas', () => {
  it('só os controllers públicos conhecidos dispensam GuardDeSessao', () => {
    const semSessao = controllersDoModulo()
      .filter((controller) => !guardsDe(controller).includes(GuardDeSessao))
      .map((controller) => controller.name)
      .filter((nome) => !PUBLICOS.has(nome) && !INTERNOS.has(nome));

    expect(semSessao).toEqual([]);
  });

  it('controller interno sem sessão exige o guard de serviço, e só ele', () => {
    const internos = controllersDoModulo().filter((controller) => INTERNOS.has(controller.name));

    expect(internos.map((controller) => controller.name)).toEqual(['CofreInternoController']);
    for (const controller of internos) {
      expect(guardsDe(controller)).toEqual([GuardDeServicoInterno]);
    }
  });

  it('todo controller com GuardDeSessao também usa GuardDeAcao', () => {
    const semGuardDeAcao = controllersDoModulo()
      .filter((controller) => guardsDe(controller).includes(GuardDeSessao))
      .filter((controller) => !guardsDe(controller).includes(GuardDeAcao))
      .map((controller) => controller.name);

    expect(semGuardDeAcao).toEqual([]);
  });

  it('toda rota de controller com GuardDeAcao declara a permissão exigida', () => {
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
  permissoes: readonly ChaveDePermissao[],
): 'permitido' | 'negado' => {
  const manipulador = (controller.prototype as Record<string, Metodo>)[metodo];

  if (manipulador === undefined) {
    throw new Error(`${controller.name}.${metodo} não existe`);
  }

  const contexto = {
    switchToHttp: () => ({ getRequest: () => ({ sessao: { permissoes } }) }),
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

describe('matriz da SPEC-007 §3.1 nas rotas reais, agora por permissão do catálogo', () => {
  const TODOS: readonly PapelPadrao[] = ['admin_escritorio', 'contador', 'auxiliar', 'auditor_readonly'];
  const so = (...papeis: PapelPadrao[]): ReadonlyArray<PapelPadrao> => papeis;
  const OPERADORES = so('admin_escritorio', 'contador', 'auxiliar');

  // [controller, método, quem pode]
  const ROTAS: ReadonlyArray<readonly [Classe, string, ReadonlyArray<PapelPadrao>]> = [
    // Cadastro do escritório
    [EscritorioController, 'obter', so('admin_escritorio', 'auditor_readonly')],
    [EscritorioController, 'salvarIdentificacao', so('admin_escritorio')],
    [EscritorioController, 'concluir', so('admin_escritorio')],
    // Empresas
    [EmpresaController, 'listar', TODOS],
    [EmpresaController, 'obter', TODOS],
    [EmpresaController, 'criar', OPERADORES],
    [EmpresaController, 'consultarCnpj', OPERADORES],
    [EmpresaController, 'ativar', OPERADORES],
    [EmpresaController, 'salvarIdentificacao', OPERADORES],
    [ManutencaoDaEmpresaController, 'salvarIdentificacao', OPERADORES],
    [ManutencaoDaEmpresaController, 'arquivar', so('admin_escritorio', 'contador')],
    [ManutencaoDaEmpresaController, 'reativar', so('admin_escritorio', 'contador')],
    [ManutencaoDaEmpresaController, 'listarEnderecos', TODOS],
    // Documentos
    [DocumentosDaEmpresaController, 'consultar', TODOS],
    [DocumentosDaEmpresaController, 'consultarHistorico', TODOS],
    [DocumentosDaEmpresaController, 'visualizar', TODOS],
    [DocumentosDaEmpresaController, 'baixar', TODOS],
    [DocumentosDaEmpresaController, 'criarExigencia', OPERADORES],
    [DocumentosDaEmpresaController, 'enviarArquivo', OPERADORES],
    [DocumentosDaEmpresaController, 'aprovar', OPERADORES],
    [DocumentosDaEmpresaController, 'rejeitar', OPERADORES],
    [DocumentosDaEmpresaController, 'dispensar', OPERADORES],
    // Plano de contas (SPEC-013 §3.12): auxiliar e auditor consultam e baixam; importar, confirmar e
    // cancelar só admin e contador (a carteira é conferida à parte, no GuardDeEscopoDeEmpresa).
    [PlanoContasDaEmpresaController, 'modelo', TODOS],
    [PlanoContasDaEmpresaController, 'historico', TODOS],
    [PlanoContasDaEmpresaController, 'previa', TODOS],
    [PlanoContasDaEmpresaController, 'rejeicoes', TODOS],
    [PlanoContasDaEmpresaController, 'relatorio', TODOS],
    [PlanoContasDaEmpresaController, 'arquivoOriginal', TODOS],
    [PlanoContasDaEmpresaController, 'contas', TODOS],
    [PlanoContasDaEmpresaController, 'enviar', so('admin_escritorio', 'contador')],
    [PlanoContasDaEmpresaController, 'confirmar', so('admin_escritorio', 'contador')],
    [PlanoContasDaEmpresaController, 'cancelar', so('admin_escritorio', 'contador')],
    // Central de Pendências
    [PendenciasController, 'consultarCentral', TODOS],
    [PendenciasDaEmpresaController, 'dispensar', OPERADORES],
    // Notificações
    [NotificacoesController, 'consultarPainel', TODOS],
    [NotificacoesController, 'consultarHistorico', TODOS],
    [NotificacoesController, 'marcarComoLida', OPERADORES],
    [NotificacoesController, 'marcarVariasComoLidas', OPERADORES],
    // Histórico de Informações (menu global + histórico cadastral)
    [HistoricoController, 'listar', so('admin_escritorio', 'contador', 'auditor_readonly')],
    [HistoricoController, 'campos', so('admin_escritorio', 'contador', 'auditor_readonly')],
    // Aba "Usuários e acessos": exige ler o Histórico E ler usuários (contador só tem o primeiro).
    [HistoricoDeUsuariosController, 'listar', so('admin_escritorio', 'auditor_readonly')],
    // Usuários e papéis padrão
    [UsuariosController, 'listar', so('admin_escritorio', 'auditor_readonly')],
    [UsuariosController, 'eu', TODOS],
    [UsuariosController, 'convidar', so('admin_escritorio')],
    [UsuariosController, 'editar', so('admin_escritorio')],
    [UsuariosController, 'suspender', so('admin_escritorio')],
    [UsuariosController, 'arquivar', so('admin_escritorio')],
    [UsuariosController, 'novoConvite', so('admin_escritorio')],
    // Carteira (SPEC-009): só o admin administra; `minha` devolve só os vínculos da própria sessão.
    [CarteirasController, 'minha', TODOS],
    [CarteirasController, 'colaboradores', so('admin_escritorio')],
    [CarteirasController, 'colaborador', so('admin_escritorio')],
    [CarteirasController, 'empresas', so('admin_escritorio')],
    [CarteirasController, 'colaboradoresDaEmpresa', so('admin_escritorio')],
    [CarteirasController, 'alterar', so('admin_escritorio')],
    [HistoricoDeCarteirasController, 'listar', so('admin_escritorio', 'auditor_readonly')],
    // Cofre de certificados A1 (SPEC-011 §3.2): mutação só admin/contador; auxiliar e auditor consultam
    [CertificadosController, 'listar', TODOS],
    [CertificadosDaEmpresaController, 'detalhe', TODOS],
    [CertificadosDaEmpresaController, 'responsaveis', TODOS],
    [CertificadosDaEmpresaController, 'trocarResponsavel', so('admin_escritorio', 'contador')],
    [CertificadosDaEmpresaController, 'desativar', so('admin_escritorio', 'contador')],
    // A chave de `ingestoes` é a de consulta: criar/substituir é conferido no caso de uso, por operação.
    [CertificadosDaEmpresaController, 'ingestoes', TODOS],
    [HistoricoDeCertificadosController, 'listar', so('admin_escritorio', 'contador', 'auditor_readonly')],
    // Papéis personalizados e catálogo: leitura para quem consulta usuários, mutação só do admin
    [PapeisController, 'catalogo', so('admin_escritorio', 'auditor_readonly')],
    [PapeisController, 'listar', so('admin_escritorio', 'auditor_readonly')],
    [PapeisController, 'obter', so('admin_escritorio', 'auditor_readonly')],
    [PapeisController, 'criar', so('admin_escritorio')],
    [PapeisController, 'editar', so('admin_escritorio')],
    [PapeisController, 'arquivar', so('admin_escritorio')],
    [PapeisController, 'reativar', so('admin_escritorio')],
  ];

  for (const [controller, metodo, quemPode] of ROTAS) {
    for (const papel of TODOS) {
      const esperado = quemPode.includes(papel) ? 'permitido' : 'negado';

      it(`${controller.name}.${metodo}: ${papel} → ${esperado}`, () => {
        expect(decide(controller, metodo, permissoesDosPapeisPadrao([papel]))).toBe(esperado);
      });
    }
  }
});

describe('papel personalizado nas rotas reais (SPEC-008 §3.4)', () => {
  // [controller, método, matriz concedida, esperado]
  const CASOS: ReadonlyArray<
    readonly [Classe, string, readonly ChaveDePermissao[], 'permitido' | 'negado']
  > = [
    // Granularidade de documentos: baixar não é visualizar, enviar não é aprovar.
    [DocumentosDaEmpresaController, 'baixar', ['documentos.arquivos.baixar'], 'permitido'],
    [DocumentosDaEmpresaController, 'visualizar', ['documentos.arquivos.baixar'], 'negado'],
    [DocumentosDaEmpresaController, 'enviarArquivo', ['documentos.arquivos.enviar'], 'permitido'],
    [DocumentosDaEmpresaController, 'aprovar', ['documentos.arquivos.enviar'], 'negado'],
    [DocumentosDaEmpresaController, 'aprovar', ['documentos.analise.aprovar'], 'permitido'],
    [DocumentosDaEmpresaController, 'rejeitar', ['documentos.analise.aprovar'], 'negado'],
    [DocumentosDaEmpresaController, 'dispensar', ['documentos.exigencias.dispensar'], 'permitido'],
    [DocumentosDaEmpresaController, 'consultar', ['documentos.exigencias.consultar'], 'permitido'],
    [DocumentosDaEmpresaController, 'consultarHistorico', ['documentos.exigencias.consultar'], 'negado'],
    // Empresas: arquivar e reativar são permissões distintas.
    [ManutencaoDaEmpresaController, 'arquivar', ['empresas.cadastro.arquivar'], 'permitido'],
    [ManutencaoDaEmpresaController, 'reativar', ['empresas.cadastro.arquivar'], 'negado'],
    [ManutencaoDaEmpresaController, 'reativar', ['empresas.cadastro.reativar'], 'permitido'],
    // O menu global exibe o histórico cadastral: as duas permissões.
    [HistoricoController, 'listar', ['historico.global.consultar'], 'negado'],
    [HistoricoController, 'listar', ['empresas.historico.consultar'], 'negado'],
    [
      HistoricoController,
      'listar',
      ['historico.global.consultar', 'empresas.historico.consultar'],
      'permitido',
    ],
    // Notificações e Central
    [NotificacoesController, 'marcarComoLida', ['notificacoes.sino.consultar'], 'negado'],
    [NotificacoesController, 'marcarComoLida', ['notificacoes.sino.marcar_lida'], 'permitido'],
    [PendenciasController, 'consultarCentral', ['pendencias.pendencias.consultar'], 'permitido'],
    // Dispensar pendência exige poder dispensar a exigência E enxergar a Central: uma chave só de
    // documentos não apagaria alerta de origem cadastral.
    [PendenciasDaEmpresaController, 'dispensar', ['documentos.exigencias.dispensar'], 'negado'],
    [PendenciasDaEmpresaController, 'dispensar', ['pendencias.pendencias.consultar'], 'negado'],
    [
      PendenciasDaEmpresaController,
      'dispensar',
      ['documentos.exigencias.dispensar', 'pendencias.pendencias.consultar'],
      'permitido',
    ],
    // Área exclusiva: nenhuma matriz de catálogo alcança usuários, papéis nem a aba de acessos.
    [UsuariosController, 'listar', ['historico.global.consultar', 'empresas.cadastro.consultar'], 'negado'],
    [PapeisController, 'criar', ['empresas.cadastro.criar', 'documentos.analise.aprovar'], 'negado'],
    [HistoricoDeUsuariosController, 'listar', ['historico.global.consultar'], 'negado'],
    // Carteira: nenhuma matriz de catálogo alcança a administração; consultar usuários não altera carteira.
    [CarteirasController, 'alterar', ['usuarios.usuarios_e_papeis.consultar'], 'negado'],
    [CarteirasController, 'alterar', ['usuarios.usuarios_e_papeis.administrar'], 'permitido'],
    [CarteirasController, 'colaboradores', ['empresas.cadastro.consultar'], 'negado'],
    [CarteirasController, 'minha', [], 'permitido'],
    [HistoricoDeCarteirasController, 'listar', ['historico.global.consultar'], 'negado'],
    // Cofre: chave por ação; nenhuma de consulta concede mutação; histórico exige as duas chaves.
    [CertificadosDaEmpresaController, 'desativar', ['certificados.cofre.consultar'], 'negado'],
    [CertificadosDaEmpresaController, 'desativar', ['certificados.cofre.desativar'], 'permitido'],
    [CertificadosDaEmpresaController, 'trocarResponsavel', ['certificados.cofre.desativar'], 'negado'],
    [CertificadosDaEmpresaController, 'trocarResponsavel', ['certificados.cofre.editar'], 'permitido'],
    [CertificadosDaEmpresaController, 'detalhe', ['certificados.historico.consultar'], 'negado'],
    [HistoricoDeCertificadosController, 'listar', ['certificados.historico.consultar'], 'negado'],
    [HistoricoDeCertificadosController, 'listar', ['historico.global.consultar'], 'negado'],
    [
      HistoricoDeCertificadosController,
      'listar',
      ['historico.global.consultar', 'certificados.historico.consultar'],
      'permitido',
    ],
    [CertificadosController, 'listar', [], 'negado'],
    // Plano de contas: a matriz salva vem normalizada (a ação implica Consultar). Importar não
    // confirma nem cancela; confirmar não importa; baixar relatório abre download e leitura.
    [PlanoContasDaEmpresaController, 'enviar', normalizarMatriz(['empresas.plano_contas.importar']), 'permitido'],
    [PlanoContasDaEmpresaController, 'confirmar', normalizarMatriz(['empresas.plano_contas.importar']), 'negado'],
    [PlanoContasDaEmpresaController, 'cancelar', normalizarMatriz(['empresas.plano_contas.importar']), 'negado'],
    [PlanoContasDaEmpresaController, 'confirmar', normalizarMatriz(['empresas.plano_contas.confirmar_importacao']), 'permitido'],
    [PlanoContasDaEmpresaController, 'cancelar', normalizarMatriz(['empresas.plano_contas.confirmar_importacao']), 'permitido'],
    [PlanoContasDaEmpresaController, 'enviar', normalizarMatriz(['empresas.plano_contas.confirmar_importacao']), 'negado'],
    [PlanoContasDaEmpresaController, 'relatorio', normalizarMatriz(['empresas.plano_contas.baixar_relatorio']), 'permitido'],
    [PlanoContasDaEmpresaController, 'arquivoOriginal', normalizarMatriz(['empresas.plano_contas.baixar_relatorio']), 'permitido'],
    [PlanoContasDaEmpresaController, 'modelo', normalizarMatriz(['empresas.plano_contas.baixar_relatorio']), 'permitido'],
    [PlanoContasDaEmpresaController, 'previa', normalizarMatriz(['empresas.plano_contas.baixar_relatorio']), 'permitido'],
    [PlanoContasDaEmpresaController, 'historico', normalizarMatriz(['empresas.plano_contas.baixar_relatorio']), 'permitido'],
    [PlanoContasDaEmpresaController, 'enviar', normalizarMatriz(['empresas.plano_contas.baixar_relatorio']), 'negado'],
    [PlanoContasDaEmpresaController, 'relatorio', ['empresas.plano_contas.consultar'], 'negado'],
    [PlanoContasDaEmpresaController, 'arquivoOriginal', ['empresas.plano_contas.consultar'], 'negado'],
    [PlanoContasDaEmpresaController, 'contas', ['empresas.cadastro.consultar'], 'negado'],
    // Sem permissão alguma, nada é aberto (exceto rota livre).
    [EmpresaController, 'listar', [], 'negado'],
    [UsuariosController, 'eu', [], 'permitido'],
  ];

  for (const [controller, metodo, matriz, esperado] of CASOS) {
    it(`${controller.name}.${metodo} com [${matriz.join(', ')}] → ${esperado}`, () => {
      expect(decide(controller, metodo, matriz)).toBe(esperado);
    });
  }
});
