import * as vscode from "vscode";

import { DEFAULT_MODELS, type ProviderId } from "./config/models";
import {
  configurationTarget,
  readSettings,
  type CavemanSettings,
} from "./config/settings";
import { asUserMessage, CavemanCommitError } from "./errors";
import {
  discoverRepositories,
  normalizeRepositories,
  type NativeGitRepository,
  type RepositoryInfo,
} from "./git/getRepository";
import {
  diffSizeInBytes,
  getChangesDiff,
  isLargeDiff,
} from "./git/gitClient";
import { runProcess } from "./process/runProcess";
import { resolveProviderExecutable, type ProviderExecutableResolver } from "./process/providerExecutable";
import { ClaudeProvider } from "./providers/claude";
import { CodexProvider } from "./providers/codex";
import type { CommitProvider, ProviderLogger } from "./providers/provider";
import { generateCommitMessage } from "./services/commitGenerator";
import { RestartableOperation } from "./services/restartableOperation";
import { CommitCache, CommitSession, repositoryKey, type CommitDraft } from "./services/commitSession";
import { cancellable, checkCancellation } from "./services/cancellation";
import { writeScmMessage } from "./services/scmWriter";
import { loadSkill } from "./skills/loader";
import { copyCommitMessage } from "./ui/clipboard";
import { ClaudeLogin } from "./ui/claudeLogin";
import { showCommitSession } from "./ui/commitPreview";
import { CavemanStatusBar } from "./ui/statusBar";

interface GitApi {
  readonly repositories: readonly (NativeGitRepository & { readonly inputBox?: { value: string } })[];
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

class OutputLogger implements ProviderLogger {
  public constructor(private readonly channel: vscode.OutputChannel) {}

  public log(message: string): void {
    const singleLine = message.replace(/[\r\n]+/g, " ");
    this.channel.appendLine(`[${new Date().toISOString()}] ${singleLine}`);
  }
}

async function nativeGitRepositories(): Promise<GitApi["repositories"]> {
  try {
    const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (extension === undefined) return [];
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1).repositories;
  } catch { return []; }
}

async function repositoriesFromVsCodeGit(): Promise<RepositoryInfo[]> {
  return normalizeRepositories(await nativeGitRepositories());
}

async function gitRepository(path: string): Promise<GitApi["repositories"][number] | undefined> {
  return (await nativeGitRepositories()).find(repository => repositoryKey(repository.rootUri.fsPath) === repositoryKey(path));
}

async function getAvailableRepositories(): Promise<RepositoryInfo[]> {
  const nativeRepositories = await repositoriesFromVsCodeGit();
  if (nativeRepositories.length > 0) {
    return nativeRepositories;
  }
  const folders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  return discoverRepositories(runProcess, folders);
}

async function selectProvider(statusBar: CavemanStatusBar): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    [
      { label: "Codex", description: "GPT-5.6 Terra · Medium", provider: "codex" as const },
      { label: "Claude Code", description: "Sonnet 5", provider: "claude" as const },
    ],
    { title: "Caveman Commit · Provider", placeHolder: "Escolha como gerar suas mensagens" },
  );
  if (selected === undefined) {
    return;
  }
  const config = vscode.workspace.getConfiguration("cavemanCommit");
  const target = configurationTarget();
  await config.update("provider", selected.provider, target);
  await config.update("model", "", target);
  const settings = readSettings();
  statusBar.update(settings.provider, settings.model, settings.reasoningEffort, settings.diffScope);
}

async function selectModel(statusBar: CavemanStatusBar): Promise<void> {
  const settings = readSettings();
  const defaults = DEFAULT_MODELS[settings.provider];
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: defaults.displayName,
        description: `Padrão · ${defaults.id}`,
        action: "default" as const,
      },
      {
        label: "Outro modelo…",
        action: "custom" as const,
      },
    ],
    { title: "Caveman Commit · Modelo", placeHolder: "Escolha o modelo" },
  );
  if (selected === undefined) {
    return;
  }
  let value = "";
  if (selected.action === "custom") {
    const entered = await vscode.window.showInputBox({
      title: "Identificador do modelo",
      value: settings.model,
      prompt: "O identificador será enviado literalmente ao CLI; não há fallback.",
      validateInput: (candidate) =>
        candidate.trim().length === 0 ? "Informe um identificador." : undefined,
    });
    if (entered === undefined) {
      return;
    }
    value = entered.trim();
  }
  await vscode.workspace
    .getConfiguration("cavemanCommit")
    .update("model", value, configurationTarget());
  const updated = readSettings();
  statusBar.update(updated.provider, updated.model, updated.reasoningEffort, updated.diffScope);
}

