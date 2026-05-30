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
import { dedup, itemToMovie, mapBaseDetail } from '../utils/tmdb';
import { makeTmdbFetch } from '../utils/api';
import { getCached, setCached } from '../utils/apiCache';
import { tmdbUrls, tmdbHeaders, pickRandomDiscoverItem } from '../utils/tmdbApi';
import { tapLight, tapMedium } from '../utils/haptics';
import { colors, gradients, radii, shadow } from '../constants/theme';

const relatedPosterWidth = 104;
const DETAIL_TTL = 10 * 60 * 1000;
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
  // Details barely change, so cache them briefly: revisiting a title (back /
  // forward, reroll repeats, "Похожие" round-trips) then reuses this instead of
  // firing the ru+en pair again. genreId/randomNotice are added by callers via
  // spread, so the cached base object is never mutated.
  const cacheKey = `detail:${type}:${id}`;
  const cached = getCached(cacheKey, DETAIL_TTL);
  if (cached) return cached;

  const extra = type === 'movie' ? 'release_dates' : 'content_ratings';
  const [ruRes, enRes] = await Promise.all([
    fetchWithTimeout(
      tmdbUrls.detail(type, id, 'ru-RU', `credits,external_ids,watch/providers,recommendations,similar,videos,${extra}`),
      { headers: tmdbHeaders(), signal }
    ),
    fetchWithTimeout(tmdbUrls.detail(type, id, 'en-US', 'videos'), { headers: tmdbHeaders(), signal }),
  ]);

  const ruData = await ruRes.json();
  const enData = await enRes.json();
  const recSource = ruData.recommendations?.results?.length
    ? ruData.recommendations.results
    : ruData.similar?.results;
  const recommendations = normalizeRelated(recSource, type);
  const recommendationsTotalPages = ruData.recommendations?.total_pages || 1;

  const result = {
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
  setCached(cacheKey, result);
  return result;
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
  const picked = await pickRandomDiscoverItem(fetchWithTimeout, {
    type, selectedGenres, adultContent, filters, recentRandomIds, signal,
  });
  if (!picked) throw new Error('Все свежие варианты уже попадались. Попробуй другой жанр или фильтр.');
  const details = await fetchFullDetails(picked.item.id, type, signal);
  return {
    ...details,
    genreId: picked.genres[0] ?? 0,
    selectedGenres: picked.genres,
    preciseFilters: filters,
    mediaType,
    randomNotice: picked.reused ? RANDOM_REUSE_NOTICE : null,
  };
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
  // Cast is capped to keep the first paint light; the user can reveal the rest.
  const [castExpanded, setCastExpanded] = useState(false);
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
  const CAST_PREVIEW = 12;
  const fullCast = movie.cast || [];
  const visibleCast = castExpanded ? fullCast : fullCast.slice(0, CAST_PREVIEW);

  // Initialize related items when the movie changes OR when recommendations
  // arrive via hydration. Depending on movie.id alone misses the hydrate case:
  // a card opened "thin" (catalog/AI/search) keeps the same id while details
  // load, so "Похожие" would never populate on first open — only on reroll.
  useEffect(() => {
    const recs = movie.recommendations || [];
    setRelatedItems(recs);
    setRelatedPage(1);
    setRelatedHasMore((movie.recommendationsTotalPages || 1) > 1);
  }, [movie.id, movie.recommendations, movie.recommendationsTotalPages]);

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
  }, [movie.cast, movie.id, movie.mediaType, movie.providers, movie.recommendations]);

  const loadMoreRelated = async () => {
    if (relatedLoadingMore || !relatedHasMore || !movie.id) return;
    relatedAbortRef.current?.abort();
    const controller = new AbortController();
    relatedAbortRef.current = controller;
    setRelatedLoadingMore(true);
    try {
      const nextPage = relatedPage + 1;
      const res = await fetchWithTimeout(
        tmdbUrls.recommendations(movie.mediaType, movie.id, nextPage),
        { headers: tmdbHeaders(), signal: controller.signal }
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
    tapLight();
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
    tapMedium();
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
      <LinearGradient colors={gradients.app} style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={20} color={colors.textSoft} />
            <Text style={styles.backText}>Назад</Text>
          </TouchableOpacity>
          <MovieDetailSkeleton />
        </ScrollView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={gradients.app} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={20} color={colors.textSoft} />
            <Text style={styles.backText}>Назад</Text>
          </TouchableOpacity>
          <View style={styles.topActions}>
            {canLoadRandom && (
              <TouchableOpacity
                style={[styles.iconBtn, styles.rerollBtn, loadingNext && styles.iconBtnDisabled]}
                onPress={loadNext}
                disabled={loadingNext}
                accessibilityRole="button"
                accessibilityLabel="Показать другой случайный тайтл"
              >
                <Ionicons name="shuffle" size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
            {movie.id && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={handleShare}
                accessibilityRole="button"
                accessibilityLabel="Поделиться"
              >
                <Ionicons name="share-outline" size={20} color={colors.textSoft} />
              </TouchableOpacity>
            )}
            {movie.id && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={toggleWatchlist}
                accessibilityRole="button"
                accessibilityLabel={inWatchlist ? 'Убрать из избранного' : 'Добавить в избранное'}
              >
                <Ionicons name={inWatchlist ? 'heart' : 'heart-outline'} size={20} color={inWatchlist ? colors.primary : colors.textSoft} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {movie.poster ? (
          <Image source={{ uri: movie.poster }} style={styles.poster} contentFit="cover" transition={300} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.poster, styles.posterFallback]}>
            <Ionicons name="image-outline" size={42} color={colors.faint} />
          </View>
        )}

        <Text style={styles.title}>{displayTitle}</Text>

        <View style={styles.metaRow}>
          {movie.rating && (
            <View style={styles.badge}>
              <Ionicons name="star" size={12} color={colors.warning} />
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
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.inlineLoadingText}>Загружаем детали...</Text>
          </View>
        )}

        <Text style={styles.overview}>{movie.overview || 'Описание пока недоступно.'}</Text>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.quickAction, inWatchlist && styles.quickActionActive]}
            onPress={toggleWatchlist}
          >
            <Ionicons
              name={inWatchlist ? 'heart' : 'heart-outline'}
              size={16}
              color={inWatchlist ? colors.text : colors.accent}
            />
            <Text style={[styles.quickActionText, inWatchlist && styles.quickActionTextActive]}>
              {inWatchlist ? 'В избранном' : 'В избранное'}
            </Text>
          </TouchableOpacity>

          {movie.trailerKey ? (
            <TouchableOpacity style={[styles.quickAction, styles.quickActionPrimary]} onPress={() => setShowTrailer(true)}>
              <Ionicons name="play-circle" size={16} color={colors.text} />
              <Text style={styles.quickActionTextActive}>Трейлер</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.quickAction, styles.quickActionDisabled]}>
              <Ionicons name="videocam-off-outline" size={16} color={colors.faint} />
              <Text style={styles.quickActionDisabledText}>Нет трейлера</Text>
            </View>
          )}

          <TouchableOpacity style={styles.quickAction} onPress={() => setShowOnline(true)}>
            <Ionicons name="globe-outline" size={16} color={colors.accent} />
            <Text style={styles.quickActionText}>Где смотреть</Text>
          </TouchableOpacity>
        </View>

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
                    tapLight();
                    if (active) clearUserStatus(movie.id, movie.mediaType);
                    else setUserStatus(movie, status.key);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={status.label}
                >
                  <Ionicons name={status.icon} size={14} color={active ? colors.text : colors.muted2} />
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

        {visibleCast.length > 0 && (
          <View style={styles.infoBlock}>
            <Text style={styles.blockTitle}>Актеры</Text>
            <View style={styles.castRow}>
              {visibleCast.map((p: any) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.castChip}
                  onPress={() => navigation.push('Actor', { personId: p.id, name: p.name })}
                >
                  <Text style={styles.castChipText}>{p.name}</Text>
                </TouchableOpacity>
              ))}
              {!castExpanded && fullCast.length > visibleCast.length && (
                <TouchableOpacity
                  style={styles.castMoreChip}
                  onPress={() => setCastExpanded(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Показать всех актёров, ещё ${fullCast.length - visibleCast.length}`}
                >
                  <Text style={styles.castMoreText}>+{fullCast.length - visibleCast.length}</Text>
                </TouchableOpacity>
              )}
              {castExpanded && fullCast.length > CAST_PREVIEW && (
                <TouchableOpacity
                  style={styles.castMoreChip}
                  onPress={() => setCastExpanded(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Свернуть список актёров"
                >
                  <Text style={styles.castMoreText}>Свернуть</Text>
                </TouchableOpacity>
              )}
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
              <Ionicons name="close-circle" size={20} color={colors.textSoft} />
              <Text style={styles.closeVideoText}>Закрыть трейлер</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.youtubeFallback} onPress={openTrailerInYouTube}>
              <Ionicons name="logo-youtube" size={18} color={colors.primary} />
              <Text style={styles.youtubeFallbackText}>Открыть на YouTube</Text>
            </TouchableOpacity>
          </View>
        )}

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
                    <ActivityIndicator size="small" color={colors.faint} />
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
              <Ionicons name="shuffle" size={20} color={colors.primary} />
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
                  <Ionicons name={source.icon as any} size={22} color={colors.primary} />
                </View>
                <View style={styles.sourceInfo}>
                  <Text style={styles.sourceName}>{source.name}</Text>
                  <Text style={styles.sourceHint}>Открыть и найти</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
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
  backText: { color: colors.textSoft, fontSize: 14, fontWeight: '700' },
  topActions: { flexDirection: 'row', gap: 8 },
  iconBtn: { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft },
  rerollBtn: { borderColor: colors.primary },
  iconBtnDisabled: { opacity: 0.4 },
  poster: { width: 220, height: 330, borderRadius: radii.lg, marginBottom: 24, backgroundColor: colors.surface, ...shadow.card },
  posterFallback: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: colors.text, textAlign: 'center', marginBottom: 12 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceElevated, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderSoft },
  badgeText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  genres: { color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: 16 },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  inlineLoadingText: { color: colors.muted2, fontSize: 13 },
  overview: { fontSize: 14, color: colors.textSoft, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  quickActions: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 },
  quickAction: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.pill },
  quickActionPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickActionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickActionDisabled: { backgroundColor: colors.surface, borderColor: colors.borderSoft },
  quickActionText: { color: colors.textSoft, fontSize: 13, fontWeight: '800' },
  quickActionTextActive: { color: colors.text, fontSize: 13, fontWeight: '800' },
  quickActionDisabledText: { color: colors.muted2, fontSize: 13, fontWeight: '700' },
  statusBlock: { width: '100%', marginBottom: 20 },
  blockTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface },
  statusChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  statusText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  statusTextActive: { color: colors.text },
  infoBlock: { width: '100%', backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.borderSoft },
  infoText: { color: colors.textSoft, fontSize: 14, lineHeight: 20 },
  noticeBox: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 14, marginBottom: 16, width: '100%' },
  noticeText: { color: colors.textSoft, fontSize: 13, textAlign: 'center' },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radii.md, padding: 16, marginBottom: 16, alignItems: 'center', width: '100%', borderWidth: 1, borderColor: colors.primaryDark },
  errorText: { color: colors.primary, fontSize: 14, textAlign: 'center', marginBottom: 8 },
  retryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  videoContainer: { marginBottom: 16, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.bgSoft },
  closeVideo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  closeVideoText: { color: colors.textSoft, fontSize: 13 },
  youtubeFallback: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  youtubeFallbackText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  relatedBlock: { width: '100%', marginBottom: 16 },
  relatedCard: { width: relatedPosterWidth, marginRight: 10 },
  relatedPoster: { width: relatedPosterWidth, height: relatedPosterWidth * 1.5, borderRadius: radii.md, marginBottom: 6, backgroundColor: colors.surface },
  relatedTitle: { color: colors.textSoft, fontSize: 11, textAlign: 'center', fontWeight: '600' },
  relatedLoadingWrap: { width: relatedPosterWidth, alignItems: 'center', justifyContent: 'center' },
  loadingNext: { paddingVertical: 16, alignItems: 'center' },
  loadingNextText: { color: colors.textSoft, fontSize: 14 },
  randomBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: radii.pill, marginTop: 8 },
  randomText: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surfaceElevated, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, paddingBottom: 40, maxHeight: '88%', borderWidth: 1, borderColor: colors.border },
  sheetHandle: { width: 40, height: 4, backgroundColor: colors.faint, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: colors.text, marginBottom: 4 },
  sheetSubtitle: { fontSize: 13, color: colors.textSoft, marginBottom: 16 },
  providerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  providerItem: { width: 70, alignItems: 'center' },
  providerLogo: { width: 44, height: 44, borderRadius: radii.md, marginBottom: 5 },
  providerName: { color: colors.textSoft, fontSize: 10, textAlign: 'center' },
  sourceBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgSoft, borderRadius: radii.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.borderSoft },
  sourceIconWrap: { width: 44, height: 44, backgroundColor: colors.surfaceElevated, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  sourceInfo: { flex: 1 },
  sourceName: { color: colors.text, fontWeight: '800', fontSize: 16 },
  sourceHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  cancelBtn: { alignItems: 'center', marginTop: 8, paddingVertical: 14 },
  cancelText: { color: colors.textSoft, fontSize: 16 },
  castRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  castChip: { backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  castChipText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  castMoreChip: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  castMoreText: { color: colors.muted, fontSize: 13, fontWeight: '800' },
});
