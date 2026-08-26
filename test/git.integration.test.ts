import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import { discoverRepositories } from "../src/git/getRepository";
import {
  commitMessage,
  getStagedDiff,
  isLargeDiff,
} from "../src/git/gitClient";
import { runProcess } from "../src/process/runProcess";

async function git(repository: string, args: readonly string[]): Promise<string> {
  const result = await runProcess("git", ["-C", repository, ...args], {
    cwd: repository,
    timeoutMs: 10_000,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout;
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "caveman-git-"));
  await git(repository, ["init"]);
  await git(repository, ["config", "user.email", "caveman@example.invalid"]);
  await git(repository, ["config", "user.name", "Caveman Test"]);
  return realpath(repository);
}

test("staged diff vazio, preenchido e grande", async () => {
  const repository = await createRepository();
  try {
    assert.equal(await getStagedDiff(runProcess, repository), "");
    await writeFile(join(repository, "arquivo.txt"), "conteúdo\n", "utf8");
    await git(repository, ["add", "arquivo.txt"]);
    const diff = await getStagedDiff(runProcess, repository);
    assert.match(diff, /arquivo\.txt/);
    assert.equal(isLargeDiff(diff, 1), true);
    assert.equal(isLargeDiff(diff, 1_000_000), false);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("mapeia Git inexistente ao obter staged diff", async () => {
  await assert.rejects(
    getStagedDiff(
      async () => {
        throw new CavemanCommitError("PROCESS_NOT_FOUND", "missing");
      },
      process.cwd(),
    ),
    (error: unknown) =>
      error instanceof CavemanCommitError && error.code === "GIT_NOT_FOUND",
  );
});

test("commit preserva acentos, caracteres especiais e body", async () => {
  const repository = await createRepository();
  try {
    await writeFile(join(repository, "arquivo.txt"), "um\n", "utf8");
    await git(repository, ["add", "arquivo.txt"]);
    const first = 'feat(teste): adicionar ação com "aspas" e $()';
    await commitMessage(runProcess, repository, first);
    assert.equal((await git(repository, ["log", "-1", "--format=%B"])).trim(), first);

    await writeFile(join(repository, "arquivo.txt"), "um\ndois\n", "utf8");
    await git(repository, ["add", "arquivo.txt"]);
    const second =
      "fix(teste): corrigir conteúdo\n\nPreserva acentuação e corpo multilinha.\nSem interpolação de shell.";
    await commitMessage(runProcess, repository, second);
    assert.equal(
      (await git(repository, ["log", "-1", "--format=%B"])).trim(),
      second,
    );
    assert.equal(await readFile(join(repository, "arquivo.txt"), "utf8"), "um\ndois\n");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("falha de git commit é explícita", async () => {
  const repository = await createRepository();
  try {
    await assert.rejects(
      commitMessage(runProcess, repository, "chore: testar falha"),
      (error: unknown) =>
        error instanceof CavemanCommitError && error.code === "GIT_COMMIT_FAILED",
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("detecta repositórios em workspace multi-root sem tocar projeto atual", async () => {
  const first = await createRepository();
  const second = await createRepository();
  try {
    const repositories = await discoverRepositories(runProcess, [first, second]);
    assert.equal(repositories.length, 2);
    assert.deepEqual(
      new Set(repositories.map((repository) => repository.path.toLocaleLowerCase())),
      new Set([first, second].map((path) => path.toLocaleLowerCase())),
    );
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
    ]);
  }
});
