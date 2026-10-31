import type { ModelOption } from "../config/models";
import type { CancellationLike } from "../process/runProcess";
import type { ProviderDependencies } from "./provider";

interface RawReasoningLevel {
  readonly effort?: unknown;
}

interface RawModel {
  readonly slug?: unknown;
  readonly display_name?: unknown;
  readonly description?: unknown;
  readonly visibility?: unknown;
  readonly default_reasoning_level?: unknown;
  readonly supported_reasoning_levels?: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseCodexModels(output: string): ModelOption[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  const models = Array.isArray(parsed)
    ? parsed
    : (parsed as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];
  return (models as RawModel[]).flatMap((model) => {
    const id = text(model.slug);
    if (id === undefined || model.visibility !== "list") return [];
    const levels = Array.isArray(model.supported_reasoning_levels)
      ? (model.supported_reasoning_levels as RawReasoningLevel[])
      : [];
    return [{
      id,
      displayName: text(model.display_name) ?? id,
      description: text(model.description),
      defaultEffort: text(model.default_reasoning_level),
      efforts: levels.flatMap((level) => text(level.effort) ?? []),
    }];
  });
}

export async function listCodexModels(
  dependencies: ProviderDependencies,
  cwd: string,
  cancellation?: CancellationLike,
): Promise<ModelOption[]> {
  try {
    const executable = dependencies.resolveExecutable?.("codex") ?? {
      command: "codex", prefixArgs: [], source: "PATH",
    };
    const result = await dependencies.run(
      executable.command,
      [...executable.prefixArgs, "debug", "models"],
      { cwd, timeoutMs: 10_000, cancellation },
    );
    if (result.exitCode !== 0) {
      dependencies.logger?.log(`Catálogo do Codex indisponível; exit code ${result.exitCode}.`);
      return [];
    }
    return parseCodexModels(result.stdout);
  } catch (error) {
    dependencies.logger?.log(`Catálogo do Codex indisponível: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
