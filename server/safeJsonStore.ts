import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Thread/async-safe JSON persistence store for local index files.
 * - Eliminates hot-path synchronous disk reads via in-memory snapshot caching.
 * - Serializes writes per file via an async promise mutex queue + atomic temp-file rename.
 * - Coalesces rapid bursts of mutations to prevent race conditions and event-loop stalls.
 */
export class SafeJsonStore {
  private readonly baseDir: string;
  private readonly memoryCache = new Map<string, unknown>();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly latestPendingData = new Map<string, string>();
  private readonly writeSeq = new Map<string, number>();

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private ensureDirSync(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolveSafePath(filename: string): string {
    const safeName = path.basename(filename);
    return path.join(this.baseDir, safeName);
  }

  public readSync<T>(filename: string, fallback: T): T {
    const safeName = path.basename(filename);
    if (this.memoryCache.has(safeName)) {
      return this.memoryCache.get(safeName) as T;
    }

    this.ensureDirSync();
    const fullPath = this.resolveSafePath(safeName);
    try {
      if (fs.existsSync(fullPath)) {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw) as T;
        this.memoryCache.set(safeName, parsed);
        return parsed;
      }
    } catch {
      // Fall back cleanly if file does not exist or was corrupted externally
    }
    this.memoryCache.set(safeName, fallback);
    return fallback;
  }

  public enqueueWrite<T>(filename: string, data: T): Promise<void> {
    const safeName = path.basename(filename);
    const serialized = JSON.stringify(data, null, 2);
    this.memoryCache.set(safeName, data);
    this.latestPendingData.set(safeName, serialized);

    const nextSeq = (this.writeSeq.get(safeName) || 0) + 1;
    this.writeSeq.set(safeName, nextSeq);

    const prevChain = this.writeQueues.get(safeName) || Promise.resolve();
    const nextChain = prevChain
      .catch(() => {
        // Keep queue alive even if a previous write errored
      })
      .then(async () => {
        // Coalesce: if newer data was queued while we waited, skip writing stale intermediate JSON
        const payload = this.latestPendingData.get(safeName);
        if (payload === undefined) return;
        // Consume only if this is the latest queued payload; clear before async write so newer writes re-set it
        this.latestPendingData.delete(safeName);

        await fs.promises.mkdir(this.baseDir, { recursive: true });
        const fullPath = this.resolveSafePath(safeName);
        const tmpPath = `${fullPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
        await fs.promises.writeFile(tmpPath, payload, 'utf8');
        await fs.promises.rename(tmpPath, fullPath);
      });

    this.writeQueues.set(safeName, nextChain);
    return nextChain;
  }

  public async flushFile(filename: string): Promise<void> {
    const safeName = path.basename(filename);
    const pending = this.writeQueues.get(safeName);
    if (pending) {
      await pending;
    }
  }

  public async flushAll(): Promise<void> {
    const chains = Array.from(this.writeQueues.values());
    await Promise.allSettled(chains);
  }

  public clearMemoryCache(filename?: string): void {
    if (filename) {
      this.memoryCache.delete(path.basename(filename));
    } else {
      this.memoryCache.clear();
    }
  }
}
