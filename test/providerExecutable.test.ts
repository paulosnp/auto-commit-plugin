import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { CavemanCommitError } from "../src/errors";
import { resolveProviderExecutable, type InstalledProviderExtension } from "../src/process/providerExecutable";

async function file(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "fixture");
  await chmod(path, 0o755);
}

const missing = (error: unknown): boolean => error instanceof CavemanCommitError &&
  error.code === "CLI_NOT_FOUND" && /Instale o CLI.*extensão/.test(error.userMessage);

test("PATH tem prioridade e não consulta nem ativa extensão", async () => {
  const root = await mkdtemp(join(tmpdir(), "caveman-path-"));
  try {
    await file(join(root, "claude.exe"));
    const executable = resolveProviderExecutable("claude", () => assert.fail("Não consultar extensão"),
      { PATH: root }, "win32", "x64");
    assert.equal(executable.command, join(root, "claude.exe"));
    assert.equal(executable.source, "PATH");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fallback encontra ambos os executáveis em caminho com espaços e acompanha atualização", async () => {
  const root = await mkdtemp(join(tmpdir(), "caveman extension "));
  try {
    let extension: InstalledProviderExtension = { extensionPath: join(root, "v1"), packageJSON: { version: "1.0.0" } };
    const getExtension = (id: string) => {
      assert.ok(["openai.chatgpt", "anthropic.claude-code"].includes(id));
      return extension;
    };
    for (const provider of ["codex", "claude"] as const) {
      const relative = provider === "codex" ? "bin/windows-x86_64/codex.exe" : "resources/native-binary/claude.exe";
      await file(join(extension.extensionPath, relative));
      const result = resolveProviderExecutable(provider, getExtension, {}, "win32", "x64");
      assert.equal(result.command, join(extension.extensionPath, relative));
      assert.deepEqual(result.prefixArgs, []);
      assert.equal(result.source, provider === "codex" ? "openai.chatgpt" : "anthropic.claude-code");
      assert.equal(result.extensionVersion, "1.0.0");
    }
    extension = { extensionPath: join(root, "v2"), packageJSON: { version: "2.0.0" } };
    await file(join(extension.extensionPath, "resources/native-binary/claude.exe"));
    assert.equal(resolveProviderExecutable("claude", getExtension, {}, "win32", "x64").extensionVersion, "2.0.0");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ausência de extensão, binário ou layout conhecido produz instrução acionável", async () => {
  const root = await mkdtemp(join(tmpdir(), "caveman-missing-"));
  try {
    for (const provider of ["codex", "claude"] as const) {
      assert.throws(() => resolveProviderExecutable(provider, () => undefined, {}, "win32", "x64"), missing);
      await file(join(root, `${provider}.exe`)); // An unknown layout must not be guessed recursively.
      assert.throws(() => resolveProviderExecutable(provider,
        () => ({ extensionPath: root, packageJSON: {} }), {}, "win32", "x64"), missing);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("seleciona plataforma e arquitetura do host sem usar outro binário do Codex", async () => {
  const root = await mkdtemp(join(tmpdir(), "caveman-platform-"));
  try {
    const getExtension = () => ({ extensionPath: root, packageJSON: {} });
    await file(join(root, "bin/windows-x86_64/codex.exe"));
    assert.throws(() => resolveProviderExecutable("codex", getExtension, {}, "linux", "x64"), missing);
    assert.throws(() => resolveProviderExecutable("codex", getExtension, {}, "win32", "arm64"), missing);
    for (const platform of ["win32", "linux", "darwin"] as const) {
      for (const arch of ["x64", "arm64"]) {
        const name = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : platform;
        const suffix = arch === "x64" ? "x86_64" : "aarch64";
        const path = join(root, "bin", `${name}-${suffix}`, platform === "win32" ? "codex.exe" : "codex");
        await file(path);
        assert.equal(resolveProviderExecutable("codex", getExtension, {}, platform, arch).command, path);
      }
    }
    assert.throws(() => resolveProviderExecutable("codex", getExtension, {}, "freebsd", "x64"), missing);
    assert.throws(() => resolveProviderExecutable("codex", getExtension, {}, "linux", "ia32"), missing);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Claude rejeita targetPlatform incompatível e diretório no lugar do executável", async () => {
  const root = await mkdtemp(join(tmpdir(), "caveman-claude-platform-"));
  try {
    const path = join(root, "resources/native-binary/claude.exe");
    await file(path);
    const getExtension = () => ({ extensionPath: root, packageJSON: { __metadata: { targetPlatform: "win32-arm64" } } });
    assert.throws(() => resolveProviderExecutable("claude", getExtension, {}, "win32", "x64"), missing);
    assert.equal(resolveProviderExecutable("claude", getExtension, {}, "win32", "arm64").command, path);
    await rm(path);
    await mkdir(path);
    assert.throws(() => resolveProviderExecutable("claude", getExtension, {}, "win32", "arm64"), missing);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fallback preserva resolução segura de shim npm e rejeita shim desconhecido", async () => {
  const root = await mkdtemp(join(tmpdir(), "caveman-provider-shim-"));
  try {
    await file(join(root, "node.exe"));
    await file(join(root, "node_modules/claude.js"));
    const shim = join(root, "claude.cmd");
    await writeFile(shim, '"%dp0%\\node_modules\\claude.js" %*');
    const getExtension = () => assert.fail("Não trocar CLI existente");
    const result = resolveProviderExecutable("claude", getExtension, { PATH: root }, "win32", "x64");
    assert.equal(result.command, join(root, "node.exe"));
    assert.deepEqual(result.prefixArgs, [join(root, "node_modules/claude.js")]);
    await writeFile(shim, "@echo off\necho unknown");
    assert.throws(() => resolveProviderExecutable("claude", getExtension, { PATH: root }, "win32", "x64"),
      (error: unknown) => error instanceof CavemanCommitError && error.code === "UNSUPPORTED_WINDOWS_SHIM");
  } finally { await rm(root, { recursive: true, force: true }); }
});
