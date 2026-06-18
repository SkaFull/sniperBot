import { Logger } from "./logger";

const logger = new Logger("CacheManager");

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // 每 30 秒清理过期缓存
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30000);
  }

  /**
   * 获取缓存
   */
  get<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      logger.debug(`Cache hit: ${key}`);
      return cached.data as T;
    }
    if (cached) {
      this.cache.delete(key);
      logger.debug(`Cache expired: ${key}`);
    }
    return null;
  }

  /**
   * 设置缓存
   */
  set<T>(key: string, data: T, ttlMs: number): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      expiresAt: now + ttlMs,
      createdAt: now
    });
    logger.debug(`Cache set: ${key}, TTL: ${ttlMs}ms`);
  }

  /**
   * 获取或创建缓存
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await factory();
    this.set(key, data, ttlMs);
    return data;
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
    logger.info("Cache cleared");
  }

  /**
   * 清理过期缓存
   */
  private cleanup(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.debug(`Cleaned up ${expiredCount} expired cache entries`);
    }
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    keys: string[];
    totalSize: number;
  } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      totalSize: this.cache.size
    };
  }

  /**
   * 关闭缓存管理器
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

export default CacheManager;