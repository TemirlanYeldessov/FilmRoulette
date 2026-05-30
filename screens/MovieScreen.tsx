import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { MovieDetailSkeleton } from '../components/Skeleton';
import { useAppContext, UserMovieStatus } from '../store/AppContext';
import { dedup, itemToMovie, applyDiscoverFilters, mapBaseDetail } from '../utils/tmdb';
import { TMDB_TOKEN as TOKEN } from '../constants/api';
import { makeTmdbFetch } from '../utils/api';

const relatedPosterWidth = 104;
const defaultPreciseFilters = { yearFrom: '', yearTo: '', minRating: 0, maxRating: 10, country: '' };
const RANDOM_REUSE_NOTICE = 'Все свежие варианты уже видели — показываю повтор.';

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

const fetchWithTimeout = makeTmdbFetch({
  notOk: 'TMDB временно не отвечает. Попробуй еще раз.',
  timeout: 'Превышено время ожидания. Проверь интернет.',
});

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
  return Array.from(unique.values());
}

function normalizeRelated(items: any[], type: string) {
  return (items || [])
    .filter((m: any) => m.poster_path)
    .map((m: any) => ({ ...m, media_type: m.media_type || type }));
}

async function fetchFullDetails(id: number, type: string, signal?: AbortSignal) {
  const extra = type === 'movie' ? 'release_dates' : 'content_ratings';
  const [ruRes, enRes] = await Promise.all([
    fetchWithTimeout(
      `https://api.themoviedb.org/3/${type}/${id}?language=ru-RU&append_to_response=credits,external_ids,watch/providers,recommendations,similar,videos,${extra}`,
      { headers: { Authorization: `Bearer ${TOKEN}` }, signal }
    ),
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=en-US&append_to_response=videos`, {
      headers: { Authorization: `Bearer ${TOKEN}` }, signal,
    }),
  ]);

  const ruData = await ruRes.json();
  const enData = await enRes.json();
  const recSource = ruData.recommendations?.results?.length
    ? ruData.recommendations.results
    : ruData.similar?.results;
  const recommendations = normalizeRelated(recSource, type);
  const recommendationsTotalPages = ruData.recommendations?.total_pages || 1;

  return {
    ...mapBaseDetail(id, ruData, enData, type),
    runtime: type === 'movie' ? ruData.runtime : ruData.episode_run_time?.[0],
    seasons: ruData.number_of_seasons,
    ageRating: getCertification(ruData, type),
    cast: ruData.credits?.cast || [],
    creators:
      type === 'movie'
        ? ruData.credits?.crew?.filter((p: any) => p.job === 'Director') || []
        : ruData.created_by || [],
    providers: getProviders(ruData),
    recommendations,
    recommendationsTotalPages,
    imdbId: ruData.external_ids?.imdb_id || null,
    genreId: null,
  };
}

async function fetchRandom(
  selectedGenres: number[],
  mediaType: string,
  adultContent: boolean,
  filters: any,
  recentRandomIds: string[],
  signal?: AbortSignal
) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const params: any = {
    sort_by: 'popularity.desc',
    language: 'ru-RU',
    include_adult: String(adultContent),
  };
  const genres = selectedGenres.filter(g => g !== 0);
  if (genres.length > 0) params.with_genres = genres.join(',');
  applyDiscoverFilters(params, filters, type);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    params.page = String(Math.floor(Math.random() * 20) + 1);
    const res = await fetchWithTimeout(
      `https://api.themoviedb.org/3/discover/${type}?${new URLSearchParams(params)}`,
      { headers: { Authorization: `Bearer ${TOKEN}` }, signal }
    );
    const data = await res.json();
    const posterItems = (data.results || []).filter((m: any) => m.poster_path);
    const freshItems = posterItems.filter((m: any) => !recentRandomIds.includes(`${type}-${m.id}`));
    const items = freshItems.length > 0 ? freshItems : (attempt >= 3 ? posterItems : []);
    if (items.length > 0) {
      const item = items[Math.floor(Math.random() * items.length)];
      const details = await fetchFullDetails(item.id, type, signal);
      return {
        ...details,
        genreId: genres[0] ?? 0,
        selectedGenres: genres,
        preciseFilters: filters,
        mediaType,
        randomNotice: freshItems.length === 0 ? RANDOM_REUSE_NOTICE : null,
      };
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
  const [randomNotice, setRandomNotice] = useState(route.params?.randomNotice || route.params?.movie?.randomNotice || '');
  const [showOnline, setShowOnline] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const relatedAbortRef = useRef<AbortController | null>(null);
  const loadNextAbortRef = useRef<AbortController | null>(null);
  const { width } = useWindowDimensions();
  const videoWidth = Math.max(width - 40, 280);

  // Related / recommendations infinite scroll
  const [relatedItems, setRelatedItems] = useState<any[]>([]);
  const [relatedPage, setRelatedPage] = useState(1);
  const [relatedHasMore, setRelatedHasMore] = useState(false);
  const [relatedLoadingMore, setRelatedLoadingMore] = useState(false);

  const {
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    getUserStatus, setUserStatus, clearUserStatus,
    recentRandomIds, addRecentRandom, adultContent,
  } = useAppContext();

  const inWatchlist = movie.id ? isInWatchlist(movie.id, movie.mediaType) : false;
  const canLoadRandom = movie.genreId !== undefined && movie.genreId !== null;
  const currentStatus = movie.id ? getUserStatus(movie.id, movie.mediaType) : null;
  const title = movie.titleRu || movie.titleEn;
  const displayTitle = movie.titleRu && movie.titleEn && movie.titleRu !== movie.titleEn
    ? `${movie.titleRu} / ${movie.titleEn}`
    : (movie.titleRu || movie.titleEn || '');
  const activePreciseFilters = movie.preciseFilters || route.params?.preciseFilters || defaultPreciseFilters;
  const activeRandomGenres = movie.selectedGenres || (movie.genreId ? [movie.genreId] : [0]);

  // Initialize related items when the movie changes OR when recommendations
  // arrive via hydration. Depending on movie.id alone misses the hydrate case:
  // a card opened "thin" (catalog/AI/search) keeps the same id while details
  // load, so "Похожие" would never populate on first open — only on reroll.
  useEffect(() => {
    const recs = movie.recommendations || [];
    setRelatedItems(recs);
    setRelatedPage(1);
    setRelatedHasMore((movie.recommendationsTotalPages || 1) > 1);
  }, [movie.id, movie.recommendations]);

  useEffect(() => {
    return () => {
      relatedAbortRef.current?.abort();
      loadNextAbortRef.current?.abort();
    };
  }, []);

  // Hydrate missing details.
  // Always reset hydrating up-front so a rapid movie switch (openRelated →
  // loadNext) can't leave the indicator stuck on after the prior effect's
  // mounted=false flag swallowed its setHydrating(false).
  useEffect(() => {
    setHydrating(false);
    if (!movie.id || movie.cast || movie.providers || movie.recommendations) return;
    let mounted = true;
    const controller = new AbortController();
    (async () => {
      setHydrating(true);
      try {
        const details = await fetchFullDetails(movie.id, movie.mediaType, controller.signal);
        if (mounted) setMovie((prev: any) => ({ ...prev, ...details, genreId: prev.genreId }));
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        if (mounted) setError(e.message || 'Не удалось загрузить детали.');
      }
      if (mounted) setHydrating(false);
    })();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [movie.id, movie.mediaType]);

  const loadMoreRelated = async () => {
    if (relatedLoadingMore || !relatedHasMore || !movie.id) return;
    relatedAbortRef.current?.abort();
    const controller = new AbortController();
    relatedAbortRef.current = controller;
    setRelatedLoadingMore(true);
    try {
      const nextPage = relatedPage + 1;
      const res = await fetchWithTimeout(
        `https://api.themoviedb.org/3/${movie.mediaType}/${movie.id}/recommendations?language=ru-RU&page=${nextPage}`,
        { headers: { Authorization: `Bearer ${TOKEN}` }, signal: controller.signal }
      );
      const data = await res.json();
      if (controller.signal.aborted) return;
      const more = normalizeRelated(data.results, movie.mediaType);
      setRelatedItems(prev => dedup([...prev, ...more]));
      setRelatedPage(nextPage);
      setRelatedHasMore(nextPage < (data.total_pages || 1));
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        // Keep recommendations best-effort; the main details are already loaded.
      }
    } finally {
      if (relatedAbortRef.current === controller) relatedAbortRef.current = null;
      if (!controller.signal.aborted) setRelatedLoadingMore(false);
    }
  };

  const toggleWatchlist = () => {
    if (inWatchlist) removeFromWatchlist(movie.id, movie.mediaType);
    else addToWatchlist(movie);
  };

  const handleShare = async () => {
    try {
      const url = `https://www.themoviedb.org/${movie.mediaType}/${movie.id}`;
      await Share.share({ message: `${title} (${movie.year})\n${url}`, title: title || '' });
    } catch {
      // User dismissed the share sheet or share isn't available on this platform.
    }
  };

  const openTrailerInYouTube = async () => {
    if (!movie.trailerKey) return;
    try {
      await Linking.openURL(`https://www.youtube.com/watch?v=${movie.trailerKey}`);
    } catch {
      Alert.alert('Не удалось открыть', 'YouTube недоступен на этом устройстве.');
    }
  };

  const openSource = async (source: typeof ONLINE_SOURCES[0]) => {
    setShowOnline(false);
    const sourceTitle = movie.titleEn || movie.titleRu || '';
    try {
      if (source.deeplink) {
        const deeplink = source.deeplink(sourceTitle);
        const canOpen = await Linking.canOpenURL(deeplink);
        if (canOpen) { await Linking.openURL(deeplink); return; }
      }
      await Linking.openURL(source.getUrl(sourceTitle));
    } catch {
      Alert.alert('Не удалось открыть', `Сервис ${source.name} недоступен.`);
    }
  };

  const loadNext = async () => {
    if (!canLoadRandom || loadingNext) return;
    loadNextAbortRef.current?.abort();
    const controller = new AbortController();
    loadNextAbortRef.current = controller;
    const { signal } = controller;
    setLoadingNext(true);
    setSkeletonVisible(true);
    setError('');
    setRandomNotice('');
    setShowTrailer(false);
    try {
      const next = await fetchRandom(activeRandomGenres, movie.mediaType, adultContent, activePreciseFilters, recentRandomIds, signal);
      if (signal.aborted) return;
      addRecentRandom(next.id, next.mediaType);
      setMovie(next);
      setRandomNotice(next.randomNotice || '');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e.message || 'Ошибка загрузки.');
    } finally {
      if (loadNextAbortRef.current === controller) loadNextAbortRef.current = null;
      if (!signal.aborted) {
        setLoadingNext(false);
        setSkeletonVisible(false);
      }
    }
  };

  const openRelated = (item: any) => {
    // push (not navigate): navigating to 'Card' from 'Card' would just update
    // the current screen's params, which MovieScreen ignores (movie is seeded
    // from route.params once). push mounts a fresh detail screen each time.
    navigation.push('Card', { movie: itemToMovie(item, movie.mediaType) });
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
            {canLoadRandom && (
              <TouchableOpacity
                style={[styles.iconBtn, styles.rerollBtn, loadingNext && styles.iconBtnDisabled]}
                onPress={loadNext}
                disabled={loadingNext}
              >
                <Ionicons name="shuffle" size={20} color="#e50914" />
              </TouchableOpacity>
            )}
            {movie.id && (
              <TouchableOpacity style={styles.iconBtn} onPress={handleShare}>
                <Ionicons name="share-outline" size={20} color="#aaa" />
              </TouchableOpacity>
            )}
            {movie.id && (
              <TouchableOpacity style={styles.iconBtn} onPress={toggleWatchlist}>
                <Ionicons name={inWatchlist ? 'heart' : 'heart-outline'} size={20} color={inWatchlist ? '#e50914' : '#aaa'} />
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

        <Text style={styles.title}>{displayTitle}</Text>

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

        <Text style={styles.overview}>{movie.overview || 'Описание пока недоступно.'}</Text>

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
                    else setUserStatus(movie, status.key);
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
            <View style={styles.castRow}>
              {movie.cast.map((p: any) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.castChip}
                  onPress={() => navigation.push('Actor', { personId: p.id, name: p.name })}
                >
                  <Text style={styles.castChipText}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {randomNotice ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{randomNotice}</Text>
          </View>
        ) : null}

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
          <View style={[styles.videoContainer, { width: videoWidth }]}>
            <YoutubePlayer
              videoId={movie.trailerKey}
              height={Math.round(videoWidth * 0.56)}
              play={showTrailer}
              onChangeState={(state: string) => { if (state === 'ended') setShowTrailer(false); }}
              onError={() => {
                setShowTrailer(false);
                Alert.alert('Трейлер недоступен', 'Видео удалено или заблокировано. Открыть на YouTube?', [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Открыть', onPress: openTrailerInYouTube },
                ]);
              }}
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

        {relatedItems.length > 0 && (
          <View style={styles.relatedBlock}>
            <Text style={styles.blockTitle}>Похожие</Text>
            <FlatList
              data={relatedItems}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, i) => `${item.id}-${item.media_type}-${i}`}
              onEndReached={loadMoreRelated}
              onEndReachedThreshold={0.5}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.relatedCard}
                  onPress={() => openRelated(item)}
                >
                  <Image
                    source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
                    style={styles.relatedPoster}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                  <Text style={styles.relatedTitle} numberOfLines={2}>{item.title || item.name}</Text>
                </TouchableOpacity>
              )}
              ListFooterComponent={
                relatedLoadingMore ? (
                  <View style={styles.relatedLoadingWrap}>
                    <ActivityIndicator size="small" color="#555" />
                  </View>
                ) : null
              }
            />
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
  rerollBtn: { borderWidth: 1, borderColor: '#e50914' },
  iconBtnDisabled: { opacity: 0.4 },
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
  noticeBox: { backgroundColor: '#1e1e40', borderWidth: 1, borderColor: '#8888ff', borderRadius: 12, padding: 14, marginBottom: 16, width: '100%' },
  noticeText: { color: '#bbb', fontSize: 13, textAlign: 'center' },
  errorBox: { backgroundColor: '#2a0a0a', borderRadius: 12, padding: 16, marginBottom: 16, alignItems: 'center', width: '100%' },
  errorText: { color: '#e50914', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  trailerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e50914', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30, marginBottom: 12 },
  trailerText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  videoContainer: { marginBottom: 16, borderRadius: 12, overflow: 'hidden' },
  closeVideo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  closeVideoText: { color: '#aaa', fontSize: 13 },
  youtubeFallback: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  youtubeFallbackText: { color: '#e50914', fontSize: 13, fontWeight: '600' },
  noTrailer: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1e1e30', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30, marginBottom: 12 },
  noTrailerText: { color: '#888', fontSize: 14 },
  onlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1e1e40', borderWidth: 1, borderColor: '#8888ff', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30, marginBottom: 12 },
  onlineBtnText: { color: '#8888ff', fontWeight: '700', fontSize: 16 },
  relatedBlock: { width: '100%', marginBottom: 16 },
  relatedCard: { width: relatedPosterWidth, marginRight: 10 },
  relatedPoster: { width: relatedPosterWidth, height: relatedPosterWidth * 1.5, borderRadius: 10, marginBottom: 6 },
  relatedTitle: { color: '#ccc', fontSize: 11, textAlign: 'center' },
  relatedLoadingWrap: { width: relatedPosterWidth, alignItems: 'center', justifyContent: 'center' },
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
  sourceHint: { color: '#888', fontSize: 12, marginTop: 2 },
  cancelBtn: { alignItems: 'center', marginTop: 8, paddingVertical: 14 },
  cancelText: { color: '#aaa', fontSize: 16 },
  castRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  castChip: { backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: '#2a2a44', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  castChipText: { color: '#8888ff', fontSize: 13 },
});
