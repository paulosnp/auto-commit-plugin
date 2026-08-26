import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { CavemanCommitError } from "../errors";
import { resolveCommand, type ResolvedCommand } from "./resolveCommand";

export interface DisposableLike {
  dispose(): void;
}

export interface CancellationLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): DisposableLike;
}

export interface ProcessOptions {
  readonly cwd?: string;
  readonly input?: string;
  readonly timeoutMs: number;
  readonly cancellation?: CancellationLike;
}

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: ProcessOptions,
) => Promise<ProcessResult>;

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true, shell: false },
    );
    killer.once("error", () => child.kill());
    killer.once("close", (code) => {
      if (code !== 0) {
        child.kill();
      }
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const forceKill = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 1_000);
  forceKill.unref();
}

export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise<ProcessResult>((resolve, reject) => {
    let resolvedCommand: ResolvedCommand;
    try {
      resolvedCommand = resolveCommand(command);
    } catch (error) {
      reject(error);
      return;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        resolvedCommand.command,
        [...resolvedCommand.prefixArgs, ...args],
        {
        cwd: options.cwd,
        detached: process.platform !== "win32",
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (error) {
      reject(
        new CavemanCommitError(
          "PROCESS_LAUNCH_FAILED",
          `Não foi possível iniciar ${command}.`,
          { cause: error },
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const cancellationRegistration: { current?: DisposableLike } = {};
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      terminateProcessTree(child);
      cancellationRegistration.current?.dispose();
      reject(
        new CavemanCommitError(
          "PROCESS_TIMEOUT",
          "A geração da mensagem excedeu o tempo limite.",
        ),
      );
    }, options.timeoutMs);

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      cancellationRegistration.current?.dispose();
      callback();
    };

    cancellationRegistration.current = options.cancellation?.onCancellationRequested(
      () => {
        finish(() => {
          terminateProcessTree(child);
          reject(
            new CavemanCommitError(
              "OPERATION_CANCELLED",
              "Operação cancelada.",
            ),
          );
        });
      },
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() => {
        const code = error.code === "ENOENT" ? "PROCESS_NOT_FOUND" : "PROCESS_FAILED";
        reject(
          new CavemanCommitError(code, `Não foi possível iniciar ${command}.`, {
            cause: error,
          }),
        );
      });
    });
    child.on("close", (code) => {
      finish(() => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    });

    if (options.cancellation?.isCancellationRequested === true) {
      finish(() => {
        terminateProcessTree(child);
        reject(
          new CavemanCommitError("OPERATION_CANCELLED", "Operação cancelada."),
        );
      });
      return;
    }

    child.stdin.on("error", () => {
      // O processo pode encerrar antes de consumir stdin; close preserva o erro real.
    });
    child.stdin.end(options.input ?? "");
  });
