import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseRepository,
  normalizeRepositories,
  type RepositoryInfo,
} from "../src/git/getRepository";
import { parsePreviewMessage } from "../src/ui/previewProtocol";

test("normaliza e deduplica repositórios da API Git", () => {
  const repositories = normalizeRepositories([
    { rootUri: { fsPath: "C:\\Repos\\back" } },
    { rootUri: { fsPath: "C:\\Repos\\front" } },
    { rootUri: { fsPath: "C:\\Repos\\back" } },
  ]);
  assert.equal(repositories.length, 2);
});

test("seleciona automaticamente um repo e abre picker para multi-root", async () => {
  const one: RepositoryInfo = { path: "/repo/one", name: "one" };
  let pickerCalls = 0;
  assert.equal(
    await chooseRepository([one], async () => {
      pickerCalls += 1;
      return undefined;
    }),
    one,
  );
  assert.equal(pickerCalls, 0);

  const two: RepositoryInfo = { path: "/repo/two", name: "two" };
  assert.equal(
    await chooseRepository([one, two], async (repositories) => {
      pickerCalls += 1;
      return repositories[1];
    }),
    two,
  );
  assert.equal(pickerCalls, 1);
});

test("protocolo do Preview cobre commit, edição, regeneração e cancelamento", () => {
  for (const action of ["commit", "edit", "regenerate", "cancel"] as const) {
    assert.deepEqual(parsePreviewMessage({ action, message: "fix: corrigir bug" }), {
      action,
      message: "fix: corrigir bug",
    });
  }
  assert.equal(parsePreviewMessage({ action: "push", message: "x" }), undefined);
  assert.equal(parsePreviewMessage({ action: "commit", message: 123 }), undefined);
});
