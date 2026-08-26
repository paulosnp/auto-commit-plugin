import assert from "node:assert/strict";
import test from "node:test";

import { parseRepositoryCopyMessage } from "../src/ui/previewProtocol";

test("protocolo multi-repositorio aceita somente copia valida", () => {
  assert.deepEqual(
    parseRepositoryCopyMessage({
      action: "copyRepository",
      index: 1,
      message: "fix(api): corrigir resposta",
    }),
    {
      action: "copyRepository",
      index: 1,
      message: "fix(api): corrigir resposta",
    },
  );
  assert.equal(
    parseRepositoryCopyMessage({
      action: "copyRepository",
      index: -1,
      message: "x",
    }),
    undefined,
  );
  assert.equal(
    parseRepositoryCopyMessage({
      action: "copyRepository",
      index: 0.5,
      message: "x",
    }),
    undefined,
  );
});
