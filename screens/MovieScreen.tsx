import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import { MovieDetailSkeleton } from '../components/Skeleton';
import { useAppContext, UserMovieStatus } from '../store/AppContext';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZDRjMGIyYjJmNWZiZDMxOWMzNTU4OTU2YmFhOTZiZiIsIm5iZiI6MTc3ODMxOTAzMS45NjMsInN1YiI6IjY5ZmVmZWI3ZmQ3NjliZmExZTFlMDk0MSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.uJTLQyX-dOE5DG4Zjim4bYRIMx3OeEfHDk6Rz0z1WNA';
const { width } = Dimensions.get('window');
const relatedPosterWidth = 104;

const ONLINE_SOURCES = [
  {
    key: 'hdrezka',
    name: 'HD Rezka',
    icon: 'film',
    getUrl: (title: string) => `https://tv.hdrezka.inc/search/${encodeURIComponent(title)}`,
  },
  {
    key: 'baskino',
    name: 'Baskino',
    icon: 'videocam',
    getUrl: (title: string) => `https://baskino.my/index.php?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(title)}`,
  },
  {
    key: 'kinopub',
    name: 'Kino.pub',
    icon: 'play-circle',
    deeplink: (title: string) => `kinopub://search?query=${encodeURIComponent(title)}`,
    getUrl: (title: string) => `https://kino.pub/item/search?query=${encodeURIComponent(title)}`,
  },
];

const STATUS_OPTIONS: { key: UserMovieStatus; label: string; icon: any }[] = [
  { key: 'want', label: 'Хочу', icon: 'bookmark-outline' },
  { key: 'watched', label: 'Смотрел', icon: 'checkmark-circle-outline' },
  { key: 'liked', label: 'Понравилось', icon: 'thumbs-up-outline' },
  { key: 'disliked', label: 'Не понравилось', icon: 'thumbs-down-outline' },
];

function getYouTubeHtml(videoId: string) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background: #000;
            overflow: hidden;
          }
          .container {
            position: relative;
            width: 100%;
            height: 100%;
          }
          iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <iframe
            id="player"
            src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=https://www.youtube.com&rel=0&playsinline=1&modestbranding=1"
            title="YouTube trailer"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
            referrerpolicy="no-referrer">
          </iframe>
        </div>
      </body>
    </html>
  `;
}

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

    if (e.name === 'AbortError') {
      throw new Error('Превышено время ожидания. Проверь интернет.');
    }

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

function getCertification(data: any, type: string) {
  if (type === 'movie') {
    const ru = data.release_dates?.results?.find((r: any) => r.iso_3166_1 === 'RU');
    const us = data.release_dates?.results?.find((r: any) => r.iso_3166_1 === 'US');
    const release = [...(ru?.release_dates || []), ...(us?.release_dates || [])].find((r: any) => r.certification);
    return release?.certification || null;
  }

  const ru = data.content_ratings?.results?.find((r: any) => r.iso_3166_1 === 'RU');
  const us = data.content_ratings?.results?.find((r: any) => r.iso_3166_1 === 'US');
  return ru?.rating || us?.rating || null;
}

function getProviders(data: any) {
  const region = data['watch/providers']?.results?.RU || data['watch/providers']?.results?.US;
  const providers = [...(region?.flatrate || []), ...(region?.rent || []), ...(region?.buy || [])];
  const unique = new Map(providers.map((p: any) => [p.provider_id, p]));
  return Array.from(unique.values()).slice(0, 8);
}

function normalizeRelated(items: any[], type: string) {
  return (items || [])
    .filter((m: any) => m.poster_path)
    .slice(0, 12)
    .map((m: any) => ({ ...m, media_type: type }));
}

async function fetchFullDetails(id: number, type: string) {
  const extra = type === 'movie' ? 'release_dates' : 'content_ratings';
  const [ruRes, enRes, trailerKey] = await Promise.all([
    fetchWithTimeout(
      `https://api.themoviedb.org/3/${type}/${id}?language=ru-RU&append_to_response=credits,external_ids,watch/providers,recommendations,similar,${extra}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    ),
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=en-US`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
    getTrailer(id, type),
  ]);

  const ruData = await ruRes.json();
  const enData = await enRes.json();
  const recommendations = normalizeRelated(
    ruData.recommendations?.results?.length ? ruData.recommendations.results : ruData.similar?.results,
    type
  );

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
    runtime: type === 'movie' ? ruData.runtime : ruData.episode_run_time?.[0],
    seasons: ruData.number_of_seasons,
    ageRating: getCertification(ruData, type),
    cast: ruData.credits?.cast?.slice(0, 8) || [],
    creators:
      type === 'movie'
        ? ruData.credits?.crew?.filter((p: any) => p.job === 'Director').slice(0, 3) || []
        : ruData.created_by || [],
    providers: getProviders(ruData),
    recommendations,
    imdbId: ruData.external_ids?.imdb_id || null,
    genreId: null,
  };
}

async function fetchRandom(genreId: number, mediaType: string, recentRandomIds: string[]) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const params: any = {
    sort_by: 'popularity.desc',
    language: 'ru-RU',
  };

  if (genreId) {
    params.with_genres = String(genreId);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    params.page = String(Math.floor(Math.random() * 20) + 1);

    const res = await fetchWithTimeout(
      `https://api.themoviedb.org/3/discover/${type}?${new URLSearchParams(params)}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    const data = await res.json();
    const items = (data.results || []).filter((m: any) => {
      return m.poster_path && !recentRandomIds.includes(`${type}-${m.id}`);
    });

    if (items.length > 0) {
      const item = items[Math.floor(Math.random() * items.length)];
      const details = await fetchFullDetails(item.id, type);
      return { ...details, genreId, mediaType };
    }
  }

  throw new Error('Все свежие варианты уже попадались. Попробуй другой жанр или фильтр.');
}

