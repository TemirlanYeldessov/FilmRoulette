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
  useWindowDimensions,
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
import { GEMINI_KEY } from '../constants/api';
import { askGemini } from '../utils/gemini';
import { makeTmdbFetch } from '../utils/api';
import { tmdbUrls, tmdbHeaders } from '../utils/tmdbApi';

const RESOLVE_CONCURRENCY = 6;
// How many AI titles to resolve against TMDB per page. The first page fills the
// initial screen; the rest resolve on scroll so a 50-title pick doesn't fire 50
// TMDB searches up front when the user may only look at the first few.
const RESOLVE_BATCH = 12;
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

// Extract the first complete top-level JSON object from arbitrary text.
// Tolerates markdown fences, leading prose, and trailing junk by tracking
// brace depth and skipping characters inside string literals.
function extractJsonObject(raw: string): string | null {
  const stripped = raw.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1');
  const text = stripped.trim();
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

type GeminiResult = {
  mediaTypeFilter: 'movie' | 'tv' | 'mixed';
  titles: string[];
  // True when the answer came from a web-search-capable model (Compound).
  // False when we fell back to the offline model, whose knowledge may be stale.
  webSearch: boolean;
};

// Rough detector for "freshness" intent (a year or new-release wording). Used
// only to decide whether to warn the user when the offline fallback ran — so a
// false positive just shows an extra hint, never blocks anything.
function isFreshnessQuery(mood: string) {
  const t = mood.toLowerCase();
  return /\b20[2-9]\d\b/.test(t) ||
    /новинк|новое|новые|свеж|последн|недавн|вышл|recent|latest|\bnew\b/.test(t);
}

function normalizeGeminiResult(parsed: any): GeminiResult {
  const rawFilter = String(parsed?.mediaTypeFilter ?? '').toLowerCase().trim();
  const mediaTypeFilter: GeminiResult['mediaTypeFilter'] =
    rawFilter === 'movie' || rawFilter === 'tv' ? rawFilter : 'mixed';
  const titles = Array.isArray(parsed?.titles)
    ? parsed.titles.filter((t: any): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  if (titles.length === 0) {
    throw new Error('ИИ не вернул ни одного названия. Попробуй переформулировать запрос.');
  }
  return { mediaTypeFilter, titles, webSearch: false };
}

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

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яё]+/gi, '');
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function isLikelyTitleMatch(query: string, item: any) {
  const normalizedQuery = normalizeTitle(query);
  const candidates = [item.title, item.name, item.original_title, item.original_name]
    .filter(Boolean)
    .map((title: string) => normalizeTitle(title));
  if (!normalizedQuery || candidates.length === 0) return false;
  return candidates.some((candidate: string) => {
    if (!candidate) return false;
    return candidate.includes(normalizedQuery) ||
      normalizedQuery.includes(candidate) ||
      levenshtein(candidate, normalizedQuery) <= 3;
  });
}

function buildAiPrompt(mood: string) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentYear = now.getFullYear();
  return `Ты эксперт по кино и сериалам. Сегодня: ${today} (текущий год — ${currentYear}).
Запрос пользователя: "${mood}".

Сначала пойми НАМЕРЕНИЕ по смыслу, а не по простому совпадению слов. Учитывай отрицания ("не хочу новое", "только не старьё", "надоели новинки") — они меняют смысл на противоположный. Слова-подсказки ниже — лишь ориентир, а не триггеры.

ШАГ 1 — Тип контента (mediaTypeFilter):
- Просит фильм/кино/movie → "movie" (только фильмы)
- Просит сериал/шоу/сезоны/series → "tv" (только сериалы)
- Тип не важен или не назван → "mixed" (и фильмы, и сериалы)

ШАГ 2 — Период:
- НОВИНКИ — хочет свежее/недавнее или назвал конкретный год (${currentYear}, ${currentYear - 1}…). ОБЯЗАТЕЛЬНО найди реальные релизы ВЕБ-ПОИСКОМ (память может устареть). Включай ТОЛЬКО этот период (назван год — строго он; "новинки" без года — ${currentYear} и конец ${currentYear - 1}). Без старья и без "разнообразия годов". Мало релизов — верни сколько есть.
- КЛАССИКА/СТАРОЕ — хочет старое/классику/ретро. Признанные старые тайтлы по вайбу; знаковая "современная классика" тоже допустима — классика не обязана быть только очень старой.
- КОНКРЕТНЫЙ ДИАПАЗОН — назвал десятилетие или промежуток (90-е, 2000-е, "2010–2015"). Только тайтлы из этого диапазона.
- ЗА ВСЕ ВРЕМЕНА (по умолчанию для общего/вайбового запроса) — и старое, и новое, максимум разнообразия по годам. ОБЯЗАТЕЛЬНО добавь и подходящие по вайбу свежие релизы ${currentYear}/${currentYear - 1} (через веб-поиск, число не ограничивай), чтобы были и новинки, а не только старое.

ШАГ 3 — Что подбирать:
- Назван конкретный фильм/сериал, франшиза/сага, режиссёр или актёр → выдай связанное с ним (части франшизы, фильмографию, близкое по стилю и духу). Это важнее абстрактного вайба.
- Описан вайб/настроение/жанр/сюжет → подбирай по атмосфере и элементам, что упомянул пользователь.

При конфликте сигналов приоритет у более конкретного и явного условия (явный год важнее общего вайба).

Объём — под запрос: узкий/конкретный (один фильм, франшиза) → несколько точных, не раздувай; широкий → много (ориентир 50-60, можно больше). Релевантность важнее числа.

Правила:
- Соблюдай mediaTypeFilter и период строго.
- Только реально существующие тайтлы; сомневаешься, что существует — не включай.
- Без повторов, только уникальные.
- Расположи по убыванию релевантности — самые точные совпадения первыми.

Ответь СТРОГО одним JSON-объектом, без markdown и без любого текста до или после него:
{
  "mediaTypeFilter": "movie" | "tv" | "mixed",
  "titles": ["English Title 1", "English Title 2", ...]
}
Названия — международные английские (под которыми тайтл есть в TMDB/IMDb).`;
}

