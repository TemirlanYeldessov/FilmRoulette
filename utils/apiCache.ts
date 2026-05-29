// Tiny in-memory TTL cache for list endpoints (top charts, trending). Switching
// media type / category / page and coming back hits this instead of refetching
// every time. Detail, random and AI requests intentionally bypass it — those
// want fresh or randomised data.
type Entry = { ts: number; data: any };

const store = new Map<string, Entry>();

export function getCached<T = any>(key: string, ttlMs: number): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > ttlMs) {
    store.delete(key);
    return null;
  }
  return e.data as T;
}

export function setCached(key: string, data: any) {
  store.set(key, { ts: Date.now(), data });
}

export const LIST_TTL = 3 * 60 * 1000;
