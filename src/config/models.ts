export type ProviderId = "codex" | "claude";

export const DEFAULT_MODELS = {
  codex: {
    id: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    shortName: "Terra",
    reasoningEffort: "medium",
  },
  claude: {
    id: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    shortName: "Sonnet",
  },
} as const;

export function isProviderId(value: string): value is ProviderId {
  return value === "codex" || value === "claude";
}

export function getDefaultModel(provider: ProviderId): string {
  return DEFAULT_MODELS[provider].id;
}

export function getEffectiveModel(provider: ProviderId, override: string): string {
  return override.trim() || getDefaultModel(provider);
}
