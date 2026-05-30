// Shared TMDB list helpers. Kept in one place so the duplicate-collapsing and
// raw-item → card-model mapping can't quietly diverge between screens.

// Collapse duplicate titles. The key falls back to a caller-supplied media type
// when the raw item omits media_type (e.g. some trending payloads), so the same
// title can't slip through as `-123` on one screen and `movie-123` on another.
export function dedup<T extends { id: number; media_type?: string }>(
  items: T[],
  fallbackType = ''
): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.media_type || fallbackType}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Apply the discover filters shared across catalog / top / roulette onto a TMDB
// discover params object. Each field is added only when present, so a caller
// whose filter object omits a field (the roulette has no `language`, Top has no
// `maxRating`) gets output identical to the old inline logic. Genres, sort_by,
// locale, paging and include_adult are caller-specific and intentionally left
// untouched here.
export function applyDiscoverFilters(
  params: Record<string, string>,
  filters: any,
  type: string,
) {
  if (filters.yearFrom)
    params[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = `${filters.yearFrom}-01-01`;
  if (filters.yearTo)
    params[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = `${filters.yearTo}-12-31`;
  if (filters.minRating > 0) params['vote_average.gte'] = String(filters.minRating);
  if (filters.maxRating < 10) params['vote_average.lte'] = String(filters.maxRating);
  if (filters.language) params.with_original_language = filters.language;
  if (filters.country) params.with_origin_country = filters.country;
  return params;
}

// Shallow structural compare of two filter objects. Used to detect unsaved
// changes in the filter sheets; JSON.stringify is enough since filter shapes
// are flat and order-stable here.
export function areFiltersEqual(a: any, b: any) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Normalize a year range from free-text inputs. Drops implausible values
// (non-numeric, or outside 1900..currentYear+5) so we never send junk like
// "0-01-01" to TMDB, and swaps a reversed from/to. Returns cleaned strings.
export function sanitizeYearRange(yearFrom: string, yearTo: string) {
  const maxYear = new Date().getFullYear() + 5;
  const norm = (v: string) => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1900 || n > maxYear) return '';
    return String(n);
  };
  let from = norm(yearFrom);
  let to = norm(yearTo);
  if (from && to && parseInt(from, 10) > parseInt(to, 10)) {
    [from, to] = [to, from];
  }
  return { yearFrom: from, yearTo: to };
}

// First YouTube trailer key from a localized + English detail payload, RU
// preferred. Both detail screens pick trailers identically, so it lives here.
export function pickTrailerKey(ruData: any, enData: any): string | null {
  const ru = ruData.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
  const en = enData.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
  return ru?.key || en?.key || null;
}

// Common detail fields shared by the full (MovieScreen) and light (Catalog)
// detail fetchers. The full fetcher spreads this and adds cast/providers/etc.
// Extracted verbatim so both screens map the base model identically.
export function mapBaseDetail(id: number, ruData: any, enData: any, type: string) {
  return {
    id,
    titleRu: ruData.title || ruData.name,
    titleEn: enData.title || enData.name,
    overview: ruData.overview || enData.overview,
    poster: ruData.poster_path ? `https://image.tmdb.org/t/p/w500${ruData.poster_path}` : null,
    trailerKey: pickTrailerKey(ruData, enData),
    mediaType: type,
    rating: ruData.vote_average ? ruData.vote_average.toFixed(1) : null,
    year: (ruData.release_date || ruData.first_air_date || '').slice(0, 4),
    country: ruData.production_countries?.[0]?.name || null,
    genres: ruData.genres?.map((g: any) => g.name).join(', ') || null,
  };
}

// Raw TMDB list item → the slim movie model the detail screen accepts. The
// detail screen re-fetches full data, so only what a card needs is filled in.
export function itemToMovie(item: any, fallbackType?: string) {
  const type = item.media_type || fallbackType;
  return {
    id: item.id,
    titleRu: item.title || item.name || '',
    titleEn: item.title || item.name || '',
    overview: item.overview || '',
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
    trailerKey: null,
    mediaType: type,
    rating: item.vote_average > 0 ? item.vote_average.toFixed(1) : null,
    year: (item.release_date || item.first_air_date || '').slice(0, 4),
    country: null,
    genres: null,
    genreId: null,
  };
}
