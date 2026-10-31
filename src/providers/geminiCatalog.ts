import { STATIC_MODELS, type ModelOption } from "../config/models";
import type { CancellationLike } from "../process/runProcess";
import type { ProviderDependencies } from "./provider";

const VARIANT = /^(.+)-(low|medium|high|xhigh|max)$/;
const VARIANT_LABEL = /\s*\((?:low|medium|high|xhigh|max)\)\s*$/i;

// `agy models` prints one "<id>\t<name>" per effort variant; group them under the base id,
// which agy accepts together with --effort.
export function parseAgyModels(output: string): ModelOption[] {
  const models = new Map<string, { displayName: string; efforts: string[] }>();
  for (const line of output.split(/\r?\n/)) {
    const [rawId, rawName] = line.split("\t");
    const id = rawId?.trim();
    if (!id || rawName === undefined || /\s/.test(id)) continue;
    const variant = VARIANT.exec(id);
    const base = variant?.[1] ?? id;
    const entry = models.get(base) ?? { displayName: rawName.replace(VARIANT_LABEL, "").trim() || base, efforts: [] };
    if (variant?.[2] !== undefined && !entry.efforts.includes(variant[2])) entry.efforts.push(variant[2]);
    models.set(base, entry);
  }
  return [...models].map(([id, { displayName, efforts }]) => ({ id, displayName, efforts }));
}

export async function listGeminiModels(
  dependencies: ProviderDependencies,
  cwd: string,
  cancellation?: CancellationLike,
): Promise<ModelOption[]> {
  try {
    const executable = dependencies.resolveExecutable?.("gemini");
    if (executable?.cli !== "agy") return [...STATIC_MODELS.gemini];
    const result = await dependencies.run(
      executable.command,
      [...executable.prefixArgs, "models"],
      { cwd, timeoutMs: 15_000, cancellation },
    );
    if (result.exitCode !== 0) {
      dependencies.logger?.log(`Catálogo do agy indisponível; exit code ${result.exitCode}.`);
      return [];
    }
    return parseAgyModels(result.stdout);
  } catch (error) {
    dependencies.logger?.log(`Catálogo do Gemini indisponível: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
