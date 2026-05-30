// Shared TMDB fetch layer. Previously this exact block (payload validation +
// timeout/abort handling) was copy-pasted into every screen. Screens differ
// only in the user-facing error wording, so they bind their own messages via
// makeTmdbFetch() while the mechanism lives here once.

// TMDB returns 200 with a { success:false, status_code, status_message } body
// for some errors, so a bare res.ok check isn't enough — validate the payload.
export function assertValidTmdbPayload(data: any) {
  if (data?.success === false || data?.status_code) {
    throw new Error(data.status_message || 'TMDB error');
  }
  return data;
}

// Wrap res.json so the payload check runs transparently on every .json() call.
function withCheckedJson(res: Response) {
  const json = res.json.bind(res);
  (res as any).json = async () => assertValidTmdbPayload(await json());
  return res;
}

export interface TmdbFetchMessages {
  // Thrown when the response is not ok (network/HTTP error).
  notOk: string;
  // Thrown when our own timeout fired (distinct from a caller-driven abort).
  timeout: string;
}

// Build a fetch function bound to a screen's error wording. The returned
// function matches the old per-screen fetchWithTimeout signature exactly, so
// call sites stay unchanged.
export function makeTmdbFetch(messages: TmdbFetchMessages) {
  return async function fetchWithTimeout(url: string, options: any = {}, timeout = 10000) {
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
      if (!res.ok) throw new Error(messages.notOk);
      return withCheckedJson(res);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // A caller-supplied signal aborting is intentional — propagate the raw
        // AbortError so callers can ignore it; our own timeout is a real error.
        if (externalSignal?.aborted) throw e;
        throw new Error(messages.timeout);
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };
}