// Prefer Gemini — an agentic system with built-in web search, so it
// knows fresh releases the offline model can't. Fall back to the plain Llama
// model if web-capable Gemini is unavailable, rate-limited, or returns garbled JSON.
async function askAI(mood: string, signal?: AbortSignal): Promise<GeminiResult> {
  try {
    // Prefer web-capable models when available; primary choice is Gemini.
    const r = await askGemini(mood, 'gemini-2.5-flash');
    // askGemini should return an object or text; parse JSON if needed below.
    const jsonText = extractJsonObject(typeof r === 'string' ? r : (r.text || ''));
    if (!jsonText) throw new Error('Не удалось распознать ответ ИИ. Попробуй ещё раз.');
    const parsed = JSON.parse(jsonText);
    return { ...normalizeGeminiResult(parsed), webSearch: true };
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    // Fallback: try the same Gemini model (may be offline), mark webSearch accordingly.
    const r = await askGemini(mood, 'gemini-2.5-flash');
    const jsonText = extractJsonObject(typeof r === 'string' ? r : (r.text || ''));
    if (!jsonText) throw e;
    const parsed = JSON.parse(jsonText);
    return { ...normalizeGeminiResult(parsed), webSearch: false };
  }
}

// askGemini is delegated to `utils/gemini.ts` which calls a native bridge
// implemented with the official SDK (com.google.ai.client.generativeai).

async function searchTitle(title: string, adultContent: boolean, mediaTypeFilter: string, signal?: AbortSignal) {
  const res = await fetchWithTimeout(
    tmdbUrls.searchMulti(title, adultContent),
    { headers: tmdbHeaders(), signal }
  );
  const data = await res.json();

  const results = (data.results || []).filter((m: any) => {
    if (!m.poster_path) return false;
    if (mediaTypeFilter === 'movie') return m.media_type === 'movie';
    if (mediaTypeFilter === 'tv') return m.media_type === 'tv';
    return m.media_type === 'movie' || m.media_type === 'tv';
  });

  // Only accept a genuine title match. Previously we fell back to "any popular
  // result", which turned AI hallucinations (or near-miss titles) into the
  // wrong real movie. Better to drop a title than to show an unrelated one.
  return results.find((item: any) => isLikelyTitleMatch(title, item)) || null;
}

