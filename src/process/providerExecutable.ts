import { homedir } from "node:os";
import { join } from "node:path";

import { PROVIDER_LABELS, type ProviderId } from "../config/models";
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
  // Gemini only: which CLI was found, since agy and @google/gemini-cli take different arguments.
  readonly cli?: "agy" | "gemini-cli";
}

export type ProviderExecutableResolver = (provider: ProviderId) => ResolvedProviderExecutable;

// Gemini ships no VS Code extension binary; it resolves through Antigravity CLI or npm instead.
const EXTENSION_IDS: Partial<Record<ProviderId, string>> = {
  codex: "openai.chatgpt",
  claude: "anthropic.claude-code",
};

export function missingProviderMessage(provider: ProviderId): string {
  const extensionId = EXTENSION_IDS[provider];
  if (extensionId === undefined) {
    return `Executável do ${PROVIDER_LABELS[provider]} não encontrado. Instale o Antigravity CLI (agy) ou @google/gemini-cli no PATH. Consulte Output → Caveman Commit.`;
  }
  return `Executável do ${PROVIDER_LABELS[provider]} não encontrado. Instale o CLI no PATH ou a extensão ${extensionId} com binário compatível. Consulte Output → Caveman Commit.`;
}

function resolveGeminiExecutable(
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  homeDirectory: string,
): ResolvedProviderExecutable {
  const agy = findCommand("agy", environment, platform);
  if (agy !== undefined) {
    return { ...resolveCommand(agy, environment, platform), source: "agy (PATH)", cli: "agy" };
  }
  // Antigravity installs agy under ~/.gemini/bin without always adding it to PATH.
  const installed = join(homeDirectory, ".gemini", "bin", platform === "win32" ? "agy.exe" : "agy");
  if (isExecutableFile(installed, platform)) {
    return { command: installed, prefixArgs: [], source: "agy (~/.gemini/bin)", cli: "agy" };
  }
  const geminiCli = findCommand("gemini", environment, platform);
  if (geminiCli !== undefined) {
    return { ...resolveCommand(geminiCli, environment, platform), source: "gemini (PATH)", cli: "gemini-cli" };
  }
  throw new CavemanCommitError("CLI_NOT_FOUND", missingProviderMessage("gemini"));
}

export function resolveProviderExecutable(
  provider: ProviderId,
  getExtension: (id: string) => InstalledProviderExtension | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  homeDirectory: string = homedir(),
): ResolvedProviderExecutable {
  if (provider === "gemini") return resolveGeminiExecutable(environment, platform, homeDirectory);
  const standalone = findCommand(provider, environment, platform);
  if (standalone !== undefined) {
    return { ...resolveCommand(standalone, environment, platform), source: "PATH" };
  }

  const extensionId = EXTENSION_IDS[provider];
  if (extensionId === undefined) {
    throw new CavemanCommitError("CLI_NOT_FOUND", missingProviderMessage(provider));
  }
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
