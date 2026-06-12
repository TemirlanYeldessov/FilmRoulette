import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PaginationBar from '../components/PaginationBar';
import PosterCard from '../components/PosterCard';
import { MovieCardSkeleton } from '../components/Skeleton';
import { itemToMovie } from '../utils/tmdb';
import { makeTmdbFetch } from '../utils/api';
import { tmdbUrls, tmdbHeaders } from '../utils/tmdbApi';
import { useGridColumns } from '../utils/useGridColumns';
import { useTranslation } from '../utils/useTranslation';
import { colors, gradients, radii } from '../constants/theme';

const PAGE_SIZE = 20;
const SKELETON_KEYS = [1, 2, 3, 4, 5, 6];

type SortKey = 'popularity' | 'year' | 'rating';
type TypeFilter = 'all' | 'movie' | 'tv';

const fetchWithTimeout = makeTmdbFetch({
  notOk: 'TMDB временно не отвечает.',
  timeout: 'Превышено время ожидания. Проверь интернет.',
});

async function fetchPerson(personId: number) {
  const [personRes, creditsRes] = await Promise.all([
    fetchWithTimeout(tmdbUrls.person(personId), { headers: tmdbHeaders() }),
    fetchWithTimeout(tmdbUrls.personCredits(personId), { headers: tmdbHeaders() }),
  ]);
  const person = await personRes.json();
  const credits = await creditsRes.json();
  // Dedup by id+media_type — combined_credits returns multiple entries when an
  // actor has multiple credits on the same title (different credit_id).
  const seen = new Set<string>();
  const cast = (credits.cast || [])
    .filter((c: any) => c.poster_path && (c.media_type === 'movie' || c.media_type === 'tv'))
    .filter((c: any) => {
      const key = `${c.media_type}-${c.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { person, cast };
}

const SORT_OPTS: { key: SortKey; label: string }[] = [
  { key: 'popularity', label: 'По популярности' },
  { key: 'rating', label: 'По рейтингу' },
  { key: 'year', label: 'По году' },
];

const TYPE_OPTS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'Всё' },
  { key: 'movie', label: 'Фильмы' },
  { key: 'tv', label: 'Сериалы' },
];

export default function ActorScreen({ route, navigation }: any) {
  const { personId, name } = route.params;
  const { columns, cardWidth } = useGridColumns();
  const [person, setPerson] = useState<any>(null);
  const [cast, setCast] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bioExpanded, setBioExpanded] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('popularity');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [actorPage, setActorPage] = useState(1);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    fetchPerson(personId)
      .then(({ person: p, cast: c }) => {
        if (!mounted) return;
        setPerson(p);
        setCast(c);
      })
      .catch((e: any) => {
        if (!mounted) return;
        setError(e?.message || 'Не удалось загрузить актёра.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [personId, retryToken]);

  const filteredCast = useMemo(() => {
    let result = typeFilter === 'all' ? cast : cast.filter(c => c.media_type === typeFilter);
    switch (sortBy) {
      case 'year':
        return [...result].sort((a, b) => {
          const ya = parseInt((a.release_date || a.first_air_date || '0').slice(0, 4), 10) || 0;
          const yb = parseInt((b.release_date || b.first_air_date || '0').slice(0, 4), 10) || 0;
          return yb - ya;
        });
      case 'rating':
        return [...result].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
      default:
        return [...result].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }
  }, [cast, sortBy, typeFilter]);

  const totalActorPages = Math.ceil(filteredCast.length / PAGE_SIZE) || 1;
  const pagedCast = filteredCast.slice((actorPage - 1) * PAGE_SIZE, actorPage * PAGE_SIZE);

  const handleSortChange = (key: SortKey) => {
    setSortBy(key);
    setActorPage(1);
  };

  const handleTypeChange = (key: TypeFilter) => {
    setTypeFilter(key);
    setActorPage(1);
  };

  const resetFilmographyFilters = () => {
    setTypeFilter('all');
    setSortBy('popularity');
    setActorPage(1);
  };

  const openCard = (item: any) => {
    // push, not navigate: Actor sits above a Card in the stack, so navigate
    // would pop back to that existing Card (which ignores param changes)
    // instead of opening the tapped title.
    navigation.push('Card', { movie: itemToMovie(item) });
  };

  const bio = person?.biography || '';
  const bioTr = useTranslation(bio);
  const displayBio = bioTr.display; // original or its Russian translation
  const hasActiveFilmographyFilters = typeFilter !== 'all' || sortBy !== 'popularity';
  const bioShort = (() => {
    if (displayBio.length <= 220) return displayBio;
    const cut = displayBio.slice(0, 220);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 150 ? cut.slice(0, lastSpace) : cut) + '…';
  })();

  const ListHeader = (
    <View style={styles.header}>
      {person?.profile_path ? (
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w300${person.profile_path}` }}
          style={styles.photo}
          contentFit="cover"
          transition={300}
        />
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <Ionicons name="person" size={48} color={colors.faint} />
        </View>
      )}

      <Text style={styles.name}>{person?.name || name}</Text>

      {person?.birthday && (
        <Text style={styles.meta}>
          {person.birthday.slice(0, 4)}
          {person.place_of_birth ? ` · ${person.place_of_birth}` : ''}
        </Text>
      )}

      {bio.length > 0 && (
        <View style={styles.bioBlock}>
          <Text style={styles.bioText}>{bioExpanded ? displayBio : bioShort}</Text>
          <View style={styles.bioActions}>
            {displayBio.length > 220 && (
              <TouchableOpacity onPress={() => setBioExpanded(v => !v)}>
                <Text style={styles.bioToggle}>{bioExpanded ? 'Свернуть' : 'Читать полностью'}</Text>
              </TouchableOpacity>
            )}
            {bioTr.canTranslate && (
              <TouchableOpacity onPress={bioTr.toggle} disabled={bioTr.translating}>
                <Text style={styles.bioToggle}>
                  {bioTr.translating ? 'Перевожу…' : bioTr.isTranslated ? 'Оригинал' : 'Перевести на русский'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {bioTr.error && <Text style={styles.bioTranslateError}>Не удалось перевести. Попробуй ещё раз.</Text>}
        </View>
      )}

      {cast.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            Фильмография ({filteredCast.length}{typeFilter !== 'all' ? ` из ${cast.length}` : ''})
          </Text>

          <View style={styles.controlsRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {TYPE_OPTS.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.chip, typeFilter === t.key && styles.chipActive]}
                    onPress={() => handleTypeChange(t.key)}
                  >
                    <Text style={[styles.chipText, typeFilter === t.key && styles.chipTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
                {SORT_OPTS.map(s => (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.chip, sortBy === s.key && styles.chipSortActive]}
                    onPress={() => handleSortChange(s.key)}
                  >
                    <Text style={[styles.chipText, sortBy === s.key && styles.chipSortTextActive]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );

  return (
    <LinearGradient colors={gradients.app} style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
        <Ionicons name="chevron-back" size={20} color={colors.textSoft} />
        <Text style={styles.backText}>Назад</Text>
      </TouchableOpacity>

      {loading ? (
        <FlatList
          data={SKELETON_KEYS}
          keyExtractor={i => String(i)}
          key={`grid-${columns}`}
          numColumns={columns}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={() => <MovieCardSkeleton cardWidth={cardWidth} />}
        />
      ) : error ? (
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={42} color={colors.faint} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setRetryToken(t => t + 1)}>
            <Text style={styles.retryText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={pagedCast}
          keyExtractor={(item, i) => `${item.id}-${item.media_type}-${i}`}
          key={`grid-${columns}`}
          numColumns={columns}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name={cast.length > 0 ? 'filter-outline' : 'film-outline'} size={36} color={colors.faint} />
              <Text style={styles.emptyText}>
                {cast.length > 0 ? 'Под эти фильтры ничего не найдено' : 'Фильмография не найдена'}
              </Text>
              <Text style={styles.emptyHint}>
                {cast.length > 0
                  ? 'Попробуй показать и фильмы, и сериалы или вернуться к сортировке по популярности.'
                  : 'В TMDB пока нет тайтлов с постерами для этого актёра.'}
              </Text>
              {cast.length > 0 && hasActiveFilmographyFilters && (
                <TouchableOpacity style={styles.emptyBtn} onPress={resetFilmographyFilters}>
                  <Text style={styles.emptyBtnText}>Сбросить фильтры</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ListFooterComponent={
            filteredCast.length > PAGE_SIZE ? (
              <PaginationBar
                currentPage={actorPage}
                totalPages={totalActorPages}
                totalResults={filteredCast.length}
                onPageChange={setActorPage}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <PosterCard item={item} cardWidth={cardWidth} onPress={() => openCard(item)}>
              {item.vote_average > 0 && (
                <Text style={styles.cardRating}>★ {item.vote_average.toFixed(1)}</Text>
              )}
              {(item.release_date || item.first_air_date) && (
                <Text style={styles.cardYear}>
                  {(item.release_date || item.first_air_date).slice(0, 4)}
                </Text>
              )}
            </PosterCard>
          )}
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 8 },
  backText: { color: colors.textSoft, fontSize: 14, fontWeight: '700' },
  header: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16 },
  photo: { width: 140, height: 140, borderRadius: 70, marginBottom: 16 },
  photoFallback: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 22, fontWeight: '900', color: colors.text, textAlign: 'center', marginBottom: 6 },
  meta: { fontSize: 13, color: colors.muted2, textAlign: 'center', marginBottom: 12 },
  bioBlock: { width: '100%', marginBottom: 16 },
  bioText: { color: colors.textSoft, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  bioActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, marginTop: 6 },
  bioToggle: { color: colors.accent, fontSize: 13, textAlign: 'center', fontWeight: '700' },
  bioTranslateError: { color: colors.muted2, fontSize: 12, textAlign: 'center', marginTop: 6 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.text, alignSelf: 'flex-start', marginTop: 4, marginBottom: 12 },
  controlsRow: { width: '100%', marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipSortActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: colors.text, fontWeight: '800' },
  chipSortTextActive: { color: colors.textSoft, fontWeight: '800' },
  grid: { paddingHorizontal: 12, paddingBottom: 32 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  cardRating: { color: colors.muted, fontSize: 11 },
  cardYear: { color: colors.muted2, fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 24 },
  emptyText: { color: colors.textSoft, fontSize: 15, textAlign: 'center', marginTop: 10, fontWeight: '700' },
  emptyHint: { color: colors.muted2, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 4 },
  emptyBtn: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, marginTop: 14 },
  emptyBtnText: { color: colors.textSoft, fontSize: 13, fontWeight: '800' },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  errorText: { color: colors.textSoft, fontSize: 14, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: radii.pill, marginTop: 6 },
  retryText: { color: colors.text, fontWeight: '800', fontSize: 14 },
});
