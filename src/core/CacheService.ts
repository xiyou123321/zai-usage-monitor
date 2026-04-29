import * as vscode from "vscode";

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

/**
 * Cache statistics for debugging
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

/**
 * LRU-style in-memory cache with TTL support
 * Used to reduce redundant API calls for frequently requested data
 */
export class CacheService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private maxEntries: number;
  private defaultTTL: number;

  /**
   * @param maxEntries Maximum number of entries to keep in cache (default: 100)
   * @param defaultTTL Default time-to-live in milliseconds (default: 5 minutes)
   */
  constructor(maxEntries = 100, defaultTTL = 5 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get value from cache
   * Returns null if not found or expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data;
  }

  /**
   * Set value in cache
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // Enforce max entries limit
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    const now = Date.now();
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expiresAt: now + (ttl ?? this.defaultTTL),
    };

    this.cache.set(key, entry);
  }

  /**
   * Delete a specific entry from cache
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const timestamps = Array.from(this.cache.values()).map(
      (entry) => entry.timestamp,
    );

    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
    };
  }

  /**
   * Get hit rate (0-1)
   */
  getHitRate(): number {
    const total = this.hits + this.misses;
    if (total === 0) return 0;
    return this.hits / total;
  }

  /**
   * Evict the oldest entry from cache
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Remove expired entries from cache
   * Returns number of removed entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get or set with factory function
   * If cache hit, return cached value. Otherwise, call factory, cache result, and return it
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await factory();
    this.set(key, data, ttl);
    return data;
  }
}
