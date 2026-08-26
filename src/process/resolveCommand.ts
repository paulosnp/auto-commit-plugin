import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, resolve, sep } from "node:path";

import { CavemanCommitError } from "../errors";

export interface ResolvedCommand {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

type Environment = Readonly<Record<string, string | undefined>>;

function pathValue(environment: Environment): string {
  return environment.PATH ?? environment.Path ?? environment.path ?? "";
}

function windowsCandidates(command: string, environment: Environment): string[] {
  const hasDirectory = /[\\/]/.test(command);
  const hasExtension = extname(command).length > 0;
  const names = hasExtension
    ? [command]
    : [`${command}.exe`, `${command}.com`, `${command}.cmd`, `${command}.bat`, command];
  if (hasDirectory) {
    return names;
  }
  return pathValue(environment)
    .split(delimiter)
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => names.map((name) => resolve(entry.replace(/^"|"$/g, ""), name)));
}

function findWindowsCommand(
  command: string,
  environment: Environment,
): string | undefined {
  return windowsCandidates(command, environment).find((candidate) =>
    existsSync(candidate),
  );
}

function npmShimScript(shimPath: string): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(shimPath, "utf8");
  } catch {
    return undefined;
  }
  const match = contents.match(/"%dp0%[\\/]([^"\r\n]+\.(?:js|cjs|mjs))"\s+%\*/i);
  const relativeScript = match?.[1];
  if (relativeScript === undefined) {
    return undefined;
  }
  return resolve(dirname(shimPath), relativeScript.replace(/[\\/]/g, sep));
}

export function resolveCommand(
  command: string,
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedCommand {
  if (platform !== "win32") {
    return { command, prefixArgs: [] };
  }

  const executable = findWindowsCommand(command, environment);
  if (executable === undefined) {
    return { command, prefixArgs: [] };
  }
  if (!/\.(?:cmd|bat)$/i.test(executable)) {
    return { command: executable, prefixArgs: [] };
  }

  const script = npmShimScript(executable);
  if (script === undefined || !existsSync(script)) {
    throw new CavemanCommitError(
      "UNSUPPORTED_WINDOWS_SHIM",
      `O shim ${executable} não pôde ser executado com segurança.`,
    );
  }
  const nodeExecutable = findWindowsCommand("node.exe", environment);
  if (nodeExecutable === undefined) {
    throw new CavemanCommitError(
      "NODE_NOT_FOUND",
      "Node.js não foi encontrado para executar o CLI instalado pelo npm.",
    );
  }
  return { command: nodeExecutable, prefixArgs: [script] };
}