export default function MoodScreen({ navigation }: any) {
  const { adultContent } = useAppContext();
  const { width } = useWindowDimensions();
  const cardWidth = useMemo(() => (width - 48) / 2, [width]);
  const [mood, setMood] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [showInput, setShowInput] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [suggestions] = useState(() => getRandomSuggestions(6));
  const [error, setError] = useState('');
  const [processed, setProcessed] = useState(0);
  const [totalTitles, setTotalTitles] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>('relevance');
  // Set when a freshness query had to use the offline fallback (no web search),
  // so the user knows the "new releases" may be incomplete/stale.
  const [staleNotice, setStaleNotice] = useState(false);
  // Lazy TMDB resolution of the AI's title list (see RESOLVE_BATCH).
  const [resolvingMore, setResolvingMore] = useState(false);
  const [allResolved, setAllResolved] = useState(false);
  const aiTitlesRef = useRef<string[]>([]);
  const aiFilterRef = useRef<string>('mixed');
  const slotsRef = useRef<(any | null)[]>([]);
  const resolveCursorRef = useRef(0);

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

  useSpeechRecognitionEvent('error', () => {
    isListeningRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setIsListening(false);
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
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
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
          setProcessed(p => p + 1);
          setResults(rebuildResults());
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(RESOLVE_CONCURRENCY, end - start) }, worker)
    );
    if (signal.aborted) return;
    setResults(rebuildResults());
    if (resolveCursorRef.current >= titles.length) setAllResolved(true);
  };

  const find = async (text: string) => {
    if (!text.trim()) return;

    if (isListening) stopListening();

    findAbortRef.current?.abort();
    const controller = new AbortController();
    findAbortRef.current = controller;
    const { signal } = controller;

    setLoading(true);
    setResults([]);
    setError('');
    setShowInput(false);
    setProcessed(0);
    setTotalTitles(0);
    setStaleNotice(false);
    setResolvingMore(false);
    setAllResolved(false);
    slotsRef.current = [];
    resolveCursorRef.current = 0;

    try {
      const aiResult = await askAI(text, signal);
      if (signal.aborted) return;

      // Freshness query but the web-search model failed → the offline fallback's
      // "new releases" can't be trusted. Warn instead of silently showing stale data.
      setStaleNotice(!aiResult.webSearch && isFreshnessQuery(text));

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
      console.error(e);
      setError(e?.message || 'Не удалось получить подборку. Попробуй ещё раз.');
      setShowInput(true);
    } finally {
      // findAbortRef is intentionally NOT cleared here — scroll-driven batches
      // reuse this signal until the next search / reset / refine aborts it.
      if (!signal.aborted) setLoading(false);
    }
  };

  // Resolve the next page when the grid nears its end.
  const loadMoreResults = async () => {
    if (loading || resolvingMore || allResolved) return;
    const controller = findAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    if (resolveCursorRef.current >= aiTitlesRef.current.length) { setAllResolved(true); return; }
    setResolvingMore(true);
    try {
      await resolveNextBatch(controller.signal);
    } finally {
      if (!controller.signal.aborted) setResolvingMore(false);
    }
  };

  const openCard = (item: any) => {
    // Navigate with a thin object and let MovieScreen hydrate full details
    // once — avoids the double fetch (here + on the detail screen).
    navigation.navigate('Card', { movie: itemToMovie(item) });
  };

  const reset = () => {
    findAbortRef.current?.abort();
    setShowInput(true);
    setResults([]);
    setMood('');
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
      <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
        <View style={styles.resultsHeader}>
          <TouchableOpacity onPress={reset} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color="#8888ff" />
            <Text style={styles.backBtnText}>Новый запрос</Text>
          </TouchableOpacity>

          {loading ? (
            totalTitles > 0 ? (
              <Text style={styles.countText}>Собираю подборку… {processed} из {totalTitles}</Text>
            ) : null
          ) : (
            <View style={styles.resultActions}>
              <Text style={styles.countText}>Найдено: {results.length}</Text>
              <View style={styles.actionBtns}>
                <TouchableOpacity style={styles.actionBtn} onPress={refine}>
                  <Ionicons name="create-outline" size={15} color="#8888ff" />
                  <Text style={styles.actionBtnText}>Уточнить</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => find(mood)}>
                  <Ionicons name="refresh" size={15} color="#8888ff" />
                  <Text style={styles.actionBtnText}>Ещё варианты</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {staleNotice && (
          <View style={styles.staleNotice}>
            <Ionicons name="warning-outline" size={15} color="#e0a030" />
            <Text style={styles.staleNoticeText}>
              Веб-поиск новинок был недоступен — список мог не попасть в самые свежие релизы. Попробуй «Ещё варианты».
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
                <Ionicons name={opt.icon} size={13} color={sortBy === opt.key ? '#fff' : '#8888ff'} />
                <Text style={[styles.sortChipText, sortBy === opt.key && styles.sortChipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading && results.length === 0 ? (
          <FlatList
            data={SKELETON_KEYS}
            keyExtractor={i => String(i)}
            numColumns={2}
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
              numColumns={2}
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
                </PosterCard>
              )}
              ListEmptyComponent={
                loading ? null : (
                  <View style={styles.emptyBox}>
                    <Ionicons name="search-outline" size={38} color="#555" />
                    <Text style={styles.emptyTitle}>Ничего не нашлось на TMDB</Text>
                    <Text style={styles.emptyHint}>
                      ИИ подобрал тайтлы, но их не удалось найти в базе. Попробуй переформулировать запрос.
                    </Text>
                    <View style={styles.emptyActions}>
                      <TouchableOpacity style={styles.emptyBtn} onPress={refine}>
                        <Ionicons name="create-outline" size={15} color="#8888ff" />
                        <Text style={styles.emptyBtnText}>Уточнить</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.emptyBtn} onPress={() => find(mood)}>
                        <Ionicons name="refresh" size={15} color="#8888ff" />
                        <Text style={styles.emptyBtnText}>Ещё варианты</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              }
              ListFooterComponent={
                (loading || resolvingMore) ? (
                  <View style={styles.streamFooter}>
                    <ActivityIndicator size="small" color="#e50914" />
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
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <FlatList
          data={suggestions}
          keyExtractor={(s) => s}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.inputArea}>
              <Text style={styles.header}>✨ ИИ-подборщик</Text>

              <View style={styles.aiBadge}>
                <Ionicons name="sparkles" size={12} color="#8888ff" />
                <Text style={styles.aiBadgeText}>Powered by Gemini · веб-поиск</Text>
              </View>

              <Text style={styles.subtitle}>
                Опиши вайб, настроение или конкретный запрос — ИИ подберёт релевантные фильмы и сериалы
              </Text>

              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Например: хочу посмотреть фильм про..."
                  placeholderTextColor="#777"
                  value={mood}
                  onChangeText={setMood}
                  multiline
                  numberOfLines={3}
                />

                <TouchableOpacity
                  style={[styles.micBtn, isListening && styles.micBtnActive]}
                  onPress={isListening ? stopListening : startListening}
                >
                  <Ionicons
                    name={isListening ? 'stop-circle' : 'mic'}
                    size={24}
                    color={isListening ? '#e50914' : '#aaa'}
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
                  <Ionicons name="alert-circle-outline" size={16} color="#e50914" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity style={styles.findBtn} onPress={() => find(mood)}>
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={styles.findText}>Подобрать</Text>
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
  header: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a1a40', borderWidth: 1, borderColor: '#4444aa', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 12 },
  aiBadgeText: { color: '#8888ff', fontSize: 12, fontWeight: '600' },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 24, lineHeight: 20 },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  input: { flex: 1, backgroundColor: '#1e1e30', borderRadius: 16, padding: 16, color: '#fff', fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  micBtn: { backgroundColor: '#1e1e30', borderRadius: 16, width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333' },
  micBtnActive: { backgroundColor: '#1a0505', borderColor: '#e50914' },
  listeningBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  listeningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e50914' },
  listeningText: { color: '#e50914', fontSize: 13, fontWeight: '600' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2a0a0a', borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: '#e50914', fontSize: 13, flex: 1 },
  findBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#e50914', paddingVertical: 16, borderRadius: 30, marginBottom: 24, marginTop: 8 },
  findText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  suggestTitle: { fontSize: 15, color: '#aaa', marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: '#333', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, marginHorizontal: 20, marginBottom: 10 },
  chipText: { color: '#ccc', fontSize: 13 },
  resultsHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  backBtnText: { color: '#8888ff', fontSize: 14 },
  countText: { color: '#888', fontSize: 12, marginTop: 4 },
  resultActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  actionBtns: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e1e40', borderWidth: 1, borderColor: '#3a3a66', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18 },
  actionBtnText: { color: '#8888ff', fontSize: 12, fontWeight: '600' },
  staleNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2a2410', borderWidth: 1, borderColor: '#5a4a1a', borderRadius: 12, padding: 12, marginHorizontal: 20, marginBottom: 12 },
  staleNoticeText: { color: '#e0a030', fontSize: 12, flex: 1, lineHeight: 17 },
  sortBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  sortLabel: { color: '#888', fontSize: 12, marginRight: 2 },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e1e30', borderWidth: 1, borderColor: '#333', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18 },
  sortChipActive: { backgroundColor: '#e50914', borderColor: '#e50914' },
  sortChipText: { color: '#8888ff', fontSize: 12, fontWeight: '600' },
  sortChipTextActive: { color: '#fff' },
  emptyBox: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { color: '#aaa', fontSize: 16, textAlign: 'center', marginTop: 10 },
  emptyHint: { color: '#555', fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  emptyActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e1e40', borderWidth: 1, borderColor: '#3a3a66', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  emptyBtnText: { color: '#8888ff', fontSize: 13, fontWeight: '600' },
  streamFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  streamFooterText: { color: '#888', fontSize: 13 },
  loadingText: { color: '#aaa', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  grid: { padding: 12 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  cardRating: { color: '#aaa', fontSize: 11 },
});
