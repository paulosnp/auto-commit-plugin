import assert from "node:assert/strict";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import {
  runProcess,
  type CancellationLike,
  type DisposableLike,
} from "../src/process/runProcess";

class TestCancellation implements CancellationLike {
  public isCancellationRequested = false;
  private listener: (() => void) | undefined;

  public onCancellationRequested(listener: () => void): DisposableLike {
    this.listener = listener;
    return { dispose: () => (this.listener = undefined) };
  }

  public cancel(): void {
    this.isCancellationRequested = true;
    this.listener?.();
  }
}

test("runner transmite stdin sem shell", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    { input: "áspas \" '$()", timeoutMs: 5_000 },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "áspas \" '$()");
});

test("runner encerra por timeout", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      timeoutMs: 30,
    }),
    (error: unknown) =>
      error instanceof CavemanCommitError && error.code === "PROCESS_TIMEOUT",
  );
});

test("runner encerra por cancelamento", async () => {
  const cancellation = new TestCancellation();
  const pending = runProcess(
    process.execPath,
    ["-e", "setTimeout(() => {}, 10000)"],
    { timeoutMs: 5_000, cancellation },
  );
  setTimeout(() => cancellation.cancel(), 30);
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof CavemanCommitError && error.code === "OPERATION_CANCELLED",
  );
});

test("runner identifica executável inexistente", async () => {
  await assert.rejects(
    runProcess("caveman-commit-inexistente", [], { timeoutMs: 1_000 }),
    (error: unknown) =>
      error instanceof CavemanCommitError && error.code === "PROCESS_NOT_FOUND",
  );
});
