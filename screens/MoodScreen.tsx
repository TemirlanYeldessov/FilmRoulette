import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useAppContext } from '../store/AppContext';
import PosterCard from '../components/PosterCard';
import { MovieCardSkeleton } from '../components/Skeleton';
import { itemToMovie } from '../utils/tmdb';
import {
  askAI,
  parseDirectIntent,
  isFreshnessQuery,
  isLikelyTitleMatch,
  isAdultQuery,
  adultSearchTerms,
  friendlyAiError,
  type AiTitle,
} from '../utils/aiSearch';
import { TmdbFeed } from '../utils/tmdbFeed';
import { logError } from '../utils/logger';
import { makeTmdbFetch } from '../utils/api';
import { tmdbUrls, tmdbHeaders } from '../utils/tmdbApi';
import { useGridColumns } from '../utils/useGridColumns';
import { tapMedium } from '../utils/haptics';
import { colors, gradients, radii, shadow } from '../constants/theme';

const RESOLVE_CONCURRENCY = 6;
// How many AI titles to resolve against TMDB per page. The first page fills the
// initial screen; the rest resolve on scroll so a 50-title pick doesn't fire 50
// TMDB searches up front when the user may only look at the first few.
const RESOLVE_BATCH = 12;
// Coalesce streaming result updates to at most one per this interval. Workers
// resolve titles faster than the grid needs to repaint; without this each batch
// fired up to RESOLVE_BATCH full-list setStates, janking the grid on slow phones.
const RESULTS_FLUSH_MS = 250;
const SKELETON_KEYS = [0, 1, 2, 3, 4, 5];

const ALL_SUGGESTIONS = [
  'Молодёжные комедии с пляжем и тусовками',
  'Грустный фильм чтобы поплакать',
  'Что-то напряжённое и непредсказуемое',
  'Лёгкий сериал чтобы фоном смотреть',
  'Что-то про космос или будущее',
  'Классика которую все видели кроме меня',
  'Криминальная драма как Breaking Bad',
  'Романтика с хэппи эндом',
  'Ужасы которые реально пугают',
  'Смешной сериал для вечера с друзьями',
  'Что-то вдохновляющее про спорт',
  'Исторический фильм про войну',
  'Аниме с глубоким сюжетом',
  'Детектив где надо думать',
  'Что-то про путешествия и приключения',
  'Фэнтези как Игра Престолов',
  'Документалка про природу или животных',
  'Триллер где не знаешь чем закончится',
  'Семейный фильм на вечер',
  'Биография реального человека',
  'Мафия и организованная преступность',
  'Постапокалипсис или выживание',
  'Психологический триллер',
  'Супергерои и комиксы',
  'Романтическая комедия',
  'Фантастика про искусственный интеллект',
  'Что-то как Stranger Things',
  'Корейская дорама',
  'Фильм про месть',
  'Сериал про врачей или полицейских',
];

function getRandomSuggestions(count = 6) {
  return [...ALL_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, count);
}

const fetchWithTimeout = makeTmdbFetch({
  notOk: 'TMDB временно не отвечает. Попробуй ещё раз.',
  timeout: 'Превышено время ожидания. Проверь интернет.',
});

