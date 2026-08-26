import assert from "node:assert/strict";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import {
  removeOutputArtifacts,
  validateCommitMessage,
} from "../src/services/responseValidator";

test("aceita subjects pt-BR válidos", () => {
  assert.equal(
    validateCommitMessage("feat(auth): adicionar validação do token").message,
    "feat(auth): adicionar validação do token",
  );
  assert.equal(
    validateCommitMessage("fix(usuarios): corrigir filtro por secretaria").subject,
    "fix(usuarios): corrigir filtro por secretaria",
  );
});

test("preserva body e normaliza CRLF", () => {
  const value = validateCommitMessage(
    "feat(unidades): aceitar múltiplos vínculos\r\n\r\nEvita duplicação de cadastro.",
  );
  assert.equal(value.body, "Evita duplicação de cadastro.");
  assert.equal(
    value.message,
    "feat(unidades): aceitar múltiplos vínculos\n\nEvita duplicação de cadastro.",
  );
});

test("remove somente fence integral ou aspas externas", () => {
  assert.equal(
    removeOutputArtifacts("```text\nfix(auth): corrigir token\n```"),
    "fix(auth): corrigir token",
  );
  assert.equal(
    removeOutputArtifacts('"docs(api): atualizar rotas"'),
    "docs(api): atualizar rotas",
  );
});

test("rejeita vazio, Markdown, texto adicional e opções múltiplas", () => {
  const invalid = [
    "",
    "# feat(auth): adicionar token",
    "Aqui está a mensagem:\nfeat(auth): adicionar token",
    "feat(auth): adicionar token\nfix(auth): corrigir token",
    "update files",
  ];
  for (const value of invalid) {
    assert.throws(
      () => validateCommitMessage(value),
      (error: unknown) => error instanceof CavemanCommitError,
    );
  }
});
