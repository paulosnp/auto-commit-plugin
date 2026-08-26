import { Buffer } from "node:buffer";

import { CavemanCommitError } from "../errors";
import type { CancellationLike, ProcessRunner } from "../process/runProcess";

export interface GitClientOptions {
  readonly timeoutMs?: number;
  readonly cancellation?: CancellationLike;
}

const DEFAULT_GIT_TIMEOUT = 30_000;

function gitError(code: string, message: string, stderr: string): CavemanCommitError {
  const detail = stderr.trim();
  return new CavemanCommitError(
    code,
    detail.length > 0 ? `${message} ${detail}` : message,
  );
}

export async function getStagedDiff(
  run: ProcessRunner,
  repositoryPath: string,
  options: GitClientOptions = {},
): Promise<string> {
  let result;
  try {
    result = await run(
      "git",
      [
        "-C",
        repositoryPath,
        "-c",
        "core.quotepath=false",
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
      ],
      {
        cwd: repositoryPath,
        timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT,
        cancellation: options.cancellation,
      },
    );
  } catch (error) {
    if (error instanceof CavemanCommitError && error.code === "PROCESS_NOT_FOUND") {
      throw new CavemanCommitError("GIT_NOT_FOUND", "Git não está instalado ou não está no PATH.", {
        cause: error,
      });
    }
    throw error;
  }

  if (result.exitCode !== 0) {
    throw gitError("GIT_DIFF_FAILED", "Falha ao obter git diff.", result.stderr);
  }
  return result.stdout;
}

export async function commitMessage(
  run: ProcessRunner,
  repositoryPath: string,
  message: string,
  options: GitClientOptions = {},
): Promise<void> {
  const result = await run(
    "git",
    ["-C", repositoryPath, "commit", "--cleanup=verbatim", "-F", "-"],
    {
      cwd: repositoryPath,
      input: message,
      timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT,
      cancellation: options.cancellation,
    },
  );
  if (result.exitCode !== 0) {
    throw gitError("GIT_COMMIT_FAILED", "Falha ao executar git commit.", result.stderr);
  }
}

export function diffSizeInBytes(diff: string): number {
  return Buffer.byteLength(diff, "utf8");
}

export function isLargeDiff(diff: string, maxDiffSize: number): boolean {
  return diffSizeInBytes(diff) > maxDiffSize;
}
