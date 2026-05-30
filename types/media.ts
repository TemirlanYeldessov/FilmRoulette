// Shared media model. The app passes movie/series objects through many screens;
// before this they were all `any`, so a typo in a field name failed silently.
// `MediaItem` captures the slim card/detail model produced by toSlimMovie /
// itemToMovie / mapBaseDetail. Fields are intentionally loose (most optional)
// because list items, detail payloads and persisted slices fill different
// subsets — but the core identity (id + mediaType) is always present.

export type MediaType = 'movie' | 'tv';

export interface MediaItem {
  id: number;
  // Kept as a plain string (not MediaType) because legacy persisted data and
  // some TMDB payloads can carry other values; screens narrow where needed.
  mediaType: string;
  titleRu?: string;
  titleEn?: string;
  poster?: string | null;
  year?: string;
  rating?: string | null;
  overview?: string;
  // List/detail extras, present only on some sources.
  genres?: string | null;
  genreId?: number | null;
  country?: string | null;
  trailerKey?: string | null;
  // Set by the roulette when it had to reuse an already-seen title.
  randomNotice?: string | null;
}

// The status a user can assign to a title. Mirrors AppContext.UserMovieStatus.
export type UserMovieStatus = 'want' | 'watched' | 'liked' | 'disliked';
