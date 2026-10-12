import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

import { renderCommitSurface, type CommitSurfaceOptions } from "../src/ui/commitSurface";

const options: CommitSurfaceOptions = {
  mode: "preview",
  drafts: [{ message: "fix(validação): corrigir token\n\nEvita acesso indevido." }],
  nonce: "test-nonce",
  cspSource: "https://webview.example",
  iconUri: "https://webview.example/status-icon.svg",
  provider: "Codex",
  model: "test-model",
};

test("mensagens e nomes externos não podem injetar HTML na webview", () => {
  const payload = '</textarea><script>alert("injected")</script><img src=x onerror=alert(1)>';
  for (const mode of ["preview", "editor", "multi"] as const) {
    const html = renderCommitSurface({
      ...options, mode, provider: payload, model: payload,
      drafts: [{ message: payload, repositoryName: payload, repositoryPath: payload }],
    });
    assert.ok(!html.includes(payload));
    assert.equal((html.match(/<script\b/g) ?? []).length, 1);
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("default-src 'none'"));
    assert.equal((html.match(/nonce="test-nonce"/g) ?? []).length, 2);
  }
});

test("script renderizado permanece JavaScript válido em todos os modos", () => {
  for (const mode of ["preview", "editor", "multi"] as const) {
    const html = renderCommitSurface({ ...options, mode });
    const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Script(script));
  }
});

test("editor multi-repositório mantém labels e feedback independentes", () => {
  const html = renderCommitSurface({ ...options, mode: "multi", drafts: [
    { repositoryName: "api", repositoryPath: "/repo/api", message: "fix(api): corrigir token" },
    { repositoryName: "web", repositoryPath: "/repo/web", message: "feat(web): adicionar filtro" },
  ] });
  for (const index of [0, 1]) {
    assert.ok(html.includes(`for="message-${index}"`));
    assert.ok(html.includes(`id="message-${index}"`));
    assert.ok(html.includes(`id="feedback-${index}"`));
  }
  assert.ok(html.includes("/repo/api"));
  assert.ok(html.includes("/repo/web"));
});
