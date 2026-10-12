import { CavemanCommitError } from "../errors";
import type { CancellationLike } from "../process/runProcess";
import { cancellable, checkCancellation } from "./cancellation";
import { validateCommitMessage } from "./responseValidator";

export async function writeScmMessage(
  inputBox: { value: string },
  text: string,
  confirmReplace: () => PromiseLike<boolean>,
  ensureCurrent: () => Promise<void>,
  cancellation: CancellationLike,
): Promise<boolean> {
  const message = validateCommitMessage(text).message;
  checkCancellation(cancellation);
  const before = inputBox.value;
  if (before.trim() && before !== message && !await cancellable(confirmReplace(), cancellation)) return false;
  await ensureCurrent();
  checkCancellation(cancellation);
  if (inputBox.value !== before) {
    throw new CavemanCommitError("SCM_MESSAGE_CHANGED", "O texto no campo Git mudou. Revise e clique em Usar no Git novamente.");
  }
  inputBox.value = message;
  return true;
}
