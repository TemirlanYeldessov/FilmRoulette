import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { TMDB_TOKEN } from '../constants/api';

const { width } = Dimensions.get('window');
const cardWidth = (width - 48) / 2;

async function fetchPerson(personId: number) {
  const [personRes, creditsRes] = await Promise.all([
    fetch(`https://api.themoviedb.org/3/person/${personId}?language=ru-RU`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    }),
    fetch(`https://api.themoviedb.org/3/person/${personId}/combined_credits?language=ru-RU`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    }),
  ]);

  const person = await personRes.json();
  const credits = await creditsRes.json();

  const cast = (credits.cast || [])
    .filter((c: any) => c.poster_path && (c.media_type === 'movie' || c.media_type === 'tv'))
    .sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 40);

  return { person, cast };
}

async function fetchDetails(id: number, type: string) {
  const [ruRes, enRes] = await Promise.all([
    fetch(`https://api.themoviedb.org/3/${type}/${id}?language=ru-RU`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    }),
    fetch(`https://api.themoviedb.org/3/${type}/${id}?language=en-US`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    }),
  ]);
  const ruData = await ruRes.json();
  const enData = await enRes.json();
  return {
    id,
    titleRu: ruData.title || ruData.name,
    titleEn: enData.title || enData.name,
    overview: ruData.overview || enData.overview,
    poster: ruData.poster_path ? `https://image.tmdb.org/t/p/w500${ruData.poster_path}` : null,
    trailerKey: null,
    mediaType: type,
    rating: ruData.vote_average ? ruData.vote_average.toFixed(1) : null,
    year: (ruData.release_date || ruData.first_air_date || '').slice(0, 4),
    country: ruData.production_countries?.[0]?.name || null,
    genres: ruData.genres?.map((g: any) => g.name).join(', ') || null,
    genreId: null,
  };
}

export default function ActorScreen({ route, navigation }: any) {
  const { personId, name } = route.params;
  const [person, setPerson] = useState<any>(null);
  const [cast, setCast] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [bioExpanded, setBioExpanded] = useState(false);

  useEffect(() => {
    fetchPerson(personId).then(({ person: p, cast: c }) => {
      setPerson(p);
      setCast(c);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [personId]);

  const openCard = async (item: any) => {
    const details = await fetchDetails(item.id, item.media_type);
    navigation.navigate('Card', { movie: details });
  };

  const bio = person?.biography || '';
  const bioShort = bio.length > 220 ? bio.slice(0, 220) + '...' : bio;

  return (
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
        <Ionicons name="chevron-back" size={20} color="#aaa" />
        <Text style={styles.backText}>Назад</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#e50914" />
        </View>
      ) : (
        <FlatList
          data={cast}
          keyExtractor={(item, i) => `${item.id}-${item.media_type}-${i}`}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          ListHeaderComponent={
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
                <Text style={styles.sectionTitle}>Фильмография ({cast.length})</Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openCard(item)}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{item.media_type === 'tv' ? 'Сериал' : 'Фильм'}</Text>
              </View>
              <Image
                source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
                style={styles.poster}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title || item.name}</Text>
              {item.vote_average > 0 && (
                <Text style={styles.cardRating}>★ {item.vote_average.toFixed(1)}</Text>
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Фильмография недоступна</Text>
            </View>
          }
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
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#fff', alignSelf: 'flex-start', marginTop: 4 },
  grid: { paddingHorizontal: 12, paddingBottom: 32 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: { width: cardWidth },
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#1a1a40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  typeBadgeText: { color: '#8888ff', fontSize: 11, fontWeight: '600' },
  poster: { width: cardWidth, height: cardWidth * 1.5, borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  cardRating: { color: '#aaa', fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 14 },
});
