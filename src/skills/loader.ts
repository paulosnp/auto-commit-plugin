import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { CavemanCommitError } from "../errors";

export function resolveSkillPath(extensionPath: string, configuredPath: string): string {
  return isAbsolute(configuredPath)
    ? configuredPath
    : resolve(extensionPath, configuredPath);
}

export async function loadSkill(
  extensionPath: string,
  configuredPath: string,
): Promise<string> {
  const skillPath = resolveSkillPath(extensionPath, configuredPath);
  try {
    const skill = await readFile(skillPath, "utf8");
    if (skill.trim().length === 0) {
      throw new CavemanCommitError(
        "EMPTY_SKILL",
        `A skill está vazia: ${skillPath}`,
      );
    }
    return skill;
  } catch (error) {
    if (error instanceof CavemanCommitError) {
      throw error;
    }
    throw new CavemanCommitError(
      "SKILL_NOT_FOUND",
      `Não foi possível carregar a skill: ${skillPath}`,
      { cause: error },
    );
  }
}
