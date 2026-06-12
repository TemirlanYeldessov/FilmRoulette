// Domain logic for the AI mood-picker: prompt building, the Gemini call
// orchestration (grounded → offline fallback), response parsing/validation and
// title matching. Kept out of MoodScreen so it's unit-testable and the screen
// only deals with UI + streaming TMDB resolution. The fetcher-bound helpers
// (searchTitle / fetchDirect) stay in the screen since they need its bound
// fetchWithTimeout wording.
import { askGemini, AiError } from './gemini';

const isAbort = (e: any) => e?.name === 'AbortError';

// One AI-suggested title plus its release year (when the model is confident).
// The year disambiguates remakes / same-named titles when resolving on TMDB.
export type AiTitle = { title: string; year: number | null };

export type GeminiResult = {
  mediaTypeFilter: 'movie' | 'tv' | 'mixed';
  titles: AiTitle[];
  // True when the answer came from the web-search-grounded model. False when we
  // fell back to the offline model, whose knowledge may be stale.
  webSearch: boolean;
};

// Gemini structured-output schema for the offline (non-grounded) call. Forces a
// valid JSON object so we no longer depend on the model honoring "reply in JSON"
// from the prompt alone. Not usable with google_search (mutually exclusive).
export const TITLES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mediaTypeFilter: { type: 'STRING', enum: ['movie', 'tv', 'mixed'] },
    titles: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          year: { type: 'INTEGER' },
        },
        required: ['title'],
        propertyOrdering: ['title', 'year'],
      },
    },
  },
  required: ['mediaTypeFilter', 'titles'],
  propertyOrdering: ['mediaTypeFilter', 'titles'],
};

// Extract the first complete top-level JSON object from arbitrary text.
// Tolerates markdown fences, leading prose, and trailing junk by tracking
// brace depth and skipping characters inside string literals. Still used for
// the grounded path (JSON mode is off there) and as a safety net.
export function extractJsonObject(raw: string): string | null {
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

// Rough detector for "freshness" intent (a year or new-release wording). Drives
// whether we pay for the slower grounded (web-search) call, and whether to warn
// the user when only the offline fallback ran. A false positive just shows an
// extra hint, never blocks anything.
export function isFreshnessQuery(mood: string) {
  const t = mood.toLowerCase();
  return /\b20[2-9]\d\b/.test(t) ||
    /новинк|новое|новые|свеж|последн|недавн|вышл|recent|latest|\bnew\b/.test(t);
}

// Accept either a bare string (grounded path / older model output) or the
// structured { title, year } object. Returns null for anything unusable.
function coerceTitle(entry: any): AiTitle | null {
  if (typeof entry === 'string') {
    const title = entry.trim();
    return title ? { title, year: null } : null;
  }
  if (entry && typeof entry === 'object') {
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    if (!title) return null;
    const y = Number(entry.year);
    const year = Number.isInteger(y) && y > 1870 && y < 2100 ? y : null;
    return { title, year };
  }
  return null;
}

export function normalizeGeminiResult(parsed: any): GeminiResult {
  const rawFilter = String(parsed?.mediaTypeFilter ?? '').toLowerCase().trim();
  const mediaTypeFilter: GeminiResult['mediaTypeFilter'] =
    rawFilter === 'movie' || rawFilter === 'tv' ? rawFilter : 'mixed';

  const rawTitles = Array.isArray(parsed?.titles) ? parsed.titles : [];
  const seen = new Set<string>();
  const titles: AiTitle[] = [];
  for (const entry of rawTitles) {
    const coerced = coerceTitle(entry);
    if (!coerced) continue;
    const key = coerced.title.toLowerCase();
    if (seen.has(key)) continue; // drop dupes the model occasionally emits
    seen.add(key);
    titles.push(coerced);
  }

  if (titles.length === 0) {
    throw new AiError('titles_empty', 'ИИ не вернул ни одного названия.');
  }
  return { mediaTypeFilter, titles, webSearch: false };
}

export function parseGeminiResult(text: string): GeminiResult {
  const jsonText = extractJsonObject(text);
  if (!jsonText) throw new AiError('parse', 'Не удалось распознать ответ ИИ.');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AiError('parse', 'Не удалось разобрать ответ ИИ.');
  }
  return normalizeGeminiResult(parsed);
}

