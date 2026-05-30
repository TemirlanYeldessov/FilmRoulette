import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAppContext } from '../store/AppContext';
import { MovieCardSkeleton } from '../components/Skeleton';
import PaginationBar from '../components/PaginationBar';
import CardMark from '../components/CardMark';
import { getCached, setCached, LIST_TTL } from '../utils/apiCache';
import { dedup, itemToMovie, sanitizeYearRange, areFiltersEqual, applyDiscoverFilters } from '../utils/tmdb';
import { makeTmdbFetch } from '../utils/api';
import { COUNTRIES, LANGUAGES, RATINGS, SORT_OPTIONS } from '../constants/filters';
import { TMDB_TOKEN as TOKEN } from '../constants/api';

const MEDIA_TABS = [
  { key: 'movie', label: 'Фильмы' },
  { key: 'tv', label: 'Сериалы' },
];

const CATEGORY_TABS = {
  movie: [
    { key: 'top_rated', label: 'Топ всех времён' },
    { key: 'trending', label: 'В тренде' },
    { key: 'popular', label: 'Популярное' },
    { key: 'now_playing', label: 'В кино сейчас' },
  ],
  tv: [
    { key: 'top_rated', label: 'Топ всех времён' },
    { key: 'trending', label: 'В тренде' },
    { key: 'popular', label: 'Популярное' },
    { key: 'on_the_air', label: 'В эфире сейчас' },
  ],
};

const SKELETON_KEYS = [1, 2, 3, 4, 5, 6];
const ITEMS_PER_PAGE = 20;

const fetchWithTimeout = makeTmdbFetch({
  notOk: 'TMDB временно не отвечает. Попробуй ещё раз.',
  timeout: 'Превышено время ожидания.',
});

async function fetchItems(mediaType: string, category: string, page: number) {
  const cacheKey = `top:${mediaType}:${category}:${page}`;
  const cached = getCached(cacheKey, LIST_TTL);
  if (cached) return cached;
  const url = category === 'trending'
    ? `https://api.themoviedb.org/3/trending/${mediaType}/week?language=ru-RU&page=${page}`
    : `https://api.themoviedb.org/3/${mediaType}/${category}?language=ru-RU&page=${page}`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await res.json();
  const result = {
    results: dedup((data.results || []).filter((m: any) => m.poster_path), mediaType),
    totalPages: Math.min(data.total_pages || 1, 500),
    totalResults: data.total_results || 0,
  };
  setCached(cacheKey, result);
  return result;
}

