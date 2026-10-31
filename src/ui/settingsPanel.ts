import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import { DEFAULT_MODELS, getEffectiveModel, isProviderId, type ModelOption, type ProviderId } from "../config/models";
import { configurationTarget } from "../config/settings";
import { asUserMessage } from "../errors";
import { parseSettingsInput, renderSettingsSurface, type SettingsInput, type SettingsState } from "./settingsSurface";

// Raw read without readSettings() validation, so an invalid configuration can still be opened and fixed here.
function currentState(): SettingsState {
  const config = vscode.workspace.getConfiguration("cavemanCommit");
  const rawProvider = config.get<string>("provider", "codex");
  const provider = isProviderId(rawProvider) ? rawProvider : "codex";
  const diffScope = config.get<string>("diffScope", "all");
  return {
    provider,
    model: getEffectiveModel(provider, config.get<string>("model", "")),
    effort: config.get<string>("reasoningEffort", ""),
    diffScope: diffScope === "staged" ? "staged" : "all",
    timeout: config.get<number>("timeout", 120_000),
    maxDiffSize: config.get<number>("maxDiffSize", 500_000),
    skillPath: config.get<string>("skillPath", "skills/caveman-commit/SKILL.md"),
    target: configurationTarget() === vscode.ConfigurationTarget.Workspace ? "workspace" : "global",
  };
}

async function saveSettings(values: SettingsInput): Promise<void> {
  const config = vscode.workspace.getConfiguration("cavemanCommit");
  const target = configurationTarget();
  const entries: Record<string, string | number> = {
    provider: values.provider,
    model: values.model === DEFAULT_MODELS[values.provider].id ? "" : values.model,
    reasoningEffort: values.effort,
    diffScope: values.diffScope,
    timeout: values.timeout,
    maxDiffSize: values.maxDiffSize,
    skillPath: values.skillPath,
  };
  for (const [key, value] of Object.entries(entries)) await config.update(key, value, target);
}

let current: vscode.WebviewPanel | undefined;

export function showSettingsPanel(
  extensionUri: vscode.Uri,
  listModels: (provider: ProviderId) => Promise<readonly ModelOption[]>,
): void {
  if (current) {
    current.reveal();
    return;
  }
  const media = vscode.Uri.joinPath(extensionUri, "media");
  const panel = vscode.window.createWebviewPanel(
    "cavemanCommit.settings",
    "Caveman Commit · Configurações",
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] },
  );
  current = panel;
  let disposed = false;
  // Model catalogs can resolve after the tab is closed; posting to a disposed webview throws.
  const post = async (message: unknown): Promise<void> => {
    if (!disposed) await panel.webview.postMessage(message);
  };
  panel.iconPath = {
    light: vscode.Uri.joinPath(media, "status-icon.svg"),
    dark: vscode.Uri.joinPath(media, "status-icon-light.svg"),
  };
  panel.webview.html = renderSettingsSurface({
    state: currentState(),
    nonce: randomBytes(16).toString("hex"),
    iconUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "status-icon.svg")).toString(),
    cspSource: panel.webview.cspSource,
  });
  const messages = panel.webview.onDidReceiveMessage(async (value: unknown) => {
    const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    try {
      if (data.action === "close") panel.dispose();
      if (data.action === "openNative") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "cavemanCommit");
      }
      if (data.action === "models" && typeof data.provider === "string" && isProviderId(data.provider)) {
        await post({ action: "models", provider: data.provider, models: await listModels(data.provider) });
      }
      if (data.action === "save") {
        const result = parseSettingsInput(data.values);
        if ("field" in result) {
          await post({ action: "error", field: result.field, message: result.message });
          return;
        }
        await saveSettings(result.values);
        void vscode.window.showInformationMessage("Caveman Commit: configurações salvas.");
        panel.dispose();
      }
    } catch (error) {
      await post({ action: "error", field: "", message: asUserMessage(error) }).catch(() => undefined);
    }
  });
  panel.onDidDispose(() => {
    disposed = true;
    messages.dispose();
    current = undefined;
  });
}
