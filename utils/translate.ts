// On-demand machine translation of foreign-language text (a movie overview or
// an actor biography) to Russian, reusing the same Gemini client as the AI
// picker. TMDB usually gives Russian, but falls back to English / the original
// language when no RU translation exists — that's when the screens show a
// "Перевести на русский" toggle backed by this.
import { askGemini } from './gemini';

// Translations never change, so once we've paid for a text we reuse it for the
// whole session (reopening the same title, the same overview reappearing via
// "Похожие", flipping the toggle back and forth). Keyed by the source text.
const cache = new Map<string, string>();

// Cheap language guess without Unicode property escapes (Hermes-safe): compare
// Cyrillic vs Latin letter counts. Predominantly Cyrillic → already Russian, so
// the screens hide the translate affordance. Text with neither (CJK, etc.) is
// treated as non-Russian so it still gets the option.
export function isLikelyRussian(text: string): boolean {
  const cyr = (text.match(/[а-яё]/gi) || []).length;
  const lat = (text.match(/[a-z]/gi) || []).length;
  if (cyr + lat === 0) return false;
  return cyr >= lat;
}

// Lead with flash-lite (cheap, fast, plenty for translation) so translation
// doesn't compete with the picker's primary 2.5-flash quota; fall back across
// the other free-tier buckets on a 429.
const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash'];

export async function translateToRussian(text: string, signal?: AbortSignal): Promise<string> {
  const key = text.trim();
  const hit = cache.get(key);
  if (hit) return hit;

  const prompt = `Переведи текст на русский язык. Верни ТОЛЬКО перевод, без пояснений, без кавычек и без префиксов. Сохрани смысл, имена собственные и тон оригинала.

Текст:
${text}`;

  const r = await askGemini(prompt, 'gemini-2.5-flash-lite', {
    signal,
    temperature: 0.2,
    timeoutMs: 20000,
    maxOutputTokens: 4096,
    fallbackModels: FALLBACK_MODELS,
  });
  const out = r.text.trim();
  if (out) cache.set(key, out);
  return out;
}