function buildAiPrompt(mood: string, opts: { grounded: boolean; adult: boolean }) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentYear = now.getFullYear();

  const freshnessLine = opts.grounded
    ? `- Новинки / fresh / latest / "вышло недавно" / конкретный свежий год (${currentYear}, ${currentYear - 1}) → используй доступный веб-поиск и возвращай только ${currentYear} и конец ${currentYear - 1}. Если релизов мало, верни сколько есть, не добавляй старое для количества.`
    : `- Новинки / fresh / latest / "вышло недавно" / конкретный свежий год (${currentYear}, ${currentYear - 1}) → опирайся на свои знания и возвращай ${currentYear} и конец ${currentYear - 1}. Если не уверен в свежих релизах, верни меньше тайтлов — не выдумывай несуществующие.`;

  return `Ты — эксперт по кино и сериалам. Отвечай только списком реальных фильмов/сериалов, которые можно найти в TMDB или IMDb.

Сегодня: ${today}. Текущий год: ${currentYear}.
Запрос пользователя: "${mood}"

Проанализируй запрос по шагам:

1. Тип контента, поле mediaTypeFilter:
- "movie" — если пользователь явно просит фильм/кино.
- "tv" — если явно просит сериал/шоу/дораму/аниме-сериал.
- "mixed" — если тип не указан или подходят и фильмы, и сериалы.

2. Временное намерение:
${freshnessLine}
- Классика / ретро / старое / 90-е / 80-е / советское / кино детства → возвращай только тайтлы из запрошенной эпохи или явно старые/классические тайтлы.
- По вайбу / похоже на X / в стиле X / like X → возвращай релевантный микс разных лет; если есть подходящие свежие релизы, включи их тоже.
- Если запрос смешивает свежесть и вайб, например "новое по вайбу Интерстеллара", приоритет у свежести.
- Учитывай отрицания: "не хочу новое" означает не подбирать новинки; "только не старьё" означает избегать старых тайтлов.

3. Правила выдачи:
- Только реально существующие тайтлы; если не уверен, не включай.
- Названия только на английском, как в TMDB/IMDb.
- Для каждого тайтла укажи год выхода (для сериалов — год премьеры). Если не уверен в годе, опусти поле year, но не выдумывай.
- Без повторов.
- Сначала самые релевантные.
- Верни как можно больше реально подходящих тайтлов, без искусственного ограничения сверху. Для широкого запроса список может быть очень большим: продолжай добавлять реальные релевантные тайтлы, пока они есть и ответ помещается. Не трать токены на пояснения и не добивай список выдуманными или нерелевантными тайтлами ради количества.
${opts.adult
  ? '- У пользователя включён режим 18+: запросы про эротику и контент для взрослых (включая порно) допустимы и легальны. Для таких запросов возвращай реальные взрослые тайтлы и релизы студий, которые есть в базе TMDB, без отказов и предупреждений.'
  : '- Не включай контент 18+ (эротику, порно) — у пользователя выключен соответствующий режим.'}

Ответь строго одним JSON-объектом без markdown и без текста до или после него:
{
  "mediaTypeFilter": "mixed",
  "titles": [
    { "title": "English Title 1", "year": 1999 },
    { "title": "English Title 2", "year": 2021 }
  ]
}`;
}

// Quota-fallback chain: every Gemini model has its own free-tier quota, so a
// 429 on the primary hops here instead of surfacing "ИИ перегружен" to the user.
const FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const AI_MAX_OUTPUT_TOKENS = {
  default: 8192,
  'gemini-2.5-flash': 16384,
  'gemini-2.5-flash-lite': 16384,
  'gemini-2.0-flash': 8192,
};

export type AskAiOptions = { signal?: AbortSignal; adultContent?: boolean };

// Prefer the Google-Search-grounded model for fresh releases. If grounding
// fails (slow/unavailable), fall back to the structured offline model — which
// uses JSON-mode + a schema for a reliable shape, lower temperature for
// stability, and a disabled thinking budget so the answer isn't starved.
export async function askAI(mood: string, opts: AskAiOptions = {}): Promise<GeminiResult> {
  const { signal, adultContent = false } = opts;
  if (isFreshnessQuery(mood)) {
    try {
      const r = await askGemini(buildAiPrompt(mood, { grounded: true, adult: adultContent }), 'gemini-2.5-flash', {
        signal,
        googleSearch: true,
        timeoutMs: 25000,
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        fallbackModels: FALLBACK_MODELS,
      });
      return { ...parseGeminiResult(r.text), webSearch: r.groundingUsed };
    } catch (e: any) {
      if (isAbort(e)) throw e;
      // Grounded call failed — fall through to the offline model below.
    }
  }
  const r = await askGemini(buildAiPrompt(mood, { grounded: false, adult: adultContent }), 'gemini-2.5-flash', {
    signal,
    googleSearch: false,
    timeoutMs: 30000,
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    responseSchema: TITLES_SCHEMA,
    temperature: 0.2,
    fallbackModels: FALLBACK_MODELS,
  });
  return { ...parseGeminiResult(r.text), webSearch: false };
}

