export interface CancellationController<Token> {
  readonly token: Token;
  cancel(): void;
  dispose(): void;
}

export class RestartableOperation<Token> {
  private controller: CancellationController<Token> | undefined;
  private running = false;
  private restartRequested = false;
  private disposed = false;

  public constructor(
    private readonly createController: () => CancellationController<Token>,
    private readonly operation: (token: Token) => Promise<void>,
  ) {}

  public async trigger(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.running) {
      this.restartRequested = true;
      this.controller?.cancel();
      return;
    }

    this.running = true;
    try {
      do {
        this.restartRequested = false;
        const controller = this.createController();
        this.controller = controller;
        try {
          await this.operation(controller.token);
        } finally {
          controller.dispose();
          if (this.controller === controller) {
            this.controller = undefined;
          }
        }
      } while (this.restartRequested && !this.disposed);
    } finally {
      this.running = false;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.restartRequested = false;
    this.controller?.cancel();
  }
}
