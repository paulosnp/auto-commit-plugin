import assert from "node:assert/strict";
import test from "node:test";

import { STATIC_MODELS } from "../src/config/models";
import { listGeminiModels, parseAgyModels } from "../src/providers/geminiCatalog";

const output = [
  "gemini-4-argon-medium\tGemini 4 Argon (Medium)",
  "gemini-4-argon-high\tGemini 4 Argon (High)",
  "gemini-4-argon-low\tGemini 4 Argon (Low)",
  "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
  "custom-model\tCustom Model",
  "Fetching available models...",
  "",
].join("\r\n");

test("catálogo do agy agrupa variantes de effort no modelo base", () => {
  assert.deepEqual(parseAgyModels(output), [
    { id: "gemini-4-argon", displayName: "Gemini 4 Argon", efforts: ["medium", "high", "low"] },
    { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash", efforts: ["low"] },
    { id: "custom-model", displayName: "Custom Model", efforts: [] },
  ]);
  assert.deepEqual(parseAgyModels(""), []);
});

test("catálogo do Gemini usa agy models, lista fixa no Gemini CLI e vazio em falha", async () => {
  const calls: (readonly string[])[] = [];
  const models = await listGeminiModels({
    run: async (_command, args) => { calls.push(args); return { stdout: output, stderr: "", exitCode: 0 }; },
    resolveExecutable: () => ({ command: "agy", prefixArgs: [], source: "agy (PATH)", cli: "agy" }),
  }, "/tmp");
  assert.equal(models.length, 3);
  assert.deepEqual(calls, [["models"]]);

  assert.deepEqual(await listGeminiModels({
    run: async () => assert.fail("Gemini CLI não lista modelos"),
    resolveExecutable: () => ({ command: "gemini", prefixArgs: [], source: "gemini (PATH)", cli: "gemini-cli" }),
  }, "/tmp"), STATIC_MODELS.gemini);

  assert.deepEqual(await listGeminiModels({
    run: async () => ({ stdout: "", stderr: "", exitCode: 1 }),
    resolveExecutable: () => ({ command: "agy", prefixArgs: [], source: "agy (PATH)", cli: "agy" }),
  }, "/tmp"), []);
});
