import * as vscode from "vscode";

import { CavemanCommitError } from "../errors";
import {
  getEffectiveModel,
  isProviderId,
  type ProviderId,
} from "./models";

export interface CavemanSettings {
  readonly provider: ProviderId;
  readonly model: string;
  readonly reasoningEffort: "medium";
  readonly skillPath: string;
  readonly timeout: number;
  readonly maxDiffSize: number;
}

export function readSettings(): CavemanSettings {
  const config = vscode.workspace.getConfiguration("cavemanCommit");
  const rawProvider = config.get<string>("provider", "codex");
  if (!isProviderId(rawProvider)) {
    throw new CavemanCommitError("INVALID_PROVIDER", "Provider inválido.");
  }

  const reasoningEffort = config.get<string>("reasoningEffort", "medium");
  if (reasoningEffort !== "medium") {
    throw new CavemanCommitError(
      "INVALID_REASONING_EFFORT",
      "Reasoning effort inválido. Use medium.",
    );
  }

  const modelOverride = config.get<string>("model", "");
  return {
    provider: rawProvider,
    model: getEffectiveModel(rawProvider, modelOverride),
    reasoningEffort,
    skillPath: config.get<string>(
      "skillPath",
      "skills/caveman-commit/SKILL.md",
    ),
    timeout: config.get<number>("timeout", 60_000),
    maxDiffSize: config.get<number>("maxDiffSize", 500_000),
  };
}

export function configurationTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders === undefined
    ? vscode.ConfigurationTarget.Global
    : vscode.ConfigurationTarget.Workspace;
}
