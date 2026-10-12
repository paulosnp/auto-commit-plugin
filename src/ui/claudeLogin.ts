import * as vscode from "vscode";
import { resolveCommand } from "../process/resolveCommand";

export class ClaudeLogin implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;
  private disposed = false;
  private readonly closeRegistration: vscode.Disposable;

  public constructor(private readonly cwd: vscode.Uri) {
    this.closeRegistration = vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === this.terminal) this.terminal = undefined;
    });
  }

  public async open(): Promise<void> {
    if (this.disposed || this.focusActiveTerminal()) return;
    await vscode.workspace.fs.createDirectory(this.cwd);
    // Concurrent requests share a single interactive login.
    if (this.disposed || this.focusActiveTerminal()) return;
    const resolved = resolveCommand("claude");
    this.terminal = vscode.window.createTerminal({
      name: "Caveman Commit · Login Claude",
      shellPath: resolved.command,
      shellArgs: [...resolved.prefixArgs, "auth", "login"],
      cwd: this.cwd,
      env: { CLAUDE_CODE_SAFE_MODE: "1" },
      isTransient: true,
      iconPath: new vscode.ThemeIcon("key"),
      message: "Conclua o login no navegador. Depois, clique em Caveman Commit para gerar a mensagem.",
    });
    this.terminal.show(false);
  }

  private focusActiveTerminal(): boolean {
    if (this.terminal === undefined || this.terminal.exitStatus !== undefined) return false;
    this.terminal.show(false);
    return true;
  }

  public dispose(): void {
    this.disposed = true;
    this.closeRegistration.dispose();
    this.terminal?.dispose();
    this.terminal = undefined;
  }
}
