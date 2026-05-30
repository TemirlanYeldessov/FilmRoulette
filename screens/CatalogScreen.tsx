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
  View,
} from 'react-native';
import PaginationBar from '../components/PaginationBar';
import CardMark from '../components/CardMark';
import PosterCard from '../components/PosterCard';
import { getCached, setCached, LIST_TTL } from '../utils/apiCache';
import { dedup, itemToMovie, sanitizeYearRange, areFiltersEqual, applyDiscoverFilters, mapBaseDetail } from '../utils/tmdb';
import { makeTmdbFetch } from '../utils/api';
import { MOVIE_GENRES, TV_GENRES, COUNTRIES, LANGUAGES, RATINGS, MAX_RATINGS, SORT_OPTIONS } from '../constants/filters';
import { HorizontalCardSkeleton, MovieCardSkeleton } from '../components/Skeleton';
import { useAppContext } from '../store/AppContext';
import { tmdbUrls, tmdbHeaders, pickRandomDiscoverItem } from '../utils/tmdbApi';
import { useGridColumns } from '../utils/useGridColumns';
import { tapMedium } from '../utils/haptics';
import { colors, gradients, radii, shadow } from '../constants/theme';

const CONTENT_TYPES = [
  { key: 'all', name: 'Фильмы и сериалы' },
  { key: 'movie', name: 'Только фильмы' },
  { key: 'tv', name: 'Только сериалы' },
];

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

const fetchWithTimeout = makeTmdbFetch({
  notOk: 'TMDB временно не отвечает. Попробуй еще раз.',
  timeout: 'Превышено время ожидания.',
});

async function fetchDetails(id: number, type: string) {
  const [ruRes, enRes] = await Promise.all([
    fetchWithTimeout(tmdbUrls.detail(type, id, 'ru-RU', 'videos'), { headers: tmdbHeaders() }),
    fetchWithTimeout(tmdbUrls.detail(type, id, 'en-US', 'videos'), { headers: tmdbHeaders() }),
  ]);
  const ruData = await ruRes.json();
  const enData = await enRes.json();
  return mapBaseDetail(id, ruData, enData, type);
}

async function fetchRandom(
  selectedGenres: number[],
  mediaType: string,
  adultContent: boolean,
  filters: any,
  recentRandomIds: string[]
) {
  const type = mediaType;
  const picked = await pickRandomDiscoverItem(fetchWithTimeout, {
    type, selectedGenres, adultContent, filters, recentRandomIds,
  });
  if (!picked) throw new Error('Новых вариантов по этим условиям не осталось. Попробуй изменить фильтры.');
  const details = await fetchDetails(picked.item.id, type);
  return {
    ...details,
    genreId: picked.genres[0] ?? 0,
    selectedGenres: picked.genres,
    preciseFilters: filters,
    randomNotice: picked.reused ? RANDOM_REUSE_NOTICE : null,
  };
}

