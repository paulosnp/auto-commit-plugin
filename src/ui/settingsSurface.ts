import { DEFAULT_MODELS, EFFORT_LEVELS, isProviderId, PROVIDER_IDS, PROVIDER_LABELS, type ProviderId } from "../config/models";
import { escapeHtml, icon, surfaceStyles } from "./commitSurface";

export interface SettingsState {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly diffScope: "all" | "staged";
  readonly timeout: number;
  readonly maxDiffSize: number;
  readonly skillPath: string;
  readonly target: "workspace" | "global";
}

export interface SettingsSurfaceOptions {
  readonly state: SettingsState;
  readonly nonce: string;
  readonly cspSource: string;
  readonly iconUri: string;
}

export interface SettingsInput {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly diffScope: "all" | "staged";
  readonly timeout: number;
  readonly maxDiffSize: number;
  readonly skillPath: string;
}

// `field` is the id of the input the webview highlights.
export type SettingsInputResult = { readonly values: SettingsInput } | { readonly field: string; readonly message: string };

const invalid = (field: string, message: string): SettingsInputResult => ({ field, message });

// The webview is a trust boundary: every value is re-validated before reaching the configuration.
export function parseSettingsInput(value: unknown): SettingsInputResult {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const { provider, model, effort, diffScope, timeout, maxDiffSize, skillPath } = data;
  if (typeof provider !== "string" || !isProviderId(provider)) return invalid("provider", "Provider inválido.");
  if (typeof model !== "string" || !model.trim()) return invalid("model", "Informe um identificador de modelo.");
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point of this check.
  if (model.length > 200 || /[\u0000-\u001f\u007f]/.test(model)) return invalid("model", "Identificador de modelo inválido.");
  if (typeof effort !== "string" || (effort !== "" && !EFFORT_LEVELS[provider].includes(effort))) {
    return invalid("effort", "Reasoning effort inválido para este provider.");
  }
  if (diffScope !== "all" && diffScope !== "staged") return invalid("diffScope", "Escopo inválido.");
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1000 || timeout > 600_000) {
    return invalid("timeout", "Prazo deve ser um inteiro entre 1000 e 600000 ms.");
  }
  if (typeof maxDiffSize !== "number" || !Number.isInteger(maxDiffSize) || maxDiffSize < 1000) {
    return invalid("max-diff-size", "Tamanho deve ser um inteiro a partir de 1000 bytes.");
  }
  if (typeof skillPath !== "string" || !skillPath.trim()) return invalid("skill-path", "Informe o caminho da skill.");
  return { values: { provider, model: model.trim(), effort, diffScope, timeout, maxDiffSize, skillPath: skillPath.trim() } };
}

function choice(name: string, value: string, label: string, checked: boolean): string {
  return `<label class="choice"><input type="radio" name="${name}" value="${escapeHtml(value)}" ${checked ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`;
}

// Native spinners can't be styled; the stepper buttons call stepUp/stepDown on the input.
function numberField(id: string, label: string, value: number, min: number, max: number | undefined, hint: string): string {
  return `<div class="field"><label for="${id}">${label}</label><div class="stepper"><input id="${id}" type="number" inputmode="numeric" step="1000" min="${min}" ${max === undefined ? "" : `max="${max}"`} value="${value}" aria-describedby="${id}-hint"><button class="step" type="button" data-step="-1" tabindex="-1" aria-label="Diminuir">${icon("minus")}</button><button class="step" type="button" data-step="1" tabindex="-1" aria-label="Aumentar">${icon("plus")}</button></div><p id="${id}-hint" class="hint">${hint}</p></div>`;
}

