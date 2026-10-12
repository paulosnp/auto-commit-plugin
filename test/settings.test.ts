import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test, { mock } from "node:test";
import type * as Settings from "../src/config/settings";

let scope: unknown;
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const original = loader._load;
const mocked = mock.method(loader, "_load", (request: string, parent: unknown, isMain: boolean) => {
  if (request !== "vscode") return original.call(loader, request, parent, isMain);
  return { workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === "diffScope" ? scope ?? fallback : fallback }) } };
});
const settings = createRequire(__filename)("../src/config/settings") as typeof Settings;
mocked.mock.restore();

test("configuração usa all por padrão, aceita staged e rejeita escopos desconhecidos", () => {
  scope = undefined; assert.equal(settings.readSettings().diffScope, "all");
  scope = "staged"; assert.equal(settings.readSettings().diffScope, "staged");
  scope = "all"; assert.equal(settings.readSettings().diffScope, "all");
  scope = "unknown"; assert.throws(() => settings.readSettings(), { code: "INVALID_DIFF_SCOPE" });
});
