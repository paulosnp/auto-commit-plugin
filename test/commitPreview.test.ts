import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test, { mock } from "node:test";
import type { Uri } from "vscode";
import type * as PreviewUi from "../src/ui/commitPreview";

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
