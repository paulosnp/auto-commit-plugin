import { randomBytes } from "node:crypto";

import * as vscode from "vscode";

import { parsePreviewMessage, type PreviewResult } from "./previewProtocol";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function previewHtml(message: string, nonce: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Caveman Commit</title>
  <style nonce="${nonce}">
    body { padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    h1 { font-size: 1.2rem; font-weight: 600; }
    textarea { width: 100%; min-height: 180px; box-sizing: border-box; resize: vertical; padding: 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-editor-font-family); line-height: 1.5; }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    button { border: 0; padding: 7px 14px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <h1>Mensagem gerada</h1>
  <textarea id="message" readonly spellcheck="true" aria-label="Mensagem de commit">${escapeHtml(message)}</textarea>
  <div class="actions">
    <button id="commit">Commit</button>
    <button id="edit" class="secondary">Editar</button>
    <button id="regenerate" class="secondary">Regenerar</button>
    <button id="cancel" class="secondary">Cancelar</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const textarea = document.getElementById('message');
    const send = (action) => vscode.postMessage({ action, message: textarea.value });
    document.getElementById('commit').addEventListener('click', () => send('commit'));
    document.getElementById('regenerate').addEventListener('click', () => send('regenerate'));
    document.getElementById('cancel').addEventListener('click', () => send('cancel'));
    document.getElementById('edit').addEventListener('click', (event) => {
      if (textarea.readOnly) {
        textarea.readOnly = false;
        textarea.focus();
        event.currentTarget.textContent = 'Aplicar edição';
        return;
      }
      send('edit');
    });
  </script>
</body>
</html>`;
}

export function showCommitPreview(message: string): Promise<PreviewResult> {
  const panel = vscode.window.createWebviewPanel(
    "cavemanCommit.preview",
    "Caveman Commit · Preview",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [] },
  );
  const nonce = randomBytes(16).toString("hex");
  panel.webview.html = previewHtml(message, nonce);

  return new Promise<PreviewResult>((resolve) => {
    let resolved = false;
    const finish = (result: PreviewResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(result);
      panel.dispose();
    };
    const messageDisposable = panel.webview.onDidReceiveMessage((value: unknown) => {
      const result = parsePreviewMessage(value);
      if (result !== undefined) {
        finish(result);
      }
    });
    panel.onDidDispose(() => {
      messageDisposable.dispose();
      if (!resolved) {
        resolved = true;
        resolve({ action: "cancel", message });
      }
    });
  });
}
