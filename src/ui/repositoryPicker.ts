import * as vscode from "vscode";

import type { RepositoryInfo } from "../git/getRepository";

interface RepositoryItem extends vscode.QuickPickItem {
  readonly repository: RepositoryInfo;
}

export async function pickRepository(
  repositories: readonly RepositoryInfo[],
): Promise<RepositoryInfo | undefined> {
  const items: RepositoryItem[] = repositories.map((repository) => ({
    label: repository.name,
    description: repository.path,
    repository,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: "Selecione o repositório",
    placeHolder: "Repositório Git com alterações staged",
  });
  return selected?.repository;
}
