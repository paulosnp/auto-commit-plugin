import assert from "node:assert/strict";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import { CommitCache, CommitSession, type GenerationContext, type SessionDependencies } from "../src/services/commitSession";
import { writeScmMessage } from "../src/services/scmWriter";

class Cancellation {
  public isCancellationRequested = false;
  private readonly listeners = new Set<() => void>();
  public onCancellationRequested(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
  public cancel(): void { this.isCancellationRequested = true; this.listeners.forEach(listener => listener()); }
}

const message = "fix(cache): preservar mensagem";
const edited = "fix(cache): atualizar mensagem";
const repository = { name: "repo", path: "/repo" };
const tick = async (): Promise<void> => { await new Promise(resolve => setImmediate(resolve)); };
type MutableDependencies = { -readonly [Key in keyof SessionDependencies]: SessionDependencies[Key] };

function fixture(cache = new CommitCache()): {
  state: { diff: string; generated: number; context: GenerationContext; copies: string[]; sent: string[]; scope: string; box: { value: string } };
  dependencies: MutableDependencies;
  token: Cancellation;
  session: CommitSession;
  cache: CommitCache;
} {
  const token = new Cancellation();
  const state = {
    diff: "diff one", generated: 0, copies: [] as string[], sent: [] as string[], scope: "", box: { value: "" },
    context: { settings: { diffScope: "all", provider: "codex", model: "model", reasoningEffort: "medium", skillPath: "skill", timeout: 1000, maxDiffSize: 500000 }, skill: "skill one" } as GenerationContext,
  };
  const dependencies: MutableDependencies = {
    cancellation: token,
    readContext: async () => state.context,
    readDiff: async (_path, scope) => { state.scope = scope; return state.diff; },
    generate: async (_context, diff) => { state.generated++; state.sent.push(diff); return message; },
    confirmLargeDiff: async () => true,
    canUseGit: async () => true,
    copy: async value => { state.copies.push(value); },
    apply: (path, value, ensure) => { assert.equal(path, repository.path); return writeScmMessage(state.box, value, async () => true, ensure, token); },
  };
  return { state, dependencies, token, cache, session: new CommitSession(cache, dependencies) };
}

test("cache LRU limita 20 resultados, promove acerto e rejeita texto inválido", () => {
  const cache = new CommitCache();
  for (let index = 0; index < 20; index++) cache.set(String(index), message);
  assert.equal(cache.get("0"), message);
  cache.set("20", message);
  assert.equal(cache.get("1"), undefined);
  assert.equal(cache.get("0"), message);
  assert.throws(() => cache.set("0", "inválida"));
  assert.equal(cache.get("0"), message);
  cache.clear();
  assert.equal(cache.get("0"), undefined);
});

test("cache isola repositório, diff, escopo, provider, modelo, effort e conteúdo da skill", async () => {
  const { state, session } = fixture();
  const original = state.context;
  const first = await session.prepare(repository);
  assert.equal(first.reused, false);
  assert.equal((await session.prepare(repository)).reused, true);
  assert.equal(state.generated, 1);
  assert.equal((await session.prepare({ name: "other", path: "/other" })).reused, false);
  for (const settings of [
    { diffScope: "staged" as const }, { provider: "claude" as const },
    { model: "another" }, { reasoningEffort: "another" },
  ]) {
    state.context = { ...original, settings: { ...original.settings, ...settings } as GenerationContext["settings"] };
    assert.equal((await session.prepare(repository)).reused, false);
  }
  state.context = { ...original, skill: "skill edited at same path" };
  assert.equal((await session.prepare(repository)).reused, false);
  state.context = original;
  state.diff = "diff two";
  assert.equal((await session.prepare(repository)).reused, false);
  assert.equal(state.generated, 8);
});

test("regenerar ignora cache e relê diff, configurações e skill; edições válidas atualizam cache", async () => {
  const { state, session, dependencies } = fixture();
  const draft = await session.prepare(repository);
  await session.prepare(repository, true);
  assert.equal(state.generated, 2);
  const outcome = await session.act(draft, "copy", edited);
  assert.equal(outcome.outcome, "copied");
  assert.deepEqual(state.copies, [edited]);
  assert.equal((await session.prepare(repository)).message, edited);
  state.diff = "latest diff";
  state.context = { ...state.context, skill: "latest skill", settings: { ...state.context.settings, diffScope: "staged", model: "latest model" } };
  dependencies.generate = async (context, diff) => {
    assert.equal(context.skill, "latest skill"); assert.equal(context.settings.model, "latest model");
    assert.equal(diff, "latest diff"); return message;
  };
  const next = await session.prepare(repository, true);
  assert.equal(next.scope, "staged");
  assert.equal(next.model, "latest model");
  assert.notEqual(next.diffHash, draft.diffHash);
});

test("escopo vazio evita IA; rejeição, falha e cancelamento não apagam cache anterior", async () => {
  const { state, session, dependencies, cache, token } = fixture();
  const draft = await session.prepare(repository);
  state.diff = "";
  await assert.rejects(session.prepare(repository), { code: "NO_CHANGES" });
  assert.equal(state.generated, 1);
  state.diff = "diff one";
  dependencies.generate = async () => { throw new Error("provider failed"); };
  await assert.rejects(session.prepare(repository, true), /provider failed/);
  dependencies.generate = async () => "inválida";
  await assert.rejects(session.prepare(repository, true));
  dependencies.generate = async () => { token.cancel(); return edited; };
  await assert.rejects(session.prepare(repository, true), { code: "OPERATION_CANCELLED" });
  assert.equal(cache.get(draft.cacheKey), message);
});

test("mudança durante geração preserva resposta, impede cache e exige uso explícito", async () => {
  const { state, session, dependencies } = fixture();
  dependencies.generate = async () => { state.diff = "changed during generation"; return message; };
  const draft = await session.prepare(repository);
  assert.equal(draft.stale, true);
  assert.equal(draft.message, message);
  assert.equal((await session.act(draft, "copy", message)).outcome, "stale");
  assert.deepEqual(state.copies, []);
  assert.equal((await session.act(draft, "copy", message, true)).outcome, "copied");
  assert.deepEqual(state.copies, [message]);
  state.diff = "diff one";
  dependencies.generate = async () => edited;
  assert.equal((await session.prepare(repository)).message, edited);
});

test("mudança antes de copiar/aplicar preserva texto editado e não altera Git/clipboard", async () => {
  const { state, session, cache } = fixture();
  const draft = await session.prepare(repository);
  state.diff = "new change";
  for (const action of ["copy", "useGit"] as const) {
    const result = await session.act(draft, action, edited);
    assert.equal(result.outcome, "stale"); assert.equal(result.draft.message, edited);
  }
  assert.equal(state.box.value, ""); assert.deepEqual(state.copies, []);
  assert.equal((await session.act(draft, "useGit", edited, true)).outcome, "applied");
  assert.equal(state.box.value, edited);
  assert.equal(cache.get(draft.cacheKey), message);
});

test("diff é revalidado após confirmar substituição no Git", async () => {
  const { state, session, dependencies, token } = fixture();
  const draft = await session.prepare(repository);
  state.box.value = "user draft";
  dependencies.apply = (_path, value, ensure) => writeScmMessage(state.box, value, async () => { state.diff = "edited while confirming"; return true; }, ensure, token);
  assert.equal((await session.act(draft, "useGit", message)).outcome, "stale");
  assert.equal(state.box.value, "user draft");
});

test("Git vazio/idêntico dispensa confirmação; substituir/cancelar mantém contrato", async () => {
  const token = new Cancellation();
  let confirmations = 0;
  const confirm = async (): Promise<boolean> => { confirmations++; return true; };
  const box = { value: "" };
  assert.equal(await writeScmMessage(box, message, confirm, async () => {}, token), true);
  assert.equal(await writeScmMessage(box, message, confirm, async () => {}, token), true);
  assert.equal(confirmations, 0);
  box.value = "manual text";
  assert.equal(await writeScmMessage(box, message, async () => false, async () => {}, token), false);
  assert.equal(box.value, "manual text");
  assert.equal(await writeScmMessage(box, message, confirm, async () => {}, token), true);
  assert.equal(confirmations, 1);
  assert.equal(box.value, message);
});

test("Git alterado durante confirmação ou revalidação nunca é sobrescrito", async () => {
  const token = new Cancellation();
  const box = { value: "first draft" };
  await assert.rejects(writeScmMessage(box, message, async () => { box.value = "latest draft"; return true; }, async () => {}, token), { code: "SCM_MESSAGE_CHANGED" });
  assert.equal(box.value, "latest draft");
  box.value = "";
  await assert.rejects(writeScmMessage(box, message, async () => true, async () => { box.value = "typed during validation"; }, token), { code: "SCM_MESSAGE_CHANGED" });
  assert.equal(box.value, "typed during validation");
  await assert.rejects(writeScmMessage(box, "invalid", async () => true, async () => {}, token));
});

test("cancelar confirmação pendente libera operação e não escreve no Git", async () => {
  const token = new Cancellation();
  const box = { value: "manual text" };
  const result = writeScmMessage(box, message, () => new Promise(() => {}), async () => {}, token);
  await tick(); token.cancel();
  await assert.rejects(result, { code: "OPERATION_CANCELLED" });
  assert.equal(box.value, "manual text");
  await assert.rejects(writeScmMessage(box, message, async () => true, async () => { throw new CavemanCommitError("DIFF_CHANGED", "changed"); }, new Cancellation()), { code: "DIFF_CHANGED" });
});
