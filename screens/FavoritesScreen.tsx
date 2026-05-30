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
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useAppContext } from '../store/AppContext';
import { useGridColumns } from '../utils/useGridColumns';
import { colors, gradients, radii, shadow } from '../constants/theme';

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
      <Ionicons name="trash-outline" size={20} color={colors.text} />
      <Text style={styles.swipeDeleteText}>Удалить</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <TouchableOpacity style={[styles.card, { width: cardWidth }]} onPress={() => navigation.navigate('Card', { movie: item })}>
        <TouchableOpacity style={styles.removeBtn} onPress={onRemove} accessibilityRole="button" accessibilityLabel="Удалить из избранного">
          <Ionicons name="close" size={12} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{item.mediaType === 'tv' ? 'Сериал' : 'Фильм'}</Text>
        </View>

        {item.poster ? (
          <Image source={{ uri: item.poster }} style={[styles.poster, { width: cardWidth, height: cardWidth * 1.5 }]} contentFit="cover" transition={200} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.poster, styles.posterFallback, { width: cardWidth, height: cardWidth * 1.5 }]}>
            <Ionicons name="image-outline" size={32} color={colors.faint} />
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
  const { columns, cardWidth } = useGridColumns();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('added');

  const hasActiveFilters = query.trim().length > 0 || typeFilter !== 'all' || statusFilter !== 'all' || sortBy !== 'added';

  const resetFilters = () => {
    setQuery('');
    setTypeFilter('all');
    setStatusFilter('all');
    setSortBy('added');
  };

  const goToTab = (tab: string) => {
    const parent = navigation.getParent?.();
    if (parent) parent.navigate(tab);
    else navigation.navigate(tab);
  };

  const filteredWatchlist = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const addedOrder = new Map(
      watchlist.map((item, index) => [`${item.id}-${item.mediaType}`, index])
    );

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
        if (sortBy === 'added') {
          return (addedOrder.get(`${b.id}-${b.mediaType}`) ?? 0) - (addedOrder.get(`${a.id}-${a.mediaType}`) ?? 0);
        }
        if (sortBy === 'title') return (a.titleRu || a.titleEn || '').localeCompare(b.titleRu || b.titleEn || '');
        if (sortBy === 'rating') return Number(b.rating || 0) - Number(a.rating || 0);
        if (sortBy === 'year') return Number(b.year || 0) - Number(a.year || 0);
        return 0;
      });
  }, [watchlist, query, typeFilter, statusFilter, sortBy, getUserStatus]);

  return (
    <LinearGradient colors={gradients.app} style={styles.container}>
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
            <Ionicons name="heart-outline" size={44} color={colors.faint} />
            <Text style={styles.emptyTitle}>Избранное пусто</Text>
            <Text style={styles.emptySubtitle}>Открой любой фильм или сериал и нажми ♥, чтобы сохранить</Text>
            <View style={styles.emptyActions}>
              <TouchableOpacity style={styles.emptyPrimaryBtn} onPress={() => goToTab('Mood')}>
                <Ionicons name="sparkles-outline" size={15} color={colors.text} />
                <Text style={styles.emptyPrimaryText}>Подобрать</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.emptySecondaryBtn} onPress={() => goToTab('Catalog')}>
                <Text style={styles.emptySecondaryText}>Каталог</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.searchInputWrap}>
              <Ionicons name="search" size={16} color={colors.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Поиск в избранном..."
                placeholderTextColor={colors.muted2}
                value={query}
                onChangeText={setQuery}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={16} color={colors.muted} />
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
                <Ionicons name="filter-outline" size={36} color={colors.faint} />
                <Text style={styles.emptyTitle}>Ничего не найдено</Text>
                <Text style={styles.emptySubtitle}>Попробуй другой запрос или фильтр</Text>
                {hasActiveFilters && (
                  <TouchableOpacity style={styles.emptyBtn} onPress={resetFilters}>
                    <Text style={styles.emptyBtnText}>Сбросить фильтры</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <FlatList
                data={filteredWatchlist}
                keyExtractor={(item, index) => `${item.id}-${item.mediaType}-${index}`}
                key={`grid-${columns}`}
                numColumns={columns}
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
  header: { fontSize: 28, fontWeight: '900', color: colors.text },
  countBadge: { backgroundColor: colors.primary, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3 },
  countBadgeText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  emptyWatchlist: { backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: 32, alignItems: 'center', gap: 8, marginTop: 8, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  emptyTitle: { color: colors.textSoft, fontSize: 16, fontWeight: '800' },
  emptySubtitle: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  emptyActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  emptyPrimaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill },
  emptyPrimaryText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  emptySecondaryBtn: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill },
  emptySecondaryText: { color: colors.textSoft, fontSize: 13, fontWeight: '800' },
  emptyBtn: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, marginTop: 8 },
  emptyBtnText: { color: colors.textSoft, fontSize: 13, fontWeight: '800' },
  searchInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated, borderRadius: radii.md, paddingHorizontal: 12, height: 44, marginBottom: 12, gap: 8, borderWidth: 1, borderColor: colors.borderSoft },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  filterScroll: { marginBottom: 10 },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  chip: { borderWidth: 1, borderColor: colors.borderSoft, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.text },
  gridRow: { justifyContent: 'space-between', marginBottom: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, paddingBottom: 8, borderWidth: 1, borderColor: colors.borderSoft },
  swipeDelete: { width: 92, backgroundColor: colors.primary, borderRadius: radii.md, marginLeft: 8, marginBottom: 8, alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeDeleteText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  removeBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: colors.primary, borderRadius: radii.pill, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: colors.accentSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1, borderWidth: 1, borderColor: colors.whiteGlass },
  typeBadgeText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  poster: { borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md, marginBottom: 7, backgroundColor: colors.surfacePressed },
  posterFallback: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 4, paddingHorizontal: 8 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  cardRating: { color: colors.muted, fontSize: 11 },
  cardYear: { color: colors.muted2, fontSize: 11 },
  statusPill: { marginTop: 7, marginHorizontal: 8, backgroundColor: colors.accentSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  statusPillText: { color: colors.textSoft, fontSize: 10, fontWeight: '800' },
});
