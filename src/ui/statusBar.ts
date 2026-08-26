import * as vscode from "vscode";

import { DEFAULT_MODELS, type ProviderId } from "../config/models";

const HOVER_COMMANDS = [
  "cavemanCommit.generateCommit",
  "cavemanCommit.selectProvider",
  "cavemanCommit.selectModel",
  "cavemanCommit.openSettings",
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
  tooltip.appendMarkdown("### $(caveman-commit) Caveman Commit\n\n");
  tooltip.appendMarkdown(
    processing
      ? "$(sync~spin) **Gerando mensagem de commit…** Clique novamente para reiniciar.\n\n"
      : "$(check) **Pronto para gerar e copiar**\n\n",
  );
  tooltip.appendMarkdown("---\n\n");
  tooltip.appendMarkdown("| Configuração | Valor |\n| :-- | --: |\n");
  tooltip.appendMarkdown(
    `| Provider | **${escapeMarkdownCell(providerLabel)}** |\n`,
  );
  tooltip.appendMarkdown(`| Modelo | ${escapeMarkdownCell(model)} |\n`);
  if (provider === "codex") {
    tooltip.appendMarkdown(
      `| Reasoning | ${escapeMarkdownCell(reasoningEffort)} |\n`,
    );
  }
  tooltip.appendMarkdown("\n$(files) Analisa alterações locais sem executar `git add`.\n\n");
  tooltip.appendMarkdown("$(clippy) Copia o resultado automaticamente para `Ctrl+V`.\n\n");
  tooltip.appendMarkdown("---\n\n");
  tooltip.appendMarkdown(
    "[$(sparkle) **Gerar mensagem**](command:cavemanCommit.generateCommit)\n\n",
  );
  tooltip.appendMarkdown(
    "[$(account) Trocar provider](command:cavemanCommit.selectProvider) · " +
      "[$(settings-gear) Trocar modelo](command:cavemanCommit.selectModel)\n\n",
  );
  tooltip.appendMarkdown(
    "[$(gear) Abrir configurações](command:cavemanCommit.openSettings)",
  );
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
    this.item.text = "$(caveman-commit) $(sync~spin) Caveman Commit";
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