function providerFor(
  provider: ProviderId,
  providers: Readonly<Record<ProviderId, CommitProvider>>,
): CommitProvider {
  const selected = providers[provider];
  if (selected === undefined) {
    throw new CavemanCommitError("INVALID_PROVIDER", "Provider inválido.");
  }
  return selected;
}

async function createMessage(
  provider: CommitProvider,
  settings: CavemanSettings,
  providerWorkingDirectory: string,
  skill: string,
  diff: string,
  statusBar: CavemanStatusBar,
  cancellation: vscode.CancellationToken,
  logger: ProviderLogger,
): Promise<string> {
  statusBar.setProcessing();
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Caveman Commit: gerando mensagem",
        cancellable: true,
      },
      async (progress, progressCancellation) => {
        const linkedCancellation = new vscode.CancellationTokenSource();
        const registrations = [
          cancellation.onCancellationRequested(() => linkedCancellation.cancel()),
          progressCancellation.onCancellationRequested(() => linkedCancellation.cancel()),
        ];
        if (
          cancellation.isCancellationRequested ||
          progressCancellation.isCancellationRequested
        ) {
          linkedCancellation.cancel();
        }
        try {
          return await generateCommitMessage(
            provider,
            skill,
            diff,
            {
              model: settings.model,
              reasoningEffort: settings.reasoningEffort,
              cwd: providerWorkingDirectory,
              timeoutMs: settings.timeout,
              cancellation: linkedCancellation.token,
            },
            (attempt, reason, kind) => {
              logger.log(`Retentativa após ${kind === "timeout" ? "timeout" : "resposta rejeitada"} na tentativa ${attempt}: ${reason}`);
              progress.report({
                message: kind === "timeout"
                  ? `Resposta demorou. ${reason} Tentativa ${attempt + 1}.`
                  : `Corrigindo formato; tentativa ${attempt + 1}.`,
              });
            },
          );
        } finally {
          for (const registration of registrations) {
            registration.dispose();
          }
          linkedCancellation.dispose();
        }
      },
    );
  } finally {
    statusBar.update(settings.provider, settings.model, settings.reasoningEffort, settings.diffScope);
  }
}

async function selectChanges(statusBar: CavemanStatusBar): Promise<void> {
  const selected = await vscode.window.showQuickPick([
    { label: "Todas as alterações", description: "Staged, unstaged e untracked", scope: "all" as const },
    { label: "Somente staged", description: "Apenas alterações no index", scope: "staged" as const },
  ], { title: "Caveman Commit · Alterações", placeHolder: "Escolha o escopo do diff" });
  if (!selected) return;
  await vscode.workspace.getConfiguration("cavemanCommit").update("diffScope", selected.scope, configurationTarget());
  const settings = readSettings();
  statusBar.update(settings.provider, settings.model, settings.reasoningEffort, settings.diffScope);
}

