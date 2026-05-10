import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { HorizontalCardSkeleton, MovieCardSkeleton } from '../components/Skeleton';
import { useAppContext } from '../store/AppContext';
import { TMDB_TOKEN as TOKEN } from '../constants/api';

const { width } = Dimensions.get('window');
const cardWidth = (width - 48) / 2;

const MOVIE_GENRES = [
  { id: 0, name: 'Все жанры' },
  { id: 28, name: 'Боевик' },
  { id: 12, name: 'Приключения' },
  { id: 16, name: 'Анимация' },
  { id: 35, name: 'Комедия' },
  { id: 80, name: 'Криминал' },
  { id: 99, name: 'Документальный' },
  { id: 18, name: 'Драма' },
  { id: 10751, name: 'Семейный' },
  { id: 14, name: 'Фэнтези' },
  { id: 36, name: 'История' },
  { id: 27, name: 'Ужасы' },
  { id: 10402, name: 'Музыка' },
  { id: 9648, name: 'Мистика' },
  { id: 10749, name: 'Романтика' },
  { id: 878, name: 'Фантастика' },
  { id: 10770, name: 'Телефильм' },
  { id: 53, name: 'Триллер' },
  { id: 10752, name: 'Военный' },
  { id: 37, name: 'Вестерн' },
];

const TV_GENRES = [
  { id: 0, name: 'Все жанры' },
  { id: 10759, name: 'Боевик' },
  { id: 16, name: 'Анимация' },
  { id: 35, name: 'Комедия' },
  { id: 80, name: 'Криминал' },
  { id: 99, name: 'Документальный' },
  { id: 18, name: 'Драма' },
  { id: 10751, name: 'Семейный' },
  { id: 10762, name: 'Детский' },
  { id: 9648, name: 'Мистика' },
  { id: 10763, name: 'Новости' },
  { id: 10764, name: 'Реалити' },
  { id: 10765, name: 'Фантастика' },
  { id: 10766, name: 'Мелодрама' },
  { id: 10767, name: 'Ток-шоу' },
  { id: 10768, name: 'Война и политика' },
  { id: 37, name: 'Вестерн' },
];

const COUNTRIES = [
  { code: '', name: 'Любая' },
  { code: 'US', name: 'США' },
  { code: 'GB', name: 'Великобритания' },
  { code: 'RU', name: 'Россия' },
  { code: 'KR', name: 'Корея' },
  { code: 'JP', name: 'Япония' },
  { code: 'FR', name: 'Франция' },
  { code: 'DE', name: 'Германия' },
  { code: 'IT', name: 'Италия' },
  { code: 'ES', name: 'Испания' },
  { code: 'IN', name: 'Индия' },
  { code: 'CN', name: 'Китай' },
  { code: 'TR', name: 'Турция' },
];

const LANGUAGES = [
  { code: '', name: 'Любой' },
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'Английский' },
  { code: 'ko', name: 'Корейский' },
  { code: 'ja', name: 'Японский' },
  { code: 'fr', name: 'Французский' },
  { code: 'de', name: 'Немецкий' },
  { code: 'es', name: 'Испанский' },
  { code: 'it', name: 'Итальянский' },
  { code: 'hi', name: 'Хинди' },
  { code: 'tr', name: 'Турецкий' },
  { code: 'zh', name: 'Китайский' },
];

const SORT_OPTIONS = [
  { key: 'popularity.desc', name: 'По популярности' },
  { key: 'vote_average.desc', name: 'По рейтингу' },
  { key: 'release_date.desc', name: 'Сначала новые' },
  { key: 'release_date.asc', name: 'Сначала старые' },
];

const CONTENT_TYPES = [
  { key: 'all', name: 'Фильмы и сериалы' },
  { key: 'movie', name: 'Только фильмы' },
  { key: 'tv', name: 'Только сериалы' },
];

const RATINGS = [0, 5, 6, 7, 8, 9];
const MAX_RATINGS = [10, 9, 8, 7, 6, 5];
const searchSkeletons = Array.from({ length: 6 }, (_, i) => i);