// The OS draws a native <select> popup, so it can't follow the page design. The hidden <select> stays the
// source of truth for value and options; the button + listbox mirror it.
function dropdownField(id: string, label: string, hint: string, wrapperId = ""): string {
  return `<div ${wrapperId ? `id="${wrapperId}" ` : ""}class="field"><span id="${id}-label" class="label">${label}</span><div class="dropdown"><button id="${id}-trigger" class="dropdown-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-label ${id}-trigger" aria-describedby="${id}-hint"><span class="dropdown-value"></span>${icon("chevron")}</button><ul id="${id}-list" class="dropdown-list" role="listbox" tabindex="-1" aria-labelledby="${id}-label" hidden></ul><select id="${id}" hidden aria-hidden="true" tabindex="-1"></select></div><p id="${id}-hint" class="hint">${hint}</p></div>`;
}

// Data block is parsed by the inline script; "<" is escaped so content cannot close the tag.
function jsonData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const settingsStyles = `
    .settings { display: grid; gap: 30px; }
    fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
    .field { display: grid; gap: 8px; min-width: 0; }
    .field > label, .field > .label, legend { padding: 0; font-size: 13px; font-weight: 600; }
    legend { margin-bottom: 10px; }
    .hint { margin: 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .choices { display: flex; flex-wrap: wrap; gap: 8px; }
    .choice { position: relative; display: inline-flex; }
    .choice input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .choice span { display: inline-flex; align-items: center; min-height: 38px; padding: 8px 16px; border: 1px solid var(--line); border-radius: 999px; transition: background 160ms ease-out; }
    .choice:hover input:not(:checked) + span { background: var(--hover); }
    .choice input:checked + span { color: var(--bg); background: var(--ink); border-color: var(--ink); font-weight: 600; }
    .choice input:focus-visible + span { outline: 2px solid var(--focus); outline-offset: 3px; }
    input[type="text"], input[type="number"] { width: 100%; min-height: 42px; padding: 9px 14px; border: 1px solid transparent; border-radius: 12px; background: var(--surface); color: var(--ink); font: inherit; }
    input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    input[type="number"] { appearance: textfield; -moz-appearance: textfield; padding-right: 88px; }
    input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .stepper { position: relative; }
    .step { position: absolute; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; min-height: 32px; padding: 0; color: var(--muted); background: transparent; }
    .step[data-step="-1"] { right: 44px; }
    .step[data-step="1"] { right: 7px; }
    .step:hover { color: var(--ink); background: var(--hover); }
    .step svg { width: 15px; height: 15px; }
    .dropdown { position: relative; }
    .dropdown-trigger { width: 100%; min-height: 42px; justify-content: space-between; padding: 9px 14px; border-radius: 12px; background: var(--surface); color: var(--ink); text-align: left; }
    .dropdown-trigger:hover:not(:disabled) { background: var(--hover); }
    .dropdown-trigger:focus-visible, .dropdown-trigger[aria-expanded="true"] { outline: 2px solid var(--focus); outline-offset: 1px; }
    .dropdown-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dropdown-trigger svg { color: var(--muted); transition: transform 160ms ease-out; }
    .dropdown-trigger[aria-expanded="true"] svg { transform: rotate(180deg); }
    .dropdown-list { position: absolute; z-index: 10; top: calc(100% + 6px); left: 0; right: 0; max-height: 280px; overflow: auto; margin: 0; padding: 6px; list-style: none; border: 1px solid var(--line); border-radius: 14px; background: var(--bg); box-shadow: 0 12px 32px color-mix(in srgb, #000 16%, transparent); }
    .dropdown-list:focus { outline: none; }
    [role="option"] { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 9px; cursor: pointer; overflow-wrap: anywhere; }
    [role="option"].active { background: var(--hover); }
    [role="option"][aria-selected="true"] { font-weight: 600; }
    [role="option"][aria-selected="true"]::after { content: "✓"; margin-left: auto; color: var(--muted); font-weight: 400; }
    [aria-invalid="true"] { border-color: var(--error); }
    details { border-top: 1px solid var(--line); padding-top: 22px; }
    summary { cursor: pointer; width: fit-content; font-size: 13px; font-weight: 600; }
    summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
    .advanced { display: grid; gap: 22px; margin-top: 20px; }
    .settings-actions { margin-top: 36px; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .settings-actions .feedback { flex-basis: 100%; }
    .vscode-high-contrast .dropdown-trigger, .vscode-high-contrast .dropdown-list, .vscode-high-contrast input, .vscode-high-contrast-light .dropdown-trigger, .vscode-high-contrast-light .dropdown-list, .vscode-high-contrast-light input { border-color: var(--vscode-contrastBorder, var(--ink)); }
    @media (max-width: 560px) { .settings-actions { align-items: stretch; flex-direction: column; } .settings-actions > .primary { align-self: flex-start; } }
    @media (prefers-reduced-motion: reduce) { .choice span, .dropdown-trigger svg { transition: none; } }
    @media (forced-colors: active) { .choice span, .dropdown-trigger, .dropdown-list, input { border: 1px solid ButtonText; } [role="option"].active { outline: 1px solid Highlight; } }`;

