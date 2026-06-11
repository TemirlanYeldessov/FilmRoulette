// Tiny in-memory LRU+TTL cache for list endpoints (top charts, trending). Switching
// media type / category / page and coming back hits this instead of refetching
// every time. Detail, random and AI requests intentionally bypass it — those
// want fresh or randomised data.
//
// Bounded so a long session (paging through many top/trending lists) can't grow
// the Map without limit: a JS Map keeps insertion order, so the oldest key is
// always the first one — we evict it once we exceed MAX_ENTRIES. Reads refresh
// recency by re-inserting, making eviction true LRU rather than FIFO.
type Entry = { ts: number; data: any };

const store = new Map<string, Entry>();

const MAX_ENTRIES = 100;

export function getCached<T = any>(key: string, ttlMs: number): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > ttlMs) {
    store.delete(key);
    return null;
  }
  // Touch: re-insert so this key becomes the most-recently-used (moves to end).
  store.delete(key);
  store.set(key, e);
  return e.data as T;
}

export function setCached(key: string, data: any) {
  // Re-insert at the end (most recent). delete-then-set also refreshes position
  // for an existing key.
  store.delete(key);
  store.set(key, { ts: Date.now(), data });
  if (store.size > MAX_ENTRIES) {
    // Oldest = first key in insertion order.
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

export const LIST_TTL = 3 * 60 * 1000;