// Map an error from the AI pipeline to user-facing wording. Branches on the
// typed AiError.kind so wording stays correct even if a message text changes
// (the old version regex-matched localized strings — a 503 looked like an
// "invalid key" error).
export function friendlyAiError(e: any): string {
  if (e instanceof AiError) {
    switch (e.kind) {
      case 'rate_limit': return 'ИИ сейчас перегружен запросами. Попробуй ещё раз через минуту.';
      case 'overloaded': return 'Сервис ИИ временно перегружен. Попробуй ещё раз через минуту.';
      case 'auth': return 'ИИ-подбор временно недоступен. Попробуй позже.';
      case 'bad_request': return 'Не удалось обработать запрос. Попробуй переформулировать.';
      case 'network': return 'Не получилось связаться с ИИ. Проверь интернет и попробуй снова.';
      case 'timeout': return 'ИИ слишком долго отвечает. Проверь интернет и попробуй снова.';
      case 'truncated': return 'Ответ ИИ не поместился. Нажми «Пересобрать».';
      case 'empty': return 'ИИ вернул пустой ответ. Нажми «Пересобрать» или уточни запрос.';
      case 'blocked': return 'ИИ не смог ответить на этот запрос. Попробуй переформулировать.';
      case 'parse': return 'ИИ ответил не так, как ожидалось. Нажми «Пересобрать» или уточни запрос.';
      case 'titles_empty': return 'ИИ не вернул ни одного названия. Попробуй переформулировать запрос.';
      default: return 'Не удалось собрать подборку. Попробуй переформулировать запрос.';
    }
  }
  return 'Не удалось собрать подборку. Попробуй переформулировать запрос.';
}

// --- Adult-intent detection ------------------------------------------------
// When the 18+ toggle is on, queries with explicit adult intent get an extra
// direct TMDB search pass in MoodScreen: the LLM may refuse to name adult
// titles, while TMDB's own search with include_adult=true finds them from the
// query text itself. Detection errs on the side of matching — a false positive
// just adds one extra TMDB search, it never hides anything.
const ADULT_MARKERS =
  /порн|porn|эротик|erotic|хентай|hentai|секс|\bsex\b|\bxxx\b|18\s*\+|для взрослых|onlyfans|brazzers|playboy|плейбой|браззерс/i;

export function isAdultQuery(query: string) {
  return ADULT_MARKERS.test(query);
}

// Russian adult keyword → the English search term TMDB actually knows the
// titles by (adult releases are English-named in the database).
const ADULT_RU_TO_EN: [RegExp, string][] = [
  [/порн/i, 'porn'],
  [/хентай/i, 'hentai'],
  [/эротик/i, 'erotica'],
  [/секс/i, 'sex'],
  [/браззерс/i, 'brazzers'],
  [/плейбой/i, 'playboy'],
];

// Big adult studios whose TMDB catalogues are dense with real releases. A bare
// "porn" text search returns mostly mainstream documentaries; leading with
// these surfaces actual studio titles (Blacked Raw, Brazzers Exxtra, …) that a
// literal keyword search never matches by name. (vixen / reality kings dropped —
// they return mostly mainstream or too few results.)
const ADULT_STUDIO_TERMS = ['blacked', 'brazzers', 'tushy', 'naughty america'];

