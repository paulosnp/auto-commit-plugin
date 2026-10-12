import assert from "node:assert/strict";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import type { CommitProvider } from "../src/providers/provider";
import { generateCommitMessage } from "../src/services/commitGenerator";

const options = {
  model: "test-model",
  cwd: process.cwd(),
  timeoutMs: 60_000,
};

test("refaz sucessivas rejeições até entregar mensagem validada", async () => {
  const valid = "fix(validação): corrigir token\n\nEvita acesso indevido.";
  const responses = [
    "",
    "corrigir token",
    `fix: ${"a".repeat(68)}`,
    "fix(auth): corrigir token.",
    "fix(auth): corrigir token\nCorpo sem separador",
    valid,
  ];
  const prompts: string[] = [];
  const retries: { attempt: number; reason: string }[] = [];
  const provider: CommitProvider = {
    id: "codex",
    async generateCommit(prompt, receivedOptions) {
      assert.equal(receivedOptions, options);
      prompts.push(prompt);
      const response = responses[prompts.length - 1];
      assert.notEqual(response, undefined, "Não pode gerar novamente após resposta válida");
      return response!;
    },
  };

  assert.equal(
    await generateCommitMessage(provider, "skill-test", "diff-test", options, (attempt, reason) => {
      retries.push({ attempt, reason });
    }),
    valid,
  );
  assert.equal(prompts.length, 6);
  assert.deepEqual(retries.map(({ attempt }) => attempt), [1, 2, 3, 4, 5]);
  for (let index = 1; index < prompts.length; index += 1) {
    const prompt = prompts[index]!;
    assert.ok(prompt.includes(retries[index - 1]!.reason));
    assert.ok(prompt.includes(JSON.stringify(responses[index - 1])));
    assert.ok(prompt.includes("skill-test"));
    assert.ok(prompt.includes("diff-test"));
  }
  assert.match(prompts[3]!, /73 caracteres/);
  assert.match(prompts[5]!, /linha vazia/);
});

test("normaliza resposta válida sem consumir outra geração", async () => {
  let calls = 0;
  const provider: CommitProvider = {
    id: "claude",
    async generateCommit() {
      calls += 1;
      return "```text\nfix(auth): corrigir token\n```";
    },
  };
  assert.equal(
    await generateCommitMessage(provider, "skill", "diff", options),
    "fix(auth): corrigir token",
  );
  assert.equal(calls, 1);
});

