import assert from "node:assert/strict";
import test from "node:test";

import {
  RestartableOperation,
  type CancellationController,
} from "../src/services/restartableOperation";

interface TestToken {
  cancelled: boolean;
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("segundo acionamento cancela execucao atual e inicia outra", async () => {
  const gates = [deferred(), deferred()];
  const controllers: CancellationController<TestToken>[] = [];
  let runs = 0;
  const operation = new RestartableOperation(
    () => {
      const token = { cancelled: false };
      const controller = {
        token,
        cancel: () => {
          token.cancelled = true;
          gates[runs - 1]?.resolve();
        },
        dispose: () => undefined,
      };
      controllers.push(controller);
      return controller;
    },
    async () => {
      const gate = gates[runs];
      runs += 1;
      await gate?.promise;
    },
  );

  const first = operation.trigger();
  await operation.trigger();
  assert.equal(controllers[0]?.token.cancelled, true);
  gates[1]?.resolve();
  await first;
  assert.equal(runs, 2);
});

test("dispose cancela sem reiniciar", async () => {
  const gate = deferred();
  let runs = 0;
  const operation = new RestartableOperation(
    () => {
      const token = { cancelled: false };
      return {
        token,
        cancel: () => {
          token.cancelled = true;
          gate.resolve();
        },
        dispose: () => undefined,
      };
    },
    async () => {
      runs += 1;
      await gate.promise;
    },
  );

  const pending = operation.trigger();
  operation.dispose();
  await pending;
  await operation.trigger();
  assert.equal(runs, 1);
});
