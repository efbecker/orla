import { cursorAtEnd, readNewLines, type FileCursor } from "./log-reader.js";

export type LogKind = "access" | "error";

type Listener = (lines: string[]) => void;

interface Channel {
  file: string;
  listeners: Set<Listener>;
  cursor: FileCursor | null;
  timer: NodeJS.Timeout | null;
  polling: boolean;
}

/**
 * Shared followers for the live log viewer: one poller per log file, started
 * on the first subscriber and stopped with the last, fanning new lines out to
 * every SSE connection.
 */
export class LiveLogHub {
  private readonly channels: Record<LogKind, Channel>;

  constructor(files: Record<LogKind, string>, private readonly intervalMs = 1000) {
    this.channels = {
      access: { file: files.access, listeners: new Set(), cursor: null, timer: null, polling: false },
      error: { file: files.error, listeners: new Set(), cursor: null, timer: null, polling: false },
    };
  }

  file(kind: LogKind): string {
    return this.channels[kind].file;
  }

  async subscribe(kind: LogKind, listener: Listener): Promise<() => void> {
    const channel = this.channels[kind];
    channel.listeners.add(listener);
    if (!channel.timer) {
      channel.cursor = await cursorAtEnd(channel.file);
      channel.timer = setInterval(() => void this.poll(channel), this.intervalMs);
    }
    return () => {
      channel.listeners.delete(listener);
      if (channel.listeners.size === 0 && channel.timer) {
        clearInterval(channel.timer);
        channel.timer = null;
      }
    };
  }

  private async poll(channel: Channel): Promise<void> {
    if (channel.polling) return;
    channel.polling = true;
    try {
      const { lines, cursor } = await readNewLines(channel.file, channel.cursor);
      channel.cursor = cursor;
      if (lines.length > 0) {
        for (const listener of channel.listeners) listener(lines);
      }
    } catch {
      // The file may be mid-rotation; the next tick retries.
    } finally {
      channel.polling = false;
    }
  }

  close(): void {
    for (const channel of Object.values(this.channels)) {
      if (channel.timer) clearInterval(channel.timer);
      channel.timer = null;
      channel.listeners.clear();
    }
  }
}
