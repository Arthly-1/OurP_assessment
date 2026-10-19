/**
 * Coalesces concurrent calls that share a key into one execution. While a computation for
 * `key` is in flight, further callers receive the same promise instead of repeating the work.
 */
export class SingleFlight<V> {
  private readonly inFlight = new Map<string, Promise<V>>();

  run(key: string, task: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = task().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}
