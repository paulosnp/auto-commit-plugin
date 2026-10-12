# Caveman Commit

Extensão do VS Code que gera a mensagem de commit em português brasileiro usando
Codex CLI ou Claude Code CLI, copia para a área de transferência e **nunca**
executa o commit.

```text
feat(usuarios): adicionar filtro por secretaria
```

## O que faz

- Analisa todas as alterações ou somente `staged`, conforme o escopo escolhido.
- Copia automaticamente a mensagem individual quando o diff continua atualizado.
- Preview com edição, regeneração, cópia e preenchimento do campo de commit no Git.
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
- Codex CLI ou Claude Code CLI instalado no `PATH`, **ou** extensão correspondente
  (`openai.chatgpt` / `anthropic.claude-code`) com executável embutido compatível.
  A autenticação do provider continua necessária.

Passos:

1. Faça as alterações; `git add` não é necessário.
2. Clique em `Caveman Commit` na Status Bar.
3. Aguarde a geração: a mensagem individual atualizada já estará na área de transferência.
4. Revise o preview; edite, regenere ou selecione **Usar no Git**.
5. Faça o commit quando decidir, pelo fluxo Git de sua preferência.

Um novo clique durante a execução cancela o fluxo atual e inicia outra geração.
Notificações abertas não bloqueiam novos cliques na barra de status.

A extensão procura primeiro o CLI no `PATH`. Se ausente, usa o executável
embutido na extensão correspondente, sem abrir seu painel, terminal ou console.
O diretório é consultado novamente a cada geração para acompanhar atualizações.
Somente o login, quando necessário, abre terminal integrado e navegador.
Falhas de autenticação ou geração não provocam troca automática de instalação.
Layouts internos desconhecidos ou incompatíveis produzem orientação para instalar
o CLI separado. Em SSH/containers, o executável precisa estar disponível no host
onde a Caveman Commit está executando.

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
| `Caveman Commit: Generate Commit for Repository` | Gera somente para o repositório recebido do Source Control; sem contexto claro, abre seletor |
| `Caveman Commit: Select Changes` | Escolhe todas as alterações ou somente staged; também disponível no hover da barra |
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
| `cavemanCommit.diffScope` | `all` | `all`: staged, unstaged e untracked; `staged`: somente index |
| `cavemanCommit.model` | `""` | Identificador do modelo; vazio usa o padrão do provider |
| `cavemanCommit.reasoningEffort` | `medium` | Reasoning effort do Codex; a extensão exige `medium` |
| `cavemanCommit.skillPath` | `skills/caveman-commit/SKILL.md` | Caminho absoluto ou relativo à instalação da extensão para a skill |
| `cavemanCommit.timeout` | `120000` | Prazo inicial por tentativa, em milissegundos (1000–600000); timeout dobra o prazo em até duas retentativas |
| `cavemanCommit.maxDiffSize` | `500000` | Tamanho em bytes que exige confirmação antes do envio integral das alterações |

```json
{
  "cavemanCommit.provider": "codex",
  "cavemanCommit.diffScope": "all",
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
- Dois ou mais: editor com cópia, **Usar no Git** e regeneração por repositório.
  Copiar ou preencher o Git confirma o resultado no próprio editor, que permanece aberto.
- O botão Caveman Commit no cabeçalho do Source Control gera somente para o
  repositório daquele painel. Sem contexto inequívoco, permite escolher o repositório.

## Diff atualizado e mensagens reutilizadas

O preview mostra o escopo enviado. `staged` considera a versão no index, inclusive
em arquivos parcialmente staged; `all` mantém o comportamento de analisar as
alterações locais, incluindo arquivos novos não ignorados. Escopo vazio avisa e
não chama a IA. Funciona também antes do primeiro commit.

**Regenerar** relê diff, configurações e conteúdo da skill, sempre chama a IA e
só substitui o resultado anterior após sucesso. Também funciona em cada repositório
do editor múltiplo. Falhas e cancelamentos preservam a mensagem anterior.

Cada resultado registra repositório, escopo e hash do diff enviado. A extensão
relê esse diff após gerar e antes de copiar ou preencher o Git. Se houver mudanças,
preserva o texto e mostra um aviso: regenere ou escolha explicitamente copiar/usar
a mensagem anterior. Resposta desatualizada não é copiada automaticamente.

Até **20 resultados** ficam em cache na memória da sessão. Um clique normal
reutiliza mensagem válida para o mesmo repositório, escopo, diff, provider, modelo,
effort e conteúdo da skill, indicando **Mensagem reutilizada**. Resultados mais
recentemente usados são mantidos; recarregar/fechar a extensão limpa o cache.
Edições válidas copiadas ou aplicadas ao Git atualizam a entrada quando o diff
continua correspondente. Mensagens desatualizadas não são gravadas no cache.

## Usar no Git

**Usar no Git** preenche apenas o campo de commit do repositório exato pela API
da extensão nativa `vscode.git`. Texto vazio ou idêntico dispensa confirmação;
texto diferente exige **Substituir** ou **Cancelar**. Se o campo mudar durante a
confirmação, a operação é interrompida para preservar a nova edição.

Após sucesso, o Source Control é revelado. Preview/editor individual fecha;
editor múltiplo permanece aberto com confirmação por repositório. Erros mantêm
o painel e seu texto. Com Git nativo indisponível, a ação fica desabilitada com
explicação; geração e cópia continuam funcionando. Nenhum stage, commit ou push
é executado.

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
| Executável não encontrado | Instale o CLI no `PATH` ou a extensão correspondente com binário compatível; CLI separado é opcional quando o binário embutido está disponível |
| Erro citando o modelo | Modelo indisponível no provider; não há fallback — ajuste `Select Model` |
| Geração interrompida | Novo clique durante a execução cancela o fluxo anterior |
| Pedido de confirmação antes de enviar | Diff acima de `cavemanCommit.maxDiffSize` |
| Geração expira | Padrão 120s; até duas retentativas com prazo crescente. Se persistir, verifique conexão/CLI e ajuste `cavemanCommit.timeout` |
| Autenticação do Claude ausente, inválida ou expirada | O login abre no terminal integrado; autentique no navegador e clique novamente na extensão |

Abra `Output → Caveman Commit` para ver provider, modelo, repositório, tamanho do
diff, origem/versão do executável, duração e exit code. O diff completo nunca aparece nos logs.

## Desenvolvimento

```bash
npm install
npm run check
```

`npm run build:icons` regenera SVGs, PNGs e a fonte da barra de status a partir de
`media/status-icon.svg`.

`npm run check` roda typecheck, lint, testes e build. Pressione `F5` no VS Code
para abrir o Extension Development Host.
