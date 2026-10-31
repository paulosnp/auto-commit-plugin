import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessOptions } from "../src/process/runProcess";
import { listCodexModels, parseCodexModels } from "../src/providers/codexCatalog";

const catalog = JSON.stringify({
  models: [
    { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", supported_reasoning_levels: [{ effort: "low" }] },
    {
      slug: "gpt-5.6-terra", display_name: "GPT-5.6 Terra", description: "Modelo padrão", visibility: "list",
      default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }, { effort: 3 }],
    },
    { slug: "gpt-6-luna", visibility: "list" },
  ],
});

test("catálogo do Codex lista só modelos visíveis com efforts suportados", () => {
  assert.deepEqual(parseCodexModels(catalog), [
    { id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", description: "Modelo padrão", defaultEffort: "medium", efforts: ["low", "ultra"] },
    { id: "gpt-6-luna", displayName: "gpt-6-luna", description: undefined, defaultEffort: undefined, efforts: [] },
  ]);
  assert.deepEqual(parseCodexModels("não é json"), []);
  assert.deepEqual(parseCodexModels("{}"), []);
});

test("catálogo do Codex usa o executável resolvido e cai para lista vazia em falha", async () => {
  const calls: { command: string; args: readonly string[]; options: ProcessOptions }[] = [];
  const models = await listCodexModels({
    run: async (command, args, options) => { calls.push({ command, args, options }); return { stdout: catalog, stderr: "", exitCode: 0 }; },
    resolveExecutable: () => ({ command: "/bin/codex", prefixArgs: ["entry.js"], source: "PATH" }),
  }, "/tmp");
  assert.equal(models.length, 2);
  assert.deepEqual(calls[0]?.args, ["entry.js", "debug", "models"]);
  assert.equal(calls[0]?.command, "/bin/codex");
  assert.equal(calls[0]?.options.timeoutMs, 10_000);

  const logs: string[] = [];
  assert.deepEqual(await listCodexModels({
    run: async () => ({ stdout: "", stderr: "", exitCode: 2 }),
    logger: { log: (message) => logs.push(message) },
  }, "/tmp"), []);
  assert.deepEqual(await listCodexModels({
    run: async () => { throw new Error("spawn"); },
    logger: { log: (message) => logs.push(message) },
  }, "/tmp"), []);
  assert.equal(logs.length, 2);
});
