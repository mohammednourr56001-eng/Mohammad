import net from 'net';
import tls from 'tls';

export interface CacheStats {
  mode: 'redis' | 'in_memory_lru';
  connected: boolean;
  hits: number;
  misses: number;
  hitRatioPct: number;
  keysCount: number;
  evictions: number;
  lastError: string | null;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Lightweight zero-dependency Redis RESP2 client with strict socket timeout.
 * Falls back transparently to the process LRU cache if REDIS_URL is unset or unreachable.
 */
async function execRedisCommand(
  redisUrl: string,
  args: string[],
  timeoutMs = 350
): Promise<string | null> {
  const parsed = new URL(redisUrl);
  const useTls = parsed.protocol === 'rediss:';
  const host = parsed.hostname || '127.0.0.1';
  const port = Number(parsed.port) || 6379;
  const password = parsed.password ? decodeURIComponent(parsed.password) : '';

  const encodeResp = (cmd: string[]): string => {
    let out = `*${cmd.length}\r\n`;
    for (const part of cmd) {
      const bufLen = Buffer.byteLength(part, 'utf8');
      out += `$${bufLen}\r\n${part}\r\n`;
    }
    return out;
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, val: string | null = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(val);
    };

    const socket = useTls
      ? tls.connect({ host, port, rejectUnauthorized: true })
      : net.createConnection({ host, port });

    socket.setTimeout(timeoutMs);

    let buffer = '';
    const expectedResponses = password ? 2 : 1;
    let receivedCount = 0;

    socket.on('connect', () => {
      if (password) {
        socket.write(encodeResp(['AUTH', password]));
      }
      socket.write(encodeResp(args));
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      // Wait until at least the final command response is complete
      if (lines.length < 2) return;

      // Simple parser for +OK, $-1, $N\r\n...\r\n, :N, -ERR
      let idx = 0;
      let lastVal: string | null = null;
      receivedCount = 0;
      while (idx < lines.length - 1) {
        const line = lines[idx];
        if (line.startsWith('-')) {
          return done(new Error(line.slice(1)));
        }
        if (line.startsWith('+') || line.startsWith(':')) {
          lastVal = line.slice(1);
          receivedCount += 1;
          idx += 1;
        } else if (line.startsWith('$')) {
          const byteLen = Number(line.slice(1));
          if (byteLen === -1) {
            lastVal = null;
            receivedCount += 1;
            idx += 1;
          } else if (idx + 1 < lines.length - 1) {
            lastVal = lines[idx + 1];
            receivedCount += 1;
            idx += 2;
          } else {
            return; // wait for more data
          }
        } else {
          idx += 1;
        }
      }

      if (receivedCount >= expectedResponses) {
        done(null, lastVal);
      }
    });

    socket.on('timeout', () => done(new Error('Redis command timeout')));
    socket.on('error', (err) => done(err));
  });
}

export class DistributedCacheLayer {
  private readonly maxEntries: number;
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private redisUrl: string | null;
  private redisHealthy = false;
  private lastError: string | null = null;

  constructor(options?: { maxEntries?: number; redisUrl?: string | null }) {
    this.maxEntries = options?.maxEntries ?? 2500;
    this.redisUrl =
      options?.redisUrl !== undefined
        ? options.redisUrl
        : process.env.REDIS_URL?.trim() || null;
  }

  public isRedisConfigured(): boolean {
    return Boolean(this.redisUrl);
  }

  public async pingRedis(): Promise<boolean> {
    if (!this.redisUrl) {
      this.redisHealthy = false;
      return false;
    }
    try {
      const pong = await execRedisCommand(this.redisUrl, ['PING'], 400);
      this.redisHealthy = pong === 'PONG';
      this.lastError = null;
      return this.redisHealthy;
    } catch (err) {
      this.redisHealthy = false;
      this.lastError = err instanceof Error ? err.message : 'Redis unreachable';
      return false;
    }
  }

  public async get<T>(key: string): Promise<T | null> {
    if (this.redisUrl) {
      try {
        const raw = await execRedisCommand(this.redisUrl, ['GET', key], 300);
        this.redisHealthy = true;
        if (raw !== null) {
          this.hits += 1;
          return JSON.parse(raw) as T;
        }
      } catch (err) {
        this.redisHealthy = false;
        this.lastError = err instanceof Error ? err.message : 'Redis read fallback';
      }
    }

    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return null;
    }

    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
    const safeTtl = Math.max(1, Math.min(86400, Math.floor(ttlSeconds)));
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (!oldestKey) break;
      this.store.delete(oldestKey);
      this.evictions += 1;
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + safeTtl * 1000,
    });

    if (this.redisUrl) {
      try {
        await execRedisCommand(
          this.redisUrl,
          ['SETEX', key, String(safeTtl), JSON.stringify(value)],
          350
        );
        this.redisHealthy = true;
      } catch (err) {
        this.redisHealthy = false;
        this.lastError = err instanceof Error ? err.message : 'Redis write fallback';
      }
    }
  }

  public async del(key: string): Promise<void> {
    this.store.delete(key);
    if (this.redisUrl) {
      try {
        await execRedisCommand(this.redisUrl, ['DEL', key], 300);
      } catch {
        // fallback already deleted local key
      }
    }
  }

  public invalidatePattern(prefixOrSubstring: string): number {
    let removed = 0;
    for (const key of Array.from(this.store.keys())) {
      if (key.includes(prefixOrSubstring)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public clearAll(): void {
    this.store.clear();
  }

  public getStats(): CacheStats {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    const totalLookups = this.hits + this.misses;
    const hitRatioPct =
      totalLookups > 0 ? Math.round((this.hits / totalLookups) * 1000) / 10 : 100;

    return {
      mode: this.redisUrl && this.redisHealthy ? 'redis' : 'in_memory_lru',
      connected: this.redisUrl ? this.redisHealthy : true,
      hits: this.hits,
      misses: this.misses,
      hitRatioPct,
      keysCount: this.store.size,
      evictions: this.evictions,
      lastError: this.lastError,
    };
  }
}

export const cacheLayer = new DistributedCacheLayer();
