import { GEMINI_KEY } from '../constants/api';

type GeminiResponse = {
  text: string;
  raw?: any;
  // True when the model actually grounded its answer with a web search (Gemini
  // returns groundingMetadata only when the search tool fired). Lets callers
  // tell a real web-backed answer from one served from stale model knowledge.
  groundingUsed: boolean;
};

type GeminiOptions = {
  signal?: AbortSignal;
  googleSearch?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
};

// JS fetch-based implementation for Expo / React Native managed workflow.
// Uses Gemini's public REST API, so CI does not need native Android SDK patches.
export async function askGemini(
  prompt: string,
  model = 'gemini-2.5-flash',
  options: GeminiOptions = {},
): Promise<GeminiResponse> {
  const key = GEMINI_KEY;
  if (!key) throw new Error('Gemini API key is not set (EXPO_PUBLIC_GEMINI_KEY)');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body: any = {
    contents: [
      { role: 'user', parts: [{ text: prompt }] }
    ],
    generationConfig: {
      temperature: options.temperature ?? 0.5,
      maxOutputTokens: options.maxOutputTokens ?? 4000,
    },
  };

  if (options.googleSearch) {
    body.tools = [{ google_search: {} }];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  const onExternalAbort = () => controller.abort();

  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onExternalAbort);
  }

  let data: any;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error('ИИ перегружен. Попробуй через минуту.');
      const txt = await res.text().catch(() => '');
      throw new Error(`Gemini API error ${res.status}: ${txt}`);
    }

    data = await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      if (options.signal?.aborted) throw e;
      throw new Error('ИИ не отвечает. Проверь интернет.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((part: any) => part?.text || '').join('').trim()
    : '';
  if (!text) {
    throw new Error('ИИ вернул пустой ответ. Попробуй ещё раз.');
  }
  const meta = data?.candidates?.[0]?.groundingMetadata;
  const groundingUsed = !!(
    meta?.groundingChunks?.length ||
    meta?.webSearchQueries?.length ||
    meta?.groundingSupports?.length
  );
  return { text, raw: data, groundingUsed };
}
