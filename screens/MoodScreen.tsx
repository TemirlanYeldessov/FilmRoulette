import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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
import CardMark from '../components/CardMark';
import { TMDB_TOKEN, GROQ_KEY, GEMINI_KEY } from '../constants/api';

const RESOLVE_CONCURRENCY = 6;

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
    if (!res.ok) throw new Error('TMDB временно не отвечает. Попробуй ещё раз.');
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

type GroqResult = {
  mediaTypeFilter: 'movie' | 'tv' | 'mixed';
  reason: string;
  titles: string[];
};

function normalizeGroqResult(parsed: any): GroqResult {
  const rawFilter = String(parsed?.mediaTypeFilter ?? '').toLowerCase().trim();
  const mediaTypeFilter: GroqResult['mediaTypeFilter'] =
    rawFilter === 'movie' || rawFilter === 'tv' ? rawFilter : 'mixed';
  const titles = Array.isArray(parsed?.titles)
    ? parsed.titles.filter((t: any): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  if (titles.length === 0) {
    throw new Error('ИИ не вернул ни одного названия. Попробуй переформулировать запрос.');
  }
  const reason = typeof parsed?.reason === 'string' ? parsed.reason : '';
  return { mediaTypeFilter, reason, titles };
}

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
  return `Ты эксперт по кино и сериалам. Пользователь описал что хочет посмотреть: "${mood}".

ВАЖНО: Сначала определи - пользователь явно просит ФИЛЬМ, СЕРИАЛ, или не уточняет.
- Если в запросе есть слова "фильм", "кино", "movie" → mediaTypeFilter = "movie" (только фильмы)
- Если в запросе есть слова "сериал", "шоу", "series", "сезон" → mediaTypeFilter = "tv" (только сериалы)
- Если тип не указан явно → mediaTypeFilter = "mixed" (можно вперемешку)

Подбери 40 конкретных названий которые МАКСИМАЛЬНО точно соответствуют запросу.

Критерии:
- Соблюдай mediaTypeFilter строго
- Подбирай по атмосфере, вайбу, элементам которые упомянул пользователь
- Только реально существующие фильмы/сериалы
- Разнообразие годов; если уместно — добавь свежие релизы последних 1-2 лет
- Без повторений

Ответь ТОЛЬКО в формате JSON без markdown:
{
  "mediaTypeFilter": "movie" | "tv" | "mixed",
  "reason": "1-2 предложения почему эти тайтлы подходят",
  "titles": ["English Title 1", "English Title 2", ...]
}

Все названия на английском. Ровно 40 уникальных названий.`;
}

// Gemini with Google Search grounding — knows fresh releases the offline LLM
// can't. Used when EXPO_PUBLIC_GEMINI_KEY is set; otherwise we use Groq.
async function askGemini(mood: string, signal?: AbortSignal): Promise<GroqResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildAiPrompt(mood) }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.6 },
        }),
        signal: controller.signal,
      }
    );
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      if (signal?.aborted) throw e;
      throw new Error('ИИ не отвечает. Проверь интернет.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  if (!res.ok) {
    if (res.status === 429) throw new Error('ИИ перегружен. Попробуй через минуту.');
    throw new Error('ИИ временно недоступен. Попробуй ещё раз.');
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p.text || '')
    .join('');

  if (!text) throw new Error('ИИ вернул пустой ответ. Попробуй ещё раз.');

  const jsonText = extractJsonObject(text);
  if (!jsonText) throw new Error('Не удалось распознать ответ ИИ. Попробуй ещё раз.');

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Не удалось распознать ответ ИИ. Попробуй ещё раз.');
  }
  return normalizeGroqResult(parsed);
}

// Prefer Gemini (live web → fresh releases); fall back to Groq on failure.
async function askAI(mood: string, signal?: AbortSignal): Promise<GroqResult> {
  if (GEMINI_KEY) {
    try {
      return await askGemini(mood, signal);
    } catch (e: any) {
      if (e?.name === 'AbortError' || !GROQ_KEY) throw e;
      return await askGroq(mood, signal);
    }
  }
  return await askGroq(mood, signal);
}

