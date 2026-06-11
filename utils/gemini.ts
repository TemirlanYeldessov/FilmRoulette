import { GEMINI_KEY } from '../constants/api';

// Typed error so callers can branch on the *cause* (overloaded vs auth vs
// network) instead of regex-matching a localized message. friendlyAiError()
// (utils/aiSearch.ts) turns a `kind` into user-facing wording.
export type AiErrorKind =
  | 'rate_limit'   // 429 — too many requests
  | 'overloaded'   // 500/502/503/504 — model/server temporarily unavailable
  | 'auth'         // 401/403 — bad/blocked key
  | 'bad_request'  // 400 — malformed request
  | 'network'      // fetch threw (no connectivity / DNS)
  | 'timeout'      // our own deadline fired
  | 'empty'        // 200 but no text in the candidate
  | 'blocked'      // safety / recitation / prompt blocked
  | 'truncated'    // finishReason MAX_TOKENS, no usable text
  | 'parse'        // text came back but wasn't the JSON we expected
  | 'titles_empty' // valid JSON but zero usable titles
  | 'unknown';

export class AiError extends Error {
  kind: AiErrorKind;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;

  constructor(
    kind: AiErrorKind,
    message: string,
    opts: { status?: number; retryable?: boolean; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
    if (opts.cause !== undefined) (this as any).cause = opts.cause;
  }
}

export type GeminiResponse = {
  text: string;
  raw?: any;
  // True when the model actually grounded its answer with a web search (Gemini
  // returns groundingMetadata only when the search tool fired). Lets callers
  // tell a real web-backed answer from one served from stale model knowledge.
  groundingUsed: boolean;
  finishReason?: string;
};

export type GeminiOptions = {
  signal?: AbortSignal;
  googleSearch?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
  // When set (and googleSearch is off) the model is constrained to strict JSON
  // matching this schema. Grounding and JSON mode are mutually exclusive on the
  // Gemini API, so the schema is ignored whenever googleSearch is on.
  responseSchema?: any;
  // Deterministic-ish sampling: same seed + same prompt ≈ same output.
  seed?: number;
  // Transient-failure retries (429 / 5xx / network). Default 2 → up to 3 calls.
  maxRetries?: number;
  // Models to try when the primary one is quota-limited (429) or persistently
  // overloaded. Each Gemini model has its own free-tier quota bucket, so
  // switching models on 429 effectively multiplies the available quota.
  fallbackModels?: string[];
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const isAbort = (e: any) => e?.name === 'AbortError';

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

// setTimeout that rejects (with an AbortError) if the signal fires first, so a
// caller-cancelled search doesn't sit idle through a backoff delay.
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(abortError());
        return;
      }
      signal.addEventListener('abort', onAbort);
    }
  });
}

// Exponential backoff with full jitter, capped. `attempt` is 1-based. Honors a
// server-provided Retry-After when present.
function backoffDelay(attempt: number, retryAfterMs?: number) {
  if (retryAfterMs && Number.isFinite(retryAfterMs)) return Math.min(retryAfterMs, 20000);
  const base = Math.min(500 * 2 ** (attempt - 1), 8000);
  return base / 2 + Math.random() * (base / 2);
}

