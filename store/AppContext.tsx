import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState } from 'react';
import type { MediaItem, UserMovieStatus } from '../types/media';

export type { UserMovieStatus } from '../types/media';

interface AppContextType {
  hydrated: boolean;
  adultContent: boolean;
  toggleAdultContent: () => void;
  watchlist: MediaItem[];
  addToWatchlist: (movie: MediaItem) => void;
  removeFromWatchlist: (id: number, mediaType: string) => void;
  isInWatchlist: (id: number, mediaType: string) => boolean;
  userRatings: Record<string, UserMovieStatus>;
  setUserStatus: (movie: MediaItem, status: UserMovieStatus) => void;
  clearUserStatus: (id: number, mediaType: string) => void;
  getUserStatus: (id: number, mediaType: string) => UserMovieStatus | null;
  recentRandomIds: string[];
  addRecentRandom: (id: number, mediaType: string) => void;
  clearRecentRandom: () => void;
  isRecentlyRandom: (id: number, mediaType: string) => boolean;
  onboardingSeen: boolean;
  markOnboardingSeen: () => void;
  clearWatchlist: () => void;
  resetOnboarding: () => void;
}

const AppContext = createContext<AppContextType>({} as AppContextType);

const keyForMovie = (id: number, mediaType: string) => `${mediaType}-${id}`;

// Bump when the persisted shape changes, and add a branch in migrateStored().
// Installs from before versioning have no key → treated as version 0.
const SCHEMA_VERSION = 1;