// True when the query is a broad ask for adult content in general (bare "porn",
// "порно", "18+", a studio name) rather than a specific title/topic. Detected by
// stripping every adult keyword + filler and checking nothing meaningful is left.
export function isGenericAdultQuery(query: string): boolean {
  // \w doesn't match Cyrillic in JS regex, so Russian stems use [а-яё]* to
  // swallow the inflected ending (посмотр[еть], эротик[а]...).
  const residual = query
    .toLowerCase()
    .replace(/порно|porno|порн|porn(hub)?|порнхаб|эротик[а-яё]*|erotica|erotic|хентай|hentai|секс|\bsex\b|\bxxx\b|18\s*\+|для\s+взрослых|adult|взросл[а-яё]*|onlyfans|blacked|brazzers|tushy|vixen|naughty\s*america|reality\s*kings|playboy|плейбой|браззерс/gi, ' ')
    .replace(/хочу|покажи|показать|смотреть|посмотр[а-яё]*|найд[а-яё]*|подбер[а-яё]*|видео|ролик[а-яё]*|фильм[а-яё]*|кино|сцен[а-яё]*|что-?то|какое-?то|какой-?нибудь|нибудь|мне|пожалуйста|немного|good|some|watch|want|movies?|films?|videos?|clips?/gi, ' ')
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim();
  return residual.length === 0;
}

// Search terms for the direct adult feed. A specific ask (named studio/actor/
// parody) is searched verbatim; a generic porn ask leads with big studios so the
// grid fills with real releases instead of "porn" documentaries.
export function adultSearchTerms(query: string): string[] {
  const lower = query.toLowerCase().trim();
  const terms: string[] = [];
  const add = (t: string) => { const k = t.trim(); if (k && !terms.includes(k)) terms.push(k); };

  if (isGenericAdultQuery(query)) {
    const porny = /порно|porn|порнхаб|pornhub|18\s*\+|для\s+взрослых|\bxxx\b|секс|\bsex\b/i.test(lower);
    if (porny) ADULT_STUDIO_TERMS.forEach(add);
    for (const [re, en] of ADULT_RU_TO_EN) if (re.test(lower)) add(en);
    if (porny) add('porn');
    if (terms.length === 0) add(lower || 'porn');
  } else {
    if (lower) add(lower);
    for (const [re, en] of ADULT_RU_TO_EN) if (re.test(lower)) add(en);
  }
  return terms.slice(0, 8);
}

// --- Title matching ------------------------------------------------------

export function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9а-яё]+/gi, '');
}

