import { randomBytes } from "node:crypto";

import * as vscode from "vscode";

import { parsePreviewMessage, type PreviewResult } from "./previewProtocol";

interface PreviewItem extends vscode.QuickPickItem {
  readonly action: PreviewResult["action"];
}

function compactBody(message: string): string | undefined {
  const body = message.split(/\r?\n/).slice(2).join(" ").trim();
  return body.length > 0 ? body : undefined;
}

export async function showCommitPreview(
  message: string,
  provider: string,
  model: string,
): Promise<PreviewResult> {
  const subject = message.split(/\r?\n/, 1)[0] ?? message;
  const body = compactBody(message);
  const items: PreviewItem[] = [
    {
      label: "$(check) Copiada · Fechar",
      description: subject,
      detail: body,
      action: "copy",
    },
    {
      label: "$(edit) Editar",
      description: "Abrir editor completo",
      action: "edit",
    },
    {
      label: "$(sync) Regenerar",
      description: "Gerar e copiar outra mensagem",
      action: "regenerate",
    },
    {
      label: "$(close) Cancelar",
      action: "cancel",
    },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: `Caveman Commit · ${provider} · ${model}`,
    placeHolder: subject,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return { action: selected?.action ?? "cancel", message };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function editorHtml(message: string, nonce: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Editar Caveman Commit</title>
  <style nonce="${nonce}">
    body { padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    textarea { width: 100%; min-height: 220px; box-sizing: border-box; resize: vertical; padding: 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-editor-font-family); line-height: 1.5; }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    .actions { display: flex; gap: 8px; margin-top: 14px; }
    button { border: 0; padding: 7px 14px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  </style>
</head>
<body>
  <h1>Editar mensagem</h1>
  <textarea id="message" spellcheck="true" aria-label="Mensagem de commit">${escapeHtml(message)}</textarea>
  <div class="actions">
    <button id="apply">Aplicar e copiar</button>
    <button id="cancel" class="secondary">Cancelar</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const textarea = document.getElementById('message');
    document.getElementById('apply').addEventListener('click', () =>
      vscode.postMessage({ action: 'copy', message: textarea.value }));
    document.getElementById('cancel').addEventListener('click', () =>
      vscode.postMessage({ action: 'cancel', message: textarea.value }));
    textarea.focus();
  </script>
</body>
</html>`;
}

export function showCommitEditor(message: string): Promise<string | undefined> {
  const panel = vscode.window.createWebviewPanel(
    "cavemanCommit.editor",
    "Editar Caveman Commit",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [] },
  );
  const nonce = randomBytes(16).toString("hex");
  panel.webview.html = editorHtml(message, nonce);

  return new Promise<string | undefined>((resolve) => {
    let resolved = false;
    const finish = (value: string | undefined): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(value);
      panel.dispose();
    };
    const messageDisposable = panel.webview.onDidReceiveMessage((value: unknown) => {
      const result = parsePreviewMessage(value);
      if (result?.action === "copy") {
        finish(result.message);
      } else if (result?.action === "cancel") {
        finish(undefined);
      }
    });
    panel.onDidDispose(() => {
      messageDisposable.dispose();
      if (!resolved) {
        resolved = true;
        resolve(undefined);
      }
    });
  });
}
