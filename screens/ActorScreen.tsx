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
  useWindowDimensions,
  View,
} from 'react-native';
import PaginationBar from '../components/PaginationBar';
import CardMark from '../components/CardMark';
import { MovieCardSkeleton } from '../components/Skeleton';
import { itemToMovie } from '../utils/tmdb';
import { TMDB_TOKEN } from '../constants/api';

const PAGE_SIZE = 20;
const SKELETON_KEYS = [1, 2, 3, 4, 5, 6];

type SortKey = 'popularity' | 'year' | 'rating';
type TypeFilter = 'all' | 'movie' | 'tv';

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
    if (!res.ok) throw new Error('TMDB временно не отвечает.');
    return withCheckedJson(res);
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      if (externalSignal?.aborted) throw e;
      throw new Error('Превышено время ожидания. Проверь интернет.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

async function fetchPerson(personId: number) {
  const [personRes, creditsRes] = await Promise.all([
    fetchWithTimeout(`https://api.themoviedb.org/3/person/${personId}?language=ru-RU`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    }),
    fetchWithTimeout(`https://api.themoviedb.org/3/person/${personId}/combined_credits?language=ru-RU`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    }),
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
  const { width } = useWindowDimensions();
  const cardWidth = useMemo(() => (width - 48) / 2, [width]);
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

  const openCard = (item: any) => {
    // push, not navigate: Actor sits above a Card in the stack, so navigate
    // would pop back to that existing Card (which ignores param changes)
    // instead of opening the tapped title.
    navigation.push('Card', { movie: itemToMovie(item) });
  };

  const bio = person?.biography || '';
  const bioShort = (() => {
    if (bio.length <= 220) return bio;
    const cut = bio.slice(0, 220);
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
          <Ionicons name="person" size={48} color="#555" />
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
          <Text style={styles.bioText}>{bioExpanded ? bio : bioShort}</Text>
          {bio.length > 220 && (
            <TouchableOpacity onPress={() => setBioExpanded(v => !v)}>
              <Text style={styles.bioToggle}>{bioExpanded ? 'Свернуть' : 'Читать полностью'}</Text>
            </TouchableOpacity>
          )}
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
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
        <Ionicons name="chevron-back" size={20} color="#aaa" />
        <Text style={styles.backText}>Назад</Text>
      </TouchableOpacity>

      {loading ? (
        <FlatList
          data={SKELETON_KEYS}
          keyExtractor={i => String(i)}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={() => <MovieCardSkeleton cardWidth={cardWidth} />}
        />
      ) : error ? (
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={42} color="#555" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setRetryToken(t => t + 1)}>
            <Text style={styles.retryText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={pagedCast}
          keyExtractor={(item, i) => `${item.id}-${item.media_type}-${i}`}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Нет результатов</Text>
            </View>
          }
          ListFooterComponent={
            <PaginationBar
              currentPage={actorPage}
              totalPages={totalActorPages}
              totalResults={filteredCast.length}
              onPageChange={setActorPage}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.card, { width: cardWidth }]} onPress={() => openCard(item)}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{item.media_type === 'tv' ? 'Сериал' : 'Фильм'}</Text>
              </View>
              <CardMark movie={itemToMovie(item)} />
              <Image
                source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
                style={[styles.poster, { width: cardWidth, height: cardWidth * 1.5 }]}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title || item.name}</Text>
              {item.vote_average > 0 && (
                <Text style={styles.cardRating}>★ {item.vote_average.toFixed(1)}</Text>
              )}
              {(item.release_date || item.first_air_date) && (
                <Text style={styles.cardYear}>
                  {(item.release_date || item.first_air_date).slice(0, 4)}
                </Text>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 8 },
  backText: { color: '#aaa', fontSize: 14 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16 },
  photo: { width: 140, height: 140, borderRadius: 70, marginBottom: 16 },
  photoFallback: { backgroundColor: '#1e1e30', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 6 },
  meta: { fontSize: 13, color: '#777', textAlign: 'center', marginBottom: 12 },
  bioBlock: { width: '100%', marginBottom: 16 },
  bioText: { color: '#bbb', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  bioToggle: { color: '#8888ff', fontSize: 13, textAlign: 'center', marginTop: 6 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#fff', alignSelf: 'flex-start', marginTop: 4, marginBottom: 12 },
  controlsRow: { width: '100%', marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: '#333' },
  chipActive: { backgroundColor: '#e50914', borderColor: '#e50914' },
  chipSortActive: { backgroundColor: '#1e1e40', borderColor: '#8888ff' },
  chipText: { color: '#666', fontSize: 12 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipSortTextActive: { color: '#8888ff', fontWeight: '600' },
  grid: { paddingHorizontal: 12, paddingBottom: 32 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: {},
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#1a1a40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  typeBadgeText: { color: '#8888ff', fontSize: 11, fontWeight: '600' },
  poster: { borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  cardRating: { color: '#aaa', fontSize: 11 },
  cardYear: { color: '#888', fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#888', fontSize: 14 },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  errorText: { color: '#aaa', fontSize: 14, textAlign: 'center' },
  retryBtn: { backgroundColor: '#e50914', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, marginTop: 6 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
