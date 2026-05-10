import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
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
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAppContext } from '../store/AppContext';
import { MovieCardSkeleton } from '../components/Skeleton';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZDRjMGIyYjJmNWZiZDMxOWMzNTU4OTU2YmFhOTZiZiIsIm5iZiI6MTc3ODMxOTAzMS45NjMsInN1YiI6IjY5ZmVmZWI3ZmQ3NjliZmExZTFlMDk0MSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.uJTLQyX-dOE5DG4Zjim4bYRIMx3OeEfHDk6Rz0z1WNA';
const { width } = Dimensions.get('window');
const cardWidth = (width - 48) / 2;

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

const LANGUAGES = [
  { code: '', name: 'Любой' }, { code: 'ru', name: 'Русский' }, { code: 'en', name: 'Английский' },
  { code: 'ko', name: 'Корейский' }, { code: 'ja', name: 'Японский' }, { code: 'fr', name: 'Французский' },
  { code: 'de', name: 'Немецкий' }, { code: 'es', name: 'Испанский' },
];

const COUNTRIES = [
  { code: '', name: 'Любая' }, { code: 'US', name: 'США' }, { code: 'GB', name: 'Великобритания' },
  { code: 'RU', name: 'Россия' }, { code: 'KR', name: 'Корея' }, { code: 'JP', name: 'Япония' },
  { code: 'FR', name: 'Франция' }, { code: 'DE', name: 'Германия' },
];

const RATINGS = [0, 5, 6, 7, 8, 9];

const SORT_OPTIONS = [
  { key: 'popularity.desc', name: 'По популярности' },
  { key: 'vote_average.desc', name: 'По рейтингу' },
  { key: 'release_date.desc', name: 'Сначала новые' },
  { key: 'release_date.asc', name: 'Сначала старые' },
];

async function fetchWithTimeout(url: string, options: any = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Превышено время ожидания.');
    throw e;
  }
}

async function fetchItems(mediaType: string, category: string, page: number) {
  let url = category === 'trending'
    ? `https://api.themoviedb.org/3/trending/${mediaType}/week?language=ru-RU&page=${page}`
    : `https://api.themoviedb.org/3/${mediaType}/${category}?language=ru-RU&page=${page}`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await res.json();
  return (data.results || []).filter((m: any) => m.poster_path);
}

async function searchItems(query: string, mediaType: string, adultContent: boolean) {
  const res = await fetchWithTimeout(
    `https://api.themoviedb.org/3/search/${mediaType}?query=${encodeURIComponent(query)}&language=ru-RU&include_adult=${adultContent}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const data = await res.json();
  return (data.results || []).filter((m: any) => m.poster_path).map((m: any) => ({ ...m, media_type: mediaType }));
}

async function discoverWithFilters(mediaType: string, filters: any, adultContent: boolean) {
  const params: any = {
    language: 'ru-RU', sort_by: filters.sortBy || 'popularity.desc',
    page: '1', include_adult: String(adultContent),
  };
  if (filters.minRating > 0) params['vote_average.gte'] = String(filters.minRating);
  if (filters.language) params.with_original_language = filters.language;
  if (filters.country) params.with_origin_country = filters.country;
  if (filters.yearFrom) params[mediaType === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = `${filters.yearFrom}-01-01`;
  if (filters.yearTo) params[mediaType === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = `${filters.yearTo}-12-31`;
  const url = `https://api.themoviedb.org/3/discover/${mediaType}?${new URLSearchParams(params)}`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await res.json();
  return (data.results || []).filter((m: any) => m.poster_path).map((m: any) => ({ ...m, media_type: mediaType }));
}

async function fetchDetails(id: number, type: string) {
  const [ruRes, enRes] = await Promise.all([
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=ru-RU`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=en-US`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
  ]);
  const ruData = await ruRes.json();
  const enData = await enRes.json();
  const resRu = await fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}/videos?language=ru-RU`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const dataRu = await resRu.json();
  let trailer = dataRu.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
  if (!trailer) {
    const resEn = await fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}/videos?language=en-US`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dataEn = await resEn.json();
    trailer = dataEn.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
  }
  return {
    id,
    titleRu: ruData.title || ruData.name,
    titleEn: enData.title || enData.name,
    overview: ruData.overview || enData.overview,
    poster: `https://image.tmdb.org/t/p/w500${ruData.poster_path}`,
    trailerKey: trailer?.key || null,
    genreId: null,
    mediaType: type,
    rating: ruData.vote_average ? ruData.vote_average.toFixed(1) : null,
    year: (ruData.release_date || ruData.first_air_date || '').slice(0, 4),
    country: ruData.production_countries?.[0]?.name || null,
    genres: ruData.genres?.map((g: any) => g.name).join(', ') || null,
  };
}

