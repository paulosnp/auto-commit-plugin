import { CavemanCommitError } from "../errors";
import type { CancellationLike, ProcessRunner } from "../process/runProcess";

export async function verifyCli(
  run: ProcessRunner,
  command: string,
  cwd: string,
  timeoutMs: number,
  notFoundMessage: string,
  cancellation?: CancellationLike,
): Promise<void> {
  try {
    const result = await run(command, ["--version"], {
      cwd,
      timeoutMs: Math.min(timeoutMs, 10_000),
      cancellation,
    });
    if (result.exitCode !== 0) {
      throw new CavemanCommitError("CLI_CHECK_FAILED", notFoundMessage);
    }
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
  return /not logged in|please (?:run|use).{0,20}(?:login|\/login)|authentication required|unauthorized|status.?401/i.test(
    output,
  );
}

export function conciseCliFailure(command: string, exitCode: number): string {
  return `${command} encerrou com exit code ${exitCode}. Consulte Output → Caveman Commit.`;
}
