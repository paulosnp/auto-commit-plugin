export type PreviewAction = "copy" | "edit" | "regenerate" | "cancel";

export interface PreviewResult {
  readonly action: PreviewAction;
  readonly message: string;
}

export interface RepositoryCopyMessage {
  readonly action: "copyRepository";
  readonly index: number;
  readonly message: string;
}

export interface SessionMessage {
  readonly action: "copy" | "useGit" | "regenerate" | "edit" | "cancel" | "close";
  readonly index: number;
  readonly message: string;
  readonly allowStale: boolean;
}

export function parseSessionMessage(value: unknown): SessionMessage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const data = value as Record<string, unknown>;
  if (!["copy", "useGit", "regenerate", "edit", "cancel", "close"].includes(data.action as string)
    || typeof data.index !== "number" || !Number.isSafeInteger(data.index) || data.index < 0
    || typeof data.message !== "string" || typeof data.allowStale !== "boolean") return undefined;
  return data as unknown as SessionMessage;
}

export function parsePreviewMessage(value: unknown): PreviewResult | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.action !== "copy" &&
    candidate.action !== "edit" &&
    candidate.action !== "regenerate" &&
    candidate.action !== "cancel"
  ) {
    return undefined;
  }
  if (typeof candidate.message !== "string") {
    return undefined;
  }
  return { action: candidate.action, message: candidate.message };
}

export function parseRepositoryCopyMessage(
  value: unknown,
): RepositoryCopyMessage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.action !== "copyRepository" ||
    typeof candidate.index !== "number" ||
    !Number.isInteger(candidate.index) ||
    candidate.index < 0 ||
    typeof candidate.message !== "string"
  ) {
    return undefined;
  }
  return {
    action: candidate.action,
    index: candidate.index,
    message: candidate.message,
  };
}
