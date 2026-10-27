import { Prisma, type DeploymentTrigger, type PrismaClient } from "@prisma/client";
import { readCapabilities } from "../nginx/capabilities.js";
import { compileConfig, previewHostConfig } from "../nginx/compiler.js";
import { NginxReloadError, NginxTestError } from "../nginx/errors.js";
import type { ApplyResult, NginxConfigExecutor } from "../nginx/executor.js";
import { loadConfigSnapshot } from "../nginx/loader.js";
import { hostInclude, type NginxPaths } from "../nginx/types.js";
import type { SecretBox } from "../lib/crypto.js";
import { notFound } from "../lib/http-errors.js";
import { recordAudit, type Actor, type AuditEntry } from "./audit.js";

export type Tx = Prisma.TransactionClient;

export interface ChangeOutcome<T> {
  result: T;
  audit: AuditEntry;
}

interface ConfigServiceOptions {
  prisma: PrismaClient;
  executor: NginxConfigExecutor;
  secrets: SecretBox;
  paths: NginxPaths;
  runtimeDir: string;
  logger: { info(obj: object, msg?: string): void; error(obj: object, msg?: string): void };
}

/** Thrown inside a transaction to roll it back after computing a preview. */
class PreviewRollback extends Error {
  constructor(readonly config: string) {
    super("preview");
  }
}

const TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 15_000 };

/**
 * Every change that affects Nginx goes through `change()`:
 *
 *   BEGIN; mutate DB; compile from the transaction's view; executor.apply
 *   (snapshot -> write -> nginx -t -> reload, or restore); audit; COMMIT
 *
 * If Nginx rejects the result, the database transaction is rolled back too,
 * so the database (the source of truth) never holds a configuration that
 * Nginx refused.
 */
export class ConfigService {
  constructor(private readonly options: ConfigServiceOptions) {}

  private compile(snapshot: Awaited<ReturnType<typeof loadConfigSnapshot>>, caps: Awaited<ReturnType<typeof readCapabilities>>) {
    return compileConfig(snapshot, { caps, paths: this.options.paths });
  }

  private decrypt = (value: string): string => this.options.secrets.decrypt(value);

  async change<T>(actor: Actor, summary: string, mutate: (tx: Tx) => Promise<ChangeOutcome<T>>): Promise<T> {
    const { prisma, executor } = this.options;
    return executor.exclusive(async () => {
      const startedAt = Date.now();
      const deployment = await prisma.deployment.create({
        data: { summary, trigger: "USER", triggeredById: actor.userId },
      });
      let applied: ApplyResult | null = null;
      try {
        const result = await prisma.$transaction(async (tx) => {
          const outcome = await mutate(tx);
          const caps = await readCapabilities(this.options.runtimeDir);
          const files = this.compile(await loadConfigSnapshot(tx, this.decrypt), caps);
          applied = await executor.apply(files);
          await recordAudit(tx, actor, outcome.audit);
          return outcome.result;
        }, TRANSACTION_OPTIONS);
        const done = applied as ApplyResult | null;
        await this.finishDeployment(deployment.id, startedAt, {
          status: "SUCCESS",
          fileHashes: done?.fileHashes,
          nginxTestOutput: done?.testOutput,
        });
        return result;
      } catch (error) {
        if (applied) {
          // Nginx already runs the new files but the commit failed: converge
          // Nginx back to what the database actually holds.
          await this.syncUnlocked("SYSTEM", null, "Reaplicação após falha no commit").catch((syncError: unknown) => {
            this.options.logger.error({ err: syncError }, "failed to resync nginx after a failed commit");
          });
        }
        await this.finishDeployment(deployment.id, startedAt, deploymentFailure(error));
        throw error;
      }
    });
  }

  /** Recompiles everything from the database and applies it. */
  sync(trigger: DeploymentTrigger, actorId: number | null, summary: string): Promise<ApplyResult> {
    return this.options.executor.exclusive(() => this.syncUnlocked(trigger, actorId, summary));
  }

  private async syncUnlocked(trigger: DeploymentTrigger, actorId: number | null, summary: string): Promise<ApplyResult> {
    const { prisma, executor } = this.options;
    const startedAt = Date.now();
    const deployment = await prisma.deployment.create({ data: { summary, trigger, triggeredById: actorId } });
    try {
      const caps = await readCapabilities(this.options.runtimeDir);
      const files = this.compile(await loadConfigSnapshot(prisma, this.decrypt), caps);
      const result = await executor.apply(files);
      await this.finishDeployment(deployment.id, startedAt, {
        status: "SUCCESS",
        fileHashes: result.fileHashes,
        nginxTestOutput: result.testOutput,
      });
      return result;
    } catch (error) {
      await this.finishDeployment(deployment.id, startedAt, deploymentFailure(error));
      throw error;
    }
  }

  /** Compiles and runs `nginx -t` without keeping the files. */
  validate(): Promise<{ ok: boolean; output: string }> {
    const { prisma, executor } = this.options;
    return executor.exclusive(async () => {
      const caps = await readCapabilities(this.options.runtimeDir);
      const files = this.compile(await loadConfigSnapshot(prisma, this.decrypt), caps);
      return executor.validate(files);
    });
  }

  /**
   * Runs `mutate` in a transaction that is always rolled back and returns the
   * rendered host file: "Visualizar .conf" for unsaved changes.
   */
  async preview(mutate: (tx: Tx) => Promise<number>): Promise<string> {
    const { prisma } = this.options;
    try {
      await prisma.$transaction(async (tx) => {
        const hostId = await mutate(tx);
        const host = await tx.proxyHost.findUnique({ where: { id: hostId }, include: hostInclude });
        if (!host) throw notFound("Host não encontrado.");
        const caps = await readCapabilities(this.options.runtimeDir);
        const snapshot = await loadConfigSnapshot(tx, this.decrypt);
        throw new PreviewRollback(previewHostConfig(host, snapshot, { caps, paths: this.options.paths }));
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof PreviewRollback) return error.config;
      throw error;
    }
    throw new Error("preview transaction committed unexpectedly");
  }

  private async finishDeployment(
    id: number,
    startedAt: number,
    data: {
      status: "SUCCESS" | "FAILED" | "ROLLED_BACK";
      fileHashes?: Record<string, string>;
      nginxTestOutput?: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    await this.options.prisma.deployment
      .update({
        where: { id },
        data: {
          status: data.status,
          fileHashes: data.fileHashes ?? Prisma.DbNull,
          nginxTestOutput: data.nginxTestOutput ?? null,
          errorMessage: data.errorMessage ?? null,
          durationMs: Date.now() - startedAt,
          finishedAt: new Date(),
        },
      })
      .catch((error: unknown) => this.options.logger.error({ err: error }, "failed to update deployment record"));
  }
}

function deploymentFailure(error: unknown) {
  if (error instanceof NginxTestError) {
    return { status: "ROLLED_BACK" as const, nginxTestOutput: error.output, errorMessage: error.message };
  }
  if (error instanceof NginxReloadError) {
    return { status: "ROLLED_BACK" as const, nginxTestOutput: error.output, errorMessage: error.message };
  }
  return { status: "FAILED" as const, errorMessage: error instanceof Error ? error.message : String(error) };
}
