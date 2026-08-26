import assert from "node:assert/strict";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import type {
  ProcessOptions,
  ProcessResult,
  ProcessRunner,
} from "../src/process/runProcess";
import { ClaudeProvider } from "../src/providers/claude";
import { CodexProvider } from "../src/providers/codex";

interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ProcessOptions;
}

function scriptedRunner(
  results: readonly ProcessResult[],
  invocations: Invocation[],
): ProcessRunner {
  let index = 0;
  return async (command, args, options) => {
    invocations.push({ command, args, options });
    const result = results[index];
    index += 1;
    if (result === undefined) {
      throw new Error("Resultado de mock ausente");
    }
    return result;
  };
}

const options = {
  model: "gpt-5.6-terra",
  reasoningEffort: "medium",
  cwd: process.cwd(),
  timeoutMs: 60_000,
} as const;

test("Codex usa Terra, medium, stdin, sessão efêmera e read-only", async () => {
  const invocations: Invocation[] = [];
  const provider = new CodexProvider({
    run: scriptedRunner(
      [
        { stdout: "codex-cli 1", stderr: "", exitCode: 0 },
        {
          stdout: "feat(auth): adicionar token\n",
          stderr: "",
          exitCode: 0,
        },
      ],
      invocations,
    ),
  });
  const result = await provider.generateCommit("PROMPT", options);
  assert.equal(result.trim(), "feat(auth): adicionar token");
  const call = invocations[1];
  assert.ok(call);
  assert.equal(call.command, "codex");
  assert.deepEqual(call.args, [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--strict-config",
    "--model",
    "gpt-5.6-terra",
    "--config",
    'model_reasoning_effort="medium"',
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "-",
  ]);
  assert.equal(call.options.input, "PROMPT");
});

test("Codex rejeita reasoning diferente de medium", async () => {
  const provider = new CodexProvider({
    run: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  });
  await assert.rejects(
    provider.generateCommit("prompt", { ...options, reasoningEffort: "high" }),
    (error: unknown) =>
      error instanceof CavemanCommitError &&
      error.code === "INVALID_REASONING_EFFORT",
  );
});

test("Claude usa Sonnet 5 sem ferramentas nem persistência", async () => {
  const invocations: Invocation[] = [];
  const provider = new ClaudeProvider({
    run: scriptedRunner(
      [
        { stdout: "2.1", stderr: "", exitCode: 0 },
        { stdout: "fix(auth): corrigir token", stderr: "", exitCode: 0 },
      ],
      invocations,
    ),
  });
  await provider.generateCommit("PROMPT", {
    ...options,
    model: "claude-sonnet-5",
    reasoningEffort: undefined,
  });
  const call = invocations[1];
  assert.ok(call);
  assert.equal(call.command, "claude");
  assert.deepEqual(call.args, [
    "--print",
    "--model",
    "claude-sonnet-5",
    "--no-session-persistence",
    "--safe-mode",
    "--disable-slash-commands",
    "--tools",
    "",
    "--output-format",
    "text",
  ]);
  assert.equal(call.options.input, "PROMPT");
});

test("mapeia CLI inexistente", async () => {
  const missing: ProcessRunner = async () => {
    throw new CavemanCommitError("PROCESS_NOT_FOUND", "missing");
  };
  await assert.rejects(
    new CodexProvider({ run: missing }).generateCommit("prompt", options),
    (error: unknown) =>
      error instanceof CavemanCommitError &&
      error.userMessage === "Codex CLI não foi encontrado no PATH.",
  );
  await assert.rejects(
    new ClaudeProvider({ run: missing }).generateCommit("prompt", {
      ...options,
      model: "claude-sonnet-5",
    }),
    (error: unknown) =>
      error instanceof CavemanCommitError &&
      error.userMessage === "Claude Code CLI não foi encontrado no PATH.",
  );
});

test("informa indisponibilidade dos modelos padrão sem fallback", async () => {
  const unavailable = scriptedRunner(
    [
      { stdout: "version", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "model not found", exitCode: 1 },
    ],
    [],
  );
  await assert.rejects(
    new CodexProvider({ run: unavailable }).generateCommit("prompt", options),
    (error: unknown) =>
      error instanceof CavemanCommitError &&
      error.code === "DEFAULT_MODEL_UNAVAILABLE",
  );

  const claudeUnavailable = scriptedRunner(
    [
      { stdout: "version", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "unknown model", exitCode: 1 },
    ],
    [],
  );
  await assert.rejects(
    new ClaudeProvider({ run: claudeUnavailable }).generateCommit("prompt", {
      ...options,
      model: "claude-sonnet-5",
    }),
    (error: unknown) =>
      error instanceof CavemanCommitError &&
      error.code === "DEFAULT_MODEL_UNAVAILABLE",
  );
});

test("informa autenticação ausente sem expor saída do CLI", async () => {
  const run = scriptedRunner(
    [
      { stdout: "version", stderr: "", exitCode: 0 },
      {
        stdout: "Not logged in · Please run /login",
        stderr: "",
        exitCode: 1,
      },
    ],
    [],
  );
  await assert.rejects(
    new ClaudeProvider({ run }).generateCommit("prompt", {
      ...options,
      model: "claude-sonnet-5",
    }),
    (error: unknown) =>
      error instanceof CavemanCommitError &&
      error.code === "CLAUDE_NOT_AUTHENTICATED",
  );
});

test("propaga timeout e cancelamento do runner", async () => {
  for (const code of ["PROCESS_TIMEOUT", "OPERATION_CANCELLED"]) {
    let invocation = 0;
    const run: ProcessRunner = async () => {
      invocation += 1;
      if (invocation === 1) {
        return { stdout: "version", stderr: "", exitCode: 0 };
      }
      throw new CavemanCommitError(code, code);
    };
    await assert.rejects(
      new CodexProvider({ run }).generateCommit("prompt", options),
      (error: unknown) =>
        error instanceof CavemanCommitError && error.code === code,
    );
  }
});
