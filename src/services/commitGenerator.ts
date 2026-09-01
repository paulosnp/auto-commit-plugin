import type { CommitGenerationOptions, CommitProvider } from "../providers/provider";

const ADDITIONAL_RULES = `REGRAS ADICIONAIS OBRIGATÓRIAS:

- Escreva toda a mensagem em português brasileiro (pt-BR).
- Preserve somente os prefixos Conventional Commits em inglês.
- Use escopo curto e tecnicamente relevante.
- Explique no assunto a principal intenção da alteração.
- Use modo imperativo quando adequado ao português brasileiro.
- Não use Markdown, aspas externas ou blocos de código.
- Não adicione explicações, comentários ou opções alternativas.
- Retorne exclusivamente uma mensagem de commit.
- Analise todas as alterações locais apresentadas: staged, unstaged e untracked.
- Use body somente quando necessário pelas regras da skill.
- Não invente alterações ausentes do diff.
- Não execute Git, shell, ferramentas ou edição de arquivos.

Exemplo correto: feat(auth): adicionar validação do token MFA
Exemplo incorreto: feat(auth): add MFA token validation`;

export function buildCommitPrompt(skill: string, diff: string, correction?: string): string {
  const retry =
    correction === undefined
      ? ""
      : `\n\nA tentativa anterior foi rejeitada: ${correction}\nCorrija o formato e retorne apenas a mensagem de commit.`;
  return `Você é responsável exclusivamente por gerar uma mensagem de commit Git.

Siga rigorosamente todas as instruções da skill fornecida.

${ADDITIONAL_RULES}

<SKILL>
${skill}
</SKILL>

<ALTERACOES_LOCAIS>
${diff}
</ALTERACOES_LOCAIS>${retry}`;
}

export async function generateCommitMessage(
  provider: CommitProvider,
  skill: string,
  diff: string,
  options: CommitGenerationOptions,
  correction?: string,
): Promise<string> {
  return provider.generateCommit(buildCommitPrompt(skill, diff, correction), options);
}
