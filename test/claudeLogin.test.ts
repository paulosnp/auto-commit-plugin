import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test, { mock } from "node:test";
import type { TerminalOptions, Uri } from "vscode";
import type * as LoginUi from "../src/ui/claudeLogin";
import type { ProviderExecutableResolver } from "../src/process/providerExecutable";

class Terminal {
  public exitStatus: { code: number } | undefined;
  public shows = 0;
  public disposed = false;
  public show(): void { this.shows += 1; }
  public dispose(): void { this.disposed = true; }
}
const terminals: { options: TerminalOptions; terminal: Terminal }[] = [];
const closeListeners = new Set<(terminal: Terminal) => void>();
let directoryFailure = false;
let executablePath = "C:/Program Files/nodejs/node.exe";
const resolveExecutable: ProviderExecutableResolver = (provider) => {
  assert.equal(provider, "claude");
  return { command: executablePath, prefixArgs: ["C:/CLI with spaces/claude.js"], source: "PATH" };
};
const moduleLoader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = moduleLoader._load;
const loadMock = mock.method(moduleLoader, "_load", (request: string, parent: unknown, isMain: boolean) => {
  if (request !== "vscode") return originalLoad.call(moduleLoader, request, parent, isMain);
  return {
    ThemeIcon: class { public constructor(public readonly id: string) {} },
    workspace: { fs: { createDirectory: async () => { if (directoryFailure) throw new Error("Storage indisponível"); } } },
    window: {
      createTerminal: (options: TerminalOptions) => {
        const terminal = new Terminal(); terminals.push({ options, terminal }); return terminal;
      },
      onDidCloseTerminal: (listener: (terminal: Terminal) => void) => {
        closeListeners.add(listener); return { dispose: () => { closeListeners.delete(listener); } };
      },
    },
  };
});
const { ClaudeLogin } = createRequire(__filename)("../src/ui/claudeLogin") as typeof LoginUi;
loadMock.mock.restore();
const cwd = { fsPath: "/isolated/login" } as Uri;

test("login executa CLI diretamente, preserva argumentos e reutiliza terminal ativo", async () => {
  terminals.length = 0;
  const login = new ClaudeLogin(cwd, resolveExecutable);
  try {
    await Promise.all([login.open(), login.open()]);
    assert.equal(terminals.length, 1);
    const { options, terminal } = terminals[0]!;
    assert.equal(options.shellPath, "C:/Program Files/nodejs/node.exe");
    assert.deepEqual(options.shellArgs, ["C:/CLI with spaces/claude.js", "auth", "login"]);
    assert.equal(options.cwd, cwd);
    assert.equal(options.isTransient, true);
    assert.equal(options.env?.CLAUDE_CODE_SAFE_MODE, "1");
    await login.open();
    assert.equal(terminals.length, 1);
    assert.equal(terminal.shows, 3);
  } finally { login.dispose(); }
});

test("login concluído ou terminal fechado permite abrir nova sessão", async () => {
  terminals.length = 0;
  const login = new ClaudeLogin(cwd, resolveExecutable);
  try {
    await login.open();
    terminals[0]!.terminal.exitStatus = { code: 0 };
    await login.open();
    assert.equal(terminals.length, 2);
    closeListeners.forEach((listener) => listener(terminals[0]!.terminal));
    await login.open();
    assert.equal(terminals.length, 2, "Fechar terminal antigo não deve remover o novo");
    closeListeners.forEach((listener) => listener(terminals[1]!.terminal));
    await login.open();
    assert.equal(terminals.length, 3);
  } finally { login.dispose(); }
});

test("falha de storage não prende próxima tentativa de login", async () => {
  terminals.length = 0;
  const login = new ClaudeLogin(cwd, resolveExecutable);
  try {
    directoryFailure = true;
    await assert.rejects(login.open(), /Storage indisponível/);
    assert.equal(terminals.length, 0);
    directoryFailure = false;
    await login.open();
    assert.equal(terminals.length, 1);
  } finally { directoryFailure = false; login.dispose(); }
});

test("dispose durante abertura pendente não deixa terminal órfão", async () => {
  terminals.length = 0;
  const login = new ClaudeLogin(cwd, resolveExecutable);
  const pending = login.open();
  login.dispose();
  await pending;
  await login.open();
  assert.equal(terminals.length, 0);
  assert.equal(closeListeners.size, 0);
});

test("login usa resolução compartilhada e reconsulta executável após fechar terminal", async () => {
  terminals.length = 0;
  const login = new ClaudeLogin(cwd, (provider) => ({
    ...resolveExecutable(provider), prefixArgs: [], source: "anthropic.claude-code",
  }));
  try {
    executablePath = "C:/Extension v1/resources/native-binary/claude.exe";
    await login.open();
    assert.equal(terminals[0]!.options.shellPath, executablePath);
    assert.deepEqual(terminals[0]!.options.shellArgs, ["auth", "login"]);
    closeListeners.forEach((listener) => listener(terminals[0]!.terminal));
    executablePath = "C:/Extension v2/resources/native-binary/claude.exe";
    await login.open();
    assert.equal(terminals[1]!.options.shellPath, executablePath);
  } finally { executablePath = "C:/Program Files/nodejs/node.exe"; login.dispose(); }
});

test("falha na resolução do login não abre terminal nem bloqueia nova tentativa", async () => {
  terminals.length = 0;
  let unavailable = true;
  const login = new ClaudeLogin(cwd, (provider) => {
    if (unavailable) throw new Error("Executável ausente");
    return resolveExecutable(provider);
  });
  try {
    await assert.rejects(login.open(), /Executável ausente/);
    assert.equal(terminals.length, 0);
    unavailable = false;
    await login.open();
    assert.equal(terminals.length, 1);
  } finally { login.dispose(); }
});
