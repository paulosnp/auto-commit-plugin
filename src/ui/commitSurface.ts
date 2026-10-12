import { sessionScript } from "./sessionScript";

export interface SurfaceDraft {
  readonly repositoryName?: string;
  readonly repositoryPath?: string;
  readonly message: string;
  readonly scope?: "all" | "staged";
  readonly stale?: boolean;
  readonly reused?: boolean;
  readonly copied?: boolean;
  readonly canUseGit?: boolean;
  readonly provider?: string;
  readonly model?: string;
}

export interface CommitSurfaceOptions {
  readonly mode: "preview" | "editor" | "multi";
  readonly drafts: readonly SurfaceDraft[];
  readonly provider: string;
  readonly model: string;
  readonly nonce: string;
  readonly cspSource: string;
  readonly iconUri: string;
  readonly session?: boolean;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const paths = {
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m13 6 5 5"/>',
  retry: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
} as const;

function icon(name: keyof typeof paths): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function details(draft: SurfaceDraft): string {
  return `<p class="draft-meta">${escapeHtml(draft.scope === "staged" ? "Somente staged" : "Todas as alterações")} · <span class="draft-model">${escapeHtml(draft.provider ?? "")} · ${escapeHtml(draft.model ?? "")}</span><span class="reuse">${draft.reused ? " · Mensagem reutilizada" : ""}</span></p>`;
}

function warning(draft: SurfaceDraft): string {
  return `<div class="stale-warning" role="status" ${draft.stale ? "" : "hidden"}><p>As alterações mudaram. Esta mensagem corresponde ao diff anterior.</p><div class="secondary-actions"><button class="secondary stale-regenerate" type="button">Regenerar</button><button class="secondary use-previous" type="button">Copiar mensagem anterior</button></div></div>`;
}

function gitButton(draft: SurfaceDraft): string {
  return `<button class="secondary use-git" type="button" ${draft.canUseGit ? "" : 'disabled title="Git nativo indisponível para este repositório."'}>Usar no Git</button>${draft.canUseGit ? "" : '<span class="git-unavailable">Git nativo indisponível para este repositório.</span>'}`;
}

function editor(draft: SurfaceDraft, index: number, multi: boolean, session: boolean): string {
  return `<section class="draft" data-index="${index}">
    ${multi ? `<header class="repository">${icon("folder")}<div><h2>${escapeHtml(draft.repositoryName ?? "Repositório")}</h2><p title="${escapeHtml(draft.repositoryPath ?? "")}">${escapeHtml(draft.repositoryPath ?? "")}</p></div></header>` : ""}
    ${session ? details(draft) + warning(draft) : ""}
    <div class="composer">
      <div class="composer-heading"><label for="message-${index}">Mensagem de commit</label><span class="subject-count" aria-live="polite"></span></div>
      <textarea id="message-${index}" spellcheck="true" aria-describedby="hint-${index} feedback-${index}">${escapeHtml(draft.message)}</textarea>
      <div class="composer-footer"><span class="line-count"></span><span id="hint-${index}" class="shortcut"><kbd>Ctrl</kbd> <kbd>Enter</kbd></span></div>
    </div>
    <div class="draft-actions">
      <p id="feedback-${index}" class="feedback" role="status" aria-live="polite">${multi ? "Pronta para copiar" : "Edite a mensagem antes de copiar."}</p>
      <div class="secondary-actions">${session ? `<button class="secondary regenerate" type="button">${icon("retry")}Regenerar</button>${gitButton(draft)}` : ""}<button class="primary copy" type="button">${icon(multi ? "copy" : "arrow")}<span>${multi ? "Copiar mensagem" : session ? "Copiar e fechar" : "Aplicar e copiar"}</span></button></div>
    </div>
  </section>`;
}

export function renderCommitSurface(options: CommitSurfaceOptions): string {
  const { mode, drafts, nonce, iconUri, cspSource, provider, model } = options;
  const message = drafts[0]?.message ?? "";
  const [subject = "", ...bodyLines] = message.split(/\r?\n/);
  const body = bodyLines.join("\n").trim();
  const title = mode === "preview" ? "Mensagem pronta" : mode === "editor" ? "Editar mensagem" : "Mensagens prontas";
  const content = mode === "preview"
    ? `<section class="draft preview-draft" data-index="0">${options.session ? details(drafts[0]!) + warning(drafts[0]!) : ""}<section class="response" aria-label="Mensagem de commit gerada">
        <div class="response-label"><span>Caveman Commit</span><span class="copied-label">${!options.session || drafts[0]?.copied ? icon("check") + "Copiada" : "Aguardando revisão"}</span></div>
        <pre class="commit-subject">${escapeHtml(subject)}</pre>
        ${body ? `<pre class="commit-body">${escapeHtml(body)}</pre>` : ""}
        <p class="clipboard-note">${!options.session || drafts[0]?.copied ? "Mensagem completa na área de transferência." : "Revise antes de copiar ou usar no Git."}</p>
      </section>
      <div class="preview-actions">
        <div class="secondary-actions"><button id="edit" class="secondary" type="button">${icon("edit")}Editar</button><button id="regenerate" class="secondary regenerate" type="button">${icon("retry")}Regenerar</button>${options.session ? gitButton(drafts[0]!) : ""}</div>
        <button id="copy" class="primary" type="button">${icon("copy")}Copiar e fechar</button>
      </div><p class="feedback" role="status" aria-live="polite"></p></section>`
    : drafts.map((draft, index) => editor(draft, index, mode === "multi", options.session === true)).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} · Caveman Commit</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background, #fff);
      --ink: var(--vscode-foreground, #242424);
      --muted: color-mix(in srgb, var(--ink) 75%, var(--bg));
      --surface: color-mix(in srgb, var(--ink) 5%, var(--bg));
      --hover: color-mix(in srgb, var(--ink) 9%, var(--bg));
      --line: color-mix(in srgb, var(--ink) 16%, var(--bg));
      --focus: var(--vscode-focusBorder, #0078d4);
      --error: var(--vscode-errorForeground, #c02b2b);
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.55 var(--vscode-font-family, "Segoe UI", system-ui, sans-serif); }
    button, textarea { font: inherit; }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 8px 16px; border: 1px solid transparent; border-radius: 999px; cursor: pointer; transition: background 160ms ease-out, opacity 160ms ease-out; }
    button svg { width: 17px; height: 17px; flex: 0 0 auto; }
    button:focus-visible, textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
    button:disabled { cursor: default; opacity: .45; }
    .primary { color: var(--bg); background: var(--ink); font-weight: 600; }
    .primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 82%, var(--bg)); }
    .secondary { color: var(--ink); background: transparent; border-color: var(--line); }
    .secondary:hover:not(:disabled), .icon-button:hover { background: var(--hover); }
    .icon-button { padding: 9px; width: 38px; background: transparent; color: var(--muted); }
    .topbar { min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 28px; }
    .brand { display: flex; align-items: center; gap: 11px; min-width: 0; font-size: 14px; font-weight: 600; }
    .brand img { width: 27px; height: 27px; }
    .vscode-dark .brand img, .vscode-high-contrast .brand img { filter: invert(1); }
    .topbar-end { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .model { color: var(--muted); font-size: 12px; min-width: 0; text-align: right; }
    .model span { display: block; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model span:first-child { color: var(--ink); font-size: 13px; }
    main { width: min(760px, 100%); margin: 0 auto; padding: 68px 24px 40px; }
    h1 { margin: 0; font-size: 24px; font-weight: 600; line-height: 1.3; letter-spacing: -.025em; text-wrap: balance; }
    .intro { margin: 9px 0 32px; color: var(--muted); font-size: 14px; text-wrap: pretty; }
    .response { padding: 24px 0 0; }
    .response-label { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; font-weight: 600; font-size: 13px; }
    .copied-label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-weight: 400; font-size: 12px; }
    .copied-label svg { width: 15px; height: 15px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-family: var(--vscode-editor-font-family, Consolas, monospace); }
    .commit-subject { font-size: 15px; line-height: 1.8; font-weight: 600; }
    .commit-body { margin-top: 22px; font-size: 14px; line-height: 1.8; }
    .clipboard-note { margin: 28px 0 0; color: var(--muted); font-size: 12px; }
    .preview-actions { margin-top: 30px; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .secondary-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .draft + .draft { margin-top: 38px; }
    .repository { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
    .repository > svg { width: 20px; height: 20px; flex: 0 0 auto; color: var(--muted); }
    .repository > div { min-width: 0; }
    h2 { font-size: 14px; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
    .repository p { margin: 2px 0 0; max-width: 65ch; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composer { border: 1px solid transparent; border-radius: 16px; background: var(--surface); }
    .composer:focus-within { border-color: var(--focus); outline: 1px solid var(--focus); }
    .composer-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px 0; color: var(--muted); font-size: 12px; }
    .subject-count { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .invalid { color: var(--error); }
    textarea { display: block; width: calc(100% - 24px); min-height: 260px; resize: vertical; margin: 8px 12px; padding: 10px 8px; border: none; border-radius: 6px; background: transparent; color: var(--ink); font: 14px/1.8 var(--vscode-editor-font-family, Consolas, monospace); }
    textarea[readonly] { opacity: .7; }
    textarea:focus-visible { outline: none; }
    .composer-footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 0 20px 16px; color: var(--muted); font-size: 12px; }
    .shortcut { display: inline-flex; gap: 4px; }
    kbd { min-width: 24px; padding: 1px 5px; border: 1px solid var(--line); border-radius: 4px; font-family: inherit; font-size: 11px; line-height: 1.5; text-align: center; }
    .draft-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; }
    .feedback { margin: 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .feedback.error { color: var(--error); }
    [hidden] { display: none !important; }
    .draft-meta, .git-unavailable { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .git-unavailable { flex-basis: 100%; }
    .stale-warning { padding: 14px 16px; margin: 16px 0; border: 1px solid var(--vscode-inputValidation-warningBorder, var(--line)); border-radius: 12px; background: var(--vscode-inputValidation-warningBackground, var(--surface)); }
    .stale-warning p { margin: 0 0 12px; }
    .draft-actions { flex-wrap: wrap; }
    .footnote { margin: 44px 0 0; text-align: center; color: var(--muted); font-size: 12px; }
    .vscode-high-contrast .composer, .vscode-high-contrast-light .composer { border-color: var(--vscode-contrastBorder, var(--ink)); }
    .vscode-high-contrast .secondary, .vscode-high-contrast-light .secondary { border-color: var(--ink); }
    @media (max-width: 560px) {
      .topbar { padding: 12px 16px; gap: 8px; }
      .brand { font-size: 13px; gap: 8px; }
      .brand img { width: 23px; height: 23px; }
      .model span { max-width: 100px; }
      .topbar-end { gap: 4px; }
      main { padding: 34px 18px 24px; }
      h1 { font-size: 22px; }
      .preview-actions { align-items: stretch; flex-direction: column; }
      .preview-actions > .primary { align-self: flex-start; }
      .draft-actions { align-items: flex-start; flex-direction: column; gap: 10px; }
      .composer-heading { padding: 16px 14px 0; }
      .composer-footer { padding: 0 14px 14px; }
      textarea { min-height: 220px; }
    }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }
    @media (forced-colors: active) { .composer, button { border: 1px solid ButtonText; } .primary { color: ButtonText; background: ButtonFace; } }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><img src="${escapeHtml(iconUri)}" alt="" aria-hidden="true"><span>Caveman Commit</span></div>
    <div class="topbar-end"><div class="model" aria-label="Configuração ativa"><span>${escapeHtml(provider)}</span><span title="${escapeHtml(model)}">${escapeHtml(model)}</span></div><button id="close" class="icon-button" type="button" title="Fechar (Esc)" aria-label="Fechar">${icon("close")}</button></div>
  </header>
  <main data-mode="${mode}">
    <h1>${title}</h1>
    <p class="intro">${mode === "preview" ? "Revise, ajuste ou gere uma nova versão." : mode === "editor" ? options.session ? "Revise o texto antes de copiar ou usar no Git." : "Ajuste o texto. A versão final será copiada para você." : `${drafts.length} repositórios. Revise e copie cada mensagem.`}</p>
    ${content}
    <p class="footnote">Você decide quando fazer o commit.</p>
  </main>
  <script nonce="${nonce}">
    ${options.session ? sessionScript : `const vscode = acquireVsCodeApi();
    const mode = document.querySelector('main').dataset.mode;
    const send = (action, message = '') => vscode.postMessage({ action, message });
    document.getElementById('close').addEventListener('click', () => send(mode === 'multi' ? 'close' : 'cancel'));
    document.getElementById('edit')?.addEventListener('click', () => send('edit'));
    document.getElementById('regenerate')?.addEventListener('click', () => send('regenerate'));
    document.getElementById('copy')?.addEventListener('click', () => send('copy'));
    document.querySelectorAll('.draft').forEach((draft) => {
      const textarea = draft.querySelector('textarea');
      const button = draft.querySelector('.copy');
      const label = button.querySelector('span');
      const feedback = draft.querySelector('.feedback');
      const count = draft.querySelector('.subject-count');
      const refresh = () => {
        const lines = textarea.value.replace(/\\r\\n/g, '\\n').split('\\n');
        const length = lines[0].trim().length;
        const invalid = length > 72 || textarea.value.length > 4000;
        count.textContent = length + ' / 72';
        count.classList.toggle('invalid', invalid);
        button.disabled = textarea.value.trim().length === 0 || invalid || draft.dataset.busy === 'true';
        draft.querySelector('.line-count').textContent = lines.length + (lines.length === 1 ? ' linha' : ' linhas');
        draft.querySelectorAll('kbd')[0].textContent = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
      };
      textarea.addEventListener('input', () => {
        label.textContent = mode === 'multi' ? 'Copiar mensagem' : 'Aplicar e copiar';
        feedback.textContent = 'Alterações ainda não copiadas.';
        feedback.classList.remove('error');
        refresh();
      });
      button.addEventListener('click', () => {
        if (button.disabled) return;
        draft.dataset.busy = 'true';
        textarea.readOnly = true;
        button.disabled = true;
        label.textContent = 'Copiando…';
        feedback.textContent = 'Copiando mensagem…';
        feedback.classList.remove('error');
        vscode.postMessage({ action: mode === 'multi' ? 'copyRepository' : 'copy', index: Number(draft.dataset.index), message: textarea.value });
      });
      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          button.click();
        }
      });
      refresh();
    });
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data?.action !== 'copied' && data?.action !== 'copyError') return;
      const index = mode === 'editor' ? 0 : data.index;
      if (!Number.isInteger(index) || index < 0) return;
      const draft = document.querySelector('.draft[data-index="' + index + '"]');
      if (!draft) return;
      draft.dataset.busy = 'false';
      draft.querySelector('textarea').readOnly = false;
      draft.querySelector('.copy').disabled = false;
      draft.querySelector('.copy span').textContent = data.action === 'copied' ? 'Copiada' : (mode === 'multi' ? 'Copiar mensagem' : 'Aplicar e copiar');
      const feedback = draft.querySelector('.feedback');
      feedback.textContent = data.action === 'copied' ? 'Mensagem copiada para a área de transferência.' : data.message;
      feedback.classList.toggle('error', data.action === 'copyError');
      if (data.action === 'copyError') draft.querySelector('textarea').focus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); document.getElementById('close').click(); }
      if (mode === 'preview' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault(); document.getElementById('copy').click();
      }
    });
    const initialFocus = document.querySelector('textarea') || document.getElementById('copy');
    initialFocus?.focus();
    if (initialFocus?.tagName === 'TEXTAREA') initialFocus.setSelectionRange(initialFocus.value.length, initialFocus.value.length);`}
  </script>
</body>
</html>`;
}
