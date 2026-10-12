import { CavemanCommitError } from "../errors";
import { DEFAULT_MODELS } from "../config/models";
import {
  conciseCliFailure,
  looksLikeAuthenticationError,
  looksLikeUnavailableModel,
  prepareProviderCli,
} from "./helpers";
import type {
  CommitGenerationOptions,
  CommitProvider,
  ProviderDependencies,
} from "./provider";

export class CodexProvider implements CommitProvider {
  public readonly id = "codex" as const;

  public constructor(private readonly dependencies: ProviderDependencies) {}

  public async generateCommit(
    prompt: string,
    options: CommitGenerationOptions,
  ): Promise<string> {
    if (options.reasoningEffort !== "medium") {
      throw new CavemanCommitError(
        "INVALID_REASONING_EFFORT",
        "Reasoning effort inválido. Use medium.",
      );
    }
    const run = await prepareProviderCli(this.dependencies, this.id, options);

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--strict-config",
      "--model",
      options.model,
      "--config",
      'model_reasoning_effort="medium"',
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "-",
    ];
    const startedAt = Date.now();
    const result = await run("codex", args, {
      cwd: options.cwd,
      input: prompt,
      timeoutMs: options.timeoutMs,
      cancellation: options.cancellation,
    });
    this.dependencies.logger?.log(
      `Codex finalizado em ${Date.now() - startedAt} ms; exit code ${result.exitCode}.`,
    );

    if (result.exitCode !== 0) {
      const diagnostic = `${result.stderr}\n${result.stdout}`;
      if (looksLikeAuthenticationError(diagnostic)) {
        throw new CavemanCommitError(
          "CODEX_NOT_AUTHENTICATED",
          "Codex CLI não está autenticado. Execute codex login.",
        );
      }
      if (
        options.model === DEFAULT_MODELS.codex.id &&
        looksLikeUnavailableModel(diagnostic)
      ) {
        throw new CavemanCommitError(
          "DEFAULT_MODEL_UNAVAILABLE",
          "O modelo GPT-5.6 Terra não está disponível na instalação atual do Codex.",
        );
      }
      throw new CavemanCommitError(
        "CODEX_FAILED",
        conciseCliFailure("Codex CLI", result.exitCode),
      );
    }
    return result.stdout;
  }
}
