import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import { asUserMessage } from "../errors";
import { validateCommitMessage } from "../services/responseValidator";
import { renderCommitSurface, type CommitSurfaceOptions } from "./commitSurface";
import { parsePreviewMessage, parseRepositoryCopyMessage, type PreviewResult } from "./previewProtocol";

export interface RepositoryCommitDraft {
  readonly repositoryName: string;
  readonly repositoryPath: string;
  readonly message: string;
}

function createSurface(
  extensionUri: vscode.Uri,
  options: Pick<CommitSurfaceOptions, "mode" | "drafts" | "provider" | "model">,
): vscode.WebviewPanel {
  const media = vscode.Uri.joinPath(extensionUri, "media");
  const panel = vscode.window.createWebviewPanel(
    `cavemanCommit.${options.mode}`,
    options.mode === "editor" ? "Caveman Commit · Editar" : "Caveman Commit",
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] },
  );
  panel.iconPath = {
    light: vscode.Uri.joinPath(media, "status-icon.svg"),
    dark: vscode.Uri.joinPath(media, "status-icon-light.svg"),
  };
  panel.webview.html = renderCommitSurface({
    ...options,
    nonce: randomBytes(16).toString("hex"),
    iconUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "status-icon.svg")).toString(),
    cspSource: panel.webview.cspSource,
  });
  return panel;
}

function waitForSurface<T>(
  panel: vscode.WebviewPanel,
  cancellation: vscode.CancellationToken | undefined,
  closedValue: T,
  receive: (value: unknown, finish: (result: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let resolved = false;
    const finish = (result: T): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
      panel.dispose();
    };
    const messages = panel.webview.onDidReceiveMessage((value: unknown) => receive(value, finish));
    const cancellationRegistration: { current?: vscode.Disposable } = {};
    panel.onDidDispose(() => {
      messages.dispose();
      cancellationRegistration.current?.dispose();
      if (!resolved) {
        resolved = true;
        resolve(closedValue);
      }
    });
    cancellationRegistration.current = cancellation?.onCancellationRequested(() => finish(closedValue));
    if (cancellation?.isCancellationRequested) finish(closedValue);
  });
}

export function showCommitPreview(
  extensionUri: vscode.Uri,
  message: string,
  provider: string,
  model: string,
  cancellation?: vscode.CancellationToken,
): Promise<PreviewResult> {
  const closed: PreviewResult = { action: "cancel", message };
  if (cancellation?.isCancellationRequested) return Promise.resolve(closed);
  const panel = createSurface(extensionUri, { mode: "preview", drafts: [{ message }], provider, model });
  return waitForSurface(panel, cancellation, closed, (value, finish) => {
    const result = parsePreviewMessage(value);
    if (result !== undefined) finish({ action: result.action, message });
  });
}

export function showCommitEditor(
  extensionUri: vscode.Uri,
  message: string,
  provider: string,
  model: string,
  cancellation?: vscode.CancellationToken,
): Promise<string | undefined> {
  if (cancellation?.isCancellationRequested) return Promise.resolve(undefined);
  const panel = createSurface(extensionUri, { mode: "editor", drafts: [{ message }], provider, model });
  return waitForSurface<string | undefined>(panel, cancellation, undefined, (value, finish) => {
    const result = parsePreviewMessage(value);
    if (result?.action === "cancel") finish(undefined);
    if (result?.action !== "copy") return;
    try {
      finish(validateCommitMessage(result.message).message);
    } catch (error) {
      void panel.webview.postMessage({ action: "copyError", message: asUserMessage(error) });
    }
  });
}

export function showMultiCommitEditor(
  extensionUri: vscode.Uri,
  drafts: readonly RepositoryCommitDraft[],
  provider: string,
  model: string,
  copyMessage: (draft: RepositoryCommitDraft) => Promise<void>,
  cancellation?: vscode.CancellationToken,
): Promise<void> {
  if (cancellation?.isCancellationRequested) return Promise.resolve();
  const panel = createSurface(extensionUri, { mode: "multi", drafts, provider, model });
  const pending = new Set<number>();
  return waitForSurface<void>(panel, cancellation, undefined, (value, finish) => {
    if (typeof value === "object" && value !== null && (value as Record<string, unknown>).action === "close") {
      finish(undefined);
      return;
    }
    const result = parseRepositoryCopyMessage(value);
    const original = result === undefined ? undefined : drafts[result.index];
    if (result === undefined || original === undefined || pending.has(result.index)) return;
    pending.add(result.index);
    void Promise.resolve()
      .then(() => copyMessage({ ...original, message: result.message }))
      .then(
        () => panel.webview.postMessage({ action: "copied", index: result.index }),
        (error: unknown) => panel.webview.postMessage({
          action: "copyError", index: result.index, message: asUserMessage(error),
        }),
      )
      .finally(() => pending.delete(result.index));
  });
}
