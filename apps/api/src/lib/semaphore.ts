/**
 * Bounds concurrent execution of expensive work (image encoding is CPU- and memory-heavy).
 * Up to `maxQueued` callers wait for a slot; beyond that, `onOverflow` supplies the error so
 * the service sheds load quickly instead of building an unbounded backlog.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
    private readonly onOverflow: () => Error,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxQueued) {
      return Promise.reject(this.onOverflow());
    }
    // The slot is handed over directly by release(), so `active` stays constant.
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}
