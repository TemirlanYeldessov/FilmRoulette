import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import PaginationBar from '../components/PaginationBar';
import CardMark from '../components/CardMark';
import { getCached, setCached, LIST_TTL } from '../utils/apiCache';
import { dedup, itemToMovie } from '../utils/tmdb';
import { HorizontalCardSkeleton, MovieCardSkeleton } from '../components/Skeleton';
import { useAppContext } from '../store/AppContext';
import { TMDB_TOKEN as TOKEN } from '../constants/api';

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
const SKELETON_KEYS = [0, 1, 2, 3, 4, 5];
const TRENDING_PAGE_CAP = 10;

const defaultFilters = {
  mediaType: 'all',
  genreIds: [] as number[],
  yearFrom: '',
  yearTo: '',
  minRating: 0,
  maxRating: 10,
  language: '',
  country: '',
  sortBy: 'popularity.desc',
};

// Multi-select genre toggle, mirroring the roulette's behaviour so genre
// selection works the same way everywhere. id 0 ("Все жанры") clears the set.
function toggleGenreId(filters: any, id: number) {
  if (id === 0) return { ...filters, genreIds: [] };
  const cur: number[] = filters.genreIds || [];
  const next = cur.includes(id) ? cur.filter(g => g !== id) : [...cur, id];
  return { ...filters, genreIds: next };
}

const defaultPreciseFilters = { yearFrom: '', yearTo: '', minRating: 0, maxRating: 10, country: '' };
const RANDOM_REUSE_NOTICE = 'Все свежие варианты уже видели — показываю повтор.';

function assertValidTmdbPayload(data: any) {
  if (data?.success === false || data?.status_code) {
    throw new Error(data.status_message || 'TMDB error');
  }
  return data;
}

function withCheckedJson(res: Response) {
  const json = res.json.bind(res);
  (res as any).json = async () => assertValidTmdbPayload(await json());
  return res;
}