async function askGroq(mood: string, signal?: AbortSignal): Promise<GroqResult> {
  const prompt = buildAiPrompt(mood);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }
  let res: Response;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      if (signal?.aborted) throw e;
      throw new Error('ИИ не отвечает. Проверь интернет.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  if (!res.ok) {
    if (res.status === 429) throw new Error('ИИ перегружен. Попробуй через минуту.');
    throw new Error('ИИ временно недоступен. Попробуй ещё раз.');
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';

  if (!text) {
    throw new Error('ИИ вернул пустой ответ. Попробуй ещё раз.');
  }

  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new Error('Не удалось распознать ответ ИИ. Попробуй ещё раз.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Не удалось распознать ответ ИИ. Попробуй ещё раз.');
  }

  return normalizeGroqResult(parsed);
}

async function searchTitle(title: string, adultContent: boolean, mediaTypeFilter: string, signal?: AbortSignal) {
  const res = await fetchWithTimeout(
    `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(title)}&language=ru-RU&include_adult=${adultContent}`,
    { headers: { Authorization: `Bearer ${TMDB_TOKEN}` }, signal }
  );
  const data = await res.json();

  const results = (data.results || []).filter((m: any) => {
    if (!m.poster_path) return false;
    if (mediaTypeFilter === 'movie') return m.media_type === 'movie';
    if (mediaTypeFilter === 'tv') return m.media_type === 'tv';
    return m.media_type === 'movie' || m.media_type === 'tv';
  });

  return results.find((item: any) => isLikelyTitleMatch(title, item)) ||
    results.find((item: any) => (item.popularity || 0) >= 5) ||
    null;
}

async function fetchDetails(id: number, type: string, signal?: AbortSignal) {
  const [ruRes, enRes] = await Promise.all([
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=ru-RU&append_to_response=videos`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` }, signal,
    }),
    fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${id}?language=en-US&append_to_response=videos`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` }, signal,
    }),
  ]);

  const ruData = await ruRes.json();
  const enData = await enRes.json();
  const trailerRu = ruData.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
  const trailerEn = enData.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');

  return {
    id,
    titleRu: ruData.title || ruData.name,
    titleEn: enData.title || enData.name,
    overview: ruData.overview || enData.overview,
    poster: ruData.poster_path ? `https://image.tmdb.org/t/p/w500${ruData.poster_path}` : null,
    trailerKey: trailerRu?.key || trailerEn?.key || null,
    genreId: null,
    mediaType: type,
    rating: ruData.vote_average ? ruData.vote_average.toFixed(1) : null,
    year: (ruData.release_date || ruData.first_air_date || '').slice(0, 4),
    country: ruData.production_countries?.[0]?.name || null,
    genres: ruData.genres?.map((g: any) => g.name).join(', ') || null,
  };
}

