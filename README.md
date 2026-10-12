# Caveman Commit

Extensão do VS Code que gera a mensagem de commit em português brasileiro usando
Codex CLI ou Claude Code CLI, copia para a área de transferência e **nunca**
executa o commit.

```text
feat(usuarios): adicionar filtro por secretaria
```

## O que faz

- Analisa alterações `staged`, `unstaged` e arquivos `untracked` não ignorados.
- Gera a mensagem e já deixa na área de transferência.
- Abre um preview com ações para copiar, editar ou regenerar.
- Interface discreta, inspirada no ChatGPT para Windows, acompanha o tema do VS Code.
- Resposta vazia ou fora do formato: refaz automaticamente até validar, usando
  o motivo da rejeição e a resposta anterior para corrigir a próxima tentativa.
  Timeout: refaz até duas vezes, dobrando o prazo até 600 segundos por tentativa.
  Cancelamento, falhas do CLI e esgotamento das retentativas interrompem a geração.

## O que não faz

- Não executa `git add`, `commit`, `push`, `reset` nem `checkout`.
- Não altera o index.
- Não armazena nem solicita API key.

## Quick start

Pré-requisitos:

- VS Code 1.94 ou superior
- Git no `PATH`
- Codex CLI e/ou Claude Code CLI já instalado e autenticado

Passos:

1. Faça as alterações; `git add` não é necessário.
2. Clique em `Caveman Commit` na Status Bar.
3. Aguarde a geração: a mensagem já estará na área de transferência.
4. Revise a mensagem no preview; edite, regenere ou feche quando terminar.
5. Cole com `Ctrl+V` onde quiser.

Um novo clique durante a execução cancela o fluxo atual e inicia outra geração.
Notificações abertas não bloqueiam novos cliques na barra de status.

Se a sessão do Claude estiver ausente ou expirada, a extensão abre automaticamente
um terminal integrado executando `claude auth login`. Conclua a autenticação no
navegador e clique novamente em `Caveman Commit`. Também é possível abrir o login
pela Command Palette (`Caveman Commit: Login Claude Code`) ou pelo hover da barra.

## Instalação

```bash
npm install
npm run package
```

`npm run package` executa `vsce package --allow-missing-repository` e gera um
`.vsix` na raiz. Instale-o pelo VS Code (`Extensions: Install from VSIX...`).
Nenhuma publicação é feita automaticamente.

## Comandos

| Comando | O que faz |
| --- | --- |
| `Caveman Commit: Generate Commit` | Gera a mensagem do repositório atual |
| `Caveman Commit: Select Provider` | Alterna entre Codex e Claude Code |
| `Caveman Commit: Select Model` | Restaura o modelo padrão ou aceita um identificador explícito |
| `Caveman Commit: Open Settings` | Abre as configurações da extensão |
| `Caveman Commit: Login Claude Code` | Abre o login do Claude no terminal integrado |

Configurações são gravadas no workspace quando ele existe; caso contrário,
globalmente.

## Modelos padrão

| Provider | Modelo | Observação |
| --- | --- | --- |
| Codex | `gpt-5.6-terra` (GPT-5.6 Terra) | reasoning effort `medium` |
| Claude Code | `claude-sonnet-5` (Claude Sonnet 5) | effort `low`; system prompt dedicado à mensagem de commit |

Não há fallback automático: modelo indisponível produz erro explícito.

## Configuração

| Chave | Padrão | Efeito |
| --- | --- | --- |
| `cavemanCommit.provider` | `codex` | CLI usado para gerar mensagens (`codex` ou `claude`) |
| `cavemanCommit.model` | `""` | Identificador do modelo; vazio usa o padrão do provider |
| `cavemanCommit.reasoningEffort` | `medium` | Reasoning effort do Codex; a extensão exige `medium` |
| `cavemanCommit.skillPath` | `skills/caveman-commit/SKILL.md` | Caminho absoluto ou relativo à instalação da extensão para a skill |
| `cavemanCommit.timeout` | `120000` | Prazo inicial por tentativa, em milissegundos (1000–600000); timeout dobra o prazo em até duas retentativas |
| `cavemanCommit.maxDiffSize` | `500000` | Tamanho em bytes que exige confirmação antes do envio integral das alterações |

```json
{
  "cavemanCommit.provider": "codex",
  "cavemanCommit.model": "",
  "cavemanCommit.reasoningEffort": "medium",
  "cavemanCommit.skillPath": "skills/caveman-commit/SKILL.md",
  "cavemanCommit.timeout": 120000,
  "cavemanCommit.maxDiffSize": 500000
}
```

Ao trocar de provider, a extensão limpa o override de modelo para impedir que um
identificador do provider anterior seja reutilizado.

## Vários repositórios no workspace

- Somente repositórios com alterações são processados.
- Um repositório alterado: preview da mensagem, com edição e regeneração.
- Dois ou mais: editor completo com mensagem editável e botão de cópia por
  repositório.

## Segurança

- Processos recebem argumentos separados, sem `shell: true`.
- Prompt e diff entram por `stdin`; o projeto é fornecido à IA somente pelo diff.
- Nenhum comando Git mutável é executado.
- Codex roda com sandbox `read-only`, sessão efêmera e configuração ignorada.
- Claude roda sem ferramentas, sem persistência de sessão e em safe mode.
- Providers executam em diretório isolado da extensão.
- No Windows, shims npm como `codex.cmd` e `claude.cmd` são resolvidos para o
  entrypoint Node.js correspondente sem ativar shell intermediário.

## Troubleshooting

| Sintoma | Causa / ação |
| --- | --- |
| Erro citando o modelo | Modelo indisponível no provider; não há fallback — ajuste `Select Model` |
| Geração interrompida | Novo clique durante a execução cancela o fluxo anterior |
| Pedido de confirmação antes de enviar | Diff acima de `cavemanCommit.maxDiffSize` |
| Geração expira | Padrão 120s; até duas retentativas com prazo crescente. Se persistir, verifique conexão/CLI e ajuste `cavemanCommit.timeout` |
| Autenticação do Claude ausente, inválida ou expirada | O login abre no terminal integrado; autentique no navegador e clique novamente na extensão |

Abra `Output → Caveman Commit` para ver provider, modelo, repositório, tamanho do
diff, duração e exit code. O diff completo nunca aparece nos logs.

## Desenvolvimento

```bash
npm install
npm run check
```

`npm run build:icons` regenera SVGs, PNGs e a fonte da barra de status a partir de
`media/status-icon.svg`.

`npm run check` roda typecheck, lint, testes e build. Pressione `F5` no VS Code
para abrir o Extension Development Host.
