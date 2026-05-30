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