export default function MoodScreen({ navigation }: any) {
  const { adultContent } = useAppContext();
  const { width } = useWindowDimensions();
  const cardWidth = useMemo(() => (width - 48) / 2, [width]);
  const [mood, setMood] = useState('');
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showInput, setShowInput] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [suggestions] = useState(() => getRandomSuggestions(6));
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [totalTitles, setTotalTitles] = useState(0);
  const restartTimerRef = useRef<any>(null);
  const findAbortRef = useRef<AbortController | null>(null);
  const openAbortRef = useRef<AbortController | null>(null);
  // Synchronous mirror of isListening — the 'end' event from native can fire
  // before React commits the setIsListening(false) from stopListening(),
  // so reading state via closure would re-trigger the restart loop.
  const isListeningRef = useRef(false);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript || '';
    if (transcript) setMood(transcript);
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
      openAbortRef.current?.abort();
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

  const find = async (text: string) => {
    if (!text.trim()) return;

    if (isListening) stopListening();

    findAbortRef.current?.abort();
    const controller = new AbortController();
    findAbortRef.current = controller;
    const { signal } = controller;

    setLoading(true);
    setResults([]);
    setReason('');
    setError('');
    setShowInput(false);
    setProcessed(0);
    setTotalTitles(0);

    try {
      const aiResult = await askAI(text, signal);
      if (signal.aborted) return;
      setReason(aiResult.reason);

      const titles = aiResult.titles;
      setTotalTitles(titles.length);

      // Keep the AI's ranking: each title resolves into a fixed slot, then we
      // rebuild a deduped, gap-free list on every completion so results stream
      // in order as they arrive instead of after the whole batch finishes.
      const slots: (any | null)[] = new Array(titles.length).fill(undefined);
      const rebuild = () => {
        const seen = new Set<string>();
        const out: any[] = [];
        for (const it of slots) {
          if (!it) continue;
          const key = `${it.id}-${it.media_type}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(it);
        }
        return out;
      };

      let cursor = 0;
      let done = 0;
      const worker = async () => {
        while (!signal.aborted) {
          const i = cursor++;
          if (i >= titles.length) return;
          try {
            const item = await searchTitle(titles[i], adultContent, aiResult.mediaTypeFilter, signal);
            slots[i] = item || null;
          } catch (e: any) {
            if (e?.name === 'AbortError') return;
            slots[i] = null; // one bad title shouldn't kill the batch
          }
          done += 1;
          if (!signal.aborted) {
            setProcessed(done);
            setResults(rebuild());
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(RESOLVE_CONCURRENCY, titles.length) }, worker)
      );

      if (signal.aborted) return;
      setResults(rebuild());
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      console.error(e);
      setError(e?.message || 'Не удалось получить подборку. Попробуй ещё раз.');
      setShowInput(true);
    } finally {
      if (findAbortRef.current === controller) findAbortRef.current = null;
      if (!signal.aborted) setLoading(false);
    }
  };

  const openCard = async (item: any) => {
    if (opening) return;
    openAbortRef.current?.abort();
    const controller = new AbortController();
    openAbortRef.current = controller;
    setOpening(true);
    try {
      const details = await fetchDetails(item.id, item.media_type, controller.signal);
      if (controller.signal.aborted) return;
      navigation.navigate('Card', { movie: details });
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      Alert.alert('Не удалось открыть', e?.message || 'Попробуй ещё раз.');
    } finally {
      if (openAbortRef.current === controller) openAbortRef.current = null;
      setOpening(false);
    }
  };

  const reset = () => {
    findAbortRef.current?.abort();
    setShowInput(true);
    setResults([]);
    setReason('');
    setMood('');
    setError('');
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

          {reason ? (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonText}>💡 {reason}</Text>
            </View>
          ) : null}

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

        {loading && results.length === 0 ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#e50914" />
            <Text style={styles.loadingText}>ИИ анализирует запрос и собирает подборку...</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              data={results}
              keyExtractor={(item, index) => `${item.id}-${item.media_type}-${index}`}
              numColumns={2}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.row}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.card, { width: cardWidth }]} onPress={() => openCard(item)} disabled={opening}>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{item.media_type === 'tv' ? 'Сериал' : 'Фильм'}</Text>
                  </View>
                  <CardMark id={item.id} mediaType={item.media_type} />

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
                </TouchableOpacity>
              )}
              ListFooterComponent={
                loading ? (
                  <View style={styles.streamFooter}>
                    <ActivityIndicator size="small" color="#e50914" />
                    <Text style={styles.streamFooterText}>Ищу ещё…</Text>
                  </View>
                ) : null
              }
            />
            {opening && (
              <View style={styles.openingOverlay} pointerEvents="auto">
                <ActivityIndicator size="large" color="#e50914" />
              </View>
            )}
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
                <Text style={styles.aiBadgeText}>Powered by Groq AI</Text>
              </View>

              <Text style={styles.subtitle}>
                Опиши вайб, настроение или конкретный запрос — ИИ подберёт релевантные фильмы и сериалы
              </Text>

              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Например: хочу посмотреть фильм про..."
                  placeholderTextColor="#555"
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
  reasonBox: { backgroundColor: '#1e1e30', borderRadius: 12, padding: 14, marginBottom: 8 },
  reasonText: { color: '#ccc', fontSize: 14, lineHeight: 20 },
  countText: { color: '#888', fontSize: 12, marginTop: 4 },
  resultActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  actionBtns: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e1e40', borderWidth: 1, borderColor: '#3a3a66', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18 },
  actionBtnText: { color: '#8888ff', fontSize: 12, fontWeight: '600' },
  streamFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  streamFooterText: { color: '#888', fontSize: 13 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 },
  loadingText: { color: '#aaa', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  openingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,15,26,0.6)', alignItems: 'center', justifyContent: 'center' },
  grid: { padding: 12 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: {},
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#1a1a40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  typeBadgeText: { color: '#8888ff', fontSize: 11, fontWeight: '600' },
  poster: { borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  cardRating: { color: '#aaa', fontSize: 11 },
});
