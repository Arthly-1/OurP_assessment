import { LRUCache } from 'lru-cache';

export interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
}

export interface ByteCacheOptions<V> {
  maxBytes: number;
  ttlMs: number;
  /** How many bytes `value` occupies. */
  sizeOf: (value: V) => number;
}

/**
 * In-memory LRU bounded by *bytes* (not entry count) with a TTL. Entries bigger than the whole
 * budget are silently not stored. Swap this class for a Redis-backed one behind `Cache<V>` to
 * share the cache across instances.
 */
export class ByteCache<V extends object> implements Cache<V> {
  private readonly store: LRUCache<string, V>;

  constructor(options: ByteCacheOptions<V>) {
    this.store = new LRUCache<string, V>({
      maxSize: options.maxBytes,
      // lru-cache requires a positive integer size per entry.
      sizeCalculation: (value) => Math.max(1, options.sizeOf(value)),
      ttl: options.ttlMs,
      ttlAutopurge: false,
    });
  }

  get(key: string): V | undefined {
    return this.store.get(key);
  }

  set(key: string, value: V): void {
    this.store.set(key, value);
  }
}
