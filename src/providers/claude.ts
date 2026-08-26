import { CavemanCommitError } from "../errors";
import { DEFAULT_MODELS } from "../config/models";
import {
  conciseCliFailure,
  looksLikeAuthenticationError,
  looksLikeUnavailableModel,
  verifyCli,
} from "./helpers";
import type {
  CommitGenerationOptions,
  CommitProvider,
  ProviderDependencies,
} from "./provider";

export class ClaudeProvider implements CommitProvider {
  public readonly id = "claude" as const;
  private verified = false;

  public constructor(private readonly dependencies: ProviderDependencies) {}

  public async generateCommit(
    prompt: string,
    options: CommitGenerationOptions,
  ): Promise<string> {
    if (!this.verified) {
      await verifyCli(
        this.dependencies.run,
        "claude",
        options.cwd,
        options.timeoutMs,
        "Claude Code CLI não foi encontrado no PATH.",
        options.cancellation,
      );
      this.verified = true;
    }

    const args = [
      "--print",
      "--model",
      options.model,
      "--no-session-persistence",
      "--safe-mode",
      "--disable-slash-commands",
      "--tools",
      "",
      "--output-format",
      "text",
    ];
    const startedAt = Date.now();
    const result = await this.dependencies.run("claude", args, {
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
        throw new CavemanCommitError(
          "CLAUDE_NOT_AUTHENTICATED",
          "Claude Code CLI não está autenticado. Execute claude e faça login.",
        );
      }
      if (
        options.model === DEFAULT_MODELS.claude.id &&
        looksLikeUnavailableModel(diagnostic)
      ) {
        throw new CavemanCommitError(
          "DEFAULT_MODEL_UNAVAILABLE",
          "O modelo Claude Sonnet 5 não está disponível na instalação atual do Claude Code.",
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
