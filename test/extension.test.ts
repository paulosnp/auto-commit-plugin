import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test, { mock } from "node:test";
import type { ExtensionContext } from "vscode";
import type * as Extension from "../src/extension";
import { CavemanCommitError } from "../src/errors";
import type { CommitDraft } from "../src/services/commitSession";
import type { CommitSessionActions } from "../src/ui/commitPreview";

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
  previewAction: "cancel", copies: [] as string[], drafts: [] as CommitDraft[],
  native: [] as { rootUri: { fsPath: string }; inputBox: { value: string } }[],
  selected: 0, revealed: 0,
};
const commands = new Map<string, (context?: unknown) => unknown>();
const disposable = { dispose() {} };
const uri = (fsPath: string) => ({ fsPath });
const vscodeStub = {
  CancellationTokenSource: TokenSource,
  ProgressLocation: { Notification: 1 },
  Uri: { joinPath: (base: { fsPath: string }, ...parts: string[]) => uri([base.fsPath, ...parts].join("/")) },
  extensions: { getExtension: () => ({ isActive: true, exports: { getAPI: () => ({ repositories: state.native }) } }) },
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
    showQuickPick: async (items: unknown[]) => { state.selected += 1; return items[items.length - 1]; },
  },
  env: { clipboard: { writeText: async (value: string) => { state.copies.push(value); } } },
  commands: {
    registerCommand: (name: string, handler: (context?: unknown) => unknown) => { commands.set(name, handler); return disposable; },
    executeCommand: async (name: string) => { if (name === "workbench.view.scm") state.revealed += 1; return commands.get(name)?.(); },
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
  "./config/settings": { readSettings: () => ({ diffScope: "all", provider: "claude", model: "claude-sonnet-5", reasoningEffort: "medium", timeout: 60000, maxDiffSize: 500000, skillPath: "skill" }) },
  "./git/getRepository": { normalizeRepositories: () => state.native.length ? state.native.map(repository => ({ name: repository.rootUri.fsPath, path: repository.rootUri.fsPath })) : [{ name: "repo", path: "/repo" }] },
  "./git/gitClient": { getChangesDiff: async () => state.diff, diffSizeInBytes: () => 100, isLargeDiff: () => false },
  "./providers/claude": { ClaudeProvider: Provider },
  "./providers/codex": { CodexProvider: Provider },
  "./skills/loader": { loadSkill: async () => "skill" },
  "./ui/commitPreview": { showCommitSession: async (_uri: unknown, drafts: CommitDraft[], actions: CommitSessionActions) => {
    state.drafts = drafts;
    if (state.previewAction === "copy" || state.previewAction === "useGit") await actions.act(drafts[0]!, state.previewAction, drafts[0]!.message, false);
  } },
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
  state.previewAction = "cancel"; state.copies = []; state.native = []; state.drafts = []; state.selected = 0; state.revealed = 0;
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
    assert.equal(state.providerCalls, 2);
    assert.equal(state.copies.length, 4);
    assert.equal(state.logins, 0);
  } finally { cleanup(); }
});

test("SCM usa o repositório do contexto e revela Git sem abrir terminal", async () => {
  const cleanup = setup();
  try {
    state.native = ["/api", "/web"].map(fsPath => ({ rootUri: { fsPath }, inputBox: { value: "" } }));
    state.previewAction = "useGit";
    await commands.get("cavemanCommit.generateFromScm")?.({ rootUri: { fsPath: "/api" } });
    assert.equal(state.drafts.length, 1);
    assert.equal(state.drafts[0]!.repositoryPath, "/api");
    assert.equal(state.native[0]!.inputBox.value, "fix(auth): corrigir token");
    assert.equal(state.native[1]!.inputBox.value, "");
    assert.equal(state.selected, 0);
    assert.equal(state.revealed, 1);
    assert.equal(state.logins, 0);
  } finally { cleanup(); }
});

test("SCM sem contexto em multi-root abre seletor; Git indisponível mantém cópia", async () => {
  const cleanup = setup();
  try {
    state.native = ["/api", "/web"].map(fsPath => ({ rootUri: { fsPath }, inputBox: { value: "" } }));
    await commands.get("cavemanCommit.generateFromScm")?.();
    assert.equal(state.selected, 1);
    assert.equal(state.drafts[0]!.repositoryPath, "/web");
    state.native = [];
    await click();
    assert.equal(state.drafts[0]!.canUseGit, false);
    assert.equal(state.copies.length, 2);
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
