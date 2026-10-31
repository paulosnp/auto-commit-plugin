import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

import * as panel from "../src/ui/settingsSurface";
import { renderSettingsSurface, type SettingsState } from "../src/ui/settingsSurface";

const state: SettingsState = {
  provider: "gemini", model: "gemini-3.8-flash", effort: "high", diffScope: "staged",
  timeout: 120000, maxDiffSize: 500000, skillPath: "skills/caveman-commit/SKILL.md", target: "workspace",
};
const render = (overrides: Partial<SettingsState> = {}): string => renderSettingsSurface({
  state: { ...state, ...overrides }, nonce: "test-nonce", cspSource: "https://webview.example", iconUri: "https://webview.example/icon.svg",
});

test("configurações marcam o estado atual e mantêm CSP com nonce", () => {
  const html = render();
  assert.match(html, /name="provider" value="gemini" checked/);
  assert.match(html, /name="diffScope" value="staged" checked/);
  assert.match(html, /neste workspace/);
  assert.ok(html.includes("default-src 'none'"));
  assert.equal((html.match(/nonce="test-nonce"/g) ?? []).length, 2);
  const data = JSON.parse(html.match(/<script id="settings-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? "");
  assert.equal(data.state.effort, "high");
  assert.deepEqual(data.efforts.gemini, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(data.defaults.claude.effort, "low");
});

test("valores externos não injetam HTML nem fecham o bloco de dados", () => {
  const payload = '</script><script>alert("x")</script><img src=x onerror=alert(1)>';
  const html = render({ model: payload, skillPath: payload });
  assert.ok(!html.includes(payload));
  assert.equal((html.match(/<script\b/g) ?? []).length, 2);
  const block = html.match(/<script id="settings-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? "";
  assert.equal(JSON.parse(block).state.model, payload);
  const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
});

test("entrada da webview é validada antes de chegar à configuração", () => {
  const valid = { provider: "codex", model: " gpt-5.6-terra ", effort: "ultra", diffScope: "all", timeout: 1000, maxDiffSize: 1000, skillPath: " skill.md " };
  assert.deepEqual(panel.parseSettingsInput(valid), { values: { ...valid, model: "gpt-5.6-terra", skillPath: "skill.md" } });
  const field = (value: unknown): string | undefined => {
    const result = panel.parseSettingsInput(value);
    return "field" in result ? result.field : undefined;
  };
  assert.equal(field({ ...valid, provider: "openai" }), "provider");
  assert.equal(field({ ...valid, model: "  " }), "model");
  assert.equal(field({ ...valid, model: "a\nb" }), "model");
  assert.equal(field({ ...valid, provider: "claude", effort: "ultra" }), "effort");
  assert.equal(field({ ...valid, diffScope: "unstaged" }), "diffScope");
  assert.equal(field({ ...valid, timeout: 600001 }), "timeout");
  assert.equal(field({ ...valid, timeout: 1500.5 }), "timeout");
  assert.equal(field({ ...valid, maxDiffSize: 999 }), "max-diff-size");
  assert.equal(field({ ...valid, skillPath: "" }), "skill-path");
  assert.equal(field(null), "provider");
});
