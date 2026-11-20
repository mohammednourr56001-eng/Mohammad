import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SafeJsonStore } from './safeJsonStore.ts';

test('SafeJsonStore caches reads in memory and prevents concurrent write corruption', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ust-json-store-'));
  try {
    const store = new SafeJsonStore(tmpDir);
    const filename = 'concurrent-index.json';

    const initial = store.readSync<Record<string, number>>(filename, {});
    assert.deepEqual(initial, {});

    // Fire 100 concurrent updates back-to-back
    const promises: Promise<void>[] = [];
    for (let i = 1; i <= 100; i += 1) {
      const current = store.readSync<Record<string, number>>(filename, {});
      current[`item_${i}`] = i;
      promises.push(store.enqueueWrite(filename, current));
    }

    await Promise.all(promises);
    await store.flushAll();

    // Fresh store instance reading directly from disk must parse valid JSON with all 100 entries
    const verifier = new SafeJsonStore(tmpDir);
    const persisted = verifier.readSync<Record<string, number>>(filename, {});
    assert.equal(Object.keys(persisted).length, 100);
    assert.equal(persisted.item_1, 1);
    assert.equal(persisted.item_100, 100);

    // Ensure no orphaned .tmp files remain
    const files = fs.readdirSync(tmpDir);
    assert.deepEqual(files, [filename]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
