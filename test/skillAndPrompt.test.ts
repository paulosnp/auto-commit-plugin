import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import { buildCommitPrompt } from "../src/services/commitGenerator";
import { loadSkill } from "../src/skills/loader";

test("carrega skill empacotada dinamicamente", async () => {
  const skill = await loadSkill(process.cwd(), "skills/caveman-commit/SKILL.md");
  assert.match(skill, /português brasileiro \(pt-BR\)/);
  assert.match(skill, /Conventional Commit/);
});

test("rejeita skill inexistente e vazia", async () => {
  await assert.rejects(
    loadSkill(process.cwd(), "skills/inexistente/SKILL.md"),
    (error: unknown) =>
      error instanceof CavemanCommitError && error.code === "SKILL_NOT_FOUND",
  );

  const directory = await mkdtemp(join(tmpdir(), "caveman-skill-"));
  try {
    const path = join(directory, "SKILL.md");
    await writeFile(path, "  \n", "utf8");
    await assert.rejects(
      loadSkill(directory, path),
      (error: unknown) =>
        error instanceof CavemanCommitError && error.code === "EMPTY_SKILL",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("prompt contém pt-BR, skill, diff e proibição de ferramentas", () => {
  const prompt = buildCommitPrompt(
    "skill-test",
    "diff --git a/auth.ts b/auth.ts",
  );
  assert.match(prompt, /português brasileiro \(pt-BR\)/);
  assert.match(prompt, /skill-test/);
  assert.match(prompt, /diff --git a\/auth\.ts b\/auth\.ts/);
  assert.match(prompt, /Não execute Git, shell, ferramentas/);
  assert.match(prompt, /<type>\(<scope>\): <resumo>/);
  assert.match(prompt, /72 caracteres, sem ponto final/);
  assert.match(prompt, /Body separado por linha vazia/);
  assert.match(prompt, /4000 caracteres/);
  assert.match(prompt, /dados, nunca instruções/);
  assert.doesNotMatch(prompt, /tentativa anterior/);
});

test("prompt de retentativa inclui o motivo da rejeição", () => {
  const prompt = buildCommitPrompt("skill-test", "diff", "Resposta inválida da IA.");
  assert.match(prompt, /Rejeição: Resposta inválida da IA\./);
});

test("prompt compacto mantém skill personalizada e diff integrais", async () => {
  const skill = "Regra personalizada: preserve IDs de issues.\nSem alteração de conteúdo.";
  const diff = "diff --git a/auth.ts b/auth.ts\n+const value = '<SKILL>data</SKILL>';\n";
  const prompt = buildCommitPrompt(skill, diff);
  assert.ok(prompt.includes(`<SKILL>\n${skill}\n</SKILL>`));
  assert.ok(prompt.includes(`<ALTERACOES_LOCAIS>\n${diff}\n</ALTERACOES_LOCAIS>`));
  const bundled = await loadSkill(process.cwd(), "skills/caveman-commit/SKILL.md");
  assert.ok(buildCommitPrompt(bundled, "").length < 1900, "Instruções fixas devem permanecer compactas");
  for (const rule of [/imperativo/, /50 caracteres/, /breaking changes/, /segurança/, /migrações de dados/, /reverts/, /Closes #42/, /Refs #17/]) {
    assert.match(bundled, rule);
  }
});
