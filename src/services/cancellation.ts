import { CavemanCommitError } from "../errors";
import type { CancellationLike } from "../process/runProcess";

export function checkCancellation(token: CancellationLike): void {
  if (token.isCancellationRequested) {
    throw new CavemanCommitError("OPERATION_CANCELLED", "Operação cancelada.");
  }
}

export function cancellable<T>(promise: PromiseLike<T>, token: CancellationLike): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const holder: { current?: { dispose(): void } } = {};
    const registration = token.onCancellationRequested(() => {
      holder.current?.dispose();
      reject(new CavemanCommitError("OPERATION_CANCELLED", "Operação cancelada."));
    });
    holder.current = registration;
    Promise.resolve(promise).then(resolve, reject).finally(() => registration.dispose());
    if (token.isCancellationRequested) {
      registration.dispose();
      reject(new CavemanCommitError("OPERATION_CANCELLED", "Operação cancelada."));
    }
  });
}