// A single Gemini round-trip. Throws AiError for every non-success path (or a
// raw AbortError when the *caller's* signal cancelled us) so askGemini's retry
// loop can decide what's worth repeating.
async function callOnce(prompt: string, model: string, options: GeminiOptions): Promise<GeminiResponse> {
  const key = GEMINI_KEY;
  if (!key) throw new AiError('auth', 'Gemini API key is not set (EXPO_PUBLIC_GEMINI_KEY)');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const useJson = !!options.responseSchema && !options.googleSearch;

  const body: any = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxOutputTokens ?? 4096,
      // gemini-2.5-flash enables "thinking" by default, and those tokens count
      // against maxOutputTokens — they can devour the whole budget and leave an
      // empty or truncated answer (the main "works every other time" bug). This
      // task needs a list, not chain-of-thought, so we disable it outright.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  // The app only ever asks for film/TV title lists, but default safety
  // thresholds false-positive on legitimate queries (slashers, true crime, and
  // adult-studio titles when the user enabled 18+). Movie titles are metadata,
  // not explicit content, so relax the filters to the API minimum.
  body.safetySettings = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ].map(category => ({ category, threshold: 'BLOCK_NONE' }));
  if (options.seed !== undefined) body.generationConfig.seed = options.seed;
  if (useJson) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = options.responseSchema;
  }
  if (options.googleSearch) body.tools = [{ google_search: {} }];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  const external = options.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (isAbort(e)) {
      // Distinguish a caller cancel (propagate raw) from our own deadline.
      if (external?.aborted) throw e;
      throw new AiError('timeout', 'ИИ не отвечает. Проверь интернет.', { retryable: true, cause: e });
    }
    throw new AiError('network', 'Не удалось связаться с ИИ. Проверь интернет.', { retryable: true, cause: e });
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }

  if (!res.ok) {
    const status = res.status;
    const bodyText = await res.text().catch(() => '');
    if (status === 429) {
      const headerSecs = Number(res.headers.get('retry-after'));
      const retryAfterMs = Number.isFinite(headerSecs) && headerSecs > 0 ? headerSecs * 1000 : undefined;
      throw new AiError('rate_limit', 'ИИ перегружен запросами.', { status, retryable: true, retryAfterMs });
    }
    if (RETRYABLE_STATUS.has(status)) {
      throw new AiError('overloaded', `Сервис ИИ временно недоступен (${status}).`, { status, retryable: true });
    }
    if (status === 401 || status === 403) {
      throw new AiError('auth', `Ошибка доступа к ИИ (${status}).`, { status });
    }
    throw new AiError(
      status === 400 ? 'bad_request' : 'unknown',
      `Gemini API error ${status}: ${bodyText.slice(0, 300)}`,
      { status },
    );
  }

  const data = await res.json().catch(() => null);

  // A prompt-level block returns no candidates at all.
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) throw new AiError('blocked', `Запрос отклонён моделью (${blockReason}).`);

  const candidate = data?.candidates?.[0];
  const finishReason: string | undefined = candidate?.finishReason;
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: any) => p?.text || '').join('').trim() : '';

  if (!text) {
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'PROHIBITED_CONTENT') {
      throw new AiError('blocked', `Ответ отклонён моделью (${finishReason}).`);
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new AiError('truncated', 'Ответ ИИ не поместился в лимит.', { retryable: true });
    }
    // No text and no explanatory reason is usually transient overload.
    throw new AiError('empty', 'ИИ вернул пустой ответ.', { retryable: true });
  }

  const meta = candidate?.groundingMetadata;
  const groundingUsed = !!(
    meta?.groundingChunks?.length ||
    meta?.webSearchQueries?.length ||
    meta?.groundingSupports?.length
  );
  return { text, raw: data, groundingUsed, finishReason };
}

// JS fetch-based implementation for Expo / React Native managed workflow.
// Uses Gemini's public REST API, so CI does not need native Android SDK patches.
// Retries transient failures (429 / 5xx / network / timeout) with jittered
// exponential backoff; never retries auth, bad-request or a caller-driven abort.
// When fallbackModels are given, quota errors (429) hop to the next model
// immediately — each model has its own free-tier quota, so waiting out a
// Retry-After on the same model is strictly worse than asking another one.
export async function askGemini(
  prompt: string,
  model = 'gemini-2.5-flash',
  options: GeminiOptions = {},
): Promise<GeminiResponse> {
  const maxRetries = options.maxRetries ?? 2;
  const models = [model, ...(options.fallbackModels ?? [])];
  let lastError: any;
  for (let mi = 0; mi < models.length; mi += 1) {
    const hasNextModel = mi < models.length - 1;
    let attempt = 0;
    for (;;) {
      try {
        return await callOnce(prompt, models[mi], options);
      } catch (e: any) {
        if (isAbort(e)) throw e;
        lastError = e;
        const ai = e instanceof AiError ? e : null;
        if (!ai?.retryable || options.signal?.aborted) throw e;
        // 429 with another model available → switch now, don't burn the backoff.
        if (ai.kind === 'rate_limit' && hasNextModel) break;
        if (attempt >= maxRetries) {
          if (hasNextModel && (ai.kind === 'rate_limit' || ai.kind === 'overloaded')) break;
          throw e;
        }
        attempt += 1;
        // Throws AbortError if the caller cancels mid-backoff — surfaced as abort.
        await wait(backoffDelay(attempt, ai.retryAfterMs), options.signal);
      }
    }
  }
  throw lastError;
}
