import { CavemanCommitError } from "../errors";
import { DEFAULT_MODELS, GEMINI_CLI_DEFAULT_MODEL } from "../config/models";
import type { ProcessResult, ProcessRunner } from "../process/runProcess";
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

// Headless agy auto-denies anything needing a prompt; these rules also deny what it would allow silently.
const AGY_SETTINGS = JSON.stringify({
  permissions: { deny: ["command(*)", "read_file(*)", "write_file(*)", "read_url(*)", "mcp(*)"] },
});

// agy rejects --effort for model IDs that already pin an effort, e.g. gemini-3.8-flash-low.
const EFFORT_SUFFIX = /-(?:low|medium|high|xhigh|max)$/;

interface AgyResult {
  readonly status?: unknown;
  readonly response?: unknown;
  readonly error?: unknown;
}

function agyResult(stdout: string): AgyResult | undefined {
  let result: AgyResult | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as { event?: unknown; result?: AgyResult };
      if (event.event === "result" && typeof event.result === "object") result = event.result;
    } catch {
      // Ignore non-JSON diagnostics interleaved with the NDJSON stream.
    }
  }
  return result;
}

export class GeminiProvider implements CommitProvider {
  public readonly id = "gemini" as const;

  public constructor(private readonly dependencies: ProviderDependencies) {}

  public async generateCommit(
    prompt: string,
    options: CommitGenerationOptions,
  ): Promise<string> {
    const { run, executable } = await prepareProviderCli(this.dependencies, this.id, options);
    return executable.cli === "agy"
      ? this.generateWithAgy(run, prompt, options)
      : this.generateWithGeminiCli(run, prompt, options);
  }

  private async generateWithAgy(
    run: ProcessRunner,
    prompt: string,
    options: CommitGenerationOptions,
  ): Promise<string> {
    const effort = options.reasoningEffort;
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--disable-slash-commands",
      "--sandbox",
      `--settings=${AGY_SETTINGS}`,
      `--model=${options.model}`,
      ...(effort === undefined || EFFORT_SUFFIX.test(options.model) ? [] : [`--effort=${effort}`]),
    ];
    // agy has no system-prompt flag and reads stdin only as stream-json messages.
    const input = `${JSON.stringify({
      event: "user",
      message: { content: `${COMMIT_SYSTEM_PROMPT}\n\n${prompt}` },
    })}\n`;
    const result = await this.execute(run, args, input, options, "agy");
    const parsed = agyResult(result.stdout);
    if (result.exitCode === 0 && parsed?.status === "SUCCESS" && typeof parsed.response === "string") {
      return parsed.response;
    }
    const error = typeof parsed?.error === "string" ? parsed.error : "";
    this.fail(`${error}\n${result.stderr}`, options, "Antigravity CLI", result.exitCode);
  }

  private async generateWithGeminiCli(
    run: ProcessRunner,
    prompt: string,
    options: CommitGenerationOptions,
  ): Promise<string> {
    const model = options.model === DEFAULT_MODELS.gemini.id ? GEMINI_CLI_DEFAULT_MODEL : options.model;
    if (options.reasoningEffort !== undefined) {
      this.dependencies.logger?.log("Gemini CLI não suporta effort; valor ignorado.");
    }
    // Gemini CLI has no system-prompt flag; --prompt is appended to stdin and forces headless mode.
    const args = [
      "--model",
      model,
      "--output-format",
      "text",
      "--approval-mode",
      "plan",
      "--extensions",
      "none",
      "--skip-trust",
      "--prompt",
      COMMIT_SYSTEM_PROMPT,
    ];
    const result = await this.execute(run, args, prompt, options, "Gemini CLI");
    if (result.exitCode === 0) return result.stdout;
    this.fail(`${result.stderr}\n${result.stdout}`, options, "Gemini CLI", result.exitCode);
  }

  private async execute(
    run: ProcessRunner,
    args: readonly string[],
    input: string,
    options: CommitGenerationOptions,
    label: string,
  ): Promise<ProcessResult> {
    const startedAt = Date.now();
    const result = await run("gemini", args, {
      cwd: options.cwd,
      input,
      timeoutMs: options.timeoutMs,
      cancellation: options.cancellation,
    });
    this.dependencies.logger?.log(
      `${label} finalizado em ${Date.now() - startedAt} ms; exit code ${result.exitCode}.`,
    );
    return result;
  }

  private fail(
    diagnostic: string,
    options: CommitGenerationOptions,
    command: string,
    exitCode: number,
  ): never {
    // ponytail: CLI errors here are short and never echo the prompt; truncate in case that changes.
    this.dependencies.logger?.log(`${command}: ${diagnostic.trim().slice(0, 500)}`);
    if (looksLikeAuthenticationError(diagnostic)) {
      throw new CavemanCommitError(
        "GEMINI_NOT_AUTHENTICATED",
        `${command} não está autenticado. Execute-o no terminal para entrar.`,
      );
    }
    if (
      options.model === DEFAULT_MODELS.gemini.id &&
      looksLikeUnavailableModel(diagnostic)
    ) {
      throw new CavemanCommitError(
        "DEFAULT_MODEL_UNAVAILABLE",
        `O modelo ${DEFAULT_MODELS.gemini.displayName} não está disponível na instalação atual do ${command}.`,
      );
    }
    const effort = /has no "([^"]+)" effort \(available: ([^)]+)\)/.exec(diagnostic);
    if (effort !== null) {
      throw new CavemanCommitError(
        "INVALID_REASONING_EFFORT",
        `O modelo ${options.model} não suporta effort ${effort[1]} (disponíveis: ${effort[2]}). Ajuste em Caveman Commit: Select Effort.`,
      );
    }
    if (looksLikeUnavailableModel(diagnostic) || /invalid model selection/i.test(diagnostic)) {
      throw new CavemanCommitError(
        "MODEL_UNAVAILABLE",
        `O modelo ${options.model} não está disponível no ${command}. Escolha outro em Caveman Commit: Select Model.`,
      );
    }
    throw new CavemanCommitError(
      "GEMINI_FAILED",
      conciseCliFailure(command, exitCode),
    );
  }
}
