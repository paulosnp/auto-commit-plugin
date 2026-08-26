import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseRepository,
  normalizeRepositories,
  type RepositoryInfo,
} from "../src/git/getRepository";
import { copyCommitMessage } from "../src/ui/clipboard";
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

test("protocolo do Preview cobre cópia, edição, regeneração e cancelamento", () => {
  for (const action of ["copy", "edit", "regenerate", "cancel"] as const) {
    assert.deepEqual(parsePreviewMessage({ action, message: "fix: corrigir bug" }), {
      action,
      message: "fix: corrigir bug",
    });
  }
  assert.equal(parsePreviewMessage({ action: "push", message: "x" }), undefined);
  assert.equal(parsePreviewMessage({ action: "copy", message: 123 }), undefined);
});

test("copia a mensagem completa para a área de transferência", async () => {
  let copied = "";
  await copyCommitMessage(
    {
      writeText(value: string): Promise<void> {
        copied = value;
        return Promise.resolve();
      },
    },
    "feat(ui): mostrar popup\n\nCopia automaticamente.",
  );
  assert.equal(copied, "feat(ui): mostrar popup\n\nCopia automaticamente.");
});
