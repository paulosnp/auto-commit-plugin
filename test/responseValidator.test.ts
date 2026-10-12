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

test("aceita escopos com acentos, inclusive Unicode decomposto", () => {
  for (const scope of ["validação", "usuários", "configuração/api", "validação".normalize("NFD")]) {
    const message = `fix(${scope}): corrigir filtro`;
    assert.equal(validateCommitMessage(message).message, message);
  }
});

test("aceita linha separadora contendo somente espaços ou tabs", () => {
  const value = validateCommitMessage(
    "fix(auth): corrigir token\r\n \t\r\nEvita acesso indevido.",
  );
  assert.equal(value.message, "fix(auth): corrigir token\n\nEvita acesso indevido.");
});

test("informa o motivo exato para corrigir a próxima tentativa", () => {
  const cases = [
    { message: `fix: ${"a".repeat(68)}`, reason: /73 caracteres.*máximo.*72/ },
    { message: "fix(auth): corrigir token.", reason: /não termine.*ponto/ },
    { message: "corrigir token", reason: /formato.*<type>\(<scope>\): <resumo>/ },
    { message: `fix: corrigir token\n\n${"a".repeat(4_000)}`, reason: /máximo.*4000/ },
    { message: "# fix(auth): corrigir token", reason: /Markdown/ },
  ];
  for (const { message, reason } of cases) {
    assert.throws(
      () => validateCommitMessage(message),
      (error: unknown) =>
        error instanceof CavemanCommitError &&
        error.code === "INVALID_AI_RESPONSE" &&
        reason.test(error.userMessage),
    );
  }
});

test("preserva limites e rejeita múltiplas mensagens com escopos acentuados", () => {
  const subject = `fix: ${"a".repeat(67)}`;
  assert.equal(validateCommitMessage(subject).subject.length, 72);
  assert.throws(
    () => validateCommitMessage("fix(usuários): corrigir filtro\n\nfeat(validação): adicionar regra"),
    /múltiplas mensagens/,
  );
  for (const message of [
    "fix(): corrigir filtro",
    "fix(usuários): corrigir filtro\nDescrição sem separador",
  ]) {
    assert.throws(
      () => validateCommitMessage(message),
      (error: unknown) =>
        error instanceof CavemanCommitError && error.code === "INVALID_AI_RESPONSE",
    );
  }
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
    removeOutputArtifacts("```bash\nfix(auth): corrigir token\n```"),
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
