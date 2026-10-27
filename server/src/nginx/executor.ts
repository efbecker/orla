import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NginxReloadError, NginxTestError, type NginxDiagnostic } from "./errors.js";
import type { CompiledFile, FileRoot } from "./types.js";

/*
 * Transactional pipeline for the managed Nginx files:
 *
 *   snapshot -> write new files -> `nginx -t` -> reload
 *                       \-> on any failure: restore snapshot, report error
 *
 * Commands run through execFile with a fixed argv (never a shell). Runs are
 * serialized with an in-process queue: only one change touches the files at a
 * time.
 */

export interface ExecutorOptions {
  roots: Record<FileRoot, string>;
  testCommand: string[];
  reloadCommand: string[];
  commandTimeoutMs?: number;
}

export interface CommandResult {
  ok: boolean;
  output: string;
}

export interface ApplyResult {
  /** Relative paths ("hosts/host-1.conf") that were created, changed or removed. */
  changed: string[];
  fileHashes: Record<string, string>;
  testOutput: string;
}

interface SnapshotEntry {
  content: Buffer;
  mode: number;
}

type Snapshot = Map<string, SnapshotEntry>;

const HOST_FILE = /^host-\d+\.conf$/;
const DIR_MODE = 0o750;

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function runCommand(argv: string[], timeoutMs: number): Promise<CommandResult> {
  const [file, ...args] = argv;
  if (!file) return Promise.resolve({ ok: false, output: "Comando vazio." });
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin" } }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      if (error) {
        const reason = error.killed ? "tempo esgotado" : error.message;
        resolve({ ok: false, output: output || reason });
        return;
      }
      resolve({ ok: true, output });
    });
  });
}

