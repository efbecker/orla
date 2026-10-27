interface Logger {
  error(obj: object, msg?: string): void;
}

/** Runs async jobs on fixed intervals, never overlapping runs of the same job. */
export class Scheduler {
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly logger: Logger) {}

  every(name: string, intervalMs: number, job: () => Promise<void>, options: { runImmediately?: boolean } = {}): void {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job();
      } catch (error) {
        this.logger.error({ err: error, job: name }, "scheduled job failed");
      } finally {
        running = false;
      }
    };
    if (options.runImmediately) void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    timer.unref();
    this.timers.push(timer);
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }
}
