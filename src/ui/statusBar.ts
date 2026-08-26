import * as vscode from "vscode";

import { DEFAULT_MODELS, type ProviderId } from "../config/models";

export class CavemanStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );

  public constructor() {
    this.item.command = "cavemanCommit.generateCommit";
    this.item.name = "Caveman Commit";
    this.item.show();
  }

  public update(provider: ProviderId, model: string, reasoningEffort: string): void {
    const defaults = DEFAULT_MODELS[provider];
    const label = model === defaults.id ? defaults.shortName : model;
    this.item.text = `$(git-commit) Caveman · ${label}`;
    this.item.tooltip =
      provider === "codex"
        ? `Gerar mensagem de commit com Caveman Commit\nProvider: Codex\nModelo: ${model}\nReasoning: ${reasoningEffort}`
        : `Gerar mensagem de commit com Caveman Commit\nProvider: Claude Code\nModelo: ${model}`;
  }

  public setProcessing(): void {
    this.item.text = "$(sync~spin) Caveman";
    this.item.tooltip = "Gerando mensagem de commit…";
  }

  public dispose(): void {
    this.item.dispose();
  }
}
