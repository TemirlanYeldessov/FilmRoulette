// Drives the "Перевести на русский" toggle shared by the detail screens. Holds
// the translated text + which version is shown, fetches lazily on first toggle,
// and resets when the source text changes (reroll to a new movie, opening a
// different actor) so a stale translation never sits under fresh text.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isLikelyRussian, translateToRussian } from './translate';

export function useTranslation(text: string) {
  const canTranslate = !!text && !isLikelyRussian(text);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setTranslated(null);
    setShowTranslated(false);
    setTranslating(false);
    setError(false);
  }, [text]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const toggle = useCallback(async () => {
    // Flip back to original, or to an already-fetched translation, for free.
    if (showTranslated) { setShowTranslated(false); return; }
    if (translated) { setShowTranslated(true); return; }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setTranslating(true);
    setError(false);
    try {
      const result = await translateToRussian(text, controller.signal);
      if (controller.signal.aborted) return;
      setTranslated(result);
      setShowTranslated(true);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) setTranslating(false);
    }
  }, [showTranslated, translated, text]);

  const display = showTranslated && translated ? translated : text;
  return { display, canTranslate, translating, error, isTranslated: showTranslated, toggle };
}