export default function MovieScreen({ route, navigation }: any) {
  const [movie, setMovie] = useState(route.params.movie);
  const [loadingNext, setLoadingNext] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [skeletonVisible, setSkeletonVisible] = useState(false);
  const [error, setError] = useState('');
  const [showOnline, setShowOnline] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const {
    addToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    getUserStatus,
    setUserStatus,
    clearUserStatus,
    recentRandomIds,
    addRecentRandom,
  } = useAppContext();

  const inWatchlist = movie.id ? isInWatchlist(movie.id, movie.mediaType) : false;
  const canLoadRandom = movie.genreId !== undefined && movie.genreId !== null;
  const currentStatus = movie.id ? getUserStatus(movie.id, movie.mediaType) : null;
  const title = movie.titleRu || movie.titleEn;

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      if (!movie.id || movie.cast || movie.providers || movie.recommendations) return;

      setHydrating(true);
      try {
        const details = await fetchFullDetails(movie.id, movie.mediaType);
        if (mounted) setMovie((prev: any) => ({ ...prev, ...details, genreId: prev.genreId }));
      } catch (e: any) {
        if (mounted) setError(e.message || 'Не удалось загрузить детали.');
      }
      if (mounted) setHydrating(false);
    }

    hydrate();

    return () => {
      mounted = false;
    };
  }, [movie.id, movie.mediaType]);

  const toggleWatchlist = () => {
    if (inWatchlist) {
      removeFromWatchlist(movie.id, movie.mediaType);
    } else {
      addToWatchlist(movie);
    }
  };

  const handleShare = async () => {
    const url = `https://www.themoviedb.org/${movie.mediaType}/${movie.id}`;
    await Share.share({ message: `${title} (${movie.year})\n${url}`, title });
  };

  const openTrailerInYouTube = () => {
    if (!movie.trailerKey) return;
    Linking.openURL(`https://www.youtube.com/watch?v=${movie.trailerKey}`);
  };

  const openSource = async (source: typeof ONLINE_SOURCES[0]) => {
    setShowOnline(false);
    const sourceTitle = movie.titleEn || movie.titleRu;

    if (source.deeplink) {
      const deeplink = source.deeplink(sourceTitle);
      const canOpen = await Linking.canOpenURL(deeplink);

      if (canOpen) {
        Linking.openURL(deeplink);
        return;
      }
    }

    Linking.openURL(source.getUrl(sourceTitle));
  };

  const loadNext = async () => {
    if (!canLoadRandom) return;

    setLoadingNext(true);
    setSkeletonVisible(true);
    setError('');
    setShowTrailer(false);

    try {
      const next = await fetchRandom(movie.genreId, movie.mediaType, recentRandomIds);
      addRecentRandom(next.id, next.mediaType);
      setMovie(next);
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки.');
    }

    setLoadingNext(false);
    setSkeletonVisible(false);
  };

  const openRelated = async (item: any) => {
    setSkeletonVisible(true);
    setError('');
    setShowTrailer(false);

    try {
      const details = await fetchFullDetails(item.id, item.media_type || movie.mediaType);
      setMovie(details);
    } catch (e: any) {
      setError(e.message || 'Не удалось открыть похожий тайтл.');
    }

    setSkeletonVisible(false);
  };

  if (skeletonVisible) {
    return (
      <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={20} color="#aaa" />
            <Text style={styles.backText}>Назад</Text>
          </TouchableOpacity>
          <MovieDetailSkeleton />
        </ScrollView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={20} color="#aaa" />
            <Text style={styles.backText}>Назад</Text>
          </TouchableOpacity>

          <View style={styles.topActions}>
            {movie.id && (
              <TouchableOpacity style={styles.iconBtn} onPress={handleShare}>
                <Ionicons name="share-outline" size={20} color="#aaa" />
              </TouchableOpacity>
            )}

            {movie.id && (
              <TouchableOpacity style={styles.iconBtn} onPress={toggleWatchlist}>
                <Ionicons
                  name={inWatchlist ? 'heart' : 'heart-outline'}
                  size={20}
                  color={inWatchlist ? '#e50914' : '#aaa'}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {movie.poster ? (
          <Image source={{ uri: movie.poster }} style={styles.poster} contentFit="cover" transition={300} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.poster, styles.posterFallback]}>
            <Ionicons name="image-outline" size={42} color="#555" />
          </View>
        )}

        <Text style={styles.title}>{movie.titleRu} / {movie.titleEn}</Text>

        <View style={styles.metaRow}>
          {movie.rating && (
            <View style={styles.badge}>
              <Ionicons name="star" size={12} color="#FFD700" />
              <Text style={styles.badgeText}>{movie.rating}</Text>
            </View>
          )}
          {movie.year && <View style={styles.badge}><Text style={styles.badgeText}>{movie.year}</Text></View>}
          {movie.country && <View style={styles.badge}><Text style={styles.badgeText}>{movie.country}</Text></View>}
          {movie.ageRating && <View style={styles.badge}><Text style={styles.badgeText}>{movie.ageRating}</Text></View>}
          {movie.runtime && <View style={styles.badge}><Text style={styles.badgeText}>{movie.runtime} мин</Text></View>}
          {!movie.runtime && movie.seasons && <View style={styles.badge}><Text style={styles.badgeText}>{movie.seasons} сез.</Text></View>}
        </View>

        {movie.genres && <Text style={styles.genres}>{movie.genres}</Text>}

        {hydrating && (
          <View style={styles.inlineLoading}>
            <ActivityIndicator size="small" color="#e50914" />
            <Text style={styles.inlineLoadingText}>Загружаем детали...</Text>
          </View>
        )}

        <Text style={styles.overview}>
          {movie.overview || 'Описание пока недоступно.'}
        </Text>

        <View style={styles.statusBlock}>
          <Text style={styles.blockTitle}>Моя оценка</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(status => {
              const active = currentStatus === status.key;
              return (
                <TouchableOpacity
                  key={status.key}
                  style={[styles.statusChip, active && styles.statusChipActive]}
                  onPress={() => {
                    if (active) clearUserStatus(movie.id, movie.mediaType);
                    else setUserStatus(movie.id, movie.mediaType, status.key);
                  }}
                >
                  <Ionicons name={status.icon} size={14} color={active ? '#fff' : '#777'} />
                  <Text style={[styles.statusText, active && styles.statusTextActive]}>{status.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {movie.creators?.length > 0 && (
          <View style={styles.infoBlock}>
            <Text style={styles.blockTitle}>{movie.mediaType === 'tv' ? 'Создатели' : 'Режиссер'}</Text>
            <Text style={styles.infoText}>{movie.creators.map((p: any) => p.name).join(', ')}</Text>
          </View>
        )}

        {movie.cast?.length > 0 && (
          <View style={styles.infoBlock}>
            <Text style={styles.blockTitle}>Актеры</Text>
            <Text style={styles.infoText}>{movie.cast.map((p: any) => p.name).join(', ')}</Text>
          </View>
        )}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            {canLoadRandom && (
              <TouchableOpacity onPress={loadNext}>
                <Text style={styles.retryText}>Попробовать снова</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {movie.trailerKey && (
          <TouchableOpacity style={styles.trailerBtn} onPress={() => setShowTrailer(true)}>
            <Ionicons name="play-circle" size={20} color="#fff" />
            <Text style={styles.trailerText}>Смотреть трейлер</Text>
          </TouchableOpacity>
        )}

        {showTrailer && movie.trailerKey && (
          <View style={styles.videoContainer}>
            <WebView
              source={{
                html: getYouTubeHtml(movie.trailerKey),
                baseUrl: 'https://www.youtube.com',
              }}
              style={styles.video}
              originWhitelist={['*']}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              onMessage={(event) => {
              }}
              mixedContentMode="always"
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              setSupportMultipleWindows={false}
              userAgent="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            />

            <TouchableOpacity style={styles.closeVideo} onPress={() => setShowTrailer(false)}>
              <Ionicons name="close-circle" size={20} color="#aaa" />
              <Text style={styles.closeVideoText}>Закрыть трейлер</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.youtubeFallback} onPress={openTrailerInYouTube}>
              <Ionicons name="logo-youtube" size={18} color="#e50914" />
              <Text style={styles.youtubeFallbackText}>Открыть на YouTube</Text>
            </TouchableOpacity>
          </View>
        )}

        {!movie.trailerKey && (
          <View style={styles.noTrailer}>
            <Ionicons name="videocam-off-outline" size={16} color="#555" />
            <Text style={styles.noTrailerText}>Трейлер недоступен</Text>
          </View>
        )}

        <TouchableOpacity style={styles.onlineBtn} onPress={() => setShowOnline(true)}>
          <Ionicons name="globe-outline" size={20} color="#8888ff" />
          <Text style={styles.onlineBtnText}>Сервисы просмотра</Text>
        </TouchableOpacity>

        {movie.recommendations?.length > 0 && (
          <View style={styles.relatedBlock}>
            <Text style={styles.blockTitle}>Похожие</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {movie.recommendations.map((item: any) => (
                <TouchableOpacity key={`${item.id}-${item.media_type}`} style={styles.relatedCard} onPress={() => openRelated(item)}>
                  <Image
                    source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
                    style={styles.relatedPoster}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                  <Text style={styles.relatedTitle} numberOfLines={2}>{item.title || item.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {canLoadRandom && (
          loadingNext ? (
            <View style={styles.loadingNext}>
              <Text style={styles.loadingNextText}>Ищем следующий...</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.randomBtn} onPress={loadNext}>
              <Ionicons name="shuffle" size={20} color="#e50914" />
              <Text style={styles.randomText}>
                Случайный {movie.mediaType === 'tv' ? 'сериал' : 'фильм'}
              </Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>

      <Modal visible={showOnline} transparent animationType="slide" onRequestClose={() => setShowOnline(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowOnline(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Сервисы просмотра</Text>
            <Text style={styles.sheetSubtitle}>{title} {movie.year ? `(${movie.year})` : ''}</Text>

            {movie.providers?.length > 0 && (
              <View style={styles.providerGrid}>
                {movie.providers.map((provider: any) => (
                  <View key={provider.provider_id} style={styles.providerItem}>
                    <Image
                      source={{ uri: `https://image.tmdb.org/t/p/w92${provider.logo_path}` }}
                      style={styles.providerLogo}
                      contentFit="cover"
                    />
                    <Text style={styles.providerName} numberOfLines={2}>{provider.provider_name}</Text>
                  </View>
                ))}
              </View>
            )}

            {ONLINE_SOURCES.map(source => (
              <TouchableOpacity key={source.key} style={styles.sourceBtn} onPress={() => openSource(source)}>
                <View style={styles.sourceIconWrap}>
                  <Ionicons name={source.icon as any} size={22} color="#e50914" />
                </View>
                <View style={styles.sourceInfo}>
                  <Text style={styles.sourceName}>{source.name}</Text>
                  <Text style={styles.sourceHint}>Открыть и найти</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#444" />
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowOnline(false)}>
              <Text style={styles.cancelText}>Отмена</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { alignItems: 'center', padding: 20, paddingTop: 60, paddingBottom: 36 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 20 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: '#aaa', fontSize: 14 },
  topActions: { flexDirection: 'row', gap: 8 },
  iconBtn: { backgroundColor: '#1e1e30', borderRadius: 12, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  poster: { width: 220, height: 330, borderRadius: 16, marginBottom: 24 },
  posterFallback: { backgroundColor: '#1e1e30', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 12 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1e1e30', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  badgeText: { color: '#fff', fontSize: 13 },
  genres: { color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  inlineLoadingText: { color: '#777', fontSize: 13 },
  overview: { fontSize: 14, color: '#ccc', textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  statusBlock: { width: '100%', marginBottom: 20 },
  blockTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#333', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  statusChipActive: { backgroundColor: '#e50914', borderColor: '#e50914' },
  statusText: { color: '#777', fontSize: 12, fontWeight: '600' },
  statusTextActive: { color: '#fff' },
  infoBlock: { width: '100%', backgroundColor: '#1e1e30', borderRadius: 14, padding: 14, marginBottom: 12 },
  infoText: { color: '#ccc', fontSize: 14, lineHeight: 20 },
  errorBox: { backgroundColor: '#2a0a0a', borderRadius: 12, padding: 16, marginBottom: 16, alignItems: 'center', width: '100%' },
  errorText: { color: '#e50914', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  trailerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e50914', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30, marginBottom: 12 },
  trailerText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  videoContainer: { width: width - 40, marginBottom: 16 },
  video: { width: '100%', height: (width - 40) * 0.56, borderRadius: 12, backgroundColor: '#000' },
  closeVideo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  closeVideoText: { color: '#aaa', fontSize: 13 },
  youtubeFallback: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  youtubeFallbackText: { color: '#e50914', fontSize: 13, fontWeight: '600' },
  noTrailer: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1e1e30', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30, marginBottom: 12 },
  noTrailerText: { color: '#555', fontSize: 14 },
  onlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1e1e40', borderWidth: 1, borderColor: '#8888ff', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30, marginBottom: 12 },
  onlineBtnText: { color: '#8888ff', fontWeight: '700', fontSize: 16 },
  relatedBlock: { width: '100%', marginBottom: 16 },
  relatedCard: { width: relatedPosterWidth, marginRight: 10 },
  relatedPoster: { width: relatedPosterWidth, height: relatedPosterWidth * 1.5, borderRadius: 10, marginBottom: 6 },
  relatedTitle: { color: '#ccc', fontSize: 11, textAlign: 'center' },
  loadingNext: { paddingVertical: 16, alignItems: 'center' },
  loadingNextText: { color: '#aaa', fontSize: 14 },
  randomBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#e50914', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30, marginTop: 8 },
  randomText: { color: '#e50914', fontWeight: '700', fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '88%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  sheetSubtitle: { fontSize: 13, color: '#aaa', marginBottom: 16 },
  providerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  providerItem: { width: 70, alignItems: 'center' },
  providerLogo: { width: 44, height: 44, borderRadius: 10, marginBottom: 5 },
  providerName: { color: '#aaa', fontSize: 10, textAlign: 'center' },
  sourceBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f0f1a', borderRadius: 16, padding: 16, marginBottom: 10 },
  sourceIconWrap: { width: 44, height: 44, backgroundColor: '#1e1e30', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  sourceInfo: { flex: 1 },
  sourceName: { color: '#fff', fontWeight: '600', fontSize: 16 },
  sourceHint: { color: '#666', fontSize: 12, marginTop: 2 },
  cancelBtn: { alignItems: 'center', marginTop: 8, paddingVertical: 14 },
  cancelText: { color: '#aaa', fontSize: 16 },
});
