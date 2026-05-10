import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState } from 'react';

export type UserMovieStatus = 'want' | 'watched' | 'liked' | 'disliked';

interface AppContextType {
  adultContent: boolean;
  toggleAdultContent: () => void;
  watchlist: any[];
  addToWatchlist: (movie: any) => void;
  removeFromWatchlist: (id: number, mediaType: string) => void;
  isInWatchlist: (id: number, mediaType: string) => boolean;
  userRatings: Record<string, UserMovieStatus>;
  setUserStatus: (id: number, mediaType: string, status: UserMovieStatus) => void;
  clearUserStatus: (id: number, mediaType: string) => void;
  getUserStatus: (id: number, mediaType: string) => UserMovieStatus | null;
  recentRandomIds: string[];
  addRecentRandom: (id: number, mediaType: string) => void;
  isRecentlyRandom: (id: number, mediaType: string) => boolean;
  onboardingSeen: boolean;
  markOnboardingSeen: () => void;
}

const AppContext = createContext<AppContextType>({} as AppContextType);

const keyForMovie = (id: number, mediaType: string) => `${mediaType}-${id}`;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [adultContent, setAdultContent] = useState(false);
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [userRatings, setUserRatingsState] = useState<Record<string, UserMovieStatus>>({});
  const [recentRandomIds, setRecentRandomIds] = useState<string[]>([]);
  const [onboardingSeen, setOnboardingSeen] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('adultContent').then(val => {
      if (val === 'true') setAdultContent(true);
    });
    AsyncStorage.getItem('watchlist').then(val => {
      if (val) setWatchlist(JSON.parse(val));
    });
    AsyncStorage.getItem('userRatings').then(val => {
      if (val) setUserRatingsState(JSON.parse(val));
    });
    AsyncStorage.getItem('recentRandomIds').then(val => {
      if (val) setRecentRandomIds(JSON.parse(val));
    });
    AsyncStorage.getItem('onboardingSeen').then(val => {
      setOnboardingSeen(val === 'true');
    });
  }, []);

  const toggleAdultContent = async () => {
    const next = !adultContent;
    setAdultContent(next);
    await AsyncStorage.setItem('adultContent', String(next));
  };

  const addToWatchlist = async (movie: any) => {
    const exists = watchlist.some(m => m.id === movie.id && m.mediaType === movie.mediaType);
    if (exists) return;

    const next = [...watchlist, movie];
    setWatchlist(next);
    await AsyncStorage.setItem('watchlist', JSON.stringify(next));
  };

  const removeFromWatchlist = async (id: number, mediaType: string) => {
    const next = watchlist.filter(m => !(m.id === id && m.mediaType === mediaType));
    setWatchlist(next);
    await AsyncStorage.setItem('watchlist', JSON.stringify(next));
  };

  const isInWatchlist = (id: number, mediaType: string) => {
    return watchlist.some(m => m.id === id && m.mediaType === mediaType);
  };

  const setUserStatus = async (id: number, mediaType: string, status: UserMovieStatus) => {
    const next = { ...userRatings, [keyForMovie(id, mediaType)]: status };
    setUserRatingsState(next);
    await AsyncStorage.setItem('userRatings', JSON.stringify(next));
  };

  const clearUserStatus = async (id: number, mediaType: string) => {
    const next = { ...userRatings };
    delete next[keyForMovie(id, mediaType)];
    setUserRatingsState(next);
    await AsyncStorage.setItem('userRatings', JSON.stringify(next));
  };

  const getUserStatus = (id: number, mediaType: string) => {
    return userRatings[keyForMovie(id, mediaType)] || null;
  };

  const addRecentRandom = async (id: number, mediaType: string) => {
    const movieKey = keyForMovie(id, mediaType);
    const next = [movieKey, ...recentRandomIds.filter(k => k !== movieKey)].slice(0, 200);
    setRecentRandomIds(next);
    await AsyncStorage.setItem('recentRandomIds', JSON.stringify(next));
  };

  const isRecentlyRandom = (id: number, mediaType: string) => {
    return recentRandomIds.includes(keyForMovie(id, mediaType));
  };

  const markOnboardingSeen = async () => {
    setOnboardingSeen(true);
    await AsyncStorage.setItem('onboardingSeen', 'true');
  };

  return (
    <AppContext.Provider
      value={{
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
        isRecentlyRandom,
        onboardingSeen,
        markOnboardingSeen,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useAppContext = () => useContext(AppContext);