function areFiltersEqual(a: any, b: any) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function fetchWithTimeout(url: string, options: any = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const externalSignal: AbortSignal | undefined = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error('TMDB временно не отвечает. Попробуй еще раз.');
    return withCheckedJson(res);
  } catch (e: any) {
    if (e.name === 'AbortError') {
      if (externalSignal?.aborted) throw e;
      throw new Error('Превышено время ожидания.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

async function fetchDetails(id: number, type: string) {
  const [ruRes, enRes] = await Promise.all([
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=ru-RU&append_to_response=videos`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=en-US&append_to_response=videos`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
  ]);
  const ruData = await ruRes.json();
  const enData = await enRes.json();
  const trailerRu = ruData.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
  const trailerEn = enData.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
  return {
    id,
    titleRu: ruData.title || ruData.name,
    titleEn: enData.title || enData.name,
    overview: ruData.overview || enData.overview,
    poster: ruData.poster_path ? `https://image.tmdb.org/t/p/w500${ruData.poster_path}` : null,
    trailerKey: trailerRu?.key || trailerEn?.key || null,
    mediaType: type,
    rating: ruData.vote_average ? ruData.vote_average.toFixed(1) : null,
    year: (ruData.release_date || ruData.first_air_date || '').slice(0, 4),
    country: ruData.production_countries?.[0]?.name || null,
    genres: ruData.genres?.map((g: any) => g.name).join(', ') || null,
  };
}

async function fetchRandom(
  selectedGenres: number[],
  mediaType: string,
  adultContent: boolean,
  filters: any,
  recentRandomIds: string[]
) {
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
    const posterItems = (data.results || []).filter((m: any) => m.poster_path);
    const freshItems = posterItems.filter((m: any) => !recentRandomIds.includes(`${type}-${m.id}`));
    const items = freshItems.length > 0 ? freshItems : (attempt >= 3 ? posterItems : []);
    if (items.length > 0) {
      const item = items[Math.floor(Math.random() * items.length)];
      const details = await fetchDetails(item.id, type);
      return {
        ...details,
        genreId: genres[0] ?? 0,
        selectedGenres: genres,
        preciseFilters: filters,
        randomNotice: freshItems.length === 0 ? RANDOM_REUSE_NOTICE : null,
      };
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
  const results = dedup(
    (data.results || []).filter(
      (m: any) => (m.media_type === 'movie' || m.media_type === 'tv') && m.poster_path
    )
  );
  return {
    results,
    totalPages: Math.min(data.total_pages ?? 1, 500),
    totalResults: data.total_results ?? 0,
  };
}

function sortMerged(items: any[], sortBy: string): any[] {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'vote_average.desc':
        return (b.vote_average || 0) - (a.vote_average || 0);
      case 'release_date.desc':
        return new Date(b.release_date || b.first_air_date || '').getTime() -
               new Date(a.release_date || a.first_air_date || '').getTime();
      case 'release_date.asc':
        return new Date(a.release_date || a.first_air_date || '').getTime() -
               new Date(b.release_date || b.first_air_date || '').getTime();
      default:
        return (b.popularity || 0) - (a.popularity || 0);
    }
  });
}

async function discoverItems(filters: any, adultContent: boolean, page = 1) {
  const types = filters.mediaType === 'all' ? ['movie', 'tv'] : [filters.mediaType];

  const requests = types.map(async (type) => {
    const params: any = {
      language: 'ru-RU',
      sort_by: filters.sortBy || 'popularity.desc',
      page: String(page),
      include_adult: String(adultContent),
    };
    if (filters.genreIds?.length) params.with_genres = filters.genreIds.join(',');
    if (filters.minRating > 0) params['vote_average.gte'] = String(filters.minRating);
    if (filters.maxRating < 10) params['vote_average.lte'] = String(filters.maxRating);
    if (filters.language) params.with_original_language = filters.language;
    if (filters.country) params.with_origin_country = filters.country;
    if (filters.yearFrom)
      params[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = `${filters.yearFrom}-01-01`;
    if (filters.yearTo)
      params[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = `${filters.yearTo}-12-31`;

    const url = `https://api.themoviedb.org/3/discover/${type}?${new URLSearchParams(params)}`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const data = await res.json();
    return {
      results: (data.results || []).filter((m: any) => m.poster_path).map((m: any) => ({ ...m, media_type: type })),
      totalPages: Math.min(data.total_pages || 1, 500),
      totalResults: data.total_results || 0,
    };
  });

  // allSettled: when "all" is selected, one media type failing shouldn't wipe
  // out the other's results. Only error out if both failed.
  const settled = await Promise.allSettled(requests);
  const typed = settled
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value);
  if (typed.length === 0) {
    const firstRejected = settled.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    throw firstRejected?.reason || new Error('Не удалось загрузить.');
  }
  const merged = sortMerged(
    dedup(typed.flatMap(t => t.results)),
    filters.sortBy || 'popularity.desc'
  );
  const totalPages = Math.max(...typed.map(t => t.totalPages));
  const totalResults = typed.reduce((sum, t) => sum + t.totalResults, 0);
  return { results: merged, totalPages, totalResults };
}

function FilterSheet({ visible, onClose, filters, onApply }: any) {
  const [local, setLocal] = useState(filters);
  const genres = local.mediaType === 'tv' ? TV_GENRES : MOVIE_GENRES;

  useEffect(() => {
    if (visible) setLocal(filters);
  }, [visible, filters]);

  const requestClose = () => {
    if (areFiltersEqual(local, filters)) {
      onClose();
      return;
    }
    Alert.alert('Есть несохранённые изменения', 'Применить изменения фильтров?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Не применять', style: 'destructive', onPress: () => { setLocal(filters); onClose(); } },
      { text: 'Применить', onPress: () => { onApply(local); onClose(); } },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={requestClose}>
      <TouchableOpacity style={fStyles.overlay} activeOpacity={1} onPress={requestClose}>
        <TouchableOpacity activeOpacity={1} style={fStyles.sheet}>
          <View style={fStyles.handle} />
          <Text style={fStyles.title}>Фильтры поиска</Text>
          <Text style={fStyles.caption}>Применяются к поиску и каталогу — не к рулетке</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={fStyles.label}>Тип контента</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {CONTENT_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[fStyles.chip, local.mediaType === t.key && fStyles.chipActive]}
                    onPress={() => setLocal({ ...local, mediaType: t.key, genreIds: [] })}
                  >
                    <Text style={[fStyles.chipText, local.mediaType === t.key && fStyles.chipTextActive]}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={fStyles.label}>Жанр</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={fStyles.chipRow}>
                {genres.map(g => {
                  const active = g.id === 0 ? local.genreIds.length === 0 : local.genreIds.includes(g.id);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[fStyles.chip, active && fStyles.chipActive]}
                      onPress={() => setLocal((p: any) => toggleGenreId(p, g.id))}
                    >
                      <Text style={[fStyles.chipText, active && fStyles.chipTextActive]}>{g.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={fStyles.label}>Год выпуска</Text>
            <View style={fStyles.yearRow}>
              <TextInput style={fStyles.yearInput} placeholder="От" placeholderTextColor="#777" value={local.yearFrom} onChangeText={v => setLocal({ ...local, yearFrom: v })} keyboardType="numeric" maxLength={4} />
              <Text style={fStyles.yearDash}>-</Text>
              <TextInput style={fStyles.yearInput} placeholder="До" placeholderTextColor="#777" value={local.yearTo} onChangeText={v => setLocal({ ...local, yearTo: v })} keyboardType="numeric" maxLength={4} />
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

  // Trending
  const [trending, setTrending] = useState<any[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError, setTrendingError] = useState('');
  const [trendingPage, setTrendingPage] = useState(1);
  const [trendingTotal, setTrendingTotal] = useState(1);
  const [trendingLoadingMore, setTrendingLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const trendingReqRef = useRef(0);

  // Random
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<number[]>([0]);
  const [preciseFilters, setPreciseFilters] = useState(defaultPreciseFilters);
  const [localPreciseFilters, setLocalPreciseFilters] = useState(defaultPreciseFilters);
  const [showPreciseFilters, setShowPreciseFilters] = useState(false);

  // Filters modal
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);

  // Search & results
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);

  const searchRequestRef = useRef(0);
  const lastQueryRef = useRef('');
  const activeFiltersRef = useRef(defaultFilters);
  const resultsListRef = useRef<FlatList>(null);
  const genres = mediaType === 'tv' ? TV_GENRES : MOVIE_GENRES;
  const { width } = useWindowDimensions();
  const cardWidth = useMemo(() => (width - 48) / 2, [width]);

  const scrollResultsToTop = useCallback(() => {
    requestAnimationFrame(() => {
      resultsListRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);

  const openPreciseFilters = () => {
    setLocalPreciseFilters(preciseFilters);
    setShowPreciseFilters(true);
  };

  const applyPreciseFilters = (next = localPreciseFilters) => {
    setPreciseFilters(next);
    setShowPreciseFilters(false);
  };

  const closePreciseFilters = () => {
    if (areFiltersEqual(localPreciseFilters, preciseFilters)) {
      setShowPreciseFilters(false);
      return;
    }
    Alert.alert('Есть несохранённые изменения', 'Применить изменения фильтров?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Не применять', style: 'destructive', onPress: () => setShowPreciseFilters(false) },
      { text: 'Применить', onPress: () => applyPreciseFilters() },
    ]);
  };

  const loadTrending = useCallback(async (mt: string, page: number, append: boolean) => {
    const myId = ++trendingReqRef.current;
    if (page === 1) {
      setTrendingLoading(true);
      setTrendingError('');
    } else {
      setTrendingLoadingMore(true);
    }
    try {
      const cacheKey = `trend:${mt}:${page}`;
      let payload = getCached<{ results: any[]; totalPages: number }>(cacheKey, LIST_TTL);
      if (!payload) {
        const res = await fetchWithTimeout(
          `https://api.themoviedb.org/3/trending/${mt}/week?language=ru-RU&page=${page}`,
          { headers: { Authorization: `Bearer ${TOKEN}` } }
        );
        const data = await res.json();
        payload = {
          results: (data.results || []).filter((m: any) => m.poster_path),
          totalPages: Math.min(data.total_pages || 1, TRENDING_PAGE_CAP),
        };
        setCached(cacheKey, payload);
      }
      if (trendingReqRef.current !== myId) return;
      const results = payload.results;
      setTrending(prev => append ? dedup([...prev, ...results]) : results);
      setTrendingTotal(payload.totalPages);
      setTrendingPage(page);
    } catch (e: any) {
      if (trendingReqRef.current !== myId) return;
      if (page === 1) setTrendingError(e?.message || 'Не удалось загрузить новинки.');
    } finally {
      if (trendingReqRef.current === myId) {
        setTrendingLoading(false);
        setTrendingLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    // Bump request id immediately so any in-flight onRefresh / loadMore for
    // the previous mediaType can't write into trending state for the new one.
    ++trendingReqRef.current;
    setTrendingLoading(true);
    setTrendingPage(1);
    setTrending([]);
    loadTrending(mediaType, 1, false);
  }, [mediaType, loadTrending]);

  const loadMoreTrending = () => {
    if (trendingLoadingMore || trendingPage >= trendingTotal) return;
    loadTrending(mediaType, trendingPage + 1, true);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTrendingPage(1);
    setTrending([]);
    await loadTrending(mediaType, 1, false);
    setRefreshing(false);
  }, [mediaType, loadTrending]);

  // Debounced text search
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
      // Record the query up-front (not just on success) so the retry button in
      // the error state knows to re-run a text search rather than a discover.
      lastQueryRef.current = q;
      try {
        const { results, totalPages: tp, totalResults: tr } = await searchItems(q, adultContent, 1);
        if (searchRequestRef.current === requestId) {
          setSearchResults(results);
          setCurrentPage(1);
          setTotalPages(tp);
          setTotalResults(tr);
        }
      } catch (e: any) {
        if (searchRequestRef.current === requestId) {
          setError(e.message || 'Не удалось выполнить поиск.');
          setSearchResults([]);
          setTotalPages(1);
          setTotalResults(0);
        }
      }
      if (searchRequestRef.current === requestId) setSearching(false);
    }, 450);

    return () => clearTimeout(timer);
  }, [searchQuery, adultContent]);

  const clearSearchMode = () => {
    searchRequestRef.current += 1;
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchMode(false);
    setSearching(false);
    setFilters(defaultFilters);
    setError('');
    setCurrentPage(1);
    setTotalPages(1);
    setTotalResults(0);
    lastQueryRef.current = '';
    activeFiltersRef.current = defaultFilters;
  };

  const handleFilterSearch = async (rawF: any) => {
    // Auto-correct contradictory ranges so the user gets actual results
    // instead of a confusing empty state.
    const f = { ...rawF };
    if (f.minRating > f.maxRating) f.maxRating = 10;
    const yf = parseInt(f.yearFrom, 10);
    const yt = parseInt(f.yearTo, 10);
    if (Number.isFinite(yf) && Number.isFinite(yt) && yf > yt) {
      f.yearFrom = String(yt);
      f.yearTo = String(yf);
    }
    const requestId = ++searchRequestRef.current;
    lastQueryRef.current = '';
    activeFiltersRef.current = f;
    setFilters(f);
    setIsSearchMode(true);
    setSearching(true);
    setSearchQuery('');
    setError('');
    setCurrentPage(1);
    try {
      const { results, totalPages: tp, totalResults: tr } = await discoverItems(f, adultContent, 1);
      if (searchRequestRef.current !== requestId) return;
      setSearchResults(results);
      setTotalPages(tp);
      setTotalResults(tr);
    } catch (e: any) {
      if (searchRequestRef.current !== requestId) return;
      setError(e.message || 'Не удалось применить фильтры.');
      setSearchResults([]);
      setTotalPages(1);
      setTotalResults(0);
    } finally {
      if (searchRequestRef.current === requestId) setSearching(false);
    }
  };

  const handlePageChange = async (page: number) => {
    if (searching) return;
    const requestId = ++searchRequestRef.current;
    const prevPage = currentPage;
    let shouldScroll = false;
    setCurrentPage(page);
    setSearching(true);
    setError('');
    try {
      const { results, totalPages: tp, totalResults: tr } = lastQueryRef.current
        ? await searchItems(lastQueryRef.current, adultContent, page)
        : await discoverItems(activeFiltersRef.current, adultContent, page);
      if (searchRequestRef.current !== requestId) return;
      setSearchResults(results);
      setTotalPages(tp);
      setTotalResults(tr);
      shouldScroll = true;
    } catch (e: any) {
      if (searchRequestRef.current !== requestId) return;
      setCurrentPage(prevPage);
      setError(e?.message || 'Не удалось перейти на страницу.');
    } finally {
      if (searchRequestRef.current === requestId) {
        setSearching(false);
        if (shouldScroll) scrollResultsToTop();
      }
    }
  };

  const openCard = (item: any) => {
    navigation.navigate('Card', { movie: itemToMovie(item, mediaType) });
  };

  const openRandom = async () => {
    const fp = { ...preciseFilters };
    if (fp.minRating > fp.maxRating) fp.maxRating = 10;
    const yf = parseInt(fp.yearFrom, 10);
    const yt = parseInt(fp.yearTo, 10);
    if (Number.isFinite(yf) && Number.isFinite(yt) && yf > yt) {
      fp.yearFrom = String(yt);
      fp.yearTo = String(yf);
    }
    setLoading(true);
    setError('');
    try {
      const movie = await fetchRandom(selectedGenres, mediaType, adultContent, fp, recentRandomIds);
      addRecentRandom(movie.id, movie.mediaType);
      navigation.navigate('Card', { movie, preciseFilters: fp, randomNotice: movie.randomNotice });
    } catch (e: any) {
      setError(e.message || 'Не удалось подобрать случайный тайтл.');
    }
    setLoading(false);
  };

  const toggleGenre = (id: number) => {
    if (id === 0) { setSelectedGenres([0]); return; }
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
            <TouchableOpacity
              style={[styles.switchBtn, mediaType === 'movie' && styles.switchBtnActive]}
              onPress={() => { setMediaType('movie'); setSelectedGenres([0]); }}
            >
              <Ionicons name="film" size={16} color={mediaType === 'movie' ? '#fff' : '#666'} />
              <Text style={[styles.switchText, mediaType === 'movie' && styles.switchTextActive]}>Фильмы</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.switchBtn, mediaType === 'tv' && styles.switchBtnActive]}
              onPress={() => { setMediaType('tv'); setSelectedGenres([0]); }}
            >
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
              placeholderTextColor="#777"
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
            <Text style={styles.resultsTitle}>
              {searchQuery.trim() ? 'Результаты поиска' : 'Результаты фильтров'}
            </Text>
          </View>

          {searching ? (
            <FlatList
              data={SKELETON_KEYS}
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
              <TouchableOpacity style={styles.searchRetryBtn} onPress={() => handlePageChange(currentPage)}>
                <Text style={styles.searchRetryText}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={38} color="#555" />
              <Text style={styles.emptyText}>Ничего не найдено</Text>
              <Text style={styles.emptyHint}>Попробуй смягчить фильтры или изменить запрос.</Text>
            </View>
          ) : (
            <FlatList
              ref={resultsListRef}
              data={searchResults}
              keyExtractor={(item) => `${item.media_type || mediaType}-${item.id}`}
              numColumns={2}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.row}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.card, { width: cardWidth }]} onPress={() => openCard(item)}>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{item.media_type === 'tv' ? 'Сериал' : 'Фильм'}</Text>
                  </View>
                  <CardMark movie={itemToMovie(item, mediaType)} />
                  <Image
                    source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
                    style={[styles.poster, { width: cardWidth, height: cardWidth * 1.5 }]}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title || item.name}</Text>
                  {item.vote_average > 0 && <Text style={styles.cardRating}>★ {item.vote_average.toFixed(1)}</Text>}
                </TouchableOpacity>
              )}
              ListFooterComponent={
                <PaginationBar
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalResults={totalResults}
                  onPageChange={handlePageChange}
                  loading={searching}
                />
              }
            />
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e50914" />}
        >
          <Text style={styles.sectionTitle}>Рулетка</Text>
          <Text style={styles.sectionSubtitle}>Выбери жанры и крути — подберём случайный тайтл</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.genreRow}>
              {genres.map(g => (
                <TouchableOpacity
                  key={g.id}
                  style={[
                    styles.genreChip,
                    (g.id === 0 ? isAllGenres : selectedGenres.includes(g.id)) && styles.genreChipActive,
                  ]}
                  onPress={() => toggleGenre(g.id)}
                >
                  <Text
                    style={[
                      styles.genreChipText,
                      (g.id === 0 ? isAllGenres : selectedGenres.includes(g.id)) && styles.genreChipTextActive,
                    ]}
                  >
                    {g.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.preciseRow} onPress={openPreciseFilters}>
            <View>
              <Text style={styles.preciseTitle}>Подобрать точнее</Text>
              <Text style={styles.preciseSubtitle}>Год, рейтинг, страна — для рулетки</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#888" />
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

          <TouchableOpacity style={styles.cinemaCard} onPress={() => navigation.navigate('Cinema')}>
            <View style={styles.cinemaIcon}>
              <Ionicons name="film" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cinemaTitle}>Сейчас в кино · Актобе</Text>
              <Text style={styles.cinemaSubtitle}>Расписание сеансов на сегодня и завтра</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#888" />
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Новинки недели</Text>

          {trendingLoading ? (
            <FlatList
              data={[1, 2, 3, 4, 5]}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={i => String(i)}
              renderItem={() => <HorizontalCardSkeleton />}
            />
          ) : trendingError ? (
            <View style={styles.trendingErrorBox}>
              <Text style={styles.trendingErrorText}>{trendingError}</Text>
              <TouchableOpacity onPress={() => loadTrending(mediaType, 1, false)}>
                <Text style={styles.trendingRetry}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={trending}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={item => `${item.media_type || mediaType}-${item.id}`}
              onEndReached={loadMoreTrending}
              onEndReachedThreshold={0.6}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => openCard(item)} style={styles.trendCard}>
                  <CardMark movie={itemToMovie(item, mediaType)} />
                  <Image
                    source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
                    style={styles.trendImage}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                  <Text style={styles.trendTitle} numberOfLines={2}>{item.title || item.name}</Text>
                </TouchableOpacity>
              )}
              ListFooterComponent={
                trendingLoadingMore ? (
                  <HorizontalCardSkeleton />
                ) : null
              }
            />
          )}
        </ScrollView>
      )}

      <FilterSheet visible={showFilters} onClose={() => setShowFilters(false)} filters={filters} onApply={handleFilterSearch} />

      <Modal visible={showPreciseFilters} transparent animationType="slide" onRequestClose={closePreciseFilters}>
        <TouchableOpacity style={fStyles.overlay} activeOpacity={1} onPress={closePreciseFilters}>
          <TouchableOpacity activeOpacity={1} style={fStyles.sheet}>
            <View style={fStyles.handle} />
            <Text style={fStyles.title}>Подобрать точнее</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={fStyles.label}>Год выпуска</Text>
              <View style={fStyles.yearRow}>
                <TextInput style={fStyles.yearInput} placeholder="От" placeholderTextColor="#777" value={localPreciseFilters.yearFrom} onChangeText={v => setLocalPreciseFilters(p => ({ ...p, yearFrom: v }))} keyboardType="numeric" maxLength={4} />
                <Text style={fStyles.yearDash}>-</Text>
                <TextInput style={fStyles.yearInput} placeholder="До" placeholderTextColor="#777" value={localPreciseFilters.yearTo} onChangeText={v => setLocalPreciseFilters(p => ({ ...p, yearTo: v }))} keyboardType="numeric" maxLength={4} />
              </View>

              <Text style={fStyles.label}>Минимальный рейтинг</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {RATINGS.map(r => (
                    <TouchableOpacity key={r} style={[fStyles.chip, localPreciseFilters.minRating === r && fStyles.chipActive]} onPress={() => setLocalPreciseFilters(p => ({ ...p, minRating: r }))}>
                      <Text style={[fStyles.chipText, localPreciseFilters.minRating === r && fStyles.chipTextActive]}>{r === 0 ? 'Любой' : `${r}+`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={fStyles.label}>Максимальный рейтинг</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {MAX_RATINGS.map(r => (
                    <TouchableOpacity key={r} style={[fStyles.chip, localPreciseFilters.maxRating === r && fStyles.chipActive]} onPress={() => setLocalPreciseFilters(p => ({ ...p, maxRating: r }))}>
                      <Text style={[fStyles.chipText, localPreciseFilters.maxRating === r && fStyles.chipTextActive]}>{r === 10 ? 'Любой' : `до ${r}`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={fStyles.label}>Страна производства</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {COUNTRIES.map(c => (
                    <TouchableOpacity key={c.code} style={[fStyles.chip, localPreciseFilters.country === c.code && fStyles.chipActive]} onPress={() => setLocalPreciseFilters(p => ({ ...p, country: c.code }))}>
                      <Text style={[fStyles.chipText, localPreciseFilters.country === c.code && fStyles.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={fStyles.buttons}>
                <TouchableOpacity style={fStyles.resetBtn} onPress={() => setLocalPreciseFilters(defaultPreciseFilters)}>
                  <Text style={fStyles.resetText}>Сбросить</Text>
                </TouchableOpacity>
                <TouchableOpacity style={fStyles.applyBtn} onPress={() => applyPreciseFilters()}>
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
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 12, marginTop: 8 },
  sectionSubtitle: { color: '#888', fontSize: 13, marginTop: -6, marginBottom: 14 },
  trendCard: { width: 120, marginRight: 10 },
  trendImage: { width: 120, height: 180, borderRadius: 10, marginBottom: 6 },
  trendTitle: { color: '#ccc', fontSize: 11, textAlign: 'center' },
  genreRow: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  genreChip: { borderWidth: 1, borderColor: '#333', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  genreChipActive: { backgroundColor: '#e50914', borderColor: '#e50914' },
  genreChipText: { color: '#666', fontSize: 13 },
  genreChipTextActive: { color: '#fff', fontWeight: '600' },
  cinemaCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1e1e40', borderWidth: 1, borderColor: '#3a3a66', borderRadius: 14, padding: 14, marginTop: 24 },
  cinemaIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#e50914', alignItems: 'center', justifyContent: 'center' },
  cinemaTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cinemaSubtitle: { color: '#9a9ad0', fontSize: 12, marginTop: 2 },
  preciseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1e1e30', borderRadius: 14, padding: 16, marginBottom: 12, marginTop: 4 },
  preciseTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  preciseSubtitle: { color: '#555', fontSize: 12, marginTop: 2 },
  errorBox: { backgroundColor: '#2a0a0a', borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: '#e50914', fontSize: 13, textAlign: 'center' },
  randomBtn: { backgroundColor: '#e50914', paddingVertical: 16, borderRadius: 30, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 4 },
  randomText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  grid: { padding: 12 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: {},
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#1a1a40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  typeBadgeText: { color: '#8888ff', fontSize: 11, fontWeight: '600' },
  poster: { borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  cardRating: { color: '#aaa', fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  emptyText: { color: '#aaa', fontSize: 16, textAlign: 'center', marginTop: 10 },
  emptyHint: { color: '#555', fontSize: 13, textAlign: 'center', marginTop: 6 },
  searchRetryBtn: { backgroundColor: '#e50914', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, marginTop: 14 },
  searchRetryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  trendingErrorBox: { backgroundColor: '#2a0a0a', borderRadius: 12, padding: 14, marginBottom: 8, alignItems: 'center', gap: 8 },
  trendingErrorText: { color: '#e50914', fontSize: 13, textAlign: 'center' },
  trendingRetry: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

const fStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '85%' },
  handle: { width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  caption: { color: '#888', fontSize: 12, marginBottom: 14 },
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
