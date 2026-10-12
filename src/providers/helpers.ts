import { CavemanCommitError } from "../errors";
import type { CancellationLike, ProcessRunner } from "../process/runProcess";
import type { ProviderId } from "../config/models";
import { missingProviderMessage } from "../process/providerExecutable";
import type { CommitGenerationOptions, ProviderDependencies } from "./provider";

export async function prepareProviderCli(
  dependencies: ProviderDependencies,
  provider: ProviderId,
  options: CommitGenerationOptions,
): Promise<ProcessRunner> {
  const executable = dependencies.resolveExecutable?.(provider) ?? {
    command: provider, prefixArgs: [], source: "PATH",
  };
  // Keep version verification and generation on the same executable; never retry on another source.
  const run: ProcessRunner = (_command, args, processOptions) =>
    dependencies.run(executable.command, [...executable.prefixArgs, ...args], processOptions);
  const version = await verifyCli(run, provider, options.cwd, options.timeoutMs,
    missingProviderMessage(provider), options.cancellation);
  dependencies.logger?.log(`Executável ${provider}: ${executable.source}; versão ${version}.`);
  return run;
}

export async function verifyCli(
  run: ProcessRunner,
  command: string,
  cwd: string,
  timeoutMs: number,
  notFoundMessage: string,
  cancellation?: CancellationLike,
): Promise<string> {
  try {
    const result = await run(command, ["--version"], {
      cwd,
      timeoutMs: Math.min(timeoutMs, 10_000),
      cancellation,
    });
    if (result.exitCode !== 0) {
      throw new CavemanCommitError("CLI_CHECK_FAILED", notFoundMessage);
    }
    return result.stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? "desconhecida";
  } catch (error) {
    if (error instanceof CavemanCommitError && error.code !== "PROCESS_NOT_FOUND") {
      throw error;
    }
    throw new CavemanCommitError("CLI_NOT_FOUND", notFoundMessage, {
      cause: error,
    });
  }
}

export function looksLikeUnavailableModel(stderr: string): boolean {
  return /model.{0,40}(not found|unavailable|does not exist|unsupported|invalid)|unknown model/i.test(
    stderr,
  );
}

export function looksLikeAuthenticationError(output: string): boolean {
  return /not logged in|please (?:run|use).{0,20}(?:login|\/login)|authentication required|unauthorized|status.?401|failed to authenticate|oauth.{0,40}(?:expired|revoked)|(?:access|refresh) token.{0,30}(?:expired|invalid|revoked)|(?:could not|failed to|unable to) refresh/i.test(
    output,
  );
}

export function conciseCliFailure(command: string, exitCode: number): string {
  return `${command} encerrou com exit code ${exitCode}. Consulte Output → Caveman Commit.`;
}