const settingsScript = `
    const vscode = acquireVsCodeApi();
    const data = JSON.parse(document.getElementById('settings-data').textContent);
    const CUSTOM = '__custom__';
    const $ = (id) => document.getElementById(id);
    const modelSelect = $('model'), customModel = $('custom-model'), customField = $('custom-model-field');
    const effortSelect = $('effort'), effortField = $('effort-field'), feedback = $('feedback'), save = $('save');
    let provider = data.state.provider;
    let models = [];
    const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
    const selectedModel = () => modelSelect.value === CUSTOM ? customModel.value.trim() : modelSelect.value;
    // Button + listbox mirroring a hidden <select>; call sync() after changing the select's options or value.
    function makeDropdown(select) {
      const root = select.closest('.dropdown'), trigger = root.querySelector('.dropdown-trigger');
      const list = root.querySelector('.dropdown-list'), label = trigger.querySelector('.dropdown-value');
      let active = -1;
      const items = () => [...list.children];
      function setActive(index) {
        const all = items();
        if (!all.length) return;
        active = (index + all.length) % all.length;
        all.forEach((item, n) => item.classList.toggle('active', n === active));
        list.setAttribute('aria-activedescendant', all[active].id);
        all[active].scrollIntoView({ block: 'nearest' });
      }
      function close(focusTrigger) {
        list.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        list.removeAttribute('aria-activedescendant');
        if (focusTrigger) trigger.focus();
      }
      function open() {
        if (trigger.disabled) return;
        list.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        setActive(Math.max(0, select.selectedIndex));
        list.focus();
      }
      function choose(index) {
        const changed = select.selectedIndex !== index;
        select.selectedIndex = index;
        trigger.removeAttribute('aria-invalid');
        sync();
        close(true);
        if (changed) select.dispatchEvent(new Event('change'));
      }
      function sync() {
        list.replaceChildren(...[...select.options].map((o, index) => {
          const item = document.createElement('li');
          item.id = select.id + '-option-' + index;
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', String(index === select.selectedIndex));
          item.textContent = o.textContent;
          item.addEventListener('mousedown', (event) => event.preventDefault());
          item.addEventListener('click', () => choose(index));
          return item;
        }));
        label.textContent = select.selectedOptions[0]?.textContent ?? '';
        trigger.disabled = select.disabled;
      }
      trigger.addEventListener('click', () => (list.hidden ? open() : close(true)));
      trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
      });
      list.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') setActive(active + 1);
        else if (event.key === 'ArrowUp') setActive(active - 1);
        else if (event.key === 'Home') setActive(0);
        else if (event.key === 'End') setActive(items().length - 1);
        else if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === ' ') choose(active);
        else if (event.key === 'Escape') { event.stopPropagation(); close(true); }
        else if (event.key === 'Tab') { close(false); return; }
        else return;
        event.preventDefault();
      });
      list.addEventListener('focusout', (event) => { if (!root.contains(event.relatedTarget)) close(false); });
      sync();
      return { sync, trigger };
    }
    const dropdowns = { model: makeDropdown(modelSelect), effort: makeDropdown(effortSelect) };
    document.querySelectorAll('.step').forEach((button) => button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      if (button.dataset.step === '1') input.stepUp(); else input.stepDown();
      input.dispatchEvent(new Event('input'));
      input.focus();
    }));
    function setFeedback(text, error) { feedback.textContent = text; feedback.classList.toggle('error', Boolean(error)); }
    function renderEfforts(keep) {
      const known = data.efforts[provider] || [];
      effortField.hidden = known.length === 0;
      const model = models.find((m) => m.id === selectedModel());
      const supported = (model && model.efforts || []).filter((e) => known.includes(e));
      const levels = supported.length ? supported : known;
      const fallback = data.defaults[provider].effort;
      // Same rule as effortAfterModelChange: offer "Padrão" only when the model supports the provider default.
      const defaultOk = !fallback || levels.includes(fallback);
      const preferred = model && model.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : levels[0];
      effortSelect.replaceChildren(...(defaultOk ? [option('', fallback ? 'Padrão (' + fallback + ')' : 'Padrão')] : []), ...levels.map((e) => option(e, e)));
      effortSelect.value = levels.includes(keep) ? keep : defaultOk ? '' : preferred;
      dropdowns.effort.sync();
    }
    function renderModels(selected) {
      const fallbackId = data.defaults[provider].model;
      modelSelect.replaceChildren(...models.map((m) => option(m.id, m.displayName + (m.id === fallbackId ? ' · Padrão' : '') + (m.displayName === m.id ? '' : ' · ' + m.id))), option(CUSTOM, 'Outro modelo…'));
      const known = models.some((m) => m.id === selected);
      modelSelect.value = known ? selected : CUSTOM;
      customModel.value = known ? '' : selected;
      customField.hidden = known;
      modelSelect.disabled = false;
      dropdowns.model.sync();
    }
    function requestModels() {
      modelSelect.disabled = true;
      modelSelect.replaceChildren(option('', 'Carregando modelos…'));
      dropdowns.model.sync();
      vscode.postMessage({ action: 'models', provider });
    }
    document.querySelectorAll('input[name="provider"]').forEach((input) => input.addEventListener('change', () => {
      provider = document.querySelector('input[name="provider"]:checked').value;
      models = [];
      requestModels();
      setFeedback('', false);
    }));
    modelSelect.addEventListener('change', () => {
      customField.hidden = modelSelect.value !== CUSTOM;
      if (modelSelect.value === CUSTOM) customModel.focus();
      renderEfforts(effortSelect.value);
    });
    customModel.addEventListener('input', () => renderEfforts(effortSelect.value));
    document.querySelectorAll('input, select').forEach((field) => field.addEventListener('input', () => field.removeAttribute('aria-invalid')));
    save.addEventListener('click', () => {
      if (save.disabled) return;
      save.disabled = true;
      setFeedback('Salvando…', false);
      vscode.postMessage({ action: 'save', values: {
        provider, model: selectedModel(), effort: effortSelect.value,
        diffScope: document.querySelector('input[name="diffScope"]:checked').value,
        timeout: Number($('timeout').value), maxDiffSize: Number($('max-diff-size').value), skillPath: $('skill-path').value.trim(),
      } });
    });
    $('close').addEventListener('click', () => vscode.postMessage({ action: 'close' }));
    $('cancel').addEventListener('click', () => vscode.postMessage({ action: 'close' }));
    $('native').addEventListener('click', () => vscode.postMessage({ action: 'openNative' }));
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.action === 'models' && message.provider === provider) {
        models = Array.isArray(message.models) ? message.models : [];
        renderModels(provider === data.state.provider ? data.state.model : data.defaults[provider].model);
        renderEfforts(provider === data.state.provider ? data.state.effort : '');
      }
      if (message?.action === 'error') {
        save.disabled = false;
        setFeedback(message.message, true);
        const target = message.field === 'model' && modelSelect.value === CUSTOM ? customModel : $(message.field);
        const field = target && dropdowns[target.id] ? dropdowns[target.id].trigger : target;
        if (field) { field.setAttribute('aria-invalid', 'true'); field.closest('details')?.setAttribute('open', ''); field.focus(); }
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); $('close').click(); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save.click(); }
    });
    requestModels();
    document.querySelector('input[name="provider"]:checked').focus();`;

