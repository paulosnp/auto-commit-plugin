import type { CancellationLike, ProcessRunner } from "../process/runProcess";

export interface CommitGenerationOptions {
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly cancellation?: CancellationLike;
}

export interface ProviderLogger {
  log(message: string): void;
}

export interface CommitProvider {
  readonly id: "codex" | "claude";
  generateCommit(
    prompt: string,
    options: CommitGenerationOptions,
  ): Promise<string>;
}

export interface ProviderDependencies {
  readonly run: ProcessRunner;
  readonly logger?: ProviderLogger;
}