const defaultFilters = {
  mediaType: 'all',
  genreId: 0,
  yearFrom: '',
  yearTo: '',
  minRating: 0,
  maxRating: 10,
  language: '',
  country: '',
  sortBy: 'popularity.desc',
};

async function fetchWithTimeout(url: string, options: any = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error('TMDB временно не отвечает. Попробуй еще раз.');
    }

    return res;
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Превышено время ожидания.');
    throw e;
  }
}

async function getTrailer(id: number, type: string) {
  try {
    const resRu = await fetchWithTimeout(
      `https://api.themoviedb.org/3/${type}/${id}/videos?language=ru-RU`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    const dataRu = await resRu.json();
    const trailerRu = dataRu.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
    if (trailerRu) return trailerRu.key;

    const resEn = await fetchWithTimeout(
      `https://api.themoviedb.org/3/${type}/${id}/videos?language=en-US`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    const dataEn = await resEn.json();
    return dataEn.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube')?.key || null;
  } catch {
    return null;
  }
}

async function fetchDetails(id: number, type: string) {
  const [ruRes, enRes] = await Promise.all([
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=ru-RU`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=en-US`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
  ]);

  const ruData = await ruRes.json();
  const enData = await enRes.json();
  const trailerKey = await getTrailer(id, type);

  return {
    id,
    titleRu: ruData.title || ruData.name,
    titleEn: enData.title || enData.name,
    overview: ruData.overview || enData.overview,
    poster: ruData.poster_path ? `https://image.tmdb.org/t/p/w500${ruData.poster_path}` : null,
    trailerKey,
    mediaType: type,
    rating: ruData.vote_average ? ruData.vote_average.toFixed(1) : null,
    year: (ruData.release_date || ruData.first_air_date || '').slice(0, 4),
    country: ruData.production_countries?.[0]?.name || null,
    genres: ruData.genres?.map((g: any) => g.name).join(', ') || null,
  };
}

async function fetchRandom(selectedGenres: number[], mediaType: string, adultContent: boolean, filters: any, recentRandomIds: string[]) {
  const type = mediaType;
  const params: any = {
    sort_by: 'popularity.desc',
    language: 'ru-RU',
    include_adult: String(adultContent),
  };
  const genres = selectedGenres.filter(g => g !== 0);

  if (genres.length > 0) params.with_genres = genres.join(',');
  if (filters.yearFrom) params[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = `${filters.yearFrom}-01-01`;
  if (filters.yearTo) params[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = `${filters.yearTo}-12-31`;
  if (filters.minRating > 0) params['vote_average.gte'] = String(filters.minRating);
  if (filters.maxRating < 10) params['vote_average.lte'] = String(filters.maxRating);
  if (filters.country) params.with_origin_country = filters.country;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    params.page = String(Math.floor(Math.random() * 20) + 1);
    const url = `https://api.themoviedb.org/3/discover/${type}?${new URLSearchParams(params)}`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const data = await res.json();
    const items = (data.results || []).filter((m: any) => m.poster_path && !recentRandomIds.includes(`${type}-${m.id}`));

    if (items.length > 0) {
      const item = items[Math.floor(Math.random() * items.length)];
      const details = await fetchDetails(item.id, type);
      return { ...details, genreId: genres[0] ?? 0, selectedGenres: genres };
    }
  }

  throw new Error('Новых вариантов по этим условиям не осталось. Попробуй изменить фильтры.');
}

async function searchItems(query: string, adultContent: boolean, page = 1) {
  const res = await fetchWithTimeout(
    `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&language=ru-RU&include_adult=${adultContent}&page=${page}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const data = await res.json();
  const results = (data.results || []).filter((m: any) => {
    return (m.media_type === 'movie' || m.media_type === 'tv') && m.poster_path;
  });
  return { results, totalPages: data.total_pages ?? 1 };
}

async function discoverItems(filters: any, adultContent: boolean) {
  const types = filters.mediaType === 'all' ? ['movie', 'tv'] : [filters.mediaType];

  const requests = types.map(async (type) => {
    const params: any = {
      language: 'ru-RU',
      sort_by: filters.sortBy || 'popularity.desc',
      page: '1',
      include_adult: String(adultContent),
    };

    if (filters.genreId) params.with_genres = String(filters.genreId);
    if (filters.minRating > 0) params['vote_average.gte'] = String(filters.minRating);
    if (filters.maxRating < 10) params['vote_average.lte'] = String(filters.maxRating);
    if (filters.language) params.with_original_language = filters.language;
    if (filters.country) params.with_origin_country = filters.country;
    if (filters.yearFrom) params[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = `${filters.yearFrom}-01-01`;
    if (filters.yearTo) params[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = `${filters.yearTo}-12-31`;

    const url = `https://api.themoviedb.org/3/discover/${type}?${new URLSearchParams(params)}`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const data = await res.json();

    return (data.results || [])
      .filter((m: any) => m.poster_path)
      .map((m: any) => ({ ...m, media_type: type }));
  });

  const results = await Promise.all(requests);
  return results.flat().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

function FilterSheet({ visible, onClose, filters, onApply }: any) {
  const [local, setLocal] = useState(filters);
  const genres = local.mediaType === 'tv' ? TV_GENRES : MOVIE_GENRES;

  useEffect(() => {
    setLocal(filters);
  }, [filters]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={fStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={fStyles.sheet}>
          <View style={fStyles.handle} />
          <Text style={fStyles.title}>Фильтры</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={fStyles.label}>Тип контента</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {CONTENT_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[fStyles.chip, local.mediaType === t.key && fStyles.chipActive]}
                    onPress={() => setLocal({ ...local, mediaType: t.key, genreId: 0 })}
                  >
                    <Text style={[fStyles.chipText, local.mediaType === t.key && fStyles.chipTextActive]}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={fStyles.label}>Жанр</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {genres.map(g => (
                  <TouchableOpacity key={g.id} style={[fStyles.chip, local.genreId === g.id && fStyles.chipActive]} onPress={() => setLocal({ ...local, genreId: g.id })}>
                    <Text style={[fStyles.chipText, local.genreId === g.id && fStyles.chipTextActive]}>{g.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={fStyles.label}>Год выпуска</Text>
            <View style={fStyles.yearRow}>
              <TextInput style={fStyles.yearInput} placeholder="От" placeholderTextColor="#555" value={local.yearFrom} onChangeText={v => setLocal({ ...local, yearFrom: v })} keyboardType="numeric" maxLength={4} />
              <Text style={fStyles.yearDash}>-</Text>
              <TextInput style={fStyles.yearInput} placeholder="До" placeholderTextColor="#555" value={local.yearTo} onChangeText={v => setLocal({ ...local, yearTo: v })} keyboardType="numeric" maxLength={4} />
            </View>

            <Text style={fStyles.label}>Минимальный рейтинг</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {RATINGS.map(r => (
                  <TouchableOpacity key={r} style={[fStyles.chip, local.minRating === r && fStyles.chipActive]} onPress={() => setLocal({ ...local, minRating: r })}>
                    <Text style={[fStyles.chipText, local.minRating === r && fStyles.chipTextActive]}>{r === 0 ? 'Любой' : `${r}+`}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={fStyles.label}>Максимальный рейтинг</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {MAX_RATINGS.map(r => (
                  <TouchableOpacity key={r} style={[fStyles.chip, local.maxRating === r && fStyles.chipActive]} onPress={() => setLocal({ ...local, maxRating: r })}>
                    <Text style={[fStyles.chipText, local.maxRating === r && fStyles.chipTextActive]}>{r === 10 ? 'Любой' : `до ${r}`}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={fStyles.label}>Язык оригинала</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {LANGUAGES.map(l => (
                  <TouchableOpacity key={l.code} style={[fStyles.chip, local.language === l.code && fStyles.chipActive]} onPress={() => setLocal({ ...local, language: l.code })}>
                    <Text style={[fStyles.chipText, local.language === l.code && fStyles.chipTextActive]}>{l.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={fStyles.label}>Страна</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {COUNTRIES.map(c => (
                  <TouchableOpacity key={c.code} style={[fStyles.chip, local.country === c.code && fStyles.chipActive]} onPress={() => setLocal({ ...local, country: c.code })}>
                    <Text style={[fStyles.chipText, local.country === c.code && fStyles.chipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={fStyles.label}>Сортировка</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {SORT_OPTIONS.map(s => (
                  <TouchableOpacity key={s.key} style={[fStyles.chip, local.sortBy === s.key && fStyles.chipActive]} onPress={() => setLocal({ ...local, sortBy: s.key })}>
                    <Text style={[fStyles.chipText, local.sortBy === s.key && fStyles.chipTextActive]}>{s.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={fStyles.buttons}>
              <TouchableOpacity style={fStyles.resetBtn} onPress={() => setLocal(defaultFilters)}>
                <Text style={fStyles.resetText}>Сбросить</Text>
              </TouchableOpacity>
              <TouchableOpacity style={fStyles.applyBtn} onPress={() => { onApply(local); onClose(); }}>
                <Text style={fStyles.applyText}>Применить</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function CatalogScreen({ navigation }: any) {
  const { adultContent, recentRandomIds, addRecentRandom } = useAppContext();
  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie');
  const [trending, setTrending] = useState<any[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showPreciseFilters, setShowPreciseFilters] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [preciseFilters, setPreciseFilters] = useState({ yearFrom: '', yearTo: '', minRating: 0, maxRating: 10, country: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<number[]>([0]);
  const searchRequestRef = useRef(0);
  const lastQueryRef = useRef('');
  const genres = mediaType === 'tv' ? TV_GENRES : MOVIE_GENRES;

  const loadTrending = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(
        `https://api.themoviedb.org/3/trending/${mediaType}/week?language=ru-RU`,
        { headers: { Authorization: `Bearer ${TOKEN}` } }
      );
      const data = await res.json();
      setTrending(data.results.filter((m: any) => m.poster_path).slice(0, 10));
    } catch (e) {
      console.error(e);
    }
  }, [mediaType]);

  useEffect(() => {
    setTrendingLoading(true);
    loadTrending().finally(() => setTrendingLoading(false));
  }, [loadTrending]);

  useEffect(() => {
    const q = searchQuery.trim();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    if (!q) {
      setSearchResults([]);
      setSearching(false);
      setIsSearchMode(false);
      return;
    }

    setIsSearchMode(true);
    setSearching(true);
    setError('');

    const timer = setTimeout(async () => {
      try {
        const { results, totalPages } = await searchItems(q, adultContent, 1);
        if (searchRequestRef.current === requestId) {
          lastQueryRef.current = q;
          setSearchResults(results);
          setSearchPage(1);
          setSearchHasMore(totalPages > 1);
        }
      } catch (e: any) {
        if (searchRequestRef.current === requestId) {
          setError(e.message || 'Не удалось выполнить поиск.');
          setSearchResults([]);
          setSearchHasMore(false);
        }
      }

      if (searchRequestRef.current === requestId) setSearching(false);
    }, 450);

    return () => clearTimeout(timer);
  }, [searchQuery, adultContent]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTrending();
    setRefreshing(false);
  }, [loadTrending]);

  const clearSearchMode = () => {
    searchRequestRef.current += 1;
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchMode(false);
    setSearching(false);
    setFilters(defaultFilters);
    setError('');
    setSearchPage(1);
    setSearchHasMore(false);
  };

  const loadMoreSearchResults = async () => {
    if (loadingMore || !searchHasMore || !lastQueryRef.current) return;
    setLoadingMore(true);
    try {
      const nextPage = searchPage + 1;
      const { results, totalPages } = await searchItems(lastQueryRef.current, adultContent, nextPage);
      setSearchResults(prev => [...prev, ...results]);
      setSearchPage(nextPage);
      setSearchHasMore(nextPage < totalPages);
    } catch {
      // silent
    }
    setLoadingMore(false);
  };

  const handleFilterSearch = async (f: any) => {
    searchRequestRef.current += 1;
    setFilters(f);
    setIsSearchMode(true);
    setSearching(true);
    setSearchQuery('');
    setError('');

    try {
      const results = await discoverItems(f, adultContent);
      setSearchResults(results);
    } catch (e: any) {
      setError(e.message || 'Не удалось применить фильтры.');
      setSearchResults([]);
    }

    setSearching(false);
  };

  const openCard = async (item: any) => {
    const type = item.media_type || mediaType;
    const details = await fetchDetails(item.id, type);
    navigation.navigate('Card', { movie: { ...details, genreId: null } });
  };

  const openRandom = async () => {
    setLoading(true);
    setError('');

    try {
      const movie = await fetchRandom(selectedGenres, mediaType, adultContent, preciseFilters, recentRandomIds);
      addRecentRandom(movie.id, movie.mediaType);
      navigation.navigate('Card', { movie });
    } catch (e: any) {
      setError(e.message || 'Не удалось подобрать случайный тайтл.');
    }

    setLoading(false);
  };

  const toggleGenre = (id: number) => {
    if (id === 0) {
      setSelectedGenres([0]);
      return;
    }

    setSelectedGenres(prev => {
      const without0 = prev.filter(g => g !== 0);

      if (without0.includes(id)) {
        const next = without0.filter(g => g !== id);
        return next.length === 0 ? [0] : next;
      }

      return [...without0, id];
    });
  };

  const isAllGenres = selectedGenres.includes(0);

  return (
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <View style={styles.header}>
        {!isSearchMode && (
          <View style={styles.switcher}>
            <TouchableOpacity style={[styles.switchBtn, mediaType === 'movie' && styles.switchBtnActive]} onPress={() => { setMediaType('movie'); setSelectedGenres([0]); }}>
              <Ionicons name="film" size={16} color={mediaType === 'movie' ? '#fff' : '#666'} />
              <Text style={[styles.switchText, mediaType === 'movie' && styles.switchTextActive]}>Фильмы</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.switchBtn, mediaType === 'tv' && styles.switchBtnActive]} onPress={() => { setMediaType('tv'); setSelectedGenres([0]); }}>
              <Ionicons name="tv" size={16} color={mediaType === 'tv' ? '#fff' : '#666'} />
              <Text style={[styles.switchText, mediaType === 'tv' && styles.switchTextActive]}>Сериалы</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            <Ionicons name="search" size={16} color="#555" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Поиск фильмов и сериалов..."
              placeholderTextColor="#555"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={clearSearchMode}>
                <Ionicons name="close-circle" size={16} color="#555" />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={styles.filterBtn} onPress={() => setShowFilters(true)}>
            <Ionicons name="options" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {isSearchMode ? (
        <View style={{ flex: 1 }}>
          <View style={styles.resultsHeader}>
            <TouchableOpacity style={styles.resultsBackBtn} onPress={clearSearchMode}>
              <Ionicons name="chevron-back" size={18} color="#8888ff" />
              <Text style={styles.resultsBackText}>Назад к каталогу</Text>
            </TouchableOpacity>
            <Text style={styles.resultsTitle}>Результаты</Text>
          </View>

          {searching ? (
            <FlatList
              data={searchSkeletons}
              keyExtractor={item => String(item)}
              numColumns={2}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.row}
              renderItem={() => <MovieCardSkeleton cardWidth={cardWidth} />}
            />
          ) : error ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={38} color="#555" />
              <Text style={styles.emptyText}>{error}</Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={38} color="#555" />
              <Text style={styles.emptyText}>Ничего не найдено</Text>
              <Text style={styles.emptyHint}>Попробуй смягчить фильтры или изменить запрос.</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item, i) => `${item.id}-${item.media_type || mediaType}-${i}`}
              numColumns={2}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.row}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.card} onPress={() => openCard(item)}>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{item.media_type === 'tv' ? 'Сериал' : 'Фильм'}</Text>
                  </View>
                  <Image source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }} style={styles.poster} contentFit="cover" transition={200} cachePolicy="memory-disk" />
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title || item.name}</Text>
                  {item.vote_average > 0 && <Text style={styles.cardRating}>★ {item.vote_average.toFixed(1)}</Text>}
                </TouchableOpacity>
              )}
              ListFooterComponent={
                searchHasMore ? (
                  <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMoreSearchResults} disabled={loadingMore}>
                    {loadingMore
                      ? <ActivityIndicator size="small" color="#e50914" />
                      : <Text style={styles.loadMoreText}>Показать ещё</Text>}
                  </TouchableOpacity>
                ) : null
              }
            />
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e50914" />}>
          <Text style={styles.sectionTitle}>Новинки недели</Text>

          {trendingLoading ? (
            <FlatList data={[1, 2, 3, 4, 5]} horizontal showsHorizontalScrollIndicator={false} keyExtractor={i => String(i)} renderItem={() => <HorizontalCardSkeleton />} />
          ) : (
            <FlatList
              data={trending}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={item => item.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => openCard(item)} style={styles.trendCard}>
                  <Image source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }} style={styles.trendImage} contentFit="cover" transition={200} cachePolicy="memory-disk" />
                  <Text style={styles.trendTitle} numberOfLines={2}>{item.title || item.name}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          <Text style={styles.sectionTitle}>Случайный {mediaType === 'movie' ? 'фильм' : 'сериал'}</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.genreRow}>
              {genres.map(g => (
                <TouchableOpacity key={g.id} style={[styles.genreChip, (g.id === 0 ? isAllGenres : selectedGenres.includes(g.id)) && styles.genreChipActive]} onPress={() => toggleGenre(g.id)}>
                  <Text style={[styles.genreChipText, (g.id === 0 ? isAllGenres : selectedGenres.includes(g.id)) && styles.genreChipTextActive]}>{g.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.preciseRow} onPress={() => setShowPreciseFilters(true)}>
            <View>
              <Text style={styles.preciseTitle}>Подобрать точнее</Text>
              <Text style={styles.preciseSubtitle}>Год, рейтинг, страна</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#555" />
          </TouchableOpacity>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {loading ? (
            <ActivityIndicator size="large" color="#e50914" style={{ marginTop: 16 }} />
          ) : (
            <TouchableOpacity style={styles.randomBtn} onPress={openRandom}>
              <Ionicons name="shuffle" size={20} color="#fff" />
              <Text style={styles.randomText}>Случайный {mediaType === 'movie' ? 'фильм' : 'сериал'}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <FilterSheet visible={showFilters} onClose={() => setShowFilters(false)} filters={filters} onApply={handleFilterSearch} />

      <Modal visible={showPreciseFilters} transparent animationType="slide" onRequestClose={() => setShowPreciseFilters(false)}>
        <TouchableOpacity style={fStyles.overlay} activeOpacity={1} onPress={() => setShowPreciseFilters(false)}>
          <TouchableOpacity activeOpacity={1} style={fStyles.sheet}>
            <View style={fStyles.handle} />
            <Text style={fStyles.title}>Подобрать точнее</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={fStyles.label}>Год выпуска</Text>
              <View style={fStyles.yearRow}>
                <TextInput style={fStyles.yearInput} placeholder="От" placeholderTextColor="#555" value={preciseFilters.yearFrom} onChangeText={v => setPreciseFilters(p => ({ ...p, yearFrom: v }))} keyboardType="numeric" maxLength={4} />
                <Text style={fStyles.yearDash}>-</Text>
                <TextInput style={fStyles.yearInput} placeholder="До" placeholderTextColor="#555" value={preciseFilters.yearTo} onChangeText={v => setPreciseFilters(p => ({ ...p, yearTo: v }))} keyboardType="numeric" maxLength={4} />
              </View>

              <Text style={fStyles.label}>Минимальный рейтинг</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {RATINGS.map(r => (
                    <TouchableOpacity key={r} style={[fStyles.chip, preciseFilters.minRating === r && fStyles.chipActive]} onPress={() => setPreciseFilters(p => ({ ...p, minRating: r }))}>
                      <Text style={[fStyles.chipText, preciseFilters.minRating === r && fStyles.chipTextActive]}>{r === 0 ? 'Любой' : `${r}+`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={fStyles.label}>Максимальный рейтинг</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {MAX_RATINGS.map(r => (
                    <TouchableOpacity key={r} style={[fStyles.chip, preciseFilters.maxRating === r && fStyles.chipActive]} onPress={() => setPreciseFilters(p => ({ ...p, maxRating: r }))}>
                      <Text style={[fStyles.chipText, preciseFilters.maxRating === r && fStyles.chipTextActive]}>{r === 10 ? 'Любой' : `до ${r}`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={fStyles.label}>Страна производства</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {COUNTRIES.map(c => (
                    <TouchableOpacity key={c.code} style={[fStyles.chip, preciseFilters.country === c.code && fStyles.chipActive]} onPress={() => setPreciseFilters(p => ({ ...p, country: c.code }))}>
                      <Text style={[fStyles.chipText, preciseFilters.country === c.code && fStyles.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={fStyles.buttons}>
                <TouchableOpacity style={fStyles.resetBtn} onPress={() => setPreciseFilters({ yearFrom: '', yearTo: '', minRating: 0, maxRating: 10, country: '' })}>
                  <Text style={fStyles.resetText}>Сбросить</Text>
                </TouchableOpacity>
                <TouchableOpacity style={fStyles.applyBtn} onPress={() => setShowPreciseFilters(false)}>
                  <Text style={fStyles.applyText}>Применить</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#0f0f1a' },
  switcher: { flexDirection: 'row', backgroundColor: '#1e1e30', borderRadius: 14, padding: 3, marginBottom: 12 },
  switchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 11 },
  switchBtnActive: { backgroundColor: '#e50914' },
  switchText: { color: '#666', fontWeight: '600', fontSize: 14 },
  switchTextActive: { color: '#fff' },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e30', borderRadius: 12, paddingHorizontal: 12, height: 44 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 14 },
  filterBtn: { backgroundColor: '#1e1e30', width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resultsHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  resultsBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  resultsBackText: { color: '#8888ff', fontSize: 14, fontWeight: '600' },
  resultsTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  scroll: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 12 },
  trendCard: { width: 120, marginRight: 10 },
  trendImage: { width: 120, height: 180, borderRadius: 10, marginBottom: 6 },
  trendTitle: { color: '#ccc', fontSize: 11, textAlign: 'center' },
  genreRow: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  genreChip: { borderWidth: 1, borderColor: '#333', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  genreChipActive: { backgroundColor: '#e50914', borderColor: '#e50914' },
  genreChipText: { color: '#666', fontSize: 13 },
  genreChipTextActive: { color: '#fff', fontWeight: '600' },
  preciseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1e1e30', borderRadius: 14, padding: 16, marginBottom: 12, marginTop: 4 },
  preciseTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  preciseSubtitle: { color: '#555', fontSize: 12, marginTop: 2 },
  errorBox: { backgroundColor: '#2a0a0a', borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: '#e50914', fontSize: 13, textAlign: 'center' },
  randomBtn: { backgroundColor: '#e50914', paddingVertical: 16, borderRadius: 30, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 4 },
  randomText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  grid: { padding: 12 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: { width: cardWidth },
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#1a1a40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  typeBadgeText: { color: '#8888ff', fontSize: 11, fontWeight: '600' },
  poster: { width: cardWidth, height: cardWidth * 1.5, borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  cardRating: { color: '#aaa', fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  emptyText: { color: '#aaa', fontSize: 16, textAlign: 'center', marginTop: 10 },
  emptyHint: { color: '#555', fontSize: 13, textAlign: 'center', marginTop: 6 },
  loadMoreBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  loadMoreText: { color: '#e50914', fontSize: 15, fontWeight: '700' },
});

const fStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '85%' },
  handle: { width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 8, marginTop: 16 },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#333' },
  chipActive: { backgroundColor: '#e50914', borderColor: '#e50914' },
  chipText: { color: '#666', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  yearInput: { backgroundColor: '#0f0f1a', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontSize: 14, width: 100 },
  yearDash: { color: '#aaa' },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  resetBtn: { flex: 1, borderWidth: 1, borderColor: '#333', paddingVertical: 14, borderRadius: 30, alignItems: 'center' },
  resetText: { color: '#aaa', fontWeight: '600' },
  applyBtn: { flex: 2, backgroundColor: '#e50914', paddingVertical: 14, borderRadius: 30, alignItems: 'center' },
  applyText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
