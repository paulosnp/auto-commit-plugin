export class CavemanCommitError extends Error {
  public constructor(
    public readonly code: string,
    public readonly userMessage: string,
    options?: ErrorOptions,
  ) {
    super(userMessage, options);
    this.name = "CavemanCommitError";
  }
}

export function asUserMessage(error: unknown): string {
  if (error instanceof CavemanCommitError) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Ocorreu um erro inesperado no Caveman Commit.";
}
