import { basename, normalize } from "node:path";

import { CavemanCommitError } from "../errors";
import type { ProcessRunner } from "../process/runProcess";

export interface RepositoryInfo {
  readonly path: string;
  readonly name: string;
}

export interface NativeGitRepository {
  readonly rootUri: { readonly fsPath: string };
}

export function normalizeRepositories(
  repositories: readonly NativeGitRepository[],
): RepositoryInfo[] {
  const unique = new Map<string, RepositoryInfo>();
  for (const repository of repositories) {
    const repositoryPath = normalize(repository.rootUri.fsPath);
    unique.set(repositoryPath.toLocaleLowerCase(), {
      path: repositoryPath,
      name: basename(repositoryPath),
    });
  }
  return [...unique.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function discoverRepositories(
  run: ProcessRunner,
  workspaceFolderPaths: readonly string[],
  timeoutMs = 10_000,
): Promise<RepositoryInfo[]> {
  const found: NativeGitRepository[] = [];
  let gitMissing = false;

  await Promise.all(
    workspaceFolderPaths.map(async (folderPath) => {
      try {
        const result = await run(
          "git",
          ["-C", folderPath, "rev-parse", "--show-toplevel"],
          { cwd: folderPath, timeoutMs },
        );
        if (result.exitCode === 0 && result.stdout.trim().length > 0) {
          found.push({ rootUri: { fsPath: result.stdout.trim() } });
        }
      } catch (error) {
        if (error instanceof CavemanCommitError && error.code === "PROCESS_NOT_FOUND") {
          gitMissing = true;
          return;
        }
        throw error;
      }
    }),
  );

  if (gitMissing) {
    throw new CavemanCommitError(
      "GIT_NOT_FOUND",
      "Git não está instalado ou não está no PATH.",
    );
  }
  return normalizeRepositories(found);
}

export type RepositoryPicker = (
  repositories: readonly RepositoryInfo[],
) => Promise<RepositoryInfo | undefined>;

export async function chooseRepository(
  repositories: readonly RepositoryInfo[],
  picker: RepositoryPicker,
): Promise<RepositoryInfo | undefined> {
  if (repositories.length === 0) {
    throw new CavemanCommitError(
      "NO_REPOSITORY",
      "Nenhum repositório Git disponível.",
    );
  }
  if (repositories.length === 1) {
    return repositories[0];
  }
  return picker(repositories);
}
