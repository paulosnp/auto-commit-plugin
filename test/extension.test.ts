import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test, { mock } from "node:test";
import type { ExtensionContext } from "vscode";
import type * as Extension from "../src/extension";
import { CavemanCommitError } from "../src/errors";

class TokenSource {
  private readonly listeners = new Set<() => void>();
  public readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      this.listeners.add(listener);
      return { dispose: () => { this.listeners.delete(listener); } };
    },
  };
  public cancel(): void {
    this.token.isCancellationRequested = true;
    this.listeners.forEach((listener) => listener());
  }
  public dispose(): void { this.listeners.clear(); }
}

const state = {
  providerCalls: 0, logins: 0, processing: 0, diff: "diff-test",
  failure: undefined as Error | undefined,
  previewAction: "cancel", copies: [] as string[],
};
const commands = new Map<string, () => unknown>();
const disposable = { dispose() {} };
const uri = (fsPath: string) => ({ fsPath });
const vscodeStub = {
  CancellationTokenSource: TokenSource,
  ProgressLocation: { Notification: 1 },
  Uri: { joinPath: (base: { fsPath: string }, ...parts: string[]) => uri([base.fsPath, ...parts].join("/")) },
  extensions: { getExtension: () => ({ isActive: true, exports: { getAPI: () => ({ repositories: [] }) } }) },
  workspace: {
    fs: { createDirectory: async () => undefined },
    onDidChangeConfiguration: () => disposable,
  },
  window: {
    createOutputChannel: () => ({ ...disposable, appendLine() {} }),
    withProgress: async (_options: unknown, task: (progress: unknown, token: TokenSource["token"]) => unknown) =>
      task({ report() {} }, new TokenSource().token),
    // Real VS Code notifications remain unresolved until the user dismisses them.
    showErrorMessage: () => new Promise(() => {}),
    showWarningMessage: () => new Promise(() => {}),
    showInformationMessage: () => new Promise(() => {}),
  },
  env: { clipboard: { writeText: async (value: string) => { state.copies.push(value); } } },
  commands: {
    registerCommand: (name: string, handler: () => unknown) => { commands.set(name, handler); return disposable; },
    executeCommand: (name: string) => commands.get(name)?.(),
  },
};
class Provider {
  public readonly id = "claude";
  public async generateCommit(): Promise<string> {
    state.providerCalls += 1;
    if (state.failure) throw state.failure;
    return "fix(auth): corrigir token";
  }
}
const dependencies: Record<string, unknown> = {
  vscode: vscodeStub,
  "./config/settings": { readSettings: () => ({ provider: "claude", model: "claude-sonnet-5", reasoningEffort: "medium", timeout: 60000, maxDiffSize: 500000, skillPath: "skill" }) },
  "./git/getRepository": { normalizeRepositories: () => [{ name: "repo", path: "/repo" }] },
  "./git/gitClient": { getLocalChangesDiff: async () => state.diff, diffSizeInBytes: () => 100, isLargeDiff: () => false },
  "./providers/claude": { ClaudeProvider: Provider },
  "./providers/codex": { CodexProvider: Provider },
  "./skills/loader": { loadSkill: async () => "skill" },
  "./ui/commitPreview": { showCommitPreview: async () => ({ action: state.previewAction }) },
  "./ui/claudeLogin": { ClaudeLogin: class { public async open(): Promise<void> { state.logins += 1; } public dispose(): void {} } },
  "./ui/statusBar": { CavemanStatusBar: class { public update(): void {} public setProcessing(): void { state.processing += 1; } public dispose(): void {} } },
};
const moduleLoader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = moduleLoader._load;
const loadMock = mock.method(moduleLoader, "_load", (request: string, parent: unknown, isMain: boolean) =>
  dependencies[request] ?? originalLoad.call(moduleLoader, request, parent, isMain));
const extension = createRequire(__filename)("../src/extension") as typeof Extension;
loadMock.mock.restore();

function setup(): () => void {
  state.providerCalls = 0; state.logins = 0; state.processing = 0;
  state.diff = "diff-test"; state.failure = undefined;
  state.previewAction = "cancel"; state.copies = [];
  commands.clear();
  const context = { subscriptions: [] as { dispose(): void }[], globalStorageUri: uri("/storage"), extensionUri: uri("/extension"), extensionPath: "/extension" };
  extension.activate(context as unknown as ExtensionContext);
  return () => context.subscriptions.forEach((item) => item.dispose());
}

async function click(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      commands.get("cavemanCommit.generateCommit")?.(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Clique bloqueado pela notificação")), 200); }),
    ]);
  } finally { clearTimeout(timeout); }
}

test("erro de autenticação abre login e libera próximo clique sem fechar notificação", async () => {
  const cleanup = setup();
  try {
    state.failure = new CavemanCommitError("CLAUDE_NOT_AUTHENTICATED", "Sessão expirada");
    await click();
    assert.equal(state.logins, 1);
    state.failure = undefined;
    await click();
    assert.equal(state.providerCalls, 2);
    assert.deepEqual(state.copies, ["fix(auth): corrigir token"]);
  } finally { cleanup(); }
});

test("notificações de erro comum, ausência de diff e cópia não bloqueiam a barra", async () => {
  const cleanup = setup();
  try {
    state.failure = new Error("Falha comum");
    await click();
    state.failure = undefined;
    state.diff = "";
    await click();
    state.diff = "diff-test";
    state.previewAction = "copy";
    await click();
    await click();
    assert.equal(state.providerCalls, 3);
    assert.equal(state.copies.length, 4);
    assert.equal(state.logins, 0);
  } finally { cleanup(); }
});

test("comando de login está disponível sem iniciar geração", async () => {
  const cleanup = setup();
  try {
    const command = commands.get("cavemanCommit.loginClaude");
    assert.ok(command);
    await command();
    assert.equal(state.logins, 1);
    assert.equal(state.providerCalls, 0);
  } finally { cleanup(); }
});
