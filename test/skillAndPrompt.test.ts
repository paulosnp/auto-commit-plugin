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
  assert.match(prompt, /feat\(auth\): adicionar validação do token/);
  assert.doesNotMatch(prompt, /tentativa anterior/);
});

test("prompt de retentativa inclui o motivo da rejeição", () => {
  const prompt = buildCommitPrompt("skill-test", "diff", "Resposta inválida da IA.");
  assert.match(prompt, /A tentativa anterior foi rejeitada: Resposta inválida da IA\./);
});
