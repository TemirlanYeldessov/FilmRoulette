// A lazily-paginated TMDB feed over one or more endpoints — one source per
// search term, or a single /discover query. The screen loads page 1 up front
// and pulls more pages only as the user scrolls, so a 2600-result query costs
// one request to start instead of 130. Dedupes across pages and sources and
// tracks a best-effort total for the "Найдено: N из M" header.
//
// Kept out of MoodScreen (which only binds the fetcher + paints the grid) so the
// pagination state machine is unit-testable with a mock fetchJson.

export type FeedSourceSpec = {
  // Build the request URL for a 1-based page number.
  makeUrl: (page: number) => string;
  // media_type to stamp on each item. /discover omits it; /search/multi sets it
  // per-item, so leave this undefined there and the item's own value is used.
  fixedType?: 'movie' | 'tv';
};

type FeedSource = FeedSourceSpec & { nextPage: number; totalPages: number };

// TMDB never serves results past page 500, whatever total_pages claims.
const MAX_TMDB_PAGE = 500;

export class TmdbFeed {
  private sources: FeedSource[];
  private seen = new Set<string>();
  // Summed total_results across sources — an upper bound, since sources can
  // overlap and we dedupe. Shown to the user as the "≈ N available" figure.
  total = 0;

  constructor(specs: FeedSourceSpec[]) {
    this.sources = specs.map(s => ({ ...s, nextPage: 1, totalPages: 0 }));
  }

  // No source has a page left to fetch. False until the first load, since
  // totalPages is unknown (0) up front.
  get exhausted(): boolean {
    return this.sources.every(s => s.totalPages > 0 && s.nextPage > s.totalPages);
  }

  // Pull the next page from every source that still has one, in parallel, then
  // merge + dedupe. `fetchJson(url)` does the request and returns parsed JSON;
  // it must reject with an AbortError to cancel (that propagates out). Any other
  // per-source failure is swallowed and ends that source, so one bad page can't
  // blank the batch or loop forever.
  async loadNext(
    fetchJson: (url: string) => Promise<any>,
    hidden?: Set<string>,
  ): Promise<any[]> {
    const active = this.sources.filter(s => s.totalPages === 0 || s.nextPage <= s.totalPages);
    if (active.length === 0) return [];

    const responses = await Promise.all(active.map(s =>
      fetchJson(s.makeUrl(s.nextPage))
        .then(data => ({ s, data }))
        .catch((e: any) => {
          if (e?.name === 'AbortError') throw e;
          return { s, data: null };
        }),
    ));

    const fresh: any[] = [];
    for (const { s, data } of responses) {
      s.nextPage += 1;
      const totalPages = Number(data?.total_pages);
      if (Number.isFinite(totalPages)) {
        if (s.totalPages === 0) this.total += Number(data?.total_results) || 0;
        s.totalPages = Math.min(totalPages, MAX_TMDB_PAGE);
      } else {
        // No usable response — stop paging this source so we don't retry a
        // dead endpoint on every scroll.
        s.totalPages = s.nextPage - 1;
      }
      for (const m of data?.results || []) {
        const type = s.fixedType
          ?? (m.media_type === 'movie' || m.media_type === 'tv' ? m.media_type : null);
        if (type !== 'movie' && type !== 'tv') continue;
        if (!m.poster_path) continue;
        const key = `${m.id}-${type}`;
        if (this.seen.has(key) || hidden?.has(key)) continue;
        this.seen.add(key);
        fresh.push({ ...m, media_type: type });
      }
    }
    return fresh;
  }
}