async function searchItems(query: string, mediaType: string, adultContent: boolean, page = 1) {
  const res = await fetchWithTimeout(
    `https://api.themoviedb.org/3/search/${mediaType}?query=${encodeURIComponent(query)}&language=ru-RU&include_adult=${adultContent}&page=${page}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const data = await res.json();
  return {
    results: dedup((data.results || []).filter((m: any) => m.poster_path).map((m: any) => ({ ...m, media_type: mediaType })), mediaType),
    totalPages: Math.min(data.total_pages || 1, 500),
    totalResults: data.total_results || 0,
  };
}

async function discoverWithFilters(mediaType: string, filters: any, adultContent: boolean, page = 1) {
  const params: any = {
    language: 'ru-RU', sort_by: filters.sortBy || 'popularity.desc',
    page: String(page), include_adult: String(adultContent),
  };
  applyDiscoverFilters(params, filters, mediaType);
  const url = `https://api.themoviedb.org/3/discover/${mediaType}?${new URLSearchParams(params)}`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await res.json();
  return {
    results: dedup((data.results || []).filter((m: any) => m.poster_path).map((m: any) => ({ ...m, media_type: mediaType })), mediaType),
    totalPages: Math.min(data.total_pages || 1, 500),
    totalResults: data.total_results || 0,
  };
}

const defaultFilters = { minRating: 0, language: '', country: '', yearFrom: '', yearTo: '', sortBy: 'popularity.desc' };

function isDefaultFilters(f: typeof defaultFilters) {
  return !f.minRating && !f.language && !f.country && !f.yearFrom && !f.yearTo && f.sortBy === 'popularity.desc';
}

export default function TopScreen({ navigation }: any) {
  const { adultContent } = useAppContext();
  const { width } = useWindowDimensions();
  const cardWidth = useMemo(() => (width - 48) / 2, [width]);
  const [mediaType, setMediaType] = useState('movie');
  const [category, setCategory] = useState('top_rated');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [localFilters, setLocalFilters] = useState(defaultFilters);
  const [error, setError] = useState('');

  const lastQueryRef = useRef('');
  const activeFiltersRef = useRef(defaultFilters);
  const listRef = useRef<FlatList>(null);
  // Monotonic request id — ignore results from stale requests.
  const requestIdRef = useRef(0);

  const load = useCallback(async (mt: string, cat: string, page: number) => {
    const myId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const { results, totalPages: tp, totalResults: tr } = await fetchItems(mt, cat, page);
      if (requestIdRef.current !== myId) return;
      setItems(results);
      setTotalPages(tp);
      setTotalResults(tr);
      setCurrentPage(page);
    } catch (e: any) {
      if (requestIdRef.current !== myId) return;
      setError(e?.message || 'Не удалось загрузить. Попробуй ещё раз.');
    } finally {
      if (requestIdRef.current === myId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    setItems([]);
    setIsSearchMode(false);
    setSearchQuery('');
    lastQueryRef.current = '';
    load(mediaType, category, 1);
  }, [mediaType, category]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(mediaType, category, 1);
    setRefreshing(false);
  }, [mediaType, category, load]);

  const switchMedia = (mt: string) => {
    setMediaType(mt);
    setCategory('top_rated');
    setSearchQuery('');
    setIsSearchMode(false);
    lastQueryRef.current = '';
  };

  const handlePageChange = async (page: number) => {
    if (loading || searching) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    if (isSearchMode) {
      const myId = ++requestIdRef.current;
      const prevPage = currentPage;
      setSearching(true);
      setError('');
      setCurrentPage(page);
      try {
        const { results, totalPages: tp, totalResults: tr } = lastQueryRef.current
          ? await searchItems(lastQueryRef.current, mediaType, adultContent, page)
          : await discoverWithFilters(mediaType, activeFiltersRef.current, adultContent, page);
        if (requestIdRef.current !== myId) return;
        setItems(results);
        setTotalPages(tp);
        setTotalResults(tr);
      } catch (e: any) {
        if (requestIdRef.current !== myId) return;
        setCurrentPage(prevPage);
        setError(e?.message || 'Не удалось перейти на страницу.');
      } finally {
        if (requestIdRef.current === myId) setSearching(false);
      }
    } else {
      await load(mediaType, category, page);
    }
  };

  // Debounced search — wait 400ms after typing stops, ignore stale results,
  // and cancel the in-flight request when a new keystroke supersedes it.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      if (isSearchMode) {
        setIsSearchMode(false);
        lastQueryRef.current = '';
        load(mediaType, category, 1);
      }
      return;
    }
    const myId = ++requestIdRef.current;
    setIsSearchMode(true);
    setSearching(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const { results, totalPages: tp, totalResults: tr } = await searchItems(q, mediaType, adultContent, 1);
        if (requestIdRef.current !== myId) return;
        lastQueryRef.current = q;
        setItems(results);
        setTotalPages(tp);
        setTotalResults(tr);
        setCurrentPage(1);
      } catch (e: any) {
        if (requestIdRef.current !== myId) return;
        setError(e?.message || 'Не удалось выполнить поиск.');
        setItems([]);
        setTotalPages(1);
        setTotalResults(0);
      } finally {
        if (requestIdRef.current === myId) setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, mediaType, adultContent, category, load]);

  const applyFilters = async (rawF: any) => {
    const f = { ...rawF };
    const years = sanitizeYearRange(f.yearFrom, f.yearTo);
    f.yearFrom = years.yearFrom;
    f.yearTo = years.yearTo;
    setFilters(f);
    activeFiltersRef.current = f;
    setShowFilters(false);
    // No filters set → stay on the current category instead of silently
    // swapping to a default Discover query that looks identical to popular.
    if (isDefaultFilters(f)) {
      if (isSearchMode) {
        setIsSearchMode(false);
        lastQueryRef.current = '';
        load(mediaType, category, 1);
      }
      return;
    }
    const myId = ++requestIdRef.current;
    lastQueryRef.current = '';
    setIsSearchMode(true);
    setSearching(true);
    setError('');
    setCurrentPage(1);
    try {
      const { results, totalPages: tp, totalResults: tr } = await discoverWithFilters(mediaType, f, adultContent, 1);
      if (requestIdRef.current !== myId) return;
      setItems(results);
      setTotalPages(tp);
      setTotalResults(tr);
    } catch (e: any) {
      if (requestIdRef.current !== myId) return;
      setError(e?.message || 'Не удалось применить фильтры.');
    } finally {
      if (requestIdRef.current === myId) setSearching(false);
    }
  };

  const closeFiltersWithConfirm = () => {
    if (areFiltersEqual(localFilters, filters)) {
      setShowFilters(false);
      return;
    }
    Alert.alert('Есть несохранённые изменения', 'Применить изменения фильтров?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Не применять', style: 'destructive', onPress: () => setShowFilters(false) },
      { text: 'Применить', onPress: () => applyFilters(localFilters) },
    ]);
  };

  const openCard = (item: any) => {
    navigation.navigate('Card', { movie: itemToMovie(item, mediaType) });
  };

  const categories = CATEGORY_TABS[mediaType as keyof typeof CATEGORY_TABS];
  const isLoading = loading || searching;

  return (
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Топ</Text>
        <View style={styles.mediaTabs}>
          {MEDIA_TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.mediaTab, mediaType === t.key && styles.mediaTabActive]}
              onPress={() => switchMedia(t.key)}
            >
              <Text style={[styles.mediaTabText, mediaType === t.key && styles.mediaTabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            <Ionicons name="search" size={16} color="#555" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Поиск в топе..."
              placeholderTextColor="#777"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={16} color="#555" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity style={styles.filterBtn} onPress={() => { setLocalFilters(filters); setShowFilters(true); }}>
            <Ionicons name="options" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {!isSearchMode && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {categories.map(c => (
              <TouchableOpacity
                key={c.key}
                style={[styles.catChip, category === c.key && styles.catChipActive]}
                onPress={() => setCategory(c.key)}
              >
                <Text style={[styles.catChipText, category === c.key && styles.catChipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {isLoading ? (
        <FlatList
          data={SKELETON_KEYS}
          keyExtractor={i => String(i)}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={() => <MovieCardSkeleton cardWidth={cardWidth} />}
        />
      ) : error ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={38} color="#555" />
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(mediaType, category, currentPage)}>
            <Text style={styles.retryText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Ничего не найдено</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => `${item.media_type || mediaType}-${item.id}`}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          refreshControl={
            !isSearchMode
              ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e50914" />
              : undefined
          }
          renderItem={({ item, index }) => {
            const rank = (currentPage - 1) * ITEMS_PER_PAGE + index + 1;
            return (
              <TouchableOpacity style={[styles.card, { width: cardWidth }]} onPress={() => openCard(item)}>
                {!isSearchMode && (
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankText}>#{rank}</Text>
                  </View>
                )}
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
            );
          }}
          ListFooterComponent={
            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              totalResults={totalResults}
              onPageChange={handlePageChange}
              loading={isLoading}
            />
          }
        />
      )}

      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={closeFiltersWithConfirm}>
        <TouchableOpacity style={fStyles.overlay} activeOpacity={1} onPress={closeFiltersWithConfirm}>
          <TouchableOpacity activeOpacity={1} style={fStyles.sheet}>
            <View style={fStyles.handle} />
            <Text style={fStyles.title}>Фильтры</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={fStyles.label}>Минимальный рейтинг</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {RATINGS.map(r => (
                    <TouchableOpacity key={r} style={[fStyles.chip, localFilters.minRating === r && fStyles.chipActive]} onPress={() => setLocalFilters(f => ({ ...f, minRating: r }))}>
                      <Text style={[fStyles.chipText, localFilters.minRating === r && fStyles.chipTextActive]}>{r === 0 ? 'Любой' : `${r}+`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={fStyles.label}>Год выпуска</Text>
              <View style={fStyles.yearRow}>
                <TextInput style={fStyles.yearInput} placeholder="От" placeholderTextColor="#777" value={localFilters.yearFrom} onChangeText={v => setLocalFilters(f => ({ ...f, yearFrom: v }))} keyboardType="numeric" maxLength={4} />
                <Text style={fStyles.yearDash}>-</Text>
                <TextInput style={fStyles.yearInput} placeholder="До" placeholderTextColor="#777" value={localFilters.yearTo} onChangeText={v => setLocalFilters(f => ({ ...f, yearTo: v }))} keyboardType="numeric" maxLength={4} />
              </View>

              <Text style={fStyles.label}>Язык оригинала</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {LANGUAGES.map(l => (
                    <TouchableOpacity key={l.code} style={[fStyles.chip, localFilters.language === l.code && fStyles.chipActive]} onPress={() => setLocalFilters(f => ({ ...f, language: l.code }))}>
                      <Text style={[fStyles.chipText, localFilters.language === l.code && fStyles.chipTextActive]}>{l.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={fStyles.label}>Страна</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {COUNTRIES.map(c => (
                    <TouchableOpacity key={c.code} style={[fStyles.chip, localFilters.country === c.code && fStyles.chipActive]} onPress={() => setLocalFilters(f => ({ ...f, country: c.code }))}>
                      <Text style={[fStyles.chipText, localFilters.country === c.code && fStyles.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={fStyles.label}>Сортировка</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {SORT_OPTIONS.map(s => (
                    <TouchableOpacity key={s.key} style={[fStyles.chip, localFilters.sortBy === s.key && fStyles.chipActive]} onPress={() => setLocalFilters(f => ({ ...f, sortBy: s.key }))}>
                      <Text style={[fStyles.chipText, localFilters.sortBy === s.key && fStyles.chipTextActive]}>{s.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={fStyles.buttons}>
                <TouchableOpacity style={fStyles.resetBtn} onPress={() => setLocalFilters(defaultFilters)}>
                  <Text style={fStyles.resetText}>Сбросить</Text>
                </TouchableOpacity>
                <TouchableOpacity style={fStyles.applyBtn} onPress={() => applyFilters(localFilters)}>
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
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 14 },
  mediaTabs: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  mediaTab: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#444' },
  mediaTabActive: { backgroundColor: '#e50914', borderColor: '#e50914' },
  mediaTabText: { color: '#aaa', fontWeight: '600' },
  mediaTabTextActive: { color: '#fff' },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 12 },
  searchInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e30', borderRadius: 12, paddingHorizontal: 12, height: 44 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 14 },
  filterBtn: { backgroundColor: '#1e1e30', width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  categoryScroll: { marginBottom: 4 },
  catChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: '#333', marginRight: 8 },
  catChipActive: { backgroundColor: '#1e1e40', borderColor: '#8888ff' },
  catChipText: { color: '#666', fontSize: 13 },
  catChipTextActive: { color: '#8888ff', fontWeight: '600' },
  grid: { padding: 12 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: {},
  rankBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#e50914', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  rankText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  poster: { borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  cardRating: { color: '#aaa', fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  emptyText: { color: '#aaa', fontSize: 16, textAlign: 'center' },
  retryBtn: { backgroundColor: '#e50914', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, marginTop: 8 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

const fStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '80%' },
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
