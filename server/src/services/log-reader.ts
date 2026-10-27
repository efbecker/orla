import { open, stat } from "node:fs/promises";

export interface FileCursor {
  inode: number;
  offset: number;
}

const MAX_CHUNK = 8 * 1024 * 1024;

async function readRange(file: string, start: number, end: number): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const length = Math.min(end - start, MAX_CHUNK);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Splits a chunk into complete lines; returns how many bytes they used. */
function completeLines(chunk: Buffer): { lines: string[]; consumed: number } {
  const lastNewline = chunk.lastIndexOf(0x0a);
  if (lastNewline === -1) return { lines: [], consumed: 0 };
  const text = chunk.subarray(0, lastNewline).toString("utf8");
  return { lines: text.length > 0 ? text.split("\n") : [""], consumed: lastNewline + 1 };
}

/**
 * Reads complete lines appended since `cursor`. Handles truncation and
 * logrotate (the previous file is finished from `<file>.1` when its inode
 * matches the cursor). Returns the new cursor.
 */
export async function readNewLines(file: string, cursor: FileCursor | null): Promise<{ lines: string[]; cursor: FileCursor }> {
  const info = await stat(file).catch(() => null);
  if (!info) return { lines: [], cursor: cursor ?? { inode: 0, offset: 0 } };

  const lines: string[] = [];
  let offset = cursor && cursor.inode === info.ino ? cursor.offset : 0;

  if (cursor && cursor.inode !== info.ino && cursor.inode !== 0) {
    const rotated = await stat(`${file}.1`).catch(() => null);
    if (rotated && rotated.ino === cursor.inode && rotated.size > cursor.offset) {
      const chunk = await readRange(`${file}.1`, cursor.offset, rotated.size);
      lines.push(...completeLines(chunk).lines);
    }
  }
  if (offset > info.size) offset = 0;
  if (info.size > offset) {
    const chunk = await readRange(file, offset, info.size);
    const { lines: fresh, consumed } = completeLines(chunk);
    lines.push(...fresh);
    offset += consumed;
  }
  return { lines: lines.filter((line) => line.length > 0), cursor: { inode: info.ino, offset } };
}

/** Last `count` lines of a file (reads at most the final 2 MB). */
export async function tailLines(file: string, count: number): Promise<string[]> {
  const info = await stat(file).catch(() => null);
  if (!info || info.size === 0) return [];
  const start = Math.max(0, info.size - 2 * 1024 * 1024);
  const chunk = await readRange(file, start, info.size);
  const lines = chunk.toString("utf8").split("\n").filter((line) => line.length > 0);
  if (start > 0) lines.shift();
  return lines.slice(-count);
}

/** Current end of file, used by live followers to skip history. */
export async function cursorAtEnd(file: string): Promise<FileCursor> {
  const info = await stat(file).catch(() => null);
  return info ? { inode: info.ino, offset: info.size } : { inode: 0, offset: 0 };
}
