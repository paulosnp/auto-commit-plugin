export type ProviderId = "codex" | "claude" | "gemini";

export const PROVIDER_IDS: readonly ProviderId[] = ["codex", "claude", "gemini"];

export const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  codex: "Codex",
  claude: "Claude Code",
  gemini: "Gemini",
};

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
    reasoningEffort: "low",
  },
  gemini: {
    id: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    shortName: "Flash",
    reasoningEffort: "low",
  },
} as const;

// Gemini levels apply to Antigravity CLI (agy); the @google/gemini-cli fallback ignores effort.
export const EFFORT_LEVELS: Readonly<Record<ProviderId, readonly string[]>> = {
  codex: ["low", "medium", "high", "xhigh", "max", "ultra"],
  claude: ["low", "medium", "high", "xhigh", "max"],
  gemini: ["low", "medium", "high", "xhigh", "max"],
};

// Alias sent to @google/gemini-cli when the Antigravity default model is selected.
export const GEMINI_CLI_DEFAULT_MODEL = "flash";

export interface ModelOption {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly defaultEffort?: string;
  readonly efforts?: readonly string[];
}

export const STATIC_MODELS: Readonly<Record<"claude" | "gemini", readonly ModelOption[]>> = {
  claude: [
    { id: "sonnet", displayName: "Sonnet", description: "Alias do Sonnet mais recente" },
    { id: "opus", displayName: "Opus", description: "Alias do Opus mais recente" },
    { id: "haiku", displayName: "Haiku", description: "Alias do Haiku mais recente" },
    { id: "fable", displayName: "Fable", description: "Alias do Fable mais recente" },
  ],
  // Used only with @google/gemini-cli; Antigravity CLI lists its own models.
  gemini: [
    { id: "pro", displayName: "Gemini Pro", description: "Alias do Pro mais recente" },
    { id: "flash-lite", displayName: "Gemini Flash Lite", description: "Alias do Flash Lite" },
    { id: "auto", displayName: "Auto", description: "Seleção automática do Gemini CLI" },
  ],
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function supportsEffort(provider: ProviderId): boolean {
  return EFFORT_LEVELS[provider].length > 0;
}

export function getDefaultModel(provider: ProviderId): string {
  return DEFAULT_MODELS[provider].id;
}

export function getDefaultEffort(provider: ProviderId): string | undefined {
  return DEFAULT_MODELS[provider].reasoningEffort;
}

export function getEffectiveModel(provider: ProviderId, override: string): string {
  return override.trim() || getDefaultModel(provider);
}

// Setting value to store after picking `model` so the effective effort stays one the model supports;
// undefined keeps the current setting.
export function effortAfterModelChange(
  provider: ProviderId,
  override: string,
  model: ModelOption | undefined,
): string | undefined {
  const efforts = model?.efforts?.filter((effort) => EFFORT_LEVELS[provider].includes(effort));
  const defaultEffort = getDefaultEffort(provider);
  const effective = override || defaultEffort;
  if (!efforts?.length || effective === undefined || efforts.includes(effective)) return undefined;
  if (defaultEffort !== undefined && efforts.includes(defaultEffort)) return "";
  return model?.defaultEffort !== undefined && efforts.includes(model.defaultEffort) ? model.defaultEffort : efforts[0];
}

export function getEffectiveEffort(provider: ProviderId, override: string): string | undefined {
  if (!supportsEffort(provider)) return undefined;
  return override.trim() || getDefaultEffort(provider);
}
