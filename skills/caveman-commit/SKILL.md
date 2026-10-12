---
name: caveman-commit
description: Mensagens de commit curtas, exatas, em pt-BR.
---

Conventional Commits em português brasileiro (pt-BR). Prefixos: feat, fix,
refactor, docs, test, chore, perf, ci, build, style, revert. Termos técnicos
consagrados podem permanecer em inglês.

- Subject: intenção principal, imperativo; scope curto e relevante, opcional.
  Prefira até 50 caracteres; máximo 72, sem ponto final. Capitalização do projeto.
- Body: omita se o subject bastar; inclua para motivo não óbvio ou issue.
  Obrigatório em breaking changes, segurança, migrações de dados e reverts:
  explique contexto e motivo. Separe por linha vazia; linhas até 72 caracteres;
  bullets com `-`. Issues/PRs no final: `Closes #42`, `Refs #17`.
- Sem “Este commit faz”, “eu”, “nós”, “agora”, “atualmente”, “Conforme solicitado”
  ou arquivo redundante com scope. IA e emoji só por convenção explícita do projeto.
- Só a mensagem. Não execute comandos, ferramentas, edições ou configurações.
