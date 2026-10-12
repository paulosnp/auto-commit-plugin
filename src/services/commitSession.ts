import { createHash } from "node:crypto";
import { normalize } from "node:path";

import type { CavemanSettings } from "../config/settings";
import { CavemanCommitError } from "../errors";
import type { DiffScope } from "../git/gitClient";
import type { RepositoryInfo } from "../git/getRepository";
import type { CancellationLike } from "../process/runProcess";
import { checkCancellation } from "./cancellation";
import { validateCommitMessage } from "./responseValidator";

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function repositoryKey(path: string): string {
  const normalized = normalize(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export interface GenerationContext {
  readonly settings: CavemanSettings;
  readonly skill: string;
}

export interface CommitDraft {
  readonly repositoryName: string;
  readonly repositoryPath: string;
  readonly message: string;
  readonly scope: DiffScope;
  readonly diffHash: string;
  readonly cacheKey: string;
  readonly provider: string;
  readonly model: string;
  readonly stale: boolean;
  readonly reused: boolean;
  readonly copied: boolean;
  readonly canUseGit: boolean;
}

export class CommitCache {
  private readonly entries = new Map<string, string>();

  public get(key: string): string | undefined {
    const message = this.entries.get(key);
    if (message !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, message);
    }
    return message;
  }

  public set(key: string, message: string): void {
    const valid = validateCommitMessage(message).message;
    this.entries.delete(key);
    this.entries.set(key, valid);
    if (this.entries.size > 20) this.entries.delete(this.entries.keys().next().value!);
  }

  public clear(): void { this.entries.clear(); }
}

export interface SessionDependencies {
  readonly readContext: () => Promise<GenerationContext>;
  readonly readDiff: (path: string, scope: DiffScope) => Promise<string>;
  readonly generate: (context: GenerationContext, diff: string) => Promise<string>;
  readonly confirmLargeDiff: (repository: RepositoryInfo, diff: string, context: GenerationContext) => Promise<boolean>;
  readonly canUseGit: (path: string) => Promise<boolean>;
  readonly copy: (message: string) => Promise<void>;
  readonly apply: (path: string, message: string, ensureCurrent: () => Promise<void>) => Promise<boolean>;
  readonly cancellation: CancellationLike;
}

export type DraftAction = "copy" | "useGit";
export interface DraftActionResult {
  readonly outcome: "copied" | "applied" | "stale" | "cancelled";
  readonly draft: CommitDraft;
}

export class CommitSession {
  public constructor(private readonly cache: CommitCache, private readonly dependencies: SessionDependencies) {}

  public async prepare(repository: RepositoryInfo, force = false): Promise<CommitDraft> {
    const { cancellation } = this.dependencies;
    checkCancellation(cancellation);
    const context = await this.dependencies.readContext();
    const { settings, skill } = context;
    const diff = await this.dependencies.readDiff(repository.path, settings.diffScope);
    checkCancellation(cancellation);
    if (!diff.trim()) throw new CavemanCommitError("NO_CHANGES", "Nenhuma alteração encontrada no escopo selecionado.");
    const diffHash = hash(diff);
    const cacheKey = hash(JSON.stringify([
      repositoryKey(repository.path), settings.diffScope, diffHash,
      settings.provider, settings.model, settings.reasoningEffort, hash(skill),
    ]));
    const cached = force ? undefined : this.cache.get(cacheKey);
    let message = cached;
    if (message === undefined) {
      if (!await this.dependencies.confirmLargeDiff(repository, diff, context)) {
        throw new CavemanCommitError("OPERATION_CANCELLED", "Geração cancelada.");
      }
      checkCancellation(cancellation);
      message = validateCommitMessage(await this.dependencies.generate(context, diff)).message;
    }
    checkCancellation(cancellation);
    const canUseGit = await this.dependencies.canUseGit(repository.path);
    const stale = hash(await this.dependencies.readDiff(repository.path, settings.diffScope)) !== diffHash;
    checkCancellation(cancellation);
    if (!stale) this.cache.set(cacheKey, message);
    return {
      repositoryName: repository.name, repositoryPath: repository.path, message,
      scope: settings.diffScope, diffHash, cacheKey,
      provider: settings.provider === "codex" ? "Codex" : "Claude Code", model: settings.model,
      stale, reused: cached !== undefined, copied: false, canUseGit,
    };
  }

  public async isCurrent(draft: CommitDraft): Promise<boolean> {
    const diff = await this.dependencies.readDiff(draft.repositoryPath, draft.scope);
    checkCancellation(this.dependencies.cancellation);
    return hash(diff) === draft.diffHash;
  }

  public async act(draft: CommitDraft, action: DraftAction, text: string, allowStale = false): Promise<DraftActionResult> {
    const message = validateCommitMessage(text).message;
    checkCancellation(this.dependencies.cancellation);
    const current = await this.isCurrent(draft);
    const updated = { ...draft, message, stale: !current };
    if (!current && !allowStale) return { outcome: "stale", draft: updated };
    if (action === "useGit") {
      try {
        const applied = await this.dependencies.apply(draft.repositoryPath, message, async () => {
          checkCancellation(this.dependencies.cancellation);
          if (!allowStale && !await this.isCurrent(draft)) {
            throw new CavemanCommitError("DIFF_CHANGED", "As alterações mudaram. Regenere ou use explicitamente a mensagem anterior.");
          }
        });
        if (!applied) return { outcome: "cancelled", draft: updated };
      } catch (error) {
        if (error instanceof CavemanCommitError && error.code === "DIFF_CHANGED") {
          return { outcome: "stale", draft: { ...updated, stale: true } };
        }
        throw error;
      }
    } else {
      await this.dependencies.copy(message);
    }
    checkCancellation(this.dependencies.cancellation);
    if (await this.isCurrent(draft)) this.cache.set(draft.cacheKey, message);
    return { outcome: action === "copy" ? "copied" : "applied", draft: { ...updated, copied: action === "copy" || (draft.message === message && draft.copied) } };
  }
}
