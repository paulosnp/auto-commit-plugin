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
  getLocalChangesDiff,
  isLargeDiff,
} from "./git/gitClient";
import { runProcess } from "./process/runProcess";
import { ClaudeProvider } from "./providers/claude";
import { CodexProvider } from "./providers/codex";
import type { CommitProvider, ProviderLogger } from "./providers/provider";
import { generateCommitMessage } from "./services/commitGenerator";
import { RestartableOperation } from "./services/restartableOperation";
import { validateCommitMessage } from "./services/responseValidator";
import { loadSkill } from "./skills/loader";
import { copyCommitMessage } from "./ui/clipboard";
import {
  showCommitEditor,
  showCommitPreview,
  showMultiCommitEditor,
  type RepositoryCommitDraft,
} from "./ui/commitPreview";
import { CavemanStatusBar } from "./ui/statusBar";

interface GitApi {
  readonly repositories: readonly NativeGitRepository[];
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

async function repositoriesFromVsCodeGit(): Promise<RepositoryInfo[]> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
  if (extension === undefined) {
    return [];
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return normalizeRepositories(exports.getAPI(1).repositories);
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
      { label: "Codex — GPT-5.6 Terra · Medium", provider: "codex" as const },
      { label: "Claude Code — Sonnet 5", provider: "claude" as const },
    ],
    { title: "Caveman Commit: Select Provider" },
  );
  if (selected === undefined) {
    return;
  }
  const config = vscode.workspace.getConfiguration("cavemanCommit");
  const target = configurationTarget();
  await config.update("provider", selected.provider, target);
  await config.update("model", "", target);
  const settings = readSettings();
  statusBar.update(settings.provider, settings.model, settings.reasoningEffort);
}

async function selectModel(statusBar: CavemanStatusBar): Promise<void> {
  const settings = readSettings();
  const defaults = DEFAULT_MODELS[settings.provider];
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: `Usar padrão — ${defaults.displayName}`,
        description: defaults.id,
        action: "default" as const,
      },
      {
        label: "Informar identificador manualmente",
        action: "custom" as const,
      },
    ],
    { title: "Caveman Commit: Select Model" },
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
  statusBar.update(updated.provider, updated.model, updated.reasoningEffort);
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
): Promise<string> {
  statusBar.setProcessing();
  try {
    const raw = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Caveman Commit: gerando mensagem",
        cancellable: true,
      },
      async (_progress, progressCancellation) => {
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
          return await generateCommitMessage(provider, skill, diff, {
            model: settings.model,
            reasoningEffort: settings.reasoningEffort,
            cwd: providerWorkingDirectory,
            timeoutMs: settings.timeout,
            cancellation: linkedCancellation.token,
          });
        } finally {
          for (const registration of registrations) {
            registration.dispose();
          }
          linkedCancellation.dispose();
        }
      },
    );
    return validateCommitMessage(raw).message;
  } finally {
    statusBar.update(settings.provider, settings.model, settings.reasoningEffort);
  }
}

