import * as vscode from "vscode";

import { DEFAULT_MODELS, type ProviderId } from "../config/models";

const HOVER_COMMANDS = [
  "cavemanCommit.generateCommit",
  "cavemanCommit.selectProvider",
  "cavemanCommit.selectModel",
  "cavemanCommit.openSettings",
  "cavemanCommit.loginClaude",
] as const;

function escapeMarkdownCell(value: string): string {
  return value
    .replace(/[\\`*_{}[\]()#+\-.!<>|]/g, "\\$&")
    .replace(/[\r\n]+/g, " ");
}

function buildTooltip(
  provider: ProviderId,
  model: string,
  reasoningEffort: string,
  processing: boolean,
): vscode.MarkdownString {
  const providerLabel = provider === "codex" ? "Codex" : "Claude Code";
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.isTrusted = { enabledCommands: HOVER_COMMANDS };
  tooltip.appendMarkdown("$(caveman-commit) **Caveman Commit**\n\n");
  tooltip.appendMarkdown(
    processing
      ? "Gerando mensagem… Clique para reiniciar.\n\n"
      : "Gerar e copiar mensagem de commit.\n\n",
  );
  tooltip.appendMarkdown(`${escapeMarkdownCell(providerLabel)} · ${escapeMarkdownCell(model)}`);
  if (provider === "codex") {
    tooltip.appendMarkdown(
      ` · ${escapeMarkdownCell(reasoningEffort)}`,
    );
  }
  tooltip.appendMarkdown("\n\n---\n\n");
  tooltip.appendMarkdown(
    "[Gerar mensagem](command:cavemanCommit.generateCommit)\n\n",
  );
  tooltip.appendMarkdown(
    "[Provider](command:cavemanCommit.selectProvider) · " +
      "[Modelo](command:cavemanCommit.selectModel)\n\n",
  );
  tooltip.appendMarkdown(
    "[Configurações](command:cavemanCommit.openSettings)",
  );
  if (provider === "claude") {
    tooltip.appendMarkdown("\n\n[Entrar no Claude](command:cavemanCommit.loginClaude)");
  }
  return tooltip;
}

export class CavemanStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  private provider: ProviderId = "codex";
  private model: string = DEFAULT_MODELS.codex.id;
  private reasoningEffort: string = DEFAULT_MODELS.codex.reasoningEffort;

  public constructor() {
    this.item.command = "cavemanCommit.generateCommit";
    this.item.name = "Caveman Commit";
    this.item.show();
  }

  public update(provider: ProviderId, model: string, reasoningEffort: string): void {
    this.provider = provider;
    this.model = model;
    this.reasoningEffort = reasoningEffort;
    this.item.text = "$(caveman-commit) Caveman Commit";
    this.item.tooltip = buildTooltip(provider, model, reasoningEffort, false);
  }

  public setProcessing(): void {
    this.item.text =
      "$(loading~spin) Caveman Commit";
    this.item.tooltip = buildTooltip(
      this.provider,
      this.model,
      this.reasoningEffort,
      true,
    );
  }

  public dispose(): void {
    this.item.dispose();
  }
}
