// Central place that builds TMDB request URLs and the auth header, so screens
// stop hand-writing endpoint strings. The fetch/error handling stays per-screen
// (each binds its own wording via makeTmdbFetch), this only owns the URLs.
import { TMDB_TOKEN } from '../constants/api';
import { applyDiscoverFilters } from './tmdb';

const BASE = 'https://api.themoviedb.org/3';

export const tmdbHeaders = () => ({ Authorization: `Bearer ${TMDB_TOKEN}` });

export const tmdbUrls = {
  // Multi search (movies + tv). `page` is optional — omitted when not given so
  // callers that never paged keep their exact previous URL.
  searchMulti: (query: string, adult: boolean, page?: number) =>
    `${BASE}/search/multi?query=${encodeURIComponent(query)}&language=ru-RU&include_adult=${adult}` +
    (page ? `&page=${page}` : ''),

  // Typed search (movie or tv).
  searchTyped: (type: string, query: string, adult: boolean, page = 1) =>
    `${BASE}/search/${type}?query=${encodeURIComponent(query)}&language=ru-RU&include_adult=${adult}&page=${page}`,

  // Keyword lookup — resolves a concept word ("isekai", "zombie", "time travel")
  // to TMDB keyword ids, which then drive a /discover with_keywords feed. Lets
  // the AI tail page sub-genres/themes that aren't TMDB genres.
  searchKeyword: (query: string) =>
    `${BASE}/search/keyword?query=${encodeURIComponent(query)}`,

  // Discover with a pre-built params object (see applyDiscoverFilters).
  discover: (type: string, params: Record<string, string>) =>
    `${BASE}/discover/${type}?${new URLSearchParams(params)}`,

  trendingWeek: (type: string, page = 1) =>
    `${BASE}/trending/${type}/week?language=ru-RU&page=${page}`,

  // Top chart category (top_rated / popular / now_playing / on_the_air).
  list: (type: string, category: string, page = 1) =>
    `${BASE}/${type}/${category}?language=ru-RU&page=${page}`,

  detail: (type: string, id: number, lang: string, append: string) =>
    `${BASE}/${type}/${id}?language=${lang}&append_to_response=${append}`,

  recommendations: (type: string, id: number, page: number) =>
    `${BASE}/${type}/${id}/recommendations?language=ru-RU&page=${page}`,

  person: (id: number) => `${BASE}/person/${id}?language=ru-RU`,

  personCredits: (id: number) => `${BASE}/person/${id}/combined_credits?language=ru-RU`,
};

// TMDB /discover never returns more than 500 pages, but the useful pool for a
// roulette is the first ~20 (popularity-sorted). We cap random paging there.
const MAX_RANDOM_PAGE = 20;
const MAX_RANDOM_ATTEMPTS = 6;

// Shared roulette core: pick a random not-recently-seen title via Discover.
// Both detail screens use this; they differ only in the detail fetcher, the
// "nothing left" wording and the assembled result shape, which stay at the call
// site. `fetcher` is the screen's bound fetchWithTimeout (preserves its error
// wording). Returns null after several tries so the caller can throw its own
// message. `reused` is true when only already-seen titles remained (drives the
// reroll notice).
//
// Paging is bounded by the query's real total_pages, learned from the first
// response: with narrow filters (country + genre + years) discover may have
// only 1-2 pages, so a blind random page in 1..20 would land on empty pages and
// falsely report "nothing left". We start optimistic, clamp once we know the
// real count, and skip empty pages instead of counting them as exhaustion.
export async function pickRandomDiscoverItem(
  fetcher: (url: string, options?: any) => Promise<Response>,
  opts: {
    type: string;
    selectedGenres: number[];
    adultContent: boolean;
    filters: any;
    recentRandomIds: string[];
    signal?: AbortSignal;
  },
): Promise<{ item: any; reused: boolean; genres: number[] } | null> {
  const { type, selectedGenres, adultContent, filters, recentRandomIds, signal } = opts;
  const params: any = {
    sort_by: 'popularity.desc',
    language: 'ru-RU',
    include_adult: String(adultContent),
  };
  const genres = selectedGenres.filter(g => g !== 0);
  if (genres.length > 0) params.with_genres = genres.join(',');
  applyDiscoverFilters(params, filters, type);

  const recent = new Set(recentRandomIds);
  let pageCap = MAX_RANDOM_PAGE; // optimistic until the first response tells us

  for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt += 1) {
    params.page = String(Math.floor(Math.random() * pageCap) + 1);
    const res = await fetcher(tmdbUrls.discover(type, params), { headers: tmdbHeaders(), signal });
    const data = await res.json();

    // Clamp future paging to the query's real page count (capped at 20).
    if (data.total_pages) pageCap = Math.min(Math.max(data.total_pages, 1), MAX_RANDOM_PAGE);

    const posterItems = (data.results || []).filter((m: any) => m.poster_path);
    // Empty page (we paged past the real range before learning pageCap) — retry
    // without burning the "accept a repeat" budget.
    if (posterItems.length === 0) continue;

    const freshItems = posterItems.filter((m: any) => !recent.has(`${type}-${m.id}`));
    // Near the end of our attempts, accept an already-seen title rather than fail.
    const items = freshItems.length > 0
      ? freshItems
      : (attempt >= MAX_RANDOM_ATTEMPTS - 2 ? posterItems : []);
    if (items.length > 0) {
      const item = items[Math.floor(Math.random() * items.length)];
      return { item, reused: freshItems.length === 0, genres };
    }
  }
  return null;
}