async function generateAndCopy(
  context: vscode.ExtensionContext,
  statusBar: CavemanStatusBar,
  providers: Readonly<Record<ProviderId, CommitProvider>>,
  logger: OutputLogger,
  cancellation: vscode.CancellationToken,
): Promise<void> {
  const settings = readSettings();
  const repositories = await getAvailableRepositories();
  if (repositories.length === 0) {
    throw new CavemanCommitError(
      "NO_REPOSITORY",
      "Nenhum repositório Git disponível.",
    );
  }

  const changes = (
    await Promise.all(
      repositories.map(async (repository) => {
        const diff = await getLocalChangesDiff(runProcess, repository.path, {
          cancellation,
        });
        return { repository, diff, bytes: diffSizeInBytes(diff) };
      }),
    )
  ).filter(({ diff }) => diff.trim().length > 0);
  if (cancellation.isCancellationRequested) {
    throw new CavemanCommitError("OPERATION_CANCELLED", "Operação cancelada.");
  }
  if (changes.length === 0) {
    await vscode.window.showWarningMessage(
      "Nenhuma alteração local encontrada para gerar a mensagem.",
    );
    return;
  }

  const largeChanges = changes.filter(({ diff }) =>
    isLargeDiff(diff, settings.maxDiffSize),
  );
  if (largeChanges.length > 0) {
    const scope =
      largeChanges.length === 1
        ? `O repositório ${largeChanges[0]?.repository.name ?? "selecionado"} possui alterações locais de tamanho elevado`
        : `${largeChanges.length} repositórios possuem alterações locais de tamanho elevado`;
    const decision = await vscode.window.showWarningMessage(
      `${scope} e podem aumentar significativamente o processamento. Continuar mesmo assim?`,
      { modal: true },
      "Continuar",
      "Cancelar",
    );
    if (decision !== "Continuar") {
      return;
    }
  }

  const skill = await loadSkill(context.extensionPath, settings.skillPath);
  const providerWorkingDirectory = vscode.Uri.joinPath(
    context.globalStorageUri,
    "provider-workspace",
  );
  await vscode.workspace.fs.createDirectory(providerWorkingDirectory);
  const provider = providerFor(settings.provider, providers);
  logger.log(`Provider: ${settings.provider}.`);
  logger.log(`Modelo: ${settings.model}.`);
  if (settings.provider === "codex") {
    logger.log(`Reasoning effort: ${settings.reasoningEffort}.`);
  }
  for (const change of changes) {
    logger.log(`Repositório: ${change.repository.path}.`);
    logger.log(`Alterações locais: ${change.bytes} bytes.`);
  }
  logger.log(
    changes.length === 1
      ? "Geração iniciada."
      : `Geração iniciada para ${changes.length} repositórios.`,
  );

  const providerLabel = settings.provider === "codex" ? "Codex" : "Claude Code";
  if (changes.length > 1) {
    const drafts: RepositoryCommitDraft[] = [];
    for (const change of changes) {
      if (cancellation.isCancellationRequested) {
        throw new CavemanCommitError("OPERATION_CANCELLED", "Operação cancelada.");
      }
      const message = await createMessage(
        provider,
        settings,
        providerWorkingDirectory.fsPath,
        skill,
        change.diff,
        statusBar,
        cancellation,
      );
      drafts.push({
        repositoryName: change.repository.name,
        repositoryPath: change.repository.path,
        message,
      });
      logger.log(`Mensagem gerada para ${change.repository.path}.`);
    }
    await showMultiCommitEditor(
      context.extensionUri,
      drafts,
      providerLabel,
      settings.model,
      async (draft) => {
        const message = validateCommitMessage(draft.message).message;
        await copyCommitMessage(vscode.env.clipboard, message);
        logger.log(`Mensagem de ${draft.repositoryPath} copiada.`);
      },
      cancellation,
    );
    return;
  }

  const change = changes[0];
  if (change === undefined) {
    return;
  }
  let message = await createMessage(
    provider,
    settings,
    providerWorkingDirectory.fsPath,
    skill,
    change.diff,
    statusBar,
    cancellation,
  );
  await copyCommitMessage(vscode.env.clipboard, message);
  logger.log("Mensagem gerada e copiada para a área de transferência.");
  for (;;) {
    const preview = await showCommitPreview(
      message,
      providerLabel,
      settings.model,
      cancellation,
    );
    if (preview.action === "cancel") {
      logger.log("Popup fechado; mensagem permanece na área de transferência.");
      return;
    }
    if (preview.action === "copy") {
      await copyCommitMessage(vscode.env.clipboard, message);
      await vscode.window.showInformationMessage(
        "Mensagem de commit copiada para a área de transferência.",
      );
      return;
    }
    if (preview.action === "regenerate") {
      logger.log("Regeneração iniciada.");
      message = await createMessage(
        provider,
        settings,
        providerWorkingDirectory.fsPath,
        skill,
        change.diff,
        statusBar,
        cancellation,
      );
      await copyCommitMessage(vscode.env.clipboard, message);
      logger.log("Nova mensagem copiada para a área de transferência.");
      continue;
    }
    const edited = await showCommitEditor(
      context.extensionUri,
      message,
      providerLabel,
      settings.model,
      cancellation,
    );
    if (edited !== undefined) {
      message = validateCommitMessage(edited).message;
      await copyCommitMessage(vscode.env.clipboard, message);
      logger.log("Mensagem editada e copiada para a área de transferência.");
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("Caveman Commit");
  const logger = new OutputLogger(channel);
  const statusBar = new CavemanStatusBar();
  const providers: Readonly<Record<ProviderId, CommitProvider>> = {
    codex: new CodexProvider({ run: runProcess, logger }),
    claude: new ClaudeProvider({ run: runProcess, logger }),
  };

  const refreshStatus = (): void => {
    try {
      const settings = readSettings();
      statusBar.update(settings.provider, settings.model, settings.reasoningEffort);
    } catch (error) {
      logger.log(`Configuração inválida: ${asUserMessage(error)}`);
    }
  };
  refreshStatus();

  const generation = new RestartableOperation(
    () => new vscode.CancellationTokenSource(),
    async (cancellation) => {
      try {
        await generateAndCopy(
          context,
          statusBar,
          providers,
          logger,
          cancellation,
        );
      } catch (error) {
        const message = asUserMessage(error);
        logger.log(
          error instanceof CavemanCommitError
            ? `Erro [${error.code}].`
            : "Erro inesperado.",
        );
        if (
          !(error instanceof CavemanCommitError && error.code === "OPERATION_CANCELLED")
        ) {
          await vscode.window.showErrorMessage(message);
        }
      } finally {
        refreshStatus();
      }
    },
  );

  context.subscriptions.push(
    channel,
    statusBar,
    generation,
    vscode.commands.registerCommand("cavemanCommit.generateCommit", () =>
      generation.trigger(),
    ),
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