// One place to transform old persisted data into the current shape on app
// update, so a format change doesn't silently break or drop user data. No
// transforms are needed yet (v0 data is already compatible with v1) — when the
// shape changes, branch on `from` here and reshape the slices before they load.
function migrateStored(
  from: number,
  slices: { watchlist: any[]; userRatings: any; recentRandomIds: string[] },
) {
  // Example for the future:
  // if (from < 2) { slices.watchlist = slices.watchlist.map(/* reshape */); }
  return slices;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSlimMovie(movie: MediaItem): MediaItem {
  return {
    id: movie.id,
    mediaType: movie.mediaType,
    titleRu: movie.titleRu,
    titleEn: movie.titleEn,
    poster: movie.poster,
    year: movie.year,
    rating: movie.rating,
    overview: movie.overview,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  // Whether the initial read actually succeeded. If it failed (rare storage
  // error), we still release the UI but must never run the persist effects —
  // otherwise the empty in-memory defaults would overwrite real saved data.
  const [canPersist, setCanPersist] = useState(false);
  const [adultContent, setAdultContent] = useState(false);
  const [watchlist, setWatchlist] = useState<MediaItem[]>([]);
  const [userRatings, setUserRatingsState] = useState<Record<string, UserMovieStatus>>({});
  const [recentRandomIds, setRecentRandomIds] = useState<string[]>([]);
  const [onboardingSeen, setOnboardingSeen] = useState(true);

  // Hydrate once from AsyncStorage. Mutations are no-op until this completes,
  // so user actions taken on initial render can't be overwritten by the resolve.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [adult, w, ratings, recent, onboarding, ver] = await Promise.all([
          AsyncStorage.getItem('adultContent'),
          AsyncStorage.getItem('watchlist'),
          AsyncStorage.getItem('userRatings'),
          AsyncStorage.getItem('recentRandomIds'),
          AsyncStorage.getItem('onboardingSeen'),
          AsyncStorage.getItem('schemaVersion'),
        ]);
        if (!mounted) return;
        const fromVersion = parseInt(ver || '0', 10) || 0;
        const migrated = migrateStored(fromVersion, {
          watchlist: safeParse<any[]>(w, []).map(toSlimMovie),
          userRatings: safeParse(ratings, {}),
          recentRandomIds: safeParse<string[]>(recent, []),
        });
        if (adult === 'true') setAdultContent(true);
        setWatchlist(migrated.watchlist);
        setUserRatingsState(migrated.userRatings);
        setRecentRandomIds(migrated.recentRandomIds);
        setOnboardingSeen(onboarding === 'true');
        if (mounted) setCanPersist(true);
      } catch {
        // Read failed — release the UI but leave canPersist false so the
        // persist effects below never clobber existing data with defaults.
      } finally {
        if (mounted) setHydrated(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Persist effects — only after hydration to avoid clobbering existing data
  // with the initial in-memory defaults.
  useEffect(() => {
    if (!canPersist) return;
    AsyncStorage.setItem('adultContent', String(adultContent));
  }, [adultContent, canPersist]);

  useEffect(() => {
    if (!canPersist) return;
    AsyncStorage.setItem('watchlist', JSON.stringify(watchlist));
  }, [watchlist, canPersist]);

  useEffect(() => {
    if (!canPersist) return;
    AsyncStorage.setItem('userRatings', JSON.stringify(userRatings));
  }, [userRatings, canPersist]);

  useEffect(() => {
    if (!canPersist) return;
    AsyncStorage.setItem('recentRandomIds', JSON.stringify(recentRandomIds));
  }, [recentRandomIds, canPersist]);

  useEffect(() => {
    if (!canPersist) return;
    AsyncStorage.setItem('onboardingSeen', String(onboardingSeen));
  }, [onboardingSeen, canPersist]);

  // Stamp the current schema version once data is safe to persist, so the next
  // launch knows which migrations (if any) to run.
  useEffect(() => {
    if (!canPersist) return;
    AsyncStorage.setItem('schemaVersion', String(SCHEMA_VERSION));
  }, [canPersist]);

  const toggleAdultContent = () => {
    if (!hydrated) return;
    setAdultContent(prev => !prev);
  };

  const addToWatchlist = (movie: any) => {
    if (!hydrated) return;
    // Strip heavy nested fields (recommendations, cast, providers, etc.) — the
    // detail screen re-fetches them on open. Keeping only what the watchlist
    // grid needs prevents the 6MB AsyncStorage cap from being hit at ~100 items.
    const slim = toSlimMovie(movie);
    setWatchlist(prev => {
      if (prev.some(m => m.id === slim.id && m.mediaType === slim.mediaType)) return prev;
      return [...prev, slim];
    });
  };

  const removeFromWatchlist = (id: number, mediaType: string) => {
    if (!hydrated) return;
    setWatchlist(prev => prev.filter(m => !(m.id === id && m.mediaType === mediaType)));
    // Drop the rating too, so it doesn't linger orphaned in storage and keep
    // showing a "seen" mark on grids after the title left the collection.
    setUserRatingsState(prev => {
      const key = keyForMovie(id, mediaType);
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const isInWatchlist = (id: number, mediaType: string) => {
    return watchlist.some(m => m.id === id && m.mediaType === mediaType);
  };

  // Rating a title also saves it to the collection, so the Favorites tab and
  // its status filters reflect everything the user has graded — not just the
  // titles they explicitly hearted.
  const setUserStatus = (movie: any, status: UserMovieStatus) => {
    if (!hydrated) return;
    setUserRatingsState(prev => ({ ...prev, [keyForMovie(movie.id, movie.mediaType)]: status }));
    const slim = toSlimMovie(movie);
    setWatchlist(prev =>
      prev.some(m => m.id === slim.id && m.mediaType === slim.mediaType) ? prev : [...prev, slim]
    );
  };

  const clearUserStatus = (id: number, mediaType: string) => {
    if (!hydrated) return;
    setUserRatingsState(prev => {
      const next = { ...prev };
      delete next[keyForMovie(id, mediaType)];
      return next;
    });
  };

  const getUserStatus = (id: number, mediaType: string) => {
    return userRatings[keyForMovie(id, mediaType)] || null;
  };

  const addRecentRandom = (id: number, mediaType: string) => {
    if (!hydrated) return;
    setRecentRandomIds(prev => {
      const movieKey = keyForMovie(id, mediaType);
      return [movieKey, ...prev.filter(k => k !== movieKey)].slice(0, 200);
    });
  };

  const clearRecentRandom = () => {
    if (!hydrated) return;
    setRecentRandomIds([]);
  };

  const isRecentlyRandom = (id: number, mediaType: string) => {
    return recentRandomIds.includes(keyForMovie(id, mediaType));
  };

  const markOnboardingSeen = () => {
    if (!hydrated) return;
    setOnboardingSeen(true);
  };

  // Wipe the whole collection and every grade in one go. Ratings are cleared
  // alongside the watchlist so no orphaned "seen" marks linger on grids.
  const clearWatchlist = () => {
    if (!hydrated) return;
    setWatchlist([]);
    setUserRatingsState({});
  };

  // Let the user replay the intro from Settings.
  const resetOnboarding = () => {
    if (!hydrated) return;
    setOnboardingSeen(false);
  };

  return (
    <AppContext.Provider
      value={{
        hydrated,
        adultContent,
        toggleAdultContent,
        watchlist,
        addToWatchlist,
        removeFromWatchlist,
        isInWatchlist,
        userRatings,
        setUserStatus,
        clearUserStatus,
        getUserStatus,
        recentRandomIds,
        addRecentRandom,
        clearRecentRandom,
        isRecentlyRandom,
        onboardingSeen,
        markOnboardingSeen,
        clearWatchlist,
        resetOnboarding,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useAppContext = () => useContext(AppContext);
