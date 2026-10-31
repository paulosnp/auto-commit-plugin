import { CavemanCommitError } from "../errors";
import { DEFAULT_MODELS } from "../config/models";
import {
  COMMIT_SYSTEM_PROMPT,
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

export class ClaudeProvider implements CommitProvider {
  public readonly id = "claude" as const;

  public constructor(private readonly dependencies: ProviderDependencies) {}

  public async generateCommit(
    prompt: string,
    options: CommitGenerationOptions,
  ): Promise<string> {
    const { run } = await prepareProviderCli(this.dependencies, this.id, options);

    const args = [
      "--print",
      "--model",
      options.model,
      "--effort",
      options.reasoningEffort ?? DEFAULT_MODELS.claude.reasoningEffort,
      "--system-prompt",
      COMMIT_SYSTEM_PROMPT,
      "--no-session-persistence",
      "--safe-mode",
      "--disable-slash-commands",
      "--tools",
      "",
      "--output-format",
      "text",
    ];
    const startedAt = Date.now();
    const result = await run("claude", args, {
      cwd: options.cwd,
      input: prompt,
      timeoutMs: options.timeoutMs,
      cancellation: options.cancellation,
    });
    this.dependencies.logger?.log(
      `Claude finalizado em ${Date.now() - startedAt} ms; exit code ${result.exitCode}.`,
    );

    if (result.exitCode !== 0) {
      const diagnostic = `${result.stderr}\n${result.stdout}`;
      if (looksLikeAuthenticationError(diagnostic)) {
        this.dependencies.logger?.log(
          "Claude: autenticação ausente, inválida ou expirada. Execute claude auth login.",
        );
        throw new CavemanCommitError(
          "CLAUDE_NOT_AUTHENTICATED",
          "Autenticação do Claude Code ausente, inválida ou expirada. Execute claude auth login.",
        );
      }
      if (
        options.model === DEFAULT_MODELS.claude.id &&
        looksLikeUnavailableModel(diagnostic)
      ) {
        throw new CavemanCommitError(
          "DEFAULT_MODEL_UNAVAILABLE",
          `O modelo ${DEFAULT_MODELS.claude.displayName} não está disponível na instalação atual do Claude Code.`,
        );
      }
      throw new CavemanCommitError(
        "CLAUDE_FAILED",
        conciseCliFailure("Claude Code CLI", result.exitCode),
      );
    }
    return result.stdout;
  }
}
