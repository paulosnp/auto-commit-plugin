import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test, { mock } from "node:test";
import type { Uri } from "vscode";
import type * as PreviewUi from "../src/ui/commitPreview";
import type { CommitDraft } from "../src/services/commitSession";
import { parseSessionMessage } from "../src/ui/previewProtocol";
import { validateCommitMessage } from "../src/services/responseValidator";

class FakePanel {
  public disposed = false;
  public readonly sent: unknown[] = [];
  private receive: ((value: unknown) => void) | undefined;
  private readonly closeListeners: (() => void)[] = [];
  public readonly webview = {
    html: "",
    cspSource: "https://webview.example",
    asWebviewUri: (uri: string) => uri,
    postMessage: (value: unknown) => { this.sent.push(value); return Promise.resolve(true); },
    onDidReceiveMessage: (listener: (value: unknown) => void) => {
      this.receive = listener;
      return { dispose: () => { this.receive = undefined; } };
    },
  };
  public emit(value: unknown): void { this.receive?.(value); }
  public onDidDispose(listener: () => void): void { this.closeListeners.push(listener); }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.closeListeners.forEach((listener) => listener());
  }
}

const panels: FakePanel[] = [];
const moduleLoader = Module as unknown as {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};
const originalLoad = moduleLoader._load;
const loadMock = mock.method(moduleLoader, "_load", (request: string, parent: unknown, isMain: boolean) => {
  if (request !== "vscode") return originalLoad.call(moduleLoader, request, parent, isMain);
  return {
    Uri: { joinPath: (base: string, ...segments: string[]) => [base, ...segments].join("/") },
    ViewColumn: { Active: 1 },
    window: { createWebviewPanel: () => { const panel = new FakePanel(); panels.push(panel); return panel; } },
  };
});
const ui = createRequire(__filename)("../src/ui/commitPreview") as typeof PreviewUi;
loadMock.mock.restore();
const extensionUri = "extension" as unknown as Uri;
const message = "fix(auth): corrigir token";
const currentPanel = (): FakePanel => panels[panels.length - 1]!;

test("preview preserva mensagem original e fecha ao escolher ação", async () => {
  const result = ui.showCommitPreview(extensionUri, message, "Codex", "model");
  const panel = currentPanel();
  panel.emit({ action: "push", message });
  assert.equal(panel.disposed, false);
  panel.emit({ action: "edit", message: "texto adulterado" });
  assert.deepEqual(await result, { action: "edit", message });
  assert.equal(panel.disposed, true);
});

test("editor mantém texto inválido aberto e só retorna mensagem validada", async () => {
  const result = ui.showCommitEditor(extensionUri, message, "Codex", "model");
  const panel = currentPanel();
  panel.emit({ action: "copy", message: "texto inválido" });
  assert.equal(panel.disposed, false);
  assert.equal((panel.sent[0] as { action: string }).action, "copyError");
  panel.emit({ action: "copy", message: `"${message}"` });
  assert.equal(await result, message);
  assert.equal(panel.disposed, true);
});

test("fechar ou cancelar resolve a promessa e libera listener", async () => {
  const result = ui.showCommitPreview(extensionUri, message, "Codex", "model");
  currentPanel().dispose();
  assert.deepEqual(await result, { action: "cancel", message });

  let cancel: (() => void) | undefined;
  let disposed = false;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: (event: unknown) => unknown) => {
      cancel = () => { listener(undefined); };
      return { dispose: () => { disposed = true; } };
    },
  };
  const editor = ui.showCommitEditor(extensionUri, message, "Codex", "model", token);
  cancel?.();
  assert.equal(await editor, undefined);
  assert.equal(disposed, true);
  token.isCancellationRequested = true;
  const count = panels.length;
  assert.equal(await ui.showCommitEditor(extensionUri, message, "Codex", "model", token), undefined);
  assert.equal(panels.length, count);
});

