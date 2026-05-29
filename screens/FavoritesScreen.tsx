import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useAppContext } from '../store/AppContext';

const TYPE_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'movie', label: 'Фильмы' },
  { key: 'tv', label: 'Сериалы' },
];

const STATUS_FILTERS = [
  { key: 'all', label: 'Любая оценка' },
  { key: 'want', label: 'Хочу' },
  { key: 'watched', label: 'Смотрел' },
  { key: 'liked', label: 'Понравилось' },
  { key: 'disliked', label: 'Не понравилось' },
];

const SORT_OPTIONS = [
  { key: 'added', label: 'Недавно добавленные' },
  { key: 'title', label: 'По названию' },
  { key: 'rating', label: 'По рейтингу' },
  { key: 'year', label: 'По году' },
];

const STATUS_LABELS: Record<string, string> = {
  want: 'Хочу посмотреть',
  watched: 'Смотрел',
  liked: 'Понравилось',
  disliked: 'Не понравилось',
};

function WatchlistCard({ item, navigation, status, onRemove, cardWidth }: any) {
  const renderRightActions = () => (
    <TouchableOpacity style={styles.swipeDelete} onPress={onRemove}>
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeDeleteText}>Удалить</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <TouchableOpacity style={[styles.card, { width: cardWidth }]} onPress={() => navigation.navigate('Card', { movie: item })}>
        <TouchableOpacity style={styles.removeBtn} onPress={onRemove}>
          <Ionicons name="close" size={12} color="#fff" />
        </TouchableOpacity>

        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{item.mediaType === 'tv' ? 'Сериал' : 'Фильм'}</Text>
        </View>

        {item.poster ? (
          <Image source={{ uri: item.poster }} style={[styles.poster, { width: cardWidth, height: cardWidth * 1.5 }]} contentFit="cover" transition={200} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.poster, styles.posterFallback, { width: cardWidth, height: cardWidth * 1.5 }]}>
            <Ionicons name="image-outline" size={32} color="#444" />
          </View>
        )}
        <Text style={styles.cardTitle} numberOfLines={2}>{item.titleRu || item.titleEn}</Text>

        <View style={styles.cardMetaRow}>
          {item.rating && <Text style={styles.cardRating}>★ {item.rating}</Text>}
          {item.year && <Text style={styles.cardYear}>{item.year}</Text>}
        </View>

        {status && (
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{STATUS_LABELS[status]}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Swipeable>
  );
}

