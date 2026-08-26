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

function editorHtml(
  message: string,
  nonce: string,
  iconUri: string,
  cspSource: string,
  provider: string,
  model: string,
): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Editar Caveman Commit</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    .page { width: min(1120px, 100%); margin: 0 auto; padding: 34px 28px 48px; }
    .hero { display: flex; align-items: center; justify-content: space-between; gap: 28px; margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 16px; min-width: 0; }
    .brand img { width: 58px; height: 58px; flex: 0 0 auto; filter: drop-shadow(0 7px 14px rgba(0, 0, 0, .28)); }
    .eyebrow { margin: 0 0 5px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(23px, 3vw, 32px); line-height: 1.15; }
    .subtitle { margin: 7px 0 0; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    .badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
    .badge { max-width: 220px; overflow: hidden; padding: 5px 9px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-badge-background); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(260px, .75fr); gap: 18px; align-items: start; }
    .card { overflow: hidden; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 10px; background: var(--vscode-sideBar-background); box-shadow: 0 8px 24px rgba(0, 0, 0, .12); }
    .card-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 11px 15px; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .card-title { font-weight: 650; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .warning { color: var(--vscode-editorWarning-foreground); }
    .editor-wrap { padding: 14px; }
    textarea { display: block; width: 100%; min-height: 310px; resize: vertical; padding: 16px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: 14px/1.65 var(--vscode-editor-font-family); }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .hint-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 11px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    kbd { padding: 2px 5px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-keybindingLabel-background); box-shadow: inset 0 -1px 0 var(--vscode-keybindingLabel-bottomBorder); font-family: var(--vscode-font-family); }
    .preview { padding: 16px; }
    .preview-subject { margin: 0; overflow-wrap: anywhere; font: 650 14px/1.5 var(--vscode-editor-font-family); }
    .preview-body { min-height: 90px; margin: 14px 0 0; padding-top: 14px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); color: var(--vscode-descriptionForeground); font: 12px/1.6 var(--vscode-editor-font-family); white-space: pre-wrap; overflow-wrap: anywhere; }
    .preview-empty { font-style: italic; opacity: .75; }
    .actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; margin-top: 18px; }
    button { min-height: 34px; padding: 7px 16px; border: 1px solid transparent; border-radius: 4px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    button.secondary { border-color: var(--vscode-button-border, transparent); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    @media (max-width: 760px) {
      .page { padding: 24px 16px 36px; }
      .hero { align-items: flex-start; flex-direction: column; }
      .badges { justify-content: flex-start; }
      .workspace { grid-template-columns: 1fr; }
      textarea { min-height: 250px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="hero">
      <div class="brand">
        <img src="${escapeHtml(iconUri)}" alt="" aria-hidden="true">
        <div>
          <p class="eyebrow">Caveman Commit</p>
          <h1>Refine a mensagem</h1>
          <p class="subtitle">Edite com preview ao vivo. Ao aplicar, o texto será copiado novamente.</p>
        </div>
      </div>
      <div class="badges" aria-label="Configuração ativa">
        <span class="badge">${escapeHtml(provider)}</span>
        <span class="badge" title="${escapeHtml(model)}">${escapeHtml(model)}</span>
        <span class="badge">Conventional Commit</span>
      </div>
    </header>

    <section class="workspace">
      <article class="card">
        <div class="card-header">
          <span class="card-title">Mensagem</span>
          <span id="subject-count" class="meta" aria-live="polite"></span>
        </div>
        <div class="editor-wrap">
          <textarea id="message" spellcheck="true" aria-label="Mensagem de commit" aria-describedby="editor-hint">${escapeHtml(message)}</textarea>
          <div id="editor-hint" class="hint-row">
            <span id="line-count"></span>
            <span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> para aplicar</span>
          </div>
        </div>
      </article>

      <aside class="card" aria-label="Preview da mensagem">
        <div class="card-header">
          <span class="card-title">Preview</span>
          <span class="meta">Ctrl+V pronto</span>
        </div>
        <div class="preview">
          <p id="preview-subject" class="preview-subject"></p>
          <div id="preview-body" class="preview-body"></div>
        </div>
      </aside>
    </section>

    <div class="actions">
      <button id="cancel" class="secondary">Cancelar</button>
      <button id="apply">Aplicar e copiar</button>
    </div>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const textarea = document.getElementById('message');
    const apply = document.getElementById('apply');
    const subjectCount = document.getElementById('subject-count');
    const lineCount = document.getElementById('line-count');
    const previewSubject = document.getElementById('preview-subject');
    const previewBody = document.getElementById('preview-body');
    const refresh = () => {
      const normalized = textarea.value.replace(/\\r\\n/g, '\\n');
      const lines = normalized.split('\\n');
      const subject = lines[0].trim();
      const body = lines.slice(1).join('\\n').trim();
      subjectCount.textContent = subject.length + '/50 no subject';
      subjectCount.classList.toggle('warning', subject.length > 50);
      lineCount.textContent = lines.length + (lines.length === 1 ? ' linha' : ' linhas');
      previewSubject.textContent = subject || 'Informe o subject do commit';
      previewSubject.classList.toggle('preview-empty', subject.length === 0);
      previewBody.textContent = body || 'Sem body — use apenas quando o motivo não for óbvio.';
      previewBody.classList.toggle('preview-empty', body.length === 0);
      apply.disabled = normalized.trim().length === 0;
    };
    apply.addEventListener('click', () =>
      vscode.postMessage({ action: 'copy', message: textarea.value }));
    document.getElementById('cancel').addEventListener('click', () =>
      vscode.postMessage({ action: 'cancel', message: textarea.value }));
    textarea.addEventListener('input', refresh);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !apply.disabled) {
        event.preventDefault();
        apply.click();
      }
    });
    refresh();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  </script>
</body>
</html>`;
}

export function showCommitEditor(
  extensionUri: vscode.Uri,
  message: string,
  provider: string,
  model: string,
): Promise<string | undefined> {
  const mediaUri = vscode.Uri.joinPath(extensionUri, "media");
  const panel = vscode.window.createWebviewPanel(
    "cavemanCommit.editor",
    "Caveman Commit · Editar",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [mediaUri],
    },
  );
  const iconPath = vscode.Uri.joinPath(mediaUri, "icon.png");
  panel.iconPath = iconPath;
  const nonce = randomBytes(16).toString("hex");
  panel.webview.html = editorHtml(
    message,
    nonce,
    panel.webview.asWebviewUri(iconPath).toString(),
    panel.webview.cspSource,
    provider,
    model,
  );

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