const defaultFilters = { minRating: 0, language: '', country: '', yearFrom: '', yearTo: '', sortBy: 'popularity.desc' };

export default function TopScreen({ navigation }: any) {
  const { adultContent } = useAppContext();
  const [mediaType, setMediaType] = useState('movie');
  const [category, setCategory] = useState('top_rated');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [cardLoading, setCardLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [localFilters, setLocalFilters] = useState(defaultFilters);

  const load = useCallback(async (mt: string, cat: string, p: number, reset = false) => {
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const results = await fetchItems(mt, cat, p);
      setItems(prev => reset || p === 1 ? results : [...prev, ...results]);
    } catch (e) { console.error(e); }
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    setPage(1);
    setItems([]);
    setLoading(true);
    load(mediaType, category, 1, true);
  }, [mediaType, category]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await load(mediaType, category, 1, true);
    setRefreshing(false);
  }, [mediaType, category]);

  const switchMedia = (mt: string) => {
    setMediaType(mt);
    setCategory('top_rated');
    setSearchQuery('');
    setIsSearchMode(false);
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(mediaType, category, next);
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setIsSearchMode(false); setSearchResults([]); return; }
    setIsSearchMode(true);
    setSearching(true);
    try {
      const results = await searchItems(q, mediaType, adultContent);
      setSearchResults(results);
    } catch (e) { console.error(e); }
    setSearching(false);
  };

  const applyFilters = async (f: any) => {
    setFilters(f);
    setShowFilters(false);
    setIsSearchMode(true);
    setSearching(true);
    try {
      const results = await discoverWithFilters(mediaType, f, adultContent);
      setSearchResults(results);
    } catch (e) { console.error(e); }
    setSearching(false);
  };

  const openCard = async (item: any) => {
    setCardLoading(true);
    try {
      const type = item.media_type || mediaType;
      const details = await fetchDetails(item.id, type);
      navigation.navigate('Card', { movie: details });
    } catch (e) { console.error(e); }
    setCardLoading(false);
  };

  const categories = CATEGORY_TABS[mediaType as keyof typeof CATEGORY_TABS];
  const displayItems = isSearchMode ? searchResults : items;

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
              placeholder={`Поиск в топе...`}
              placeholderTextColor="#555"
              value={searchQuery}
              onChangeText={handleSearch}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setIsSearchMode(false); }}>
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

      {loading || cardLoading || searching ? (
        <FlatList
          data={[1,2,3,4,5,6]}
          keyExtractor={i => String(i)}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={() => <MovieCardSkeleton cardWidth={cardWidth} />}
        />
      ) : displayItems.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Ничего не найдено</Text>
        </View>
      ) : (
        <FlatList
          data={displayItems}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          refreshControl={!isSearchMode ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e50914" /> : undefined}
          onEndReached={!isSearchMode ? loadMore : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? (
            <View style={styles.row}>
              <MovieCardSkeleton cardWidth={cardWidth} />
              <MovieCardSkeleton cardWidth={cardWidth} />
            </View>
          ) : null}
          renderItem={({ item, index }) => (
            <TouchableOpacity style={styles.card} onPress={() => openCard(item)} disabled={cardLoading}>
              {!isSearchMode && (
                <View style={styles.rankBadge}>
                  <Text style={styles.rankText}>#{index + 1}</Text>
                </View>
              )}
              <Image
                source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
                style={styles.poster}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title || item.name}</Text>
              {item.vote_average > 0 && <Text style={styles.cardRating}>⭐ {item.vote_average.toFixed(1)}</Text>}
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <TouchableOpacity style={fStyles.overlay} activeOpacity={1} onPress={() => setShowFilters(false)}>
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
                <TextInput style={fStyles.yearInput} placeholder="От" placeholderTextColor="#555" value={localFilters.yearFrom} onChangeText={v => setLocalFilters(f => ({ ...f, yearFrom: v }))} keyboardType="numeric" maxLength={4} />
                <Text style={fStyles.yearDash}>-</Text>
                <TextInput style={fStyles.yearInput} placeholder="До" placeholderTextColor="#555" value={localFilters.yearTo} onChangeText={v => setLocalFilters(f => ({ ...f, yearTo: v }))} keyboardType="numeric" maxLength={4} />
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
  card: { width: cardWidth },
  rankBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#e50914', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  rankText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  poster: { width: cardWidth, height: cardWidth * 1.5, borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  cardRating: { color: '#aaa', fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#aaa', fontSize: 16 },
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
