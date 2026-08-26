import * as vscode from "vscode";

import { DEFAULT_MODELS, type ProviderId } from "./config/models";
import {
  configurationTarget,
  readSettings,
  type CavemanSettings,
} from "./config/settings";
import { asUserMessage, CavemanCommitError } from "./errors";
import {
  chooseRepository,
  discoverRepositories,
  normalizeRepositories,
  type NativeGitRepository,
  type RepositoryInfo,
} from "./git/getRepository";
import {
  commitMessage,
  diffSizeInBytes,
  getStagedDiff,
  isLargeDiff,
} from "./git/gitClient";
import { runProcess } from "./process/runProcess";
import { ClaudeProvider } from "./providers/claude";
import { CodexProvider } from "./providers/codex";
import type { CommitProvider, ProviderLogger } from "./providers/provider";
import { generateCommitMessage } from "./services/commitGenerator";
import { validateCommitMessage } from "./services/responseValidator";
import { loadSkill } from "./skills/loader";
import { showCommitPreview } from "./ui/commitPreview";
import { pickRepository } from "./ui/repositoryPicker";
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
): Promise<string> {
  statusBar.setProcessing();
  try {
    const raw = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Caveman Commit: gerando mensagem",
        cancellable: true,
      },
      (_progress, token) =>
        generateCommitMessage(provider, skill, diff, {
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          cwd: providerWorkingDirectory,
          timeoutMs: settings.timeout,
          cancellation: token,
        }),
    );
    return validateCommitMessage(raw).message;
  } finally {
    statusBar.update(settings.provider, settings.model, settings.reasoningEffort);
  }
}

async function generateAndCommit(
  context: vscode.ExtensionContext,
  statusBar: CavemanStatusBar,
  providers: Readonly<Record<ProviderId, CommitProvider>>,
  logger: OutputLogger,
): Promise<void> {
  const settings = readSettings();
  const repositories = await getAvailableRepositories();
  const repository = await chooseRepository(repositories, pickRepository);
  if (repository === undefined) {
    return;
  }

  const diff = await getStagedDiff(runProcess, repository.path);
  if (diff.trim().length === 0) {
    await vscode.window.showWarningMessage(
      "Nenhuma alteração staged encontrada. Adicione arquivos ao stage antes de gerar o commit.",
    );
    return;
  }
  const bytes = diffSizeInBytes(diff);
  if (isLargeDiff(diff, settings.maxDiffSize)) {
    const decision = await vscode.window.showWarningMessage(
      "O diff staged possui um tamanho elevado e pode aumentar significativamente o processamento. Continuar mesmo assim?",
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
  logger.log(`Repositório: ${repository.path}.`);
  logger.log(`Diff staged: ${bytes} bytes.`);
  logger.log("Geração iniciada.");

  let message = await createMessage(
    provider,
    settings,
    providerWorkingDirectory.fsPath,
    skill,
    diff,
    statusBar,
  );
  for (;;) {
    const preview = await showCommitPreview(message);
    if (preview.action === "cancel") {
      logger.log("Preview cancelado; Git não alterado.");
      return;
    }
    if (preview.action === "regenerate") {
      logger.log("Regeneração iniciada.");
      message = await createMessage(
        provider,
        settings,
        providerWorkingDirectory.fsPath,
        skill,
        diff,
        statusBar,
      );
      continue;
    }
    if (preview.action === "edit") {
      message = validateCommitMessage(preview.message).message;
      continue;
    }

    const approved = validateCommitMessage(preview.message).message;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Caveman Commit: executando git commit",
        cancellable: false,
      },
      () => commitMessage(runProcess, repository.path, approved),
    );
    logger.log("Commit concluído.");
    await vscode.window.showInformationMessage("Commit realizado com sucesso.");
    return;
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
  let generationRunning = false;

  const refreshStatus = (): void => {
    try {
      const settings = readSettings();
      statusBar.update(settings.provider, settings.model, settings.reasoningEffort);
    } catch (error) {
      logger.log(`Configuração inválida: ${asUserMessage(error)}`);
    }
  };
  refreshStatus();

  context.subscriptions.push(
    channel,
    statusBar,
    vscode.commands.registerCommand("cavemanCommit.generateCommit", async () => {
      if (generationRunning) {
        await vscode.window.showInformationMessage("Caveman Commit já está em execução.");
        return;
      }
      generationRunning = true;
      try {
        await generateAndCommit(context, statusBar, providers, logger);
      } catch (error) {
        const message = asUserMessage(error);
        logger.log(
          error instanceof CavemanCommitError
            ? `Erro [${error.code}].`
            : "Erro inesperado.",
        );
        if (!(error instanceof CavemanCommitError && error.code === "OPERATION_CANCELLED")) {
          await vscode.window.showErrorMessage(message);
        }
      } finally {
        generationRunning = false;
        refreshStatus();
      }
    }),
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