test("aceita resposta válida na oitava retentativa após oito rejeições", async () => {
  let calls = 0;
  const retries: number[] = [];
  const provider: CommitProvider = {
    id: "claude",
    async generateCommit() {
      calls++;
      return calls === 9 ? "fix(cli): limitar retentativas" : "resposta inválida";
    },
  };
  assert.equal(await generateCommitMessage(provider, "skill", "diff", options, attempt => { retries.push(attempt); }), "fix(cli): limitar retentativas");
  assert.equal(calls, 9);
  assert.deepEqual(retries, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("nona rejeição encerra sem décima chamada e preserva último motivo", async () => {
  let calls = 0; let retries = 0;
  const provider: CommitProvider = {
    id: "codex",
    async generateCommit() { calls++; return calls % 2 ? "" : "resposta inválida"; },
  };
  await assert.rejects(generateCommitMessage(provider, "skill", "diff", options, () => { retries++; }), (error: unknown) => {
    assert.ok(error instanceof CavemanCommitError);
    assert.equal(error.code, "AI_RESPONSE_RETRIES_EXHAUSTED");
    assert.match(error.userMessage, /tentativa inicial e 8 retentativas/);
    assert.match(error.userMessage, /Resposta vazia da IA/);
    assert.ok(error.cause instanceof CavemanCommitError);
    assert.equal(error.cause.code, "EMPTY_AI_RESPONSE");
    return true;
  });
  assert.equal(calls, 9); assert.equal(retries, 8);
});

test("timeout não consome nem reinicia limite de oito retentativas por rejeição", async () => {
  for (const lastResponse of ["fix(cli): limitar retentativas", "resposta inválida"]) {
    let calls = 0;
    const kinds: string[] = [];
    const provider: CommitProvider = {
      id: "claude",
      async generateCommit() {
        calls++;
        if (calls === 5 || calls === 10) throw new CavemanCommitError("PROCESS_TIMEOUT", "timeout");
        return calls === 11 ? lastResponse : "resposta inválida";
      },
    };
    const result = generateCommitMessage(provider, "skill", "diff", options, (_, __, kind) => { kinds.push(kind); });
    if (lastResponse.startsWith("fix")) assert.equal(await result, lastResponse);
    else await assert.rejects(result, { code: "AI_RESPONSE_RETRIES_EXHAUSTED" });
    assert.equal(calls, 11);
    assert.equal(kinds.filter(kind => kind === "validation").length, 8);
    assert.equal(kinds.filter(kind => kind === "timeout").length, 2);
  }
});

test("cancelamento na última resposta tem prioridade sobre esgotamento", async () => {
  let calls = 0;
  const cancellation = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const provider: CommitProvider = {
    id: "codex",
    async generateCommit() {
      calls++;
      if (calls === 9) cancellation.isCancellationRequested = true;
      return "resposta inválida";
    },
  };
  await assert.rejects(generateCommitMessage(provider, "skill", "diff", { ...options, cancellation }), { code: "OPERATION_CANCELLED" });
  assert.equal(calls, 9);
});

test("cancelamento interrompe recuperação antes de iniciar outra tentativa", async () => {
  const cancellation = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
  let calls = 0;
  const provider: CommitProvider = {
    id: "codex",
    async generateCommit() {
      calls += 1;
      return "resposta inválida";
    },
  };
  const cancelledOptions = { ...options, cancellation };
  const cancelled = (error: unknown): boolean =>
    error instanceof CavemanCommitError && error.code === "OPERATION_CANCELLED";
  await assert.rejects(
    generateCommitMessage(provider, "skill", "diff", cancelledOptions, () => {
      cancellation.isCancellationRequested = true;
    }),
    cancelled,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    generateCommitMessage(provider, "skill", "diff", cancelledOptions),
    cancelled,
  );
  assert.equal(calls, 1);
});

test("não entrega resposta recebida após cancelamento", async () => {
  const cancellation = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
  const provider: CommitProvider = {
    id: "codex",
    async generateCommit() {
      cancellation.isCancellationRequested = true;
      return "fix(auth): corrigir token";
    },
  };
  await assert.rejects(
    generateCommitMessage(provider, "skill", "diff", { ...options, cancellation }),
    (error: unknown) =>
      error instanceof CavemanCommitError && error.code === "OPERATION_CANCELLED",
  );
});

test("propaga falhas do CLI sem inventar mensagem ou repetir a chamada", async () => {
  for (const code of ["CODEX_NOT_AUTHENTICATED", "CODEX_FAILED"]) {
    const failure = new CavemanCommitError(code, "Falha do CLI");
    let calls = 0;
    const provider: CommitProvider = {
      id: "codex",
      async generateCommit() {
        calls += 1;
        throw failure;
      },
    };
    await assert.rejects(
      generateCommitMessage(provider, "skill", "diff", options),
      (error: unknown) => error === failure,
    );
    assert.equal(calls, 1);
  }
});

test("limita contexto da resposta rejeitada na retentativa", async () => {
  const oversized = `fix: ${"a".repeat(10_000)}MARCADOR_FINAL`;
  let calls = 0;
  const provider: CommitProvider = {
    id: "codex",
    async generateCommit(prompt) {
      calls += 1;
      if (calls === 1) {
        return oversized;
      }
      assert.equal(calls, 2);
      assert.ok(prompt.includes(JSON.stringify(oversized.slice(0, 4_000))));
      assert.ok(!prompt.includes("MARCADOR_FINAL"));
      assert.match(prompt, /máximo 4000 caracteres/);
      return "fix(auth): corrigir token";
    },
  };
  assert.equal(
    await generateCommitMessage(provider, "skill", "diff", options),
    "fix(auth): corrigir token",
  );
});

test("recupera timeout com prazo crescente e preserva correção anterior", async () => {
  const prompts: string[] = [];
  const deadlines: number[] = [];
  const kinds: string[] = [];
  const provider: CommitProvider = {
    id: "claude",
    async generateCommit(prompt, receivedOptions) {
      prompts.push(prompt);
      deadlines.push(receivedOptions.timeoutMs);
      assert.equal(receivedOptions.model, options.model);
      assert.equal(receivedOptions.cwd, options.cwd);
      if (prompts.length === 1) return "resposta inválida";
      if (prompts.length < 4) throw new CavemanCommitError("PROCESS_TIMEOUT", "Timeout");
      return "fix(cli): recuperar geração lenta";
    },
  };
  assert.equal(
    await generateCommitMessage(provider, "skill", "diff", options, (_, __, kind) => {
      kinds.push(kind);
    }),
    "fix(cli): recuperar geração lenta",
  );
  assert.deepEqual(deadlines, [60_000, 60_000, 120_000, 240_000]);
  assert.deepEqual(kinds, ["validation", "timeout", "timeout"]);
  assert.equal(prompts[1], prompts[2]);
  assert.equal(prompts[2], prompts[3]);
});

test("limita retentativas e prazo por timeout sem inventar mensagem", async () => {
  const deadlines: number[] = [];
  const failure = new CavemanCommitError("PROCESS_TIMEOUT", "Timeout");
  const provider: CommitProvider = {
    id: "codex",
    async generateCommit(_, receivedOptions) {
      deadlines.push(receivedOptions.timeoutMs);
      throw failure;
    },
  };
  await assert.rejects(
    generateCommitMessage(provider, "skill", "diff", { ...options, timeoutMs: 400_000 }),
    (error: unknown) => error instanceof CavemanCommitError &&
      error.code === "PROCESS_TIMEOUT" && error.cause === failure &&
      error.userMessage.includes("duas retentativas"),
  );
  assert.deepEqual(deadlines, [400_000, 600_000, 600_000]);
});

test("cancelamento impede retentativa após timeout", async () => {
  const cancellation = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
  let calls = 0;
  const provider: CommitProvider = {
    id: "claude",
    async generateCommit(_, receivedOptions) {
      assert.equal(receivedOptions.cancellation, cancellation);
      calls += 1;
      throw new CavemanCommitError("PROCESS_TIMEOUT", "Timeout");
    },
  };
  await assert.rejects(
    generateCommitMessage(provider, "skill", "diff", { ...options, cancellation }, () => {
      cancellation.isCancellationRequested = true;
    }),
    (error: unknown) => error instanceof CavemanCommitError && error.code === "OPERATION_CANCELLED",
  );
  assert.equal(calls, 1);
});

test("cancelamento durante timeout tem prioridade sobre recuperação", async () => {
  const cancellation = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
  const provider: CommitProvider = {
    id: "claude",
    async generateCommit() {
      cancellation.isCancellationRequested = true;
      throw new CavemanCommitError("PROCESS_TIMEOUT", "Timeout");
    },
  };
  await assert.rejects(
    generateCommitMessage(provider, "skill", "diff", { ...options, cancellation }, () => {
      assert.fail("Não deve repetir geração cancelada");
    }),
    (error: unknown) => error instanceof CavemanCommitError && error.code === "OPERATION_CANCELLED",
  );
});