test("multi-repositório confirma cópia após sucesso e mantém aberto após erro", async () => {
  let copies = 0;
  let reject = false;
  const result = ui.showMultiCommitEditor(extensionUri, [
    { repositoryName: "api", repositoryPath: "/api", message },
  ], "Codex", "model", async () => {
    copies += 1;
    if (reject) throw new Error("Falha ao copiar");
  });
  const panel = currentPanel();
  const copy = { action: "copyRepository", index: 0, message };
  panel.emit(copy);
  panel.emit(copy);
  assert.equal(panel.sent.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(copies, 1);
  assert.deepEqual(panel.sent[0], { action: "copied", index: 0 });
  reject = true;
  panel.emit(copy);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(panel.sent[1], { action: "copyError", index: 0, message: "Falha ao copiar" });
  assert.equal(panel.disposed, false);
  panel.emit({ action: "close" });
  await result;
  assert.equal(panel.disposed, true);
});

const draft: CommitDraft = {
  repositoryName: "api", repositoryPath: "/api", message, scope: "all", diffHash: "old-hash", cacheKey: "key",
  provider: "Codex", model: "model", stale: false, reused: false, copied: true, canUseGit: true,
};
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
const event = (action: string, index = 0, text = message, allowStale = false): unknown => ({ action, index, message: text, allowStale });
const tick = async (): Promise<void> => { await new Promise(resolve => setImmediate(resolve)); };

test("protocolo de sessão rejeita ações, índices, payloads e flags adulterados", () => {
  assert.ok(parseSessionMessage(event("useGit", 0, message, true)));
  for (const value of [null, "copy", {}, event("push"), event("copy", -1), event("copy", 0.5), { action: "copy", index: 0, message, allowStale: "true" }, { action: "useGit", index: 0, message: 1, allowStale: false }]) {
    assert.equal(parseSessionMessage(value), undefined);
  }
});

test("sessão individual preserva texto em erros e stale; fecha somente após copiar/aplicar", async () => {
  let calls = 0; let cancelled = 0;
  let stale = true;
  const result = ui.showCommitSession(extensionUri, [draft], {
    act: async (original, action, text, allowStale) => {
      calls++; validateCommitMessage(text);
      assert.equal(action, "useGit");
      if (stale && !allowStale) return { outcome: "stale", draft: { ...original, message: text, stale: true } };
      return { outcome: "applied", draft: { ...original, message: text } };
    },
    regenerate: async () => { throw new Error("provider failed"); },
    reportError() {}, cancel: () => { cancelled++; },
  }, token);
  const panel = currentPanel();
  panel.emit(event("edit"));
  assert.match(panel.webview.html, /data-mode="editor"/);
  panel.emit(event("useGit", 0, "inválida")); await tick();
  assert.equal(panel.disposed, false);
  assert.equal((panel.sent.at(-1) as { outcome: string }).outcome, "error");
  panel.emit(event("useGit", 0, "fix(api): preservar edição")); await tick();
  assert.equal((panel.sent.at(-1) as { outcome: string }).outcome, "stale");
  panel.emit(event("regenerate")); await tick();
  assert.equal(panel.disposed, false);
  assert.equal((panel.sent.at(-1) as { outcome: string }).outcome, "error");
  stale = false;
  panel.emit(event("useGit", 0, "fix(api): preservar edição", true));
  await result;
  assert.equal(calls, 3); assert.equal(cancelled, 1);
});

test("regeneração por repositório troca snapshot só após sucesso e mantém editor múltiplo", async () => {
  let observed = ""; let reject = true;
  const result = ui.showCommitSession(extensionUri, [draft, { ...draft, repositoryName: "web", repositoryPath: "/web" }], {
    act: async (original, _action, text) => { observed = original.diffHash; return { outcome: "copied", draft: { ...original, message: text } }; },
    regenerate: async original => { if (reject) throw new Error("failed"); return { ...original, diffHash: "new-hash", message: "fix(web): atualizar interface" }; },
    reportError() {}, cancel() {},
  }, token);
  const panel = currentPanel(); const originalHtml = panel.webview.html;
  panel.emit(event("regenerate", 1)); await tick();
  panel.emit(event("copy", 1)); await tick();
  assert.equal(observed, "old-hash");
  reject = false;
  panel.emit(event("regenerate", 1)); await tick();
  assert.equal((panel.sent.at(-1) as { outcome: string; index: number }).outcome, "updated");
  assert.equal((panel.sent.at(-1) as { index: number }).index, 1);
  assert.equal(panel.webview.html, originalHtml); // Other unsaved textareas are not rebuilt.
  panel.emit(event("copy", 1)); await tick();
  assert.equal(observed, "new-hash"); assert.equal(panel.disposed, false);
  panel.emit(event("close")); await result;
});

test("sessão ignora índice inválido e duplicação pendente; fechar cancela operação", async () => {
  let complete: ((value: CommitDraft) => void) | undefined; let calls = 0; let cancelled = 0;
  const result = ui.showCommitSession(extensionUri, [draft], {
    act: async original => ({ outcome: "copied", draft: original }),
    regenerate: () => { calls++; return new Promise(resolve => { complete = resolve; }); },
    reportError() {}, cancel: () => { cancelled++; },
  }, token);
  const panel = currentPanel();
  panel.emit(event("regenerate", 4));
  panel.emit(event("regenerate")); panel.emit(event("regenerate"));
  assert.equal(calls, 1);
  panel.emit(event("close")); await result;
  const sent = panel.sent.length;
  complete?.({ ...draft, message: "fix(api): nova mensagem" }); await tick();
  assert.equal(cancelled, 1); assert.equal(panel.sent.length, sent);
});
