import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NginxReloadError, NginxTestError } from "./errors.js";
import { NginxConfigExecutor, parseNginxOutput } from "./executor.js";
import type { CompiledFile } from "./types.js";

let base: string;
let roots: { hosts: string; generated: string };

const ok = ["sh", "-c", "echo 'nginx: configuration file test is successful' >&2"];

function failing(hostsDir: string): string[] {
  return [
    "sh",
    "-c",
    `echo 'nginx: [emerg] unknown directive "bogus" in ${hostsDir}/host-2.conf:2' >&2; echo 'nginx: configuration file test failed' >&2; exit 1`,
  ];
}

function file(root: "hosts" | "generated", filePath: string, content: string, mode = 0o640): CompiledFile {
  return { root, path: filePath, content, mode };
}

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "orla-exec-"));
  roots = { hosts: path.join(base, "conf.d"), generated: path.join(base, "generated") };
  await mkdir(roots.hosts, { recursive: true });
  await mkdir(path.join(roots.generated, "http.d"), { recursive: true });
  await writeFile(path.join(roots.hosts, "host-1.conf"), "old host 1\n", { mode: 0o640 });
  await writeFile(path.join(roots.hosts, "unmanaged.conf"), "keep me\n");
  await writeFile(path.join(roots.generated, "http.d/upstreams.conf"), "old upstreams\n", { mode: 0o640 });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("NginxConfigExecutor", () => {
  it("writes the new managed set, removes stale files and reloads", async () => {
    const reloadMarker = path.join(base, "reloaded");
    const executor = new NginxConfigExecutor({ roots, testCommand: ok, reloadCommand: ["sh", "-c", `touch ${reloadMarker}`] });

    const result = await executor.exclusive(() =>
      executor.apply([
        file("hosts", "host-2.conf", "new host 2\n"),
        file("generated", "http.d/upstreams.conf", "new upstreams\n"),
        file("generated", "certs/3/privkey.pem", "key\n", 0o600),
      ]),
    );

    expect(result.changed).toEqual([
      "generated/certs/3/privkey.pem",
      "generated/http.d/upstreams.conf",
      "hosts/host-1.conf",
      "hosts/host-2.conf",
    ]);
    expect(await readdir(roots.hosts)).toEqual(["host-2.conf", "unmanaged.conf"]);
    expect((await stat(path.join(roots.generated, "certs/3/privkey.pem"))).mode & 0o777).toBe(0o600);
    expect(await readFile(reloadMarker, "utf8")).toBe("");
    expect(Object.keys(result.fileHashes)).toHaveLength(3);
  });

  it("restores the snapshot and reports the exact nginx error when the test fails", async () => {
    const executor = new NginxConfigExecutor({ roots, testCommand: failing(roots.hosts), reloadCommand: ["false"] });

    const promise = executor.exclusive(() =>
      executor.apply([file("hosts", "host-2.conf", "server {\n    bogus on;\n}\n"), file("generated", "http.d/upstreams.conf", "new\n")]),
    );
    await expect(promise).rejects.toBeInstanceOf(NginxTestError);
    const error = (await promise.catch((e: unknown) => e)) as NginxTestError;
    expect(error.diagnostics[0]).toMatchObject({
      level: "emerg",
      message: 'unknown directive "bogus"',
      file: "hosts/host-2.conf",
      line: 2,
      source: "bogus on;",
    });
    expect(error.message).toContain("linha 2");

    expect(await readdir(roots.hosts)).toEqual(["host-1.conf", "unmanaged.conf"]);
    expect(await readFile(path.join(roots.hosts, "host-1.conf"), "utf8")).toBe("old host 1\n");
    expect(await readFile(path.join(roots.generated, "http.d/upstreams.conf"), "utf8")).toBe("old upstreams\n");
  });

  it("restores the snapshot when the reload fails", async () => {
    const executor = new NginxConfigExecutor({ roots, testCommand: ok, reloadCommand: ["sh", "-c", "echo boom >&2; exit 1"] });
    await expect(executor.exclusive(() => executor.apply([file("hosts", "host-1.conf", "changed\n")]))).rejects.toBeInstanceOf(
      NginxReloadError,
    );
    expect(await readFile(path.join(roots.hosts, "host-1.conf"), "utf8")).toBe("old host 1\n");
  });

  it("does not reload when nothing changed", async () => {
    const executor = new NginxConfigExecutor({ roots, testCommand: ok, reloadCommand: ["false"] });
    const result = await executor.exclusive(() =>
      executor.apply([file("hosts", "host-1.conf", "old host 1\n"), file("generated", "http.d/upstreams.conf", "old upstreams\n")]),
    );
    expect(result.changed).toEqual([]);
  });

  it("validate() always restores the previous files", async () => {
    const executor = new NginxConfigExecutor({ roots, testCommand: ok, reloadCommand: ["false"] });
    await executor.exclusive(() => executor.validate([file("hosts", "host-9.conf", "x\n")]));
    expect(await readdir(roots.hosts)).toEqual(["host-1.conf", "unmanaged.conf"]);
  });

  it("serializes concurrent runs", async () => {
    const executor = new NginxConfigExecutor({ roots, testCommand: ok, reloadCommand: ok });
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        executor.exclusive(async () => {
          order.push(n);
          await executor.apply([file("hosts", `host-${n}.conf`, `${n}\n`)]);
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe("parseNginxOutput", () => {
  it("keeps unknown paths absolute", () => {
    const [diagnostic] = parseNginxOutput("nginx: [emerg] bad in /etc/nginx/nginx.conf:10", roots);
    expect(diagnostic).toMatchObject({ file: "/etc/nginx/nginx.conf", line: 10 });
  });
});