export function levenshtein(a: string, b: string) {
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

// Whether a TMDB item plausibly *is* the AI-suggested title. The fuzzy
// tolerance scales with title length (was a flat ≤3, which matched unrelated
// short titles like "Heat" vs "Her"); substring matches are gated to length ≥4
// so a 3-letter query can't match by being contained in a longer title.
export function isLikelyTitleMatch(query: string, item: any) {
  const q = normalizeTitle(query);
  if (!q) return false;
  const candidates = [item.title, item.name, item.original_title, item.original_name]
    .filter(Boolean)
    .map((t: string) => normalizeTitle(t));
  const maxDist = Math.max(1, Math.round(q.length / 5));
  return candidates.some((c: string) => {
    if (!c) return false;
    if (c === q) return true;
    if (c.length >= 4 && q.length >= 4 && (c.includes(q) || q.includes(c))) return true;
    return levenshtein(c, q) <= maxDist;
  });
}

// --- Direct TMDB routing -------------------------------------------------
// Some queries are fully structured ("новинки", a bare genre, "лучшие фильмы")
// and need no LLM at all. We serve those straight from TMDB /discover — one fast
// request instead of a slow grounded Gemini call plus N per-title lookups.
// parseDirectIntent returns null the moment a query carries any free-form intent,
// so anything nuanced still flows through the AI path.

const MOVIE_GENRE_KEYWORDS: { id: number; re: RegExp }[] = [
  { id: 28, re: /боевик|экшн|экшен|action/ },
  { id: 35, re: /комеди|смешн|comedy/ },
  { id: 18, re: /\bдрам|drama/ },
  { id: 27, re: /ужас|хоррор|horror/ },
  { id: 10749, re: /мелодрам|романт|romance/ },
  { id: 878, re: /фантастик|sci-?fi/ },
  { id: 53, re: /триллер|thriller/ },
  { id: 16, re: /анимаци|мультф|мультик|animation/ },
  { id: 99, re: /документ|documentary/ },
  { id: 9648, re: /детектив|mystery/ },
  { id: 14, re: /фэнтези|фэнтэзи|фентези|fantasy/ },
  { id: 12, re: /приключен|adventure/ },
  { id: 10751, re: /семейн|family/ },
  { id: 36, re: /историч|history/ },
  { id: 10752, re: /военн|\bwar\b/ },
  { id: 80, re: /криминал|crime|мафи/ },
  { id: 37, re: /вестерн|western/ },
];

// Movie genre id → TV genre id where TMDB splits them into separate buckets.
const MOVIE_TO_TV_GENRE: Record<number, number> = {
  28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768,
};

// Free-form markers the LLM should interpret — their presence disables routing.
const SEMANTIC_MARKERS = /похож|в стиле|как\s|вайб|настроени|про\s|about|like\s|чтобы|который|где\s/;

const ROUTE_CONNECTORS = new Set([
  'и', 'а', 'но', 'или', 'со', 'для', 'от', 'до', 'по', 'из', 'во', 'об',
  'же', 'бы', 'ли', 'это', 'их', 'его', 'ещё', 'еще', 'чтоб', 'там',
]);

export type DirectIntent = { type: 'movie' | 'tv'; params: Record<string, string> };

export function parseDirectIntent(query: string, adultContent: boolean): DirectIntent | null {
  const lower = query.toLowerCase().trim();
  if (!lower || SEMANTIC_MARKERS.test(lower)) return null;

  const isTv = /сериал|шоу|дорам|сезон/.test(lower);
  const fresh = isFreshnessQuery(lower);
  const classic = /класси|ретро|старо|стар(ый|ые|ое)|[789]0-?е|советск|нуар/.test(lower);
  const topRated = /лучш|\bтоп\b|высок\w*\s*рейтинг|рейтингов|popular|популярн|известн|культов/.test(lower);
  const genreIds = MOVIE_GENRE_KEYWORDS.filter(g => g.re.test(lower)).map(g => g.id);

  if (!(fresh || classic || topRated || genreIds.length)) return null;

  // Strip every token we recognized. If meaningful words survive, the query is
  // richer than our structured signals can express → defer to the LLM.
  let residual = lower
    .replace(/[«»"“”().,!?:;]/g, ' ')
    .replace(/\b20[2-9]\d\b/g, ' ')
    .replace(/[789]0-?е/g, ' ');
  for (const g of MOVIE_GENRE_KEYWORDS) residual = residual.replace(g.re, ' ');
  residual = residual
    .replace(/новинк\w*|новое|новые|новый|свеж\w*|последн\w*|недавн\w*|вышл\w*|recent|latest|\bnew\b|fresh/g, ' ')
    .replace(/класси\w*|ретро|старо\w*|стар(ый|ые|ое)|советск\w*|нуар/g, ' ')
    .replace(/лучш\w*|\bтоп\b|высок\w*|рейтинг\w*|popular|популярн\w*|известн\w*|культов\w*/g, ' ')
    .replace(/фильм\w*|кино|сериал\w*|шоу|дорам\w*|сезон\w*|movies?|films?|shows?|series/g, ' ')
    .replace(/посмотр\w*|смотр\w*|хочу|покажи|показать|найд\w*|подбер\w*|подборк\w*|watch|want/g, ' ')
    .replace(/что-?то|нибудь|какой-?нибудь|мне|вечер\w*|сегодня|самы\w*|просто|пожалуйста|good|some/g, ' ')
    .replace(/хорош\w*|интересн\w*|на\b|\bв\b|\bс\b|\bо\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const leftover = residual.split(' ').filter(t => t.length > 2 && !ROUTE_CONNECTORS.has(t));
  if (leftover.length > 0) return null;

  const type: 'movie' | 'tv' = isTv ? 'tv' : 'movie';
  const params: Record<string, string> = {
    include_adult: String(adultContent),
    'vote_count.gte': '30',
  };
  if (genreIds.length) {
    const ids = type === 'tv' ? genreIds.map(id => MOVIE_TO_TV_GENRE[id] ?? id) : genreIds;
    params.with_genres = ids.join(',');
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dateField = type === 'tv' ? 'first_air_date' : 'primary_release_date';

  if (topRated) {
    params.sort_by = 'vote_average.desc';
    params['vote_count.gte'] = '300';
  } else if (fresh) {
    // "Popular among recent releases" — the most useful reading of "новинки".
    params.sort_by = 'popularity.desc';
    params[`${dateField}.gte`] = `${now.getFullYear() - 1}-01-01`;
    params[`${dateField}.lte`] = today;
    params['vote_count.gte'] = '10';
  } else if (classic) {
    params.sort_by = 'vote_average.desc';
    params['vote_count.gte'] = '200';
    params[`${dateField}.lte`] = '2005-12-31';
  } else {
    params.sort_by = 'popularity.desc';
  }

  return { type, params };
}
