import { askGemini } from '../utils/gemini';

// The key is read at module load from constants/api; mock it so the client
// proceeds to fetch instead of throwing "key not set". jest.mock is hoisted
// above the import by babel-jest, so the mock is in place before gemini.ts loads.
jest.mock('../constants/api', () => ({ GEMINI_KEY: 'test-key', TMDB_TOKEN: 'tmdb-token' }));

// Minimal fetch Response stand-in.
function makeRes(status: number, body: any, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const okText = (text: string) =>
  makeRes(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });

afterEach(() => {
  jest.restoreAllMocks();
  (global as any).fetch = undefined;
});

describe('askGemini retry/error handling', () => {
  it('retries a transient 503 and then succeeds', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeRes(503, 'overloaded'))
      .mockResolvedValueOnce(okText('{"ok":true}'));
    (global as any).fetch = fetchMock;

    const r = await askGemini('p', 'gemini-2.5-flash', { maxRetries: 2 });
    expect(r.text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 bad_request', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeRes(400, 'bad'));
    (global as any).fetch = fetchMock;

    await expect(askGemini('p', 'm', { maxRetries: 2 })).rejects.toMatchObject({ kind: 'bad_request' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 429 to rate_limit and gives up after maxRetries', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeRes(429, 'too many'));
    (global as any).fetch = fetchMock;

    await expect(askGemini('p', 'm', { maxRetries: 1 })).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('reports MAX_TOKENS with no text as truncated', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(
      makeRes(200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }),
    );
    await expect(askGemini('p', 'm', { maxRetries: 0 })).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('reports a prompt-level block', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(
      makeRes(200, { promptFeedback: { blockReason: 'SAFETY' } }),
    );
    await expect(askGemini('p', 'm', { maxRetries: 0 })).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('disables thinking and enables JSON mode for a schema call without search', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okText('{}'));
    (global as any).fetch = fetchMock;

    await askGemini('p', 'm', { responseSchema: { type: 'OBJECT' }, maxRetries: 0 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toEqual({ type: 'OBJECT' });
    expect(body.tools).toBeUndefined();
  });

  it('skips JSON mode but keeps the search tool when grounding is on', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okText('{}'));
    (global as any).fetch = fetchMock;

    await askGemini('p', 'm', { responseSchema: { type: 'OBJECT' }, googleSearch: true, maxRetries: 0 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.responseMimeType).toBeUndefined();
    expect(body.tools).toEqual([{ google_search: {} }]);
  });
});