export function renderSettingsSurface(options: SettingsSurfaceOptions): string {
  const { state, nonce, cspSource, iconUri } = options;
  const data = {
    state,
    efforts: EFFORT_LEVELS,
    defaults: Object.fromEntries(PROVIDER_IDS.map((provider) => [
      provider, { model: DEFAULT_MODELS[provider].id, effort: DEFAULT_MODELS[provider].reasoningEffort ?? "" },
    ])),
  };
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configurações · Caveman Commit</title>
  <style nonce="${nonce}">
${surfaceStyles}${settingsStyles}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><img src="${escapeHtml(iconUri)}" alt="" aria-hidden="true"><span>Caveman Commit</span></div>
    <div class="topbar-end"><div class="model" aria-label="Configuração ativa"><span>${escapeHtml(PROVIDER_LABELS[state.provider])}</span><span title="${escapeHtml(state.model)}">${escapeHtml(state.model)}</span></div><button id="close" class="icon-button" type="button" title="Fechar (Esc)" aria-label="Fechar">${icon("close")}</button></div>
  </header>
  <main>
    <h1>Configurações</h1>
    <p class="intro">Escolha como as mensagens são geradas. Salvas ${state.target === "workspace" ? "neste workspace" : "no perfil global"}.</p>
    <div class="settings">
      <fieldset><legend>Provider</legend><div class="choices">${PROVIDER_IDS.map((provider) => choice("provider", provider, PROVIDER_LABELS[provider], provider === state.provider)).join("")}</div></fieldset>
      ${dropdownField("model", "Modelo", "Lista do CLI instalado; o identificador vai literalmente ao CLI, sem fallback.")}
      <div id="custom-model-field" class="field" hidden><label for="custom-model">Identificador do modelo</label><input id="custom-model" type="text" spellcheck="false" autocomplete="off"></div>
      ${dropdownField("effort", "Reasoning effort", "Níveis suportados pelo modelo escolhido.", "effort-field")}
      <fieldset><legend>Alterações enviadas</legend><div class="choices">${choice("diffScope", "all", "Todas as alterações", state.diffScope === "all")}${choice("diffScope", "staged", "Somente staged", state.diffScope === "staged")}</div></fieldset>
      <details>
        <summary>Avançado</summary>
        <div class="advanced">
          ${numberField("timeout", "Prazo por tentativa (ms)", state.timeout, 1000, 600000, "Entre 1000 e 600000. Em timeout, refaz até duas vezes dobrando o prazo.")}
          ${numberField("max-diff-size", "Diff que pede confirmação (bytes)", state.maxDiffSize, 1000, undefined, "Acima deste tamanho, a extensão confirma antes de enviar.")}
          <div class="field"><label for="skill-path">Skill</label><input id="skill-path" type="text" spellcheck="false" value="${escapeHtml(state.skillPath)}" aria-describedby="skill-path-hint"><p id="skill-path-hint" class="hint">Caminho absoluto ou relativo à instalação da extensão.</p></div>
        </div>
      </details>
    </div>
    <div class="settings-actions">
      <button id="native" class="secondary" type="button">Configurações do VS Code</button>
      <div class="secondary-actions"><button id="cancel" class="secondary" type="button">Cancelar</button><button id="save" class="primary" type="button">${icon("check")}Salvar</button></div>
      <p id="feedback" class="feedback" role="status" aria-live="polite"></p>
    </div>
    <p class="footnote"><kbd>Ctrl</kbd> <kbd>Enter</kbd> salva · <kbd>Esc</kbd> fecha</p>
  </main>
  <script id="settings-data" type="application/json">${jsonData(data)}</script>
  <script nonce="${nonce}">${settingsScript}
  </script>
</body>
</html>`;
}