export default function FavoritesScreen({ navigation }: any) {
  const { watchlist, removeFromWatchlist, getUserStatus } = useAppContext();
  const { width } = useWindowDimensions();
  const cardWidth = useMemo(() => (width - 52) / 2, [width]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('added');

  const filteredWatchlist = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return [...watchlist]
      .filter(item => {
        const title = `${item.titleRu || ''} ${item.titleEn || ''}`.toLowerCase();
        const status = getUserStatus(item.id, item.mediaType);

        if (normalized && !title.includes(normalized)) return false;
        if (typeFilter !== 'all' && item.mediaType !== typeFilter) return false;
        if (statusFilter !== 'all' && status !== statusFilter) return false;

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'title') return (a.titleRu || a.titleEn || '').localeCompare(b.titleRu || b.titleEn || '');
        if (sortBy === 'rating') return Number(b.rating || 0) - Number(a.rating || 0);
        if (sortBy === 'year') return Number(b.year || 0) - Number(a.year || 0);
        return 0;
      });
  }, [watchlist, query, typeFilter, statusFilter, sortBy, getUserStatus]);

  return (
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Избранное</Text>
          {watchlist.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{watchlist.length}</Text>
            </View>
          )}
        </View>

        {watchlist.length === 0 ? (
          <View style={styles.emptyWatchlist}>
            <Ionicons name="heart-outline" size={44} color="#333" />
            <Text style={styles.emptyTitle}>Избранное пусто</Text>
            <Text style={styles.emptySubtitle}>Открой любой фильм или сериал и нажми ♥, чтобы сохранить</Text>
          </View>
        ) : (
          <>
            <View style={styles.searchInputWrap}>
              <Ionicons name="search" size={16} color="#888" />
              <TextInput
                style={styles.searchInput}
                placeholder="Поиск в избранном..."
                placeholderTextColor="#666"
                value={query}
                onChangeText={setQuery}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={16} color="#888" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              <View style={styles.chipRow}>
                {TYPE_FILTERS.map(filter => (
                  <TouchableOpacity
                    key={filter.key}
                    style={[styles.chip, typeFilter === filter.key && styles.chipActive]}
                    onPress={() => setTypeFilter(filter.key)}
                  >
                    <Text style={[styles.chipText, typeFilter === filter.key && styles.chipTextActive]}>{filter.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              <View style={styles.chipRow}>
                {STATUS_FILTERS.map(filter => (
                  <TouchableOpacity
                    key={filter.key}
                    style={[styles.chip, statusFilter === filter.key && styles.chipActive]}
                    onPress={() => setStatusFilter(filter.key)}
                  >
                    <Text style={[styles.chipText, statusFilter === filter.key && styles.chipTextActive]}>{filter.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              <View style={styles.chipRow}>
                {SORT_OPTIONS.map(option => (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.chip, sortBy === option.key && styles.chipActive]}
                    onPress={() => setSortBy(option.key)}
                  >
                    <Text style={[styles.chipText, sortBy === option.key && styles.chipTextActive]}>{option.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {filteredWatchlist.length === 0 ? (
              <View style={styles.emptyWatchlist}>
                <Ionicons name="filter-outline" size={36} color="#333" />
                <Text style={styles.emptyTitle}>Ничего не найдено</Text>
                <Text style={styles.emptySubtitle}>Попробуй другой запрос или фильтр</Text>
              </View>
            ) : (
              <FlatList
                data={filteredWatchlist}
                keyExtractor={(item, index) => `${item.id}-${item.mediaType}-${index}`}
                numColumns={2}
                scrollEnabled={false}
                columnWrapperStyle={styles.gridRow}
                renderItem={({ item }) => (
                  <WatchlistCard
                    item={item}
                    navigation={navigation}
                    status={getUserStatus(item.id, item.mediaType)}
                    onRemove={() => removeFromWatchlist(item.id, item.mediaType)}
                    cardWidth={cardWidth}
                  />
                )}
              />
            )}
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  header: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  countBadge: { backgroundColor: '#e50914', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  countBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  emptyWatchlist: { backgroundColor: '#1e1e30', borderRadius: 16, padding: 32, alignItems: 'center', gap: 8, marginTop: 8 },
  emptyTitle: { color: '#ccc', fontSize: 16, fontWeight: '600' },
  emptySubtitle: { color: '#888', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  searchInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e30', borderRadius: 12, paddingHorizontal: 12, height: 44, marginBottom: 12, gap: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 14 },
  filterScroll: { marginBottom: 10 },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  chip: { borderWidth: 1, borderColor: '#333', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  chipActive: { backgroundColor: '#e50914', borderColor: '#e50914' },
  chipText: { color: '#888', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  gridRow: { justifyContent: 'space-between', marginBottom: 12 },
  card: { backgroundColor: '#141426', borderRadius: 12, paddingBottom: 8 },
  swipeDelete: { width: 92, backgroundColor: '#e50914', borderRadius: 12, marginLeft: 8, marginBottom: 8, alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeDeleteText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  removeBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: '#e50914', borderRadius: 10, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#1a1a40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  typeBadgeText: { color: '#8888ff', fontSize: 11, fontWeight: '600' },
  poster: { borderTopLeftRadius: 12, borderTopRightRadius: 12, marginBottom: 7 },
  posterFallback: { backgroundColor: '#1e1e30', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 4, paddingHorizontal: 8 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  cardRating: { color: '#aaa', fontSize: 11 },
  cardYear: { color: '#888', fontSize: 11 },
  statusPill: { marginTop: 7, marginHorizontal: 8, backgroundColor: '#1e1e40', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  statusPillText: { color: '#8888ff', fontSize: 10, fontWeight: '700' },
});
