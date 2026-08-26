import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import { discoverRepositories } from "../src/git/getRepository";
import {
  getLocalChangesDiff,
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

test("lê arquivo untracked sem executar git add", async () => {
  const repository = await createRepository();
  try {
    assert.equal(await getLocalChangesDiff(runProcess, repository), "");
    await writeFile(join(repository, "arquivo.txt"), "conteúdo\n", "utf8");
    const diff = await getLocalChangesDiff(runProcess, repository);
    assert.match(diff, /arquivo\.txt/);
    assert.match(diff, /conteúdo/);
    assert.equal(await git(repository, ["diff", "--cached"]), "");
    assert.match(await git(repository, ["status", "--porcelain"]), /^\?\? arquivo\.txt/m);
    assert.equal(isLargeDiff(diff, 1), true);
    assert.equal(isLargeDiff(diff, 1_000_000), false);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("combina alterações staged, unstaged e untracked sem mudar o index", async () => {
  const repository = await createRepository();
  try {
    await writeFile(join(repository, "staged.txt"), "base\n", "utf8");
    await writeFile(join(repository, "unstaged.txt"), "base\n", "utf8");
    await git(repository, ["add", "staged.txt", "unstaged.txt"]);
    await git(repository, ["commit", "-m", "chore: criar base"]);

    await writeFile(join(repository, "staged.txt"), "base\nstaged\n", "utf8");
    await git(repository, ["add", "staged.txt"]);
    await writeFile(join(repository, "unstaged.txt"), "base\nunstaged\n", "utf8");
    await writeFile(join(repository, "untracked.txt"), "untracked\n", "utf8");

    const before = await git(repository, ["status", "--porcelain"]);
    const diff = await getLocalChangesDiff(runProcess, repository);
    const after = await git(repository, ["status", "--porcelain"]);

    assert.equal(after, before);
    assert.match(diff, /staged\.txt/);
    assert.match(diff, /unstaged\.txt/);
    assert.match(diff, /untracked\.txt/);
    assert.match(diff, /\+staged/);
    assert.match(diff, /\+unstaged/);
    assert.match(diff, /\+untracked/);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("mapeia Git inexistente ao obter alterações locais", async () => {
  await assert.rejects(
    getLocalChangesDiff(
      async () => {
        throw new CavemanCommitError("PROCESS_NOT_FOUND", "missing");
      },
      process.cwd(),
    ),
    (error: unknown) =>
      error instanceof CavemanCommitError && error.code === "GIT_NOT_FOUND",
  );
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
