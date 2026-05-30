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

// Shared roulette core: pick a random not-recently-seen title via Discover.
// Both detail screens use this; they differ only in the detail fetcher, the
// "nothing left" wording and the assembled result shape, which stay at the call
// site. `fetcher` is the screen's bound fetchWithTimeout (preserves its error
// wording). Returns null after 5 tries so the caller can throw its own message.
// `reused` is true when only already-seen titles remained (drives the reroll notice).
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

  for (let attempt = 0; attempt < 5; attempt += 1) {
    params.page = String(Math.floor(Math.random() * 20) + 1);
    const res = await fetcher(tmdbUrls.discover(type, params), { headers: tmdbHeaders(), signal });
    const data = await res.json();
    const posterItems = (data.results || []).filter((m: any) => m.poster_path);
    const freshItems = posterItems.filter((m: any) => !recentRandomIds.includes(`${type}-${m.id}`));
    // After a few tries with no fresh hits, accept a repeat rather than fail.
    const items = freshItems.length > 0 ? freshItems : (attempt >= 3 ? posterItems : []);
    if (items.length > 0) {
      const item = items[Math.floor(Math.random() * items.length)];
      return { item, reused: freshItems.length === 0, genres };
    }
  }
  return null;
}
