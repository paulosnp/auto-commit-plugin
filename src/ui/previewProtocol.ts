export type PreviewAction = "commit" | "edit" | "regenerate" | "cancel";

export interface PreviewResult {
  readonly action: PreviewAction;
  readonly message: string;
}

export function parsePreviewMessage(value: unknown): PreviewResult | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.action !== "commit" &&
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
