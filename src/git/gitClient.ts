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

async function runGitDiff(
  run: ProcessRunner,
  repositoryPath: string,
  args: readonly string[],
  options: GitClientOptions = {},
): Promise<string> {
  let result;
  try {
    result = await run(
      "git",
      ["-C", repositoryPath, "-c", "core.quotepath=false", ...args],
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
    throw gitError(
      "GIT_DIFF_FAILED",
      "Falha ao obter alterações locais do Git.",
      result.stderr,
    );
  }
  return result.stdout;
}

export async function getStagedDiff(
  run: ProcessRunner,
  repositoryPath: string,
  options: GitClientOptions = {},
): Promise<string> {
  return runGitDiff(
    run,
    repositoryPath,
    ["diff", "--cached", "--no-ext-diff", "--no-textconv"],
    options,
  );
}

async function listUntrackedFiles(
  run: ProcessRunner,
  repositoryPath: string,
  options: GitClientOptions,
): Promise<string[]> {
  const result = await run(
    "git",
    ["-C", repositoryPath, "ls-files", "--others", "--exclude-standard", "-z"],
    {
      cwd: repositoryPath,
      timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT,
      cancellation: options.cancellation,
    },
  );
  if (result.exitCode !== 0) {
    throw gitError(
      "GIT_DIFF_FAILED",
      "Falha ao listar arquivos locais do Git.",
      result.stderr,
    );
  }
  return result.stdout.split("\0").filter((path) => path.length > 0);
}

async function diffUntrackedFile(
  run: ProcessRunner,
  repositoryPath: string,
  relativePath: string,
  options: GitClientOptions,
): Promise<string> {
  const result = await run(
    "git",
    [
      "-C",
      repositoryPath,
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--",
      "/dev/null",
      relativePath,
    ],
    {
      cwd: repositoryPath,
      timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT,
      cancellation: options.cancellation,
    },
  );
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw gitError(
      "GIT_DIFF_FAILED",
      `Falha ao analisar arquivo local: ${relativePath}.`,
      result.stderr,
    );
  }
  return result.stdout;
}

export async function getLocalChangesDiff(
  run: ProcessRunner,
  repositoryPath: string,
  options: GitClientOptions = {},
): Promise<string> {
  const tracked = await runGitDiff(
    run,
    repositoryPath,
    ["diff", "HEAD", "--no-ext-diff", "--no-textconv"],
    options,
  ).catch(async (error: unknown) => {
    if (!(error instanceof CavemanCommitError) || error.code !== "GIT_DIFF_FAILED") {
      throw error;
    }
    const staged = await getStagedDiff(run, repositoryPath, options);
    const unstaged = await runGitDiff(
      run,
      repositoryPath,
      ["diff", "--no-ext-diff", "--no-textconv"],
      options,
    );
    return `${staged}\n${unstaged}`.trim();
  });

  const untrackedFiles = await listUntrackedFiles(run, repositoryPath, options);
  const untrackedDiffs: string[] = [];
  for (const relativePath of untrackedFiles) {
    untrackedDiffs.push(
      await diffUntrackedFile(run, repositoryPath, relativePath, options),
    );
  }
  return [tracked, ...untrackedDiffs]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function diffSizeInBytes(diff: string): number {
  return Buffer.byteLength(diff, "utf8");
}

export function isLargeDiff(diff: string, maxDiffSize: number): boolean {
  return diffSizeInBytes(diff) > maxDiffSize;
}