async function searchItems(query: string, adultContent: boolean, page = 1) {
  const res = await fetchWithTimeout(
    tmdbUrls.searchMulti(query, adultContent, page),
    { headers: tmdbHeaders() }
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

// Parse a TMDB date to a sortable timestamp; missing/invalid dates become 0 so
// they sort last (desc) / first (asc) instead of producing NaN comparisons,
// which leave undated items in an unstable order.
function dateValue(item: any): number {
  const t = new Date(item.release_date || item.first_air_date || '').getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortMerged(items: any[], sortBy: string): any[] {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'vote_average.desc':
        return (b.vote_average || 0) - (a.vote_average || 0);
      case 'release_date.desc':
        return dateValue(b) - dateValue(a);
      case 'release_date.asc':
        return dateValue(a) - dateValue(b);
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
    applyDiscoverFilters(params, filters, type);

    const res = await fetchWithTimeout(tmdbUrls.discover(type, params), { headers: tmdbHeaders() });
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
              <TextInput style={fStyles.yearInput} placeholder="От" placeholderTextColor={colors.muted2} value={local.yearFrom} onChangeText={v => setLocal({ ...local, yearFrom: v })} keyboardType="numeric" maxLength={4} />
              <Text style={fStyles.yearDash}>-</Text>
              <TextInput style={fStyles.yearInput} placeholder="До" placeholderTextColor={colors.muted2} value={local.yearTo} onChangeText={v => setLocal({ ...local, yearTo: v })} keyboardType="numeric" maxLength={4} />
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
  const [localRandomGenres, setLocalRandomGenres] = useState<number[]>([0]);
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
  const { columns, cardWidth } = useGridColumns();
  const randomSummary = useMemo(() => {
    const pickedGenres = selectedGenres.filter(id => id !== 0);
    const genreNames = pickedGenres
      .map(id => genres.find(g => g.id === id)?.name)
      .filter(Boolean);
    const filterBits = [
      preciseFilters.yearFrom || preciseFilters.yearTo
        ? `${preciseFilters.yearFrom || '...'}-${preciseFilters.yearTo || '...'}`
        : '',
      preciseFilters.minRating > 0 ? `рейтинг ${preciseFilters.minRating}+` : '',
      preciseFilters.maxRating < 10 ? `до ${preciseFilters.maxRating}` : '',
      preciseFilters.country
        ? COUNTRIES.find(c => c.code === preciseFilters.country)?.name
        : '',
    ].filter(Boolean);
    return [...(genreNames.length ? genreNames : ['все жанры']), ...filterBits].join(' · ');
  }, [selectedGenres, preciseFilters, genres]);

  const scrollResultsToTop = useCallback(() => {
    requestAnimationFrame(() => {
      resultsListRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);

  const openPreciseFilters = () => {
    setLocalPreciseFilters(preciseFilters);
    setLocalRandomGenres(selectedGenres);
    setShowPreciseFilters(true);
  };

  const applyPreciseFilters = (next = localPreciseFilters, nextGenres = localRandomGenres) => {
    const normalized = { ...next };
    if (normalized.minRating > normalized.maxRating) normalized.maxRating = 10;
    const years = sanitizeYearRange(normalized.yearFrom, normalized.yearTo);
    normalized.yearFrom = years.yearFrom;
    normalized.yearTo = years.yearTo;
    setPreciseFilters(normalized);
    setSelectedGenres(nextGenres.length ? nextGenres : [0]);
    setShowPreciseFilters(false);
  };

  const closePreciseFilters = () => {
    if (
      areFiltersEqual(localPreciseFilters, preciseFilters) &&
      localRandomGenres.join(',') === selectedGenres.join(',')
    ) {
      setShowPreciseFilters(false);
      return;
    }
    Alert.alert('Есть несохранённые изменения', 'Применить изменения фильтров?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Не применять', style: 'destructive', onPress: () => setShowPreciseFilters(false) },
      { text: 'Применить', onPress: () => applyPreciseFilters() },
    ]);
  };

  const toggleLocalGenre = (id: number) => {
    if (id === 0) { setLocalRandomGenres([0]); return; }
    setLocalRandomGenres(prev => {
      const without0 = prev.filter(g => g !== 0);
      if (without0.includes(id)) {
        const next = without0.filter(g => g !== id);
        return next.length === 0 ? [0] : next;
      }
      return [...without0, id];
    });
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
        const res = await fetchWithTimeout(tmdbUrls.trendingWeek(mt, page), { headers: tmdbHeaders() });
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
    const years = sanitizeYearRange(f.yearFrom, f.yearTo);
    f.yearFrom = years.yearFrom;
    f.yearTo = years.yearTo;
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
    if (loading) return;
    tapMedium();
    const fp = { ...preciseFilters };
    if (fp.minRating > fp.maxRating) fp.maxRating = 10;
    const years = sanitizeYearRange(fp.yearFrom, fp.yearTo);
    fp.yearFrom = years.yearFrom;
    fp.yearTo = years.yearTo;
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

  return (
    <LinearGradient colors={gradients.app} style={styles.container}>
      <View style={styles.header}>
        {!isSearchMode && (
          <View style={styles.switcher}>
            <TouchableOpacity
              style={[styles.switchBtn, mediaType === 'movie' && styles.switchBtnActive]}
              onPress={() => { setMediaType('movie'); setSelectedGenres([0]); }}
            >
              <Ionicons name="film" size={16} color={mediaType === 'movie' ? colors.text : colors.muted2} />
              <Text style={[styles.switchText, mediaType === 'movie' && styles.switchTextActive]}>Фильмы</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.switchBtn, mediaType === 'tv' && styles.switchBtnActive]}
              onPress={() => { setMediaType('tv'); setSelectedGenres([0]); }}
            >
              <Ionicons name="tv" size={16} color={mediaType === 'tv' ? colors.text : colors.muted2} />
              <Text style={[styles.switchText, mediaType === 'tv' && styles.switchTextActive]}>Сериалы</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            <Ionicons name="search" size={16} color={colors.muted2} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Поиск фильмов и сериалов..."
              placeholderTextColor={colors.muted2}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={clearSearchMode}
                accessibilityRole="button"
                accessibilityLabel="Очистить поиск"
              >
                <Ionicons name="close-circle" size={16} color={colors.muted2} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => setShowFilters(true)}
            accessibilityRole="button"
            accessibilityLabel="Открыть фильтры"
          >
            <Ionicons name="options" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {isSearchMode ? (
        <View style={{ flex: 1 }}>
          <View style={styles.resultsHeader}>
            <TouchableOpacity style={styles.resultsBackBtn} onPress={clearSearchMode}>
              <Ionicons name="chevron-back" size={18} color={colors.accent} />
              <Text style={styles.resultsBackText}>Назад к каталогу</Text>
            </TouchableOpacity>
            <Text style={styles.resultsTitle}>
              {searchQuery.trim() ? 'Результаты поиска' : 'Результаты фильтров'}
            </Text>
            {!searchQuery.trim() && filters.mediaType === 'all' && filters.sortBy !== 'popularity.desc' && (
              <Text style={styles.resultsCaption}>
                В режиме «Фильмы и сериалы» сортировка применяется в пределах страницы
              </Text>
            )}
          </View>

          {searching ? (
            <FlatList
              data={SKELETON_KEYS}
              keyExtractor={item => String(item)}
              key={`grid-${columns}`}
              numColumns={columns}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.row}
              renderItem={() => <MovieCardSkeleton cardWidth={cardWidth} />}
            />
          ) : error ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={38} color={colors.faint} />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity style={styles.searchRetryBtn} onPress={() => handlePageChange(currentPage)}>
                <Text style={styles.searchRetryText}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={38} color={colors.faint} />
              <Text style={styles.emptyText}>Ничего не найдено</Text>
              <Text style={styles.emptyHint}>Попробуй смягчить фильтры или изменить запрос.</Text>
              <TouchableOpacity style={styles.searchRetryBtn} onPress={clearSearchMode}>
                <Text style={styles.searchRetryText}>Сбросить поиск</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              ref={resultsListRef}
              data={searchResults}
              keyExtractor={(item) => `${item.media_type || mediaType}-${item.id}`}
              key={`grid-${columns}`}
              numColumns={columns}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.row}
              renderItem={({ item }) => (
                <PosterCard item={item} cardWidth={cardWidth} onPress={() => openCard(item)} mediaTypeFallback={mediaType}>
                  {item.vote_average > 0 && <Text style={styles.cardRating}>★ {item.vote_average.toFixed(1)}</Text>}
                </PosterCard>
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          <View style={styles.roulettePanel}>
            <View style={styles.rouletteTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Рулетка</Text>
                <Text style={styles.sectionSubtitle}>Быстрый выбор, когда не хочется листать каталог</Text>
              </View>
              <TouchableOpacity style={styles.rouletteSettingsBtn} onPress={openPreciseFilters}>
                <Ionicons name="options" size={17} color={colors.accent} />
                <Text style={styles.rouletteSettingsText}>Настроить</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.rouletteSummary}>
              <Ionicons name="filter-outline" size={15} color={colors.muted} />
              <Text style={styles.rouletteSummaryText} numberOfLines={2}>{randomSummary}</Text>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={styles.randomLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.randomLoadingText}>Подбираю тайтл...</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.randomBtn} onPress={openRandom}>
                <Ionicons name="shuffle" size={20} color={colors.text} />
                <Text style={styles.randomText}>Случайный {mediaType === 'movie' ? 'фильм' : 'сериал'}</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={styles.cinemaCardCompact} onPress={() => navigation.navigate('Cinema')}>
            <View style={styles.cinemaIcon}>
              <Ionicons name="film" size={22} color={colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cinemaTitle}>Сейчас в кино · Актобе</Text>
              <Text style={styles.cinemaSubtitle}>Расписание сеансов на сегодня и завтра</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Можно выбрать вручную</Text>
          <Text style={styles.sectionSubtitle}>Новинки недели, если хочется просто полистать</Text>

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
            <Text style={fStyles.title}>Настроить рулетку</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={fStyles.label}>Жанры</Text>
              <View style={fStyles.genreGrid}>
                {genres.map(g => {
                  const active = g.id === 0 ? localRandomGenres.includes(0) : localRandomGenres.includes(g.id);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[fStyles.chip, active && fStyles.chipActive]}
                      onPress={() => toggleLocalGenre(g.id)}
                    >
                      <Text style={[fStyles.chipText, active && fStyles.chipTextActive]}>{g.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={fStyles.label}>Год выпуска</Text>
              <View style={fStyles.yearRow}>
                <TextInput style={fStyles.yearInput} placeholder="От" placeholderTextColor={colors.muted2} value={localPreciseFilters.yearFrom} onChangeText={v => setLocalPreciseFilters(p => ({ ...p, yearFrom: v }))} keyboardType="numeric" maxLength={4} />
                <Text style={fStyles.yearDash}>-</Text>
                <TextInput style={fStyles.yearInput} placeholder="До" placeholderTextColor={colors.muted2} value={localPreciseFilters.yearTo} onChangeText={v => setLocalPreciseFilters(p => ({ ...p, yearTo: v }))} keyboardType="numeric" maxLength={4} />
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
                <TouchableOpacity
                  style={fStyles.resetBtn}
                  onPress={() => {
                    setLocalPreciseFilters(defaultPreciseFilters);
                    setLocalRandomGenres([0]);
                  }}
                >
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
  header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: colors.bg },
  switcher: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radii.lg, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: colors.borderSoft },
  switchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: radii.md },
  switchBtnActive: { backgroundColor: colors.primary },
  switchText: { color: colors.muted2, fontWeight: '700', fontSize: 14 },
  switchTextActive: { color: colors.text },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated, borderRadius: radii.md, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.borderSoft },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  filterBtn: { backgroundColor: colors.surfaceElevated, width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft },
  resultsHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  resultsBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  resultsBackText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  resultsTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  resultsCaption: { color: colors.muted2, fontSize: 11, marginTop: 4 },
  scroll: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 12, marginTop: 8 },
  sectionSubtitle: { color: colors.muted, fontSize: 13, marginTop: -6, marginBottom: 14 },
  roulettePanel: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 16, marginBottom: 14, ...shadow.card },
  rouletteTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  rouletteSettingsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill },
  rouletteSettingsText: { color: colors.textSoft, fontSize: 12, fontWeight: '800' },
  rouletteSummary: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.bgSoft, borderRadius: radii.md, padding: 10, marginBottom: 12 },
  rouletteSummaryText: { color: colors.textSoft, fontSize: 12, flex: 1, lineHeight: 17 },
  randomLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  randomLoadingText: { color: colors.textSoft, fontSize: 13, fontWeight: '700' },
  trendCard: { width: 120, marginRight: 10 },
  trendImage: { width: 120, height: 180, borderRadius: radii.md, marginBottom: 6, backgroundColor: colors.surface },
  trendTitle: { color: colors.textSoft, fontSize: 11, textAlign: 'center', fontWeight: '600' },
  cinemaCardCompact: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radii.lg, padding: 13, marginTop: 10 },
  cinemaIcon: { width: 42, height: 42, borderRadius: radii.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  cinemaTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  cinemaSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radii.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.primaryDark },
  errorText: { color: colors.primary, fontSize: 13, textAlign: 'center' },
  randomBtn: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: radii.pill, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 4 },
  randomText: { color: colors.text, fontWeight: '800', fontSize: 16 },
  grid: { padding: 12 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  cardRating: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  emptyText: { color: colors.textSoft, fontSize: 16, textAlign: 'center', marginTop: 10, fontWeight: '700' },
  emptyHint: { color: colors.muted2, fontSize: 13, textAlign: 'center', marginTop: 6 },
  searchRetryBtn: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: radii.pill, marginTop: 14 },
  searchRetryText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  trendingErrorBox: { backgroundColor: colors.dangerBg, borderRadius: radii.md, padding: 14, marginBottom: 8, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.primaryDark },
  trendingErrorText: { color: colors.primary, fontSize: 13, textAlign: 'center' },
  trendingRetry: { color: colors.text, fontSize: 13, fontWeight: '800' },
});

const fStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surfaceElevated, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, paddingBottom: 40, maxHeight: '85%', borderWidth: 1, borderColor: colors.border },
  handle: { width: 40, height: 4, backgroundColor: colors.faint, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '900', color: colors.text, marginBottom: 6 },
  caption: { color: colors.muted, fontSize: 12, marginBottom: 14 },
  label: { color: colors.textSoft, fontSize: 13, marginBottom: 8, marginTop: 16, fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  genreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.text, fontWeight: '800' },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  yearInput: { backgroundColor: colors.bgSoft, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 10, color: colors.text, fontSize: 14, width: 100, borderWidth: 1, borderColor: colors.borderSoft },
  yearDash: { color: colors.textSoft },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  resetBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, borderRadius: radii.pill, alignItems: 'center' },
  resetText: { color: colors.textSoft, fontWeight: '700' },
  applyBtn: { flex: 2, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.pill, alignItems: 'center' },
  applyText: { color: colors.text, fontWeight: '800', fontSize: 15 },
});