/** Parses `nginx -t` output into structured diagnostics. */
export function parseNginxOutput(output: string, roots: Record<FileRoot, string>, files?: Map<string, string>): NginxDiagnostic[] {
  const diagnostics: NginxDiagnostic[] = [];
  const pattern = /^nginx: \[(\w+)\] (.*?)(?: in (\/\S+?):(\d+))?$/;
  for (const line of output.split(/\r?\n/)) {
    const match = pattern.exec(line.trim());
    if (!match) continue;
    const [, level = "error", message = "", absolute, lineNumber] = match;
    const diagnostic: NginxDiagnostic = { level, message };
    if (absolute) {
      const relative = toRelative(absolute, roots);
      diagnostic.file = relative ?? absolute;
      diagnostic.line = Number(lineNumber);
      const content = relative ? files?.get(relative) : undefined;
      if (content !== undefined) diagnostic.source = content.split("\n")[diagnostic.line - 1]?.trim();
    }
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

function toRelative(absolute: string, roots: Record<FileRoot, string>): string | undefined {
  for (const [root, dir] of Object.entries(roots) as Array<[FileRoot, string]>) {
    const rel = path.relative(dir, absolute);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return `${root}/${rel.split(path.sep).join("/")}`;
  }
  return undefined;
}

export class NginxConfigExecutor {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly timeoutMs: number;

  constructor(private readonly options: ExecutorOptions) {
    this.timeoutMs = options.commandTimeoutMs ?? 30_000;
  }

  /** Runs `task` after every previously queued task (global config lock). */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Writes `files` as the complete managed set, validates and reloads.
   * Must be called inside `exclusive` (the config services do this).
   */
  async apply(files: CompiledFile[]): Promise<ApplyResult> {
    const snapshot = await this.snapshot();
    const contents = new Map(files.map((file) => [`${file.root}/${file.path}`, file.content]));
    let changed: string[];
    try {
      changed = await this.writeAll(files, snapshot);
    } catch (error) {
      await this.restore(snapshot);
      throw error;
    }

    const test = await runCommand(this.options.testCommand, this.timeoutMs);
    if (!test.ok) {
      await this.restore(snapshot);
      throw new NginxTestError(parseNginxOutput(test.output, this.options.roots, contents), test.output);
    }

    if (changed.length > 0) {
      const reload = await runCommand(this.options.reloadCommand, this.timeoutMs);
      if (!reload.ok) {
        await this.restore(snapshot);
        throw new NginxReloadError(reload.output);
      }
    }

    const fileHashes = Object.fromEntries([...contents].map(([key, content]) => [key, sha256(content)]));
    return { changed, fileHashes, testOutput: test.output };
  }

  /** Writes `files`, runs `nginx -t` and always restores the previous files. */
  async validate(files: CompiledFile[]): Promise<CommandResult> {
    const snapshot = await this.snapshot();
    const contents = new Map(files.map((file) => [`${file.root}/${file.path}`, file.content]));
    try {
      await this.writeAll(files, snapshot);
      const test = await runCommand(this.options.testCommand, this.timeoutMs);
      if (!test.ok) {
        throw new NginxTestError(parseNginxOutput(test.output, this.options.roots, contents), test.output);
      }
      return test;
    } finally {
      await this.restore(snapshot);
    }
  }

  /** Current managed files, keyed by "root/relative/path". */
  async snapshot(): Promise<Snapshot> {
    const entries: Snapshot = new Map();
    for (const [root, dir] of Object.entries(this.options.roots) as Array<[FileRoot, string]>) {
      for (const relative of await this.listManaged(root, dir)) {
        const absolute = path.join(dir, relative);
        const [content, info] = await Promise.all([readFile(absolute), stat(absolute)]);
        entries.set(`${root}/${relative}`, { content, mode: info.mode & 0o777 });
      }
    }
    return entries;
  }

  private async listManaged(root: FileRoot, dir: string): Promise<string[]> {
    if (root === "hosts") {
      const names = await readdir(dir).catch(() => [] as string[]);
      return names.filter((name) => HOST_FILE.test(name)).sort();
    }
    const result: string[] = [];
    const walk = async (relative: string): Promise<void> => {
      const entries = await readdir(path.join(dir, relative), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const child = relative ? path.posix.join(relative, entry.name) : entry.name;
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile() && !entry.name.startsWith(".orla-tmp-")) result.push(child);
      }
    };
    await walk("");
    return result.sort();
  }

  private absolute(key: string): string {
    const slash = key.indexOf("/");
    const root = key.slice(0, slash) as FileRoot;
    const relative = key.slice(slash + 1);
    const base = this.options.roots[root];
    const absolute = path.resolve(base, relative);
    if (!absolute.startsWith(`${path.resolve(base)}${path.sep}`)) {
      throw new Error(`Caminho fora do diretório gerenciado: ${key}`);
    }
    return absolute;
  }

  private async writeFileAtomic(absolute: string, content: string | Buffer, mode: number): Promise<void> {
    await mkdir(path.dirname(absolute), { recursive: true, mode: DIR_MODE });
    const temp = path.join(path.dirname(absolute), `.orla-tmp-${randomBytes(6).toString("hex")}`);
    await writeFile(temp, content, { mode });
    await chmod(temp, mode);
    await rename(temp, absolute);
  }

  /** Makes the managed set equal to `files`; returns the keys that changed. */
  private async writeAll(files: CompiledFile[], current: Snapshot): Promise<string[]> {
    const changed: string[] = [];
    const desired = new Set<string>();
    for (const file of files) {
      const key = `${file.root}/${file.path}`;
      desired.add(key);
      const existing = current.get(key);
      if (existing && existing.mode === file.mode && existing.content.equals(Buffer.from(file.content))) continue;
      await this.writeFileAtomic(this.absolute(key), file.content, file.mode);
      changed.push(key);
    }
    for (const key of current.keys()) {
      if (desired.has(key)) continue;
      await unlink(this.absolute(key)).catch(() => undefined);
      await this.removeEmptyParents(key);
      changed.push(key);
    }
    return changed.sort();
  }

  private async restore(snapshot: Snapshot): Promise<void> {
    const current = await this.snapshot();
    for (const key of current.keys()) {
      if (!snapshot.has(key)) {
        await rm(this.absolute(key), { force: true });
        await this.removeEmptyParents(key);
      }
    }
    for (const [key, entry] of snapshot) {
      const existing = current.get(key);
      if (existing && existing.mode === entry.mode && existing.content.equals(entry.content)) continue;
      await this.writeFileAtomic(this.absolute(key), entry.content, entry.mode);
    }
  }

  /** Removes now-empty subdirectories (e.g. certs/12/) below the root. */
  private async removeEmptyParents(key: string): Promise<void> {
    const slash = key.indexOf("/");
    const root = path.resolve(this.options.roots[key.slice(0, slash) as FileRoot]);
    let dir = path.dirname(this.absolute(key));
    const keep = new Set(["http.d", "ip-lists", "htpasswd", "certs", "www"].map((name) => path.join(root, name)));
    while (dir.startsWith(`${root}${path.sep}`) && !keep.has(dir)) {
      try {
        await rmdir(dir);
      } catch {
        return;
      }
      dir = path.dirname(dir);
    }
  }
}
