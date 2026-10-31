import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test, { mock } from "node:test";
import type * as Settings from "../src/config/settings";
import * as models from "../src/config/models";

let scope: unknown;
let provider: unknown;
let effort: unknown;
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const original = loader._load;
const mocked = mock.method(loader, "_load", (request: string, parent: unknown, isMain: boolean) => {
  if (request !== "vscode") return original.call(loader, request, parent, isMain);
  const values = (): Record<string, unknown> => ({ diffScope: scope, provider, reasoningEffort: effort });
  return { workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => values()[key] ?? fallback }) } };
});
const settings = createRequire(__filename)("../src/config/settings") as typeof Settings;
mocked.mock.restore();

test("configuração usa all por padrão, aceita staged e rejeita escopos desconhecidos", () => {
  provider = undefined; effort = undefined;
  scope = undefined; assert.equal(settings.readSettings().diffScope, "all");
  scope = "staged"; assert.equal(settings.readSettings().diffScope, "staged");
  scope = "all"; assert.equal(settings.readSettings().diffScope, "all");
  scope = "unknown"; assert.throws(() => settings.readSettings(), { code: "INVALID_DIFF_SCOPE" });
  scope = undefined;
});

test("effort vazio usa o padrão do provider e valores são validados por provider", () => {
  provider = "codex"; effort = "";
  assert.equal(settings.readSettings().reasoningEffort, "medium");
  effort = "ultra"; assert.equal(settings.readSettings().reasoningEffort, "ultra");
  provider = "claude"; effort = "";
  assert.equal(settings.readSettings().reasoningEffort, "low");
  effort = "max"; assert.equal(settings.readSettings().reasoningEffort, "max");
  effort = "ultra"; assert.throws(() => settings.readSettings(), { code: "INVALID_REASONING_EFFORT" });
  provider = "gemini"; effort = "";
  const gemini = settings.readSettings();
  assert.equal(gemini.provider, "gemini");
  assert.equal(gemini.model, "gemini-3.8-flash");
  assert.equal(gemini.reasoningEffort, "low");
  effort = "high"; assert.equal(settings.readSettings().reasoningEffort, "high");
  effort = "ultra"; assert.throws(() => settings.readSettings(), { code: "INVALID_REASONING_EFFORT" });
  provider = "other"; assert.throws(() => settings.readSettings(), { code: "INVALID_PROVIDER" });
  provider = undefined; effort = undefined;
});

test("trocar de modelo ajusta o effort efetivo para um suportado pelo modelo", () => {
  const gptOss = { id: "gpt-oss-120b", displayName: "GPT-OSS 120B", efforts: ["medium"] };
  const flash = { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash", efforts: ["high", "medium", "low"] };
  // Default "low" unsupported → first supported effort.
  assert.equal(models.effortAfterModelChange("gemini", "", gptOss), "medium");
  // Supported effective effort keeps the current setting.
  assert.equal(models.effortAfterModelChange("gemini", "", flash), undefined);
  assert.equal(models.effortAfterModelChange("gemini", "high", flash), undefined);
  // Unsupported override falls back to the provider default when the model supports it.
  assert.equal(models.effortAfterModelChange("gemini", "xhigh", flash), "");
  // Codex catalog default is preferred when the provider default is unsupported.
  assert.equal(models.effortAfterModelChange("codex", "", { id: "x", displayName: "x", defaultEffort: "high", efforts: ["low", "high"] }), "high");
  // Unknown efforts from the catalog are ignored; custom models without a catalog entry keep the setting.
  assert.equal(models.effortAfterModelChange("codex", "", { id: "x", displayName: "x", efforts: ["minimal"] }), undefined);
  assert.equal(models.effortAfterModelChange("gemini", "xhigh", undefined), undefined);
});
