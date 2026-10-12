import { CavemanCommitError } from "../errors";

const SUBJECT_PATTERN = /^(feat|fix|refactor|docs|test|chore|perf|ci|build|style|revert)(\([\p{L}\p{M}\p{N}._/-]+\))?!?: \S.*$/u;

export interface ValidatedCommitMessage {
  readonly message: string;
  readonly subject: string;
  readonly body?: string;
}

export function removeOutputArtifacts(raw: string): string {
  let value = raw.trim().replace(/\r\n/g, "\n");
  const fenced = value.match(/^```[a-z]*[ \t]*\n([\s\S]*?)\n?```$/i);
  if (fenced?.[1] !== undefined) {
    value = fenced[1].trim();
  }
  const quoted = value.match(/^("|')([\s\S]*)\1$/);
  if (quoted?.[2] !== undefined) {
    value = quoted[2].trim();
  }
  return value;
}

export function validateCommitMessage(raw: string): ValidatedCommitMessage {
  const message = removeOutputArtifacts(raw);
  if (message.length === 0) {
    throw new CavemanCommitError("EMPTY_AI_RESPONSE", "Resposta vazia da IA.");
  }
  if (message.length > 4_000) {
    throw new CavemanCommitError(
      "INVALID_AI_RESPONSE",
      "Resposta inválida da IA: a mensagem deve ter no máximo 4000 caracteres.",
    );
  }
  if (/```|^#{1,6}\s/m.test(message)) {
    throw new CavemanCommitError(
      "INVALID_AI_RESPONSE",
      "Resposta inválida da IA: remova Markdown, títulos e blocos de código.",
    );
  }

  const lines = message.split("\n");
  const subject = lines[0]?.trim() ?? "";
  if (!SUBJECT_PATTERN.test(subject)) {
    throw new CavemanCommitError(
      "INVALID_AI_RESPONSE",
      'Resposta inválida da IA: use o formato <type>(<scope>): <resumo>, com escopo opcional, por exemplo: "fix(validação): corrigir token".',
    );
  }
  if (subject.length > 72) {
    throw new CavemanCommitError(
      "INVALID_AI_RESPONSE",
      `Resposta inválida da IA: o subject tem ${subject.length} caracteres; use no máximo 72.`,
    );
  }
  if (subject.endsWith(".")) {
    throw new CavemanCommitError(
      "INVALID_AI_RESPONSE",
      "Resposta inválida da IA: não termine o subject com ponto.",
    );
  }
  if (lines.length > 1 && lines[1]?.trim() !== "") {
    throw new CavemanCommitError(
      "INVALID_AI_RESPONSE",
      "Resposta inválida da IA: separe subject e body com uma linha vazia.",
    );
  }
  if (lines.slice(1).some((line) => SUBJECT_PATTERN.test(line.trim()))) {
    throw new CavemanCommitError(
      "INVALID_AI_RESPONSE",
      "Resposta inválida da IA: múltiplas mensagens foram retornadas.",
    );
  }

  const body = lines.slice(2).join("\n").trim();
  return body.length > 0
    ? { message: `${subject}\n\n${body}`, subject, body }
    : { message: subject, subject };
}
