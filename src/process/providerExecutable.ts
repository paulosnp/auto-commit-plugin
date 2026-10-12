import { join } from "node:path";

import type { ProviderId } from "../config/models";
import { CavemanCommitError } from "../errors";
import { findCommand, isExecutableFile, resolveCommand, type ResolvedCommand } from "./resolveCommand";

export interface InstalledProviderExtension {
  readonly extensionPath: string;
  readonly packageJSON: {
    readonly version?: unknown;
    readonly __metadata?: { readonly targetPlatform?: unknown };
  };
}

export interface ResolvedProviderExecutable extends ResolvedCommand {
  readonly source: string;
  readonly extensionVersion?: string;
}

export type ProviderExecutableResolver = (provider: ProviderId) => ResolvedProviderExecutable;

const EXTENSION_IDS = { codex: "openai.chatgpt", claude: "anthropic.claude-code" } as const;

export function missingProviderMessage(provider: ProviderId): string {
  const name = provider === "codex" ? "Codex" : "Claude Code";
  return `Executável do ${name} não encontrado. Instale o CLI no PATH ou a extensão ${EXTENSION_IDS[provider]} com binário compatível. Consulte Output → Caveman Commit.`;
}

export function resolveProviderExecutable(
  provider: ProviderId,
  getExtension: (id: string) => InstalledProviderExtension | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ResolvedProviderExecutable {
  const standalone = findCommand(provider, environment, platform);
  if (standalone !== undefined) {
    return { ...resolveCommand(standalone, environment, platform), source: "PATH" };
  }

  const extensionId = EXTENSION_IDS[provider];
  const extension = getExtension(extensionId);
  const supportedPlatform = ["win32", "linux", "darwin"].includes(platform);
  if (extension !== undefined && supportedPlatform && ["x64", "arm64"].includes(arch)) {
    const executableName = provider + (platform === "win32" ? ".exe" : "");
    const platformName = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : platform;
    const archName = arch === "x64" ? "x86_64" : "aarch64";
    // Claude's native-binary directory has no architecture in its name.
    const targetPlatform = extension.packageJSON.__metadata?.targetPlatform;
    if (provider === "claude" && typeof targetPlatform === "string" &&
      targetPlatform !== "undefined" && targetPlatform !== "universal" &&
      targetPlatform !== `${platform}-${arch}` &&
      !(platform === "linux" && targetPlatform === `alpine-${arch}`)) {
      throw new CavemanCommitError("CLI_NOT_FOUND", missingProviderMessage(provider));
    }
    const executable = provider === "codex"
      ? join(extension.extensionPath, "bin", `${platformName}-${archName}`, executableName)
      : join(extension.extensionPath, "resources", "native-binary", executableName);
    if (isExecutableFile(executable, platform)) {
      const version = extension.packageJSON.version;
      return {
        command: executable,
        prefixArgs: [],
        source: extensionId,
        extensionVersion: typeof version === "string" ? version : undefined,
      };
    }
  }
  throw new CavemanCommitError("CLI_NOT_FOUND", missingProviderMessage(provider));
}
