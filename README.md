# Caveman Commit

Caveman Commit é uma extensão do VS Code que gera mensagens de commit em
português brasileiro usando Codex CLI ou Claude Code CLI. Ela analisa alterações
locais, copia a mensagem automaticamente e nunca executa o commit.

## Pré-requisitos

- VS Code 1.94 ou superior
- Git no `PATH`
- Codex CLI e/ou Claude Code CLI já instalado e autenticado

Nenhuma API key é armazenada ou solicitada pela extensão.

## Modelos padrão

- Codex: `gpt-5.6-terra` (GPT-5.6 Terra), reasoning effort `medium`
- Claude Code: `claude-sonnet-5` (Claude Sonnet 5)

Não há fallback automático. Modelo indisponível produz erro explícito.

## Uso

1. Faça as alterações; `git add` não é necessário.
2. Clique em `Caveman · Terra` ou `Caveman · Sonnet` na Status Bar.
3. Aguarde a geração: a mensagem já estará na área de transferência.
4. Use o popup compacto para fechar, editar ou regenerar.
5. Cole com `Ctrl+V` onde quiser.

Exemplo:

```text
feat(usuarios): adicionar filtro por secretaria
```

Alterações `staged`, `unstaged` e arquivos `untracked` não ignorados são
analisados. A extensão não altera o index e nunca executa `git add`, `commit`,
`push`, `reset` ou `checkout`.

## Comandos

- `Caveman Commit: Generate Commit`
- `Caveman Commit: Select Provider`
- `Caveman Commit: Select Model`
- `Caveman Commit: Open Settings`

`Select Provider` alterna entre Codex e Claude Code. `Select Model` restaura o
modelo padrão ou aceita um identificador explícito. Configurações são gravadas
no workspace quando ele existe; caso contrário, globalmente.

## Configuração

```json
{
  "cavemanCommit.provider": "codex",
  "cavemanCommit.model": "",
  "cavemanCommit.reasoningEffort": "medium",
  "cavemanCommit.skillPath": "skills/caveman-commit/SKILL.md",
  "cavemanCommit.timeout": 60000,
  "cavemanCommit.maxDiffSize": 500000
}
```

Modelo vazio usa o padrão do provider. Ao trocar provider, a extensão limpa o
override para impedir que um identificador do provider anterior seja reutilizado.

## Segurança

Processos recebem argumentos separados, sem `shell: true`. Prompt e diff entram
por `stdin`. Nenhum comando Git mutável é executado. Codex roda com sandbox
`read-only`, sessão efêmera e configuração ignorada; Claude roda sem ferramentas,
sem persistência de sessão e em safe mode. Providers executam em diretório
isolado da extensão; o projeto é fornecido à IA somente pelo diff enviado em
`stdin`.

No Windows, shims npm como `codex.cmd` e `claude.cmd` são resolvidos para o
entrypoint Node.js correspondente sem ativar shell intermediário.

O diff completo nunca aparece nos logs. Abra `Output → Caveman Commit` para ver
provider, modelo, repositório, tamanho do diff, duração e exit code.

## Desenvolvimento

```bash
npm install
npm run check
```

Pressione `F5` no VS Code para abrir Extension Development Host.

## Empacotamento

```bash
npm run package
```

O comando executa `vsce package`. Nenhuma publicação é feita automaticamente.
