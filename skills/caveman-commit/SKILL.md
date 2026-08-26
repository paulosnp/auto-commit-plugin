---
name: caveman-commit
description: >
  Gerador ultracompacto de mensagens de commit. Preserva intenção e motivo,
  seguindo Conventional Commits e português brasileiro.
---

Escreva mensagens de commit curtas e exatas. Sem ruído. Priorize o motivo.

## Idioma obrigatório

Todas as mensagens de commit devem ser escritas em português brasileiro (pt-BR).

O prefixo Conventional Commit permanece no padrão técnico: `feat`, `fix`,
`refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`, `style` ou `revert`.
Escopo, assunto e corpo devem estar em português brasileiro. Termos técnicos
consagrados podem permanecer em inglês quando melhorarem a clareza.

Correto: `feat(auth): adicionar validação do token MFA`

Incorreto: `feat(auth): add MFA token validation`

## Regras

**Subject:**

- Formato: `<type>(<scope>): <resumo imperativo>`; scope opcional.
- Use modo imperativo.
- Prefira até 50 caracteres; limite absoluto de 72.
- Não termine com ponto.
- Respeite a convenção de capitalização do projeto.

**Body, somente quando necessário:**

- Omita quando o subject explicar tudo.
- Inclua somente para motivo não óbvio, breaking change, migração ou issue.
- Quebre linhas em até 72 caracteres.
- Use bullets `-`, nunca `*`.
- Referencie issues/PRs no final: `Closes #42`, `Refs #17`.

**Nunca inclua:**

- “Este commit faz”, “eu”, “nós”, “agora” ou “atualmente”.
- “Conforme solicitado”.
- Atribuição a IA, salvo regra explícita do projeto.
- Emoji, salvo convenção explícita do projeto.
- Nome de arquivo redundante com o scope.

## Clareza obrigatória

Sempre inclua body para breaking changes, correções de segurança, migrações de
dados e reverts. Explique contexto necessário para manutenção futura.

## Limites

Gere somente a mensagem. Não execute Git, shell, ferramentas, edição de arquivos
ou alteração de configurações.