function getItemYear(item: any) {
  const d = item?.release_date || item?.first_air_date || '';
  const y = parseInt(String(d).slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

const SORT_OPTIONS = [
  { key: 'relevance', label: 'Релевантность', icon: 'sparkles-outline' },
  { key: 'rating', label: 'Рейтинг', icon: 'star-outline' },
  { key: 'year', label: 'Год', icon: 'calendar-outline' },
  { key: 'popularity', label: 'Популярность', icon: 'flame-outline' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['key'];

const QUICK_REFINES = [
  { label: 'Свежее', suffix: 'Покажи более свежие варианты, без старых тайтлов.' },
  { label: 'Только фильмы', suffix: 'Оставь только фильмы.' },
  { label: 'Только сериалы', suffix: 'Оставь только сериалы.' },
  { label: 'Легче', suffix: 'Сделай подборку легче, добрее и проще для вечернего просмотра.' },
  { label: 'Мрачнее', suffix: 'Сделай подборку более мрачной, напряженной и атмосферной.' },
  { label: 'Популярнее', suffix: 'Сделай подборку из более известных и популярных тайтлов.' },
] as const;

// Resolve one AI-suggested title against TMDB search. Accepts only a genuine
// title match (never "any popular result") so an AI hallucination or near-miss
// can't surface as the wrong real movie. When the AI gave a year, prefer the
// candidate whose release year matches (±1) — this disambiguates remakes and
// same-named titles; otherwise the most relevant match wins.
async function searchTitle(
  entry: AiTitle,
  adultContent: boolean,
  mediaTypeFilter: string,
  signal?: AbortSignal,
) {
  const res = await fetchWithTimeout(
    tmdbUrls.searchMulti(entry.title, adultContent),
    { headers: tmdbHeaders(), signal }
  );
  const data = await res.json();

  const results = (data.results || []).filter((m: any) => {
    if (!m.poster_path) return false;
    if (mediaTypeFilter === 'movie') return m.media_type === 'movie';
    if (mediaTypeFilter === 'tv') return m.media_type === 'tv';
    return m.media_type === 'movie' || m.media_type === 'tv';
  });

  const matches = results.filter((item: any) => isLikelyTitleMatch(entry.title, item));
  if (matches.length === 0) return null;
  if (entry.year) {
    const byYear = matches.find((item: any) => Math.abs(getItemYear(item) - entry.year!) <= 1);
    if (byYear) return byYear;
  }
  return matches[0];
}

// Parse + GET one TMDB endpoint, bound to the screen's timeout/error wording.
const fetchJson = (url: string, signal?: AbortSignal) =>
  fetchWithTimeout(url, { headers: tmdbHeaders(), signal }).then(res => res.json());

// Build a paginated TMDB feed for queries that don't need the LLM:
//   • 18+ on + adult intent → /search/multi over the adult terms (studios for a
//     generic "porn" ask), so the grid streams real adult releases lazily.
//   • structured query (новинки / жанр / "лучшие") → a single /discover feed.
// Returns null for everything nuanced, which then flows through the AI path.
function buildDirectFeed(query: string, adultContent: boolean): TmdbFeed | null {
  if (adultContent && isAdultQuery(query)) {
    return new TmdbFeed(
      adultSearchTerms(query).map(term => ({
        makeUrl: (page: number) => tmdbUrls.searchMulti(term, true, page),
      }))
    );
  }
  const intent = parseDirectIntent(query, adultContent);
  if (intent) {
    return new TmdbFeed([{
      makeUrl: (page: number) => tmdbUrls.discover(intent.type, { ...intent.params, page: String(page) }),
      fixedType: intent.type,
    }]);
  }
  return null;
}

export default function MoodScreen({ navigation }: any) {
  const { adultContent } = useAppContext();
  const { columns, cardWidth } = useGridColumns();
  const [mood, setMood] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [showInput, setShowInput] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [suggestions] = useState(() => getRandomSuggestions(6));
  const [error, setError] = useState('');
  const [processed, setProcessed] = useState(0);
  const [totalTitles, setTotalTitles] = useState(0);
  // Best-effort count of how many titles the active feed has in total (TMDB
  // total_results). Drives the "Найдено: N из M" hint so the user knows more
  // will load on scroll. 0 for the AI path, where the title list is the total.
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>('relevance');
  // Set when a freshness query had to use the offline fallback (no web search),
  // so the user knows the "new releases" may be incomplete/stale.
  const [staleNotice, setStaleNotice] = useState(false);
  // Lazy TMDB resolution of the AI's title list (see RESOLVE_BATCH).
  const [resolvingMore, setResolvingMore] = useState(false);
  const [allResolved, setAllResolved] = useState(false);
  const aiTitlesRef = useRef<AiTitle[]>([]);
  const aiFilterRef = useRef<string>('mixed');
  const slotsRef = useRef<(any | null)[]>([]);
  // Set when the query is served by a paginated TMDB feed (adult search or
  // structured /discover) instead of the AI title path. loadMoreResults pulls
  // the next page from it on scroll.
  const feedRef = useRef<TmdbFeed | null>(null);
  const resolveCursorRef = useRef(0);
  // Titles the user dismissed ("Не подходит"). Tracked in a ref so a later batch
  // resolving to the same film can't quietly bring it back via rebuildResults.
  const hiddenKeysRef = useRef<Set<string>>(new Set());
  // Streaming throttle bookkeeping (see RESULTS_FLUSH_MS). processedCountRef is
  // the running count of attempted titles; lastFlushRef is the last paint time.
  const processedCountRef = useRef(0);
  const lastFlushRef = useRef(0);
  const submitDisabled = !mood.trim() || loading;

  // Keep `results` in the AI's relevance order; derive the displayed order so
  // switching sort never loses the original ranking ('relevance' returns it).
  // While results are still streaming in, hold the relevance order so cards
  // don't reshuffle on every arrival (which makes them jump under the finger);
  // the chosen sort is applied once the batch settles.
  const sortedResults = useMemo(() => {
    if (sortBy === 'relevance' || loading) return results;
    const arr = [...results];
    if (sortBy === 'rating') arr.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    else if (sortBy === 'year') arr.sort((a, b) => getItemYear(b) - getItemYear(a));
    else if (sortBy === 'popularity') arr.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return arr;
  }, [results, sortBy, loading]);
  const restartTimerRef = useRef<any>(null);
  const findAbortRef = useRef<AbortController | null>(null);
  // Synchronous mirror of isListening — the 'end' event from native can fire
  // before React commits the setIsListening(false) from stopListening(),
  // so reading state via closure would re-trigger the restart loop.
  const isListeningRef = useRef(false);
  // Text committed so far across recognition segments. Each restart starts a
  // fresh native session whose transcript resets, so we fold finalized segments
  // in here and append the live one — otherwise long dictation overwrites
  // itself and earlier words vanish.
  const baseTranscriptRef = useRef('');

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript || '';
    if (!transcript) return;
    const base = baseTranscriptRef.current;
    const combined = base ? `${base} ${transcript}`.trim() : transcript;
    // Show committed text + the live (interim) segment as it's spoken.
    setMood(combined);
    // Once a segment is finalized, fold it in so the next segment (or a
    // recognizer restart) appends to it instead of replacing everything.
    if (event.isFinal) baseTranscriptRef.current = combined;
  });

  useSpeechRecognitionEvent('end', () => {
    if (!isListeningRef.current) return;
    restartTimerRef.current = setTimeout(() => {
      if (!isListeningRef.current) return;
      ExpoSpeechRecognitionModule.start({
        lang: 'ru-RU',
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
      });
    }, 200);
  });

  useSpeechRecognitionEvent('error', (event) => {
    isListeningRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setIsListening(false);
    // 'aborted' fires on our own stop()/unmount — not worth surfacing. Anything
    // else (no-speech, network, not-allowed) means dictation actually failed, so
    // tell the user instead of the badge just silently vanishing.
    if (event?.error && event.error !== 'aborted') {
      setError('Не удалось распознать речь. Попробуй ещё раз или введи текст.');
    }
  });

  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      findAbortRef.current?.abort();
    };
  }, []);

  const startListening = async () => {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

    if (!result.granted) {
      Alert.alert(
        'Нужен доступ к микрофону',
        'Разреши доступ в настройках, чтобы пользоваться голосовым вводом.',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Настройки', onPress: () => Linking.openSettings().catch(() => {}) },
        ]
      );
      return;
    }

    // Seed the accumulator with whatever's already typed so voice appends to
    // it instead of wiping it.
    baseTranscriptRef.current = mood.trim();
    isListeningRef.current = true;
    setIsListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: 'ru-RU',
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
    });
  };

  const stopListening = () => {
    isListeningRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setIsListening(false);
    ExpoSpeechRecognitionModule.stop();
  };

  // Rebuild a deduped, gap-free list from the resolved slots. Shared by the
  // initial resolve and scroll-driven batches so they refresh results the same way.
  const rebuildResults = () => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const it of slotsRef.current) {
      if (!it) continue;
      const key = `${it.id}-${it.media_type}`;
      if (seen.has(key) || hiddenKeysRef.current.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
  };

  // Push the latest counts + list into state, respecting the streaming throttle
  // unless `force` (the trailing flush after a batch settles, which must be exact).
  const flushStreaming = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlushRef.current < RESULTS_FLUSH_MS) return;
    lastFlushRef.current = now;
    setProcessed(processedCountRef.current);
    setResults(rebuildResults());
  };

  // Resolve the next window of AI titles against TMDB (RESOLVE_BATCH at a time),
  // streaming results in the AI's order as each resolves.
  const resolveNextBatch = async (signal: AbortSignal) => {
    const titles = aiTitlesRef.current;
    const start = resolveCursorRef.current;
    if (start >= titles.length) { setAllResolved(true); return; }
    const end = Math.min(start + RESOLVE_BATCH, titles.length);
    resolveCursorRef.current = end;

    let cursor = start;
    const worker = async () => {
      while (!signal.aborted) {
        const i = cursor++;
        if (i >= end) return;
        try {
          slotsRef.current[i] = await searchTitle(titles[i], adultContent, aiFilterRef.current, signal) || null;
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
          slotsRef.current[i] = null; // one bad title shouldn't kill the batch
        }
        if (!signal.aborted) {
          processedCountRef.current += 1;
          flushStreaming();
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(RESOLVE_CONCURRENCY, end - start) }, worker)
    );
    if (signal.aborted) return;
    flushStreaming(true); // trailing flush — final state must be exact, not throttled away
    if (resolveCursorRef.current >= titles.length) setAllResolved(true);
  };

  const find = async (text: string) => {
    const query = text.trim();
    if (!query) {
      setError('Опиши настроение или выбери идею для поиска.');
      setShowInput(true);
      return;
    }

    if (isListening) stopListening();
    tapMedium();

    findAbortRef.current?.abort();
    const controller = new AbortController();
    findAbortRef.current = controller;
    const { signal } = controller;

    setLoading(true);
    setActiveQuery(query);
    setResults([]);
    setError('');
    setShowInput(false);
    setProcessed(0);
    setTotalTitles(0);
    setTotalAvailable(0);
    setStaleNotice(false);
    setResolvingMore(false);
    setAllResolved(false);
    slotsRef.current = [];
    feedRef.current = null;
    resolveCursorRef.current = 0;
    hiddenKeysRef.current = new Set();
    processedCountRef.current = 0;
    lastFlushRef.current = 0;

    try {
      // Direct path: adult / structured queries are served by a paginated TMDB
      // feed — no slow LLM round-trip, and the full result pool (thousands of
      // titles) streams in lazily on scroll instead of being capped up front.
      const feed = buildDirectFeed(query, adultContent);
      if (feed) {
        feedRef.current = feed;
        // Pull pages until the grid has something to show (or the feed runs
        // dry) — a first page can be all posterless/dupe items.
        let items: any[] = [];
        for (let guard = 0; guard < 5 && items.length === 0 && !feed.exhausted; guard += 1) {
          const fresh = await feed.loadNext(u => fetchJson(u, signal), hiddenKeysRef.current);
          if (signal.aborted) return;
          items = items.concat(fresh);
        }
        if (items.length > 0) {
          setResults(items);
          setTotalTitles(items.length);
          setTotalAvailable(feed.total);
          setProcessed(items.length);
          setAllResolved(feed.exhausted);
          return;
        }
        // Feed produced nothing usable → drop it and fall through to the AI path.
        feedRef.current = null;
      }

      const aiResult = await askAI(query, { signal, adultContent });
      if (signal.aborted) return;

      // Freshness query but the web-search model failed → the offline fallback's
      // "new releases" can't be trusted. Warn instead of silently showing stale data.
      setStaleNotice(!aiResult.webSearch && isFreshnessQuery(query));

      aiTitlesRef.current = aiResult.titles;
      aiFilterRef.current = aiResult.mediaTypeFilter;
      slotsRef.current = new Array(aiResult.titles.length).fill(undefined);
      setTotalTitles(aiResult.titles.length);

      // Resolve the first page now; the rest stream in on scroll. Keep going if
      // an early page yields nothing on TMDB, so the empty state stays honest
      // (don't claim "nothing found" while later titles are still unresolved).
      await resolveNextBatch(signal);
      while (!signal.aborted && rebuildResults().length === 0 && resolveCursorRef.current < aiTitlesRef.current.length) {
        await resolveNextBatch(signal);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      logError(e, { scope: 'mood.find', query });
      setError(friendlyAiError(e));
      setShowInput(true);
    } finally {
      // findAbortRef is intentionally NOT cleared here — scroll-driven batches
      // reuse this signal until the next search / reset / refine aborts it.
      if (!signal.aborted) setLoading(false);
    }
  };

  // Load the next page when the grid nears its end — a feed page for the direct
  // path, or the next batch of AI titles otherwise.
  const loadMoreResults = async () => {
    if (loading || resolvingMore || allResolved) return;
    const controller = findAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    const { signal } = controller;
    setResolvingMore(true);
    try {
      const feed = feedRef.current;
      if (feed) {
        const fresh = await feed.loadNext(u => fetchJson(u, signal), hiddenKeysRef.current);
        if (signal.aborted) return;
        if (fresh.length) setResults(prev => [...prev, ...fresh]);
        if (feed.exhausted) setAllResolved(true);
        return;
      }
      if (resolveCursorRef.current >= aiTitlesRef.current.length) { setAllResolved(true); return; }
      await resolveNextBatch(signal);
    } finally {
      if (!controller.signal.aborted) setResolvingMore(false);
    }
  };

  const openCard = (item: any) => {
    // Navigate with a thin object and let MovieScreen hydrate full details
    // once — avoids the double fetch (here + on the detail screen).
    navigation.navigate('Card', { movie: itemToMovie(item) });
  };

  const hideResult = (item: any) => {
    const key = `${item.id}-${item.media_type}`;
    hiddenKeysRef.current.add(key);
    slotsRef.current = slotsRef.current.map(slot =>
      slot && `${slot.id}-${slot.media_type}` === key ? null : slot
    );
    setResults(prev => prev.filter(it => `${it.id}-${it.media_type}` !== key));
  };

  const applyQuickRefine = (suffix: string) => {
    const base = activeQuery || mood;
    const next = `${base}. ${suffix}`;
    setMood(next);
    find(next);
  };

  const reset = () => {
    findAbortRef.current?.abort();
    hiddenKeysRef.current = new Set();
    feedRef.current = null;
    setShowInput(true);
    setResults([]);
    setMood('');
    setActiveQuery('');
    setError('');
    setResolvingMore(false);
    setAllResolved(false);
  };

  // Back to the input but keep the typed query, so the user can tweak it.
  const refine = () => {
    findAbortRef.current?.abort();
    setLoading(false);
    setShowInput(true);
  };

  if (!showInput) {
    return (
      <LinearGradient colors={gradients.app} style={styles.container}>
        <View style={styles.resultsHeader}>
          <TouchableOpacity onPress={reset} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.accent} />
            <Text style={styles.backBtnText}>Новый запрос</Text>
          </TouchableOpacity>

          {!!activeQuery && (
            <View style={styles.queryBox}>
              <Text style={styles.queryLabel}>По запросу</Text>
              <Text style={styles.queryText} numberOfLines={2}>{activeQuery}</Text>
            </View>
          )}

          {loading ? (
            totalTitles > 0 ? (
              <Text style={styles.countText}>Собираю подборку… {processed} из {totalTitles}</Text>
            ) : null
          ) : (
            <View style={styles.resultActions}>
              <Text style={styles.countText}>
                Найдено: {results.length}
                {!allResolved && totalAvailable > results.length ? ` из ${totalAvailable}` : ''}
              </Text>
              <View style={styles.actionBtns}>
                <TouchableOpacity style={styles.actionBtn} onPress={refine}>
                  <Ionicons name="create-outline" size={15} color={colors.accent} />
                  <Text style={styles.actionBtnText}>Уточнить</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => find(activeQuery || mood)}>
                  <Ionicons name="refresh" size={15} color={colors.accent} />
                  <Text style={styles.actionBtnText}>Пересобрать</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {!loading && !!activeQuery && (
          <View style={styles.quickRefineBar}>
            {QUICK_REFINES.map(refineOption => (
              <TouchableOpacity
                key={refineOption.label}
                style={styles.quickRefineChip}
                onPress={() => applyQuickRefine(refineOption.suffix)}
              >
                <Text style={styles.quickRefineText}>{refineOption.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {staleNotice && (
          <View style={styles.staleNotice}>
            <Ionicons name="warning-outline" size={15} color={colors.warning} />
            <Text style={styles.staleNoticeText}>
              Веб-поиск новинок был недоступен — список мог не попасть в самые свежие релизы. Попробуй «Пересобрать».
            </Text>
          </View>
        )}

        {results.length > 0 && (
          <View style={styles.sortBar}>
            <Text style={styles.sortLabel}>Сортировка:</Text>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.sortChip, sortBy === opt.key && styles.sortChipActive]}
                onPress={() => setSortBy(opt.key)}
              >
                <Ionicons name={opt.icon} size={13} color={sortBy === opt.key ? colors.text : colors.accent} />
                <Text style={[styles.sortChipText, sortBy === opt.key && styles.sortChipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading && results.length === 0 ? (
          <FlatList
            data={SKELETON_KEYS}
            keyExtractor={i => String(i)}
            key={`grid-${columns}`}
            numColumns={columns}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.row}
            ListHeaderComponent={
              <Text style={[styles.loadingText, { paddingHorizontal: 12, paddingBottom: 16 }]}>
                ИИ анализирует запрос и собирает подборку…
              </Text>
            }
            renderItem={() => <MovieCardSkeleton cardWidth={cardWidth} />}
          />
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              data={sortedResults}
              keyExtractor={(item) => `${item.media_type}-${item.id}`}
              key={`grid-${columns}`}
              numColumns={columns}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.row}
              onEndReached={loadMoreResults}
              onEndReachedThreshold={0.5}
              renderItem={({ item }) => (
                <PosterCard item={item} cardWidth={cardWidth} onPress={() => openCard(item)}>
                  {(item.vote_average > 0 || getItemYear(item) > 0) && (
                    <Text style={styles.cardRating}>
                      {item.vote_average > 0 ? `★ ${item.vote_average.toFixed(1)}` : ''}
                      {item.vote_average > 0 && getItemYear(item) > 0 ? '  ·  ' : ''}
                      {getItemYear(item) > 0 ? getItemYear(item) : ''}
                    </Text>
                  )}
                  <TouchableOpacity style={styles.hideResultBtn} onPress={() => hideResult(item)}>
                    <Ionicons name="close-circle-outline" size={13} color={colors.muted2} />
                    <Text style={styles.hideResultText}>Не подходит</Text>
                  </TouchableOpacity>
                </PosterCard>
              )}
              ListEmptyComponent={
                loading ? null : (
                  <View style={styles.emptyBox}>
                    <Ionicons name="search-outline" size={38} color={colors.faint} />
                    <Text style={styles.emptyTitle}>Ничего не нашлось на TMDB</Text>
                    <Text style={styles.emptyHint}>
                      ИИ подобрал тайтлы, но их не удалось найти в базе. Попробуй переформулировать запрос.
                    </Text>
                    <View style={styles.emptyActions}>
                      <TouchableOpacity style={styles.emptyBtn} onPress={refine}>
                        <Ionicons name="create-outline" size={15} color={colors.accent} />
                        <Text style={styles.emptyBtnText}>Уточнить</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.emptyBtn} onPress={() => find(activeQuery || mood)}>
                        <Ionicons name="refresh" size={15} color={colors.accent} />
                        <Text style={styles.emptyBtnText}>Пересобрать</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              }
              ListFooterComponent={
                (loading || resolvingMore) ? (
                  <View style={styles.streamFooter}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.streamFooterText}>Ищу ещё…</Text>
                  </View>
                ) : null
              }
            />
          </View>
        )}
      </LinearGradient>
    );
  }

  return (
      <LinearGradient colors={gradients.app} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <FlatList
          data={suggestions}
          keyExtractor={(s) => s}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.inputArea}>
              <Text style={styles.header}>✨ ИИ-подборщик</Text>

              <View style={styles.aiBadge}>
                <Ionicons name="sparkles" size={12} color={colors.accent} />
                <Text style={styles.aiBadgeText}>Powered by Gemini · веб-поиск</Text>
              </View>

              <Text style={styles.subtitle}>
                Опиши вайб, настроение или конкретный запрос — ИИ подберёт релевантные фильмы и сериалы
              </Text>

              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Например: хочу посмотреть фильм про..."
                  placeholderTextColor={colors.muted2}
                  value={mood}
                  onChangeText={(value) => {
                    setMood(value);
                    if (error) setError('');
                  }}
                  multiline
                  numberOfLines={3}
                />

                <TouchableOpacity
                  style={[styles.micBtn, isListening && styles.micBtnActive]}
                  onPress={isListening ? stopListening : startListening}
                  accessibilityRole="button"
                  accessibilityLabel={isListening ? 'Остановить голосовой ввод' : 'Голосовой ввод запроса'}
                >
                  <Ionicons
                    name={isListening ? 'stop-circle' : 'mic'}
                    size={24}
                    color={isListening ? colors.primary : colors.textSoft}
                  />
                </TouchableOpacity>
              </View>

              {isListening && (
                <View style={styles.listeningBadge}>
                  <View style={styles.listeningDot} />
                  <Text style={styles.listeningText}>Слушаю, говорите...</Text>
                </View>
              )}

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.primary} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.findBtn, submitDisabled && styles.findBtnDisabled]}
                onPress={() => find(mood)}
                disabled={submitDisabled}
              >
                <Ionicons name="sparkles" size={18} color={colors.text} />
                <Text style={styles.findText}>{mood.trim() ? 'Подобрать' : 'Опиши запрос'}</Text>
              </TouchableOpacity>

              <Text style={styles.suggestTitle}>Идеи для поиска:</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chip}
              onPress={() => {
                setMood(item);
                find(item);
              }}
            >
              <Text style={styles.chipText}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inputArea: { padding: 20, paddingTop: 60 },
  header: { fontSize: 29, fontWeight: '900', color: colors.text, marginBottom: 8 },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, alignSelf: 'flex-start', marginBottom: 12 },
  aiBadgeText: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },
  subtitle: { fontSize: 14, color: colors.textSoft, marginBottom: 24, lineHeight: 20 },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  input: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: 16, color: colors.text, fontSize: 15, minHeight: 92, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.borderSoft, ...shadow.card },
  micBtn: { backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft },
  micBtnActive: { backgroundColor: colors.dangerBg, borderColor: colors.primary },
  listeningBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  listeningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  listeningText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerBg, borderRadius: radii.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.primaryDark },
  errorText: { color: colors.primary, fontSize: 13, flex: 1 },
  findBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: radii.pill, marginBottom: 24, marginTop: 8, ...shadow.card },
  findBtnDisabled: { opacity: 0.45 },
  findText: { color: colors.text, fontWeight: '800', fontSize: 16 },
  suggestTitle: { fontSize: 15, color: colors.textSoft, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.pill, marginHorizontal: 20, marginBottom: 10 },
  chipText: { color: colors.textSoft, fontSize: 13, fontWeight: '600' },
  resultsHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  backBtnText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  countText: { color: colors.muted, fontSize: 12, marginTop: 4 },
  resultActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  actionBtns: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill },
  actionBtnText: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },
  queryBox: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 12, marginBottom: 10 },
  queryLabel: { color: colors.muted2, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  queryText: { color: colors.textSoft, fontSize: 13, lineHeight: 18 },
  quickRefineBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  quickRefineChip: { borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill },
  quickRefineText: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },
  staleNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.md, padding: 12, marginHorizontal: 20, marginBottom: 12 },
  staleNoticeText: { color: colors.warning, fontSize: 12, flex: 1, lineHeight: 17 },
  sortBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  sortLabel: { color: colors.muted, fontSize: 12, marginRight: 2 },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.borderSoft, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill },
  sortChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sortChipText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  sortChipTextActive: { color: colors.text },
  emptyBox: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { color: colors.textSoft, fontSize: 16, textAlign: 'center', marginTop: 10, fontWeight: '700' },
  emptyHint: { color: colors.muted2, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  emptyActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.pill },
  emptyBtnText: { color: colors.textSoft, fontSize: 13, fontWeight: '700' },
  streamFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  streamFooterText: { color: colors.muted, fontSize: 13 },
  loadingText: { color: colors.textSoft, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  grid: { padding: 12 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  cardRating: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  hideResultBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 5, paddingVertical: 3 },
  hideResultText: { color: colors.muted2, fontSize: 11, fontWeight: '700' },
});
