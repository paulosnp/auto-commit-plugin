export interface ClipboardLike {
  writeText(value: string): Thenable<void>;
}

export async function copyCommitMessage(
  clipboard: ClipboardLike,
  message: string,
): Promise<void> {
  await clipboard.writeText(message);
}
