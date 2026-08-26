import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import { resolveCommand } from "../src/process/resolveCommand";

test("resolve shim npm do Codex para Node.js sem shell", async () => {
  const directory = await mkdtemp(join(tmpdir(), "caveman-shim-"));
  try {
    const script = join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
    await mkdir(join(script, ".."), { recursive: true });
    await writeFile(script, "", "utf8");
    await writeFile(join(directory, "node.exe"), "", "utf8");
    await writeFile(join(directory, "codex"), "shim Unix", "utf8");
    await writeFile(
      join(directory, "codex.cmd"),
      '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
      "utf8",
    );

    const resolved = resolveCommand("codex", { PATH: directory }, "win32");
    assert.equal(resolved.command, join(directory, "node.exe"));
    assert.deepEqual(resolved.prefixArgs, [script]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejeita shim Windows desconhecido em vez de ativar shell", async () => {
  const directory = await mkdtemp(join(tmpdir(), "caveman-shim-"));
  try {
    await writeFile(join(directory, "codex.cmd"), "@echo off\necho inseguro", "utf8");
    assert.throws(
      () => resolveCommand("codex", { PATH: directory }, "win32"),
      (error: unknown) =>
        error instanceof CavemanCommitError &&
        error.code === "UNSUPPORTED_WINDOWS_SHIM",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mantém resolução nativa em Unix", () => {
  assert.deepEqual(resolveCommand("codex", {}, "linux"), {
    command: "codex",
    prefixArgs: [],
  });
});