async function generateAndCopy(
  context: vscode.ExtensionContext,
  statusBar: CavemanStatusBar,
  providers: Readonly<Record<ProviderId, CommitProvider>>,
  logger: OutputLogger,
  parentCancellation: vscode.CancellationToken,
  cache: CommitCache,
  targetPath: string | undefined,
  reportError: (error: unknown) => void,
): Promise<void> {
  const source = new vscode.CancellationTokenSource();
  const registration = parentCancellation.onCancellationRequested(() => source.cancel());
  if (parentCancellation.isCancellationRequested) source.cancel();
  const cancellation = source.token;
  try {
    const available = await getAvailableRepositories();
    const repositories = targetPath === undefined ? available : available.filter(repository => repositoryKey(repository.path) === repositoryKey(targetPath));
    if (!repositories.length) throw new CavemanCommitError("NO_REPOSITORY", "Nenhum repositório Git disponível.");
    const session = new CommitSession(cache, {
      cancellation,
      readContext: async () => {
        const settings = readSettings();
        return { settings, skill: await loadSkill(context.extensionPath, settings.skillPath) };
      },
      readDiff: (path, scope) => getChangesDiff(runProcess, path, scope, { cancellation }),
      generate: async ({ settings, skill }, diff) => {
        const cwd = vscode.Uri.joinPath(context.globalStorageUri, "provider-workspace");
        await vscode.workspace.fs.createDirectory(cwd);
        logger.log(`Provider: ${settings.provider}; modelo: ${settings.model}; effort: ${settings.reasoningEffort}; escopo: ${settings.diffScope}; diff: ${diffSizeInBytes(diff)} bytes.`);
        return createMessage(providerFor(settings.provider, providers), settings, cwd.fsPath, skill, diff, statusBar, cancellation, logger);
      },
      confirmLargeDiff: async (repository, diff, { settings }) => {
        if (!isLargeDiff(diff, settings.maxDiffSize)) return true;
        const decision = await cancellable(vscode.window.showWarningMessage(
          `${repository.name}: diff elevado. O processamento pode demorar. Continuar mesmo assim?`,
          { modal: true }, "Continuar", "Cancelar",
        ), cancellation);
        return decision === "Continuar";
      },
      canUseGit: async path => typeof (await gitRepository(path))?.inputBox?.value === "string",
      copy: message => copyCommitMessage(vscode.env.clipboard, message),
      apply: async (path, message, ensureCurrent) => {
        const repository = await gitRepository(path);
        if (!repository?.inputBox) throw new CavemanCommitError("SCM_UNAVAILABLE", "Git nativo indisponível para este repositório. Copie a mensagem ou habilite a extensão Git do VS Code.");
        const applied = await writeScmMessage(repository.inputBox, message, async () => {
          const decision = await vscode.window.showWarningMessage(
            "O campo de commit já contém outro texto. Substituir?", { modal: true }, "Substituir", "Cancelar",
          );
          return decision === "Substituir";
        }, ensureCurrent, cancellation);
        if (applied) void Promise.resolve(vscode.commands.executeCommand("workbench.view.scm")).catch(() => undefined);
        return applied;
      },
    });
    const drafts: CommitDraft[] = [];
    for (const repository of repositories) {
      try {
        const draft = await session.prepare(repository);
        drafts.push(draft);
        logger.log(`${draft.reused ? "Mensagem reutilizada" : "Mensagem gerada"}: ${repository.path}; escopo: ${draft.scope}; hash: ${draft.diffHash}${draft.stale ? "; diff alterado" : ""}.`);
      } catch (error) {
        if (!(error instanceof CavemanCommitError && error.code === "NO_CHANGES")) throw error;
      }
    }
    checkCancellation(cancellation);
    if (!drafts.length) {
      void vscode.window.showWarningMessage("Nenhuma alteração encontrada no escopo selecionado.");
      return;
    }
    const autoCopy = async (draft: CommitDraft): Promise<CommitDraft> => {
      if (draft.stale) return draft;
      return (await session.act(draft, "copy", draft.message)).draft;
    };
    if (drafts.length === 1) drafts[0] = await autoCopy(drafts[0]!);
    await showCommitSession(context.extensionUri, drafts, {
      act: (draft, action, text, allowStale) => session.act(draft, action, text, allowStale),
      regenerate: async draft => {
        const updated = await session.prepare({ name: draft.repositoryName, path: draft.repositoryPath }, true);
        return drafts.length === 1 ? autoCopy(updated) : updated;
      },
      reportError,
      cancel: () => source.cancel(),
    }, cancellation);
  } finally {
    source.cancel();
    registration.dispose();
    source.dispose();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("Caveman Commit");
  const logger = new OutputLogger(channel);
  const statusBar = new CavemanStatusBar();
  const resolveExecutable: ProviderExecutableResolver = (provider) =>
    resolveProviderExecutable(provider, (id) => vscode.extensions.getExtension(id));
  const login = new ClaudeLogin(vscode.Uri.joinPath(context.globalStorageUri, "login"), resolveExecutable);
  const providers: Readonly<Record<ProviderId, CommitProvider>> = {
    codex: new CodexProvider({ run: runProcess, logger, resolveExecutable }),
    claude: new ClaudeProvider({ run: runProcess, logger, resolveExecutable }),
  };

  const refreshStatus = (): void => {
    try {
      const settings = readSettings();
      statusBar.update(settings.provider, settings.model, settings.reasoningEffort, settings.diffScope);
    } catch (error) {
      logger.log(`Configuração inválida: ${asUserMessage(error)}`);
    }
  };
  refreshStatus();

  const openClaudeLogin = async (): Promise<void> => {
    try {
      await login.open();
      logger.log("Login do Claude aberto no terminal integrado.");
      void vscode.window.showInformationMessage(
        "Conclua o login do Claude no navegador. Depois, clique em Caveman Commit para gerar a mensagem.",
      );
    } catch (error) {
      logger.log(`Falha ao abrir login do Claude: ${asUserMessage(error)}`);
      void vscode.window.showErrorMessage(asUserMessage(error));
    }
  };

  const cache = new CommitCache();
  let requestedPath: string | undefined;
  const reportError = (error: unknown): void => {
    logger.log(`Erro: ${asUserMessage(error)}`);
    if (error instanceof CavemanCommitError && error.code === "CLAUDE_NOT_AUTHENTICATED") void openClaudeLogin();
  };
  const generation = new RestartableOperation(
    () => new vscode.CancellationTokenSource(),
    async (cancellation) => {
      const targetPath = requestedPath;
      statusBar.setProcessing();
      try {
        await generateAndCopy(
          context,
          statusBar,
          providers,
          logger,
          cancellation,
          cache,
          targetPath,
          reportError,
        );
      } catch (error) {
        const message = asUserMessage(error);
        logger.log(
          error instanceof CavemanCommitError
            ? `Erro [${error.code}]: ${message}`
            : "Erro inesperado.",
        );
        if (
          !cancellation.isCancellationRequested &&
          !(error instanceof CavemanCommitError && error.code === "OPERATION_CANCELLED")
        ) {
          if (error instanceof CavemanCommitError && error.code === "CLAUDE_NOT_AUTHENTICATED") {
            void openClaudeLogin();
          } else {
            void vscode.window.showErrorMessage(message);
          }
        }
      } finally {
        refreshStatus();
      }
    },
  );

  context.subscriptions.push(
    channel,
    statusBar,
    login,
    generation,
    { dispose: () => cache.clear() },
    vscode.commands.registerCommand("cavemanCommit.generateCommit", () => {
      logger.log("Solicitação de geração recebida.");
      requestedPath = undefined;
      return generation.trigger();
    }),
    vscode.commands.registerCommand("cavemanCommit.generateFromScm", async (context: unknown) => {
      const repositories = await getAvailableRepositories();
      if (!repositories.length) {
        void vscode.window.showWarningMessage("Nenhum repositório Git disponível.");
        return;
      }
      const rootUri = typeof context === "object" && context !== null && "rootUri" in context
        ? (context as { rootUri?: { fsPath?: unknown } }).rootUri : undefined;
      const path = typeof rootUri?.fsPath === "string" ? rootUri.fsPath : undefined;
      let selected = path === undefined ? undefined : repositories.find(repository => repositoryKey(repository.path) === repositoryKey(path));
      if (!selected) {
        if (repositories.length === 1) selected = repositories[0];
        else selected = (await vscode.window.showQuickPick(repositories.map(repository => ({ label: repository.name, description: repository.path, repository })), { title: "Caveman Commit · Repositório" }))?.repository;
      }
      if (!selected) return;
      requestedPath = selected.path;
      return generation.trigger();
    }),
    vscode.commands.registerCommand("cavemanCommit.selectChanges", () => selectChanges(statusBar)),
    vscode.commands.registerCommand("cavemanCommit.loginClaude", openClaudeLogin),
    vscode.commands.registerCommand("cavemanCommit.selectProvider", () =>
      selectProvider(statusBar),
    ),
    vscode.commands.registerCommand("cavemanCommit.selectModel", () =>
      selectModel(statusBar),
    ),
    vscode.commands.registerCommand("cavemanCommit.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "cavemanCommit"),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("cavemanCommit")) {
        refreshStatus();
      }
    }),
  );
}

export function deactivate(): void {
  // Recursos são descartados por ExtensionContext.subscriptions.
}
