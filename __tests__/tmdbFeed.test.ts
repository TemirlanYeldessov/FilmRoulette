import { TmdbFeed } from '../utils/tmdbFeed';

// Build a TMDB-shaped page response.
const page = (results: any[], total_results: number, total_pages: number) =>
  ({ results, total_results, total_pages });

const movie = (id: number, extra: any = {}) =>
  ({ id, media_type: 'movie', poster_path: `/p${id}.jpg`, ...extra });

describe('TmdbFeed', () => {
  it('loads the first page, stamps fixedType and records the total', async () => {
    const feed = new TmdbFeed([{ makeUrl: p => `/discover?page=${p}`, fixedType: 'tv' }]);
    const fetchJson = jest.fn().mockResolvedValue(page([{ id: 1, poster_path: '/a.jpg' }], 250, 13));

    const items = await feed.loadNext(fetchJson);
    expect(items).toEqual([{ id: 1, poster_path: '/a.jpg', media_type: 'tv' }]);
    expect(feed.total).toBe(250);
    expect(feed.exhausted).toBe(false);
    expect(fetchJson).toHaveBeenCalledWith('/discover?page=1');
  });

  it('paginates across loadNext calls and reports exhausted at the end', async () => {
    const feed = new TmdbFeed([{ makeUrl: p => `/s?page=${p}` }]);
    const fetchJson = jest.fn()
      .mockResolvedValueOnce(page([movie(1)], 2, 2))
      .mockResolvedValueOnce(page([movie(2)], 2, 2));

    const first = await feed.loadNext(fetchJson);
    expect(first.map(i => i.id)).toEqual([1]);
    expect(feed.exhausted).toBe(false);

    const second = await feed.loadNext(fetchJson);
    expect(second.map(i => i.id)).toEqual([2]);
    expect(feed.exhausted).toBe(true);

    // Nothing left to fetch.
    expect(await feed.loadNext(fetchJson)).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('dedupes across pages/sources and skips posterless + non-movie/tv items', async () => {
    const feed = new TmdbFeed([{ makeUrl: p => `/a?page=${p}` }, { makeUrl: p => `/b?page=${p}` }]);
    const fetchJson = jest.fn()
      .mockResolvedValueOnce(page([movie(1), { id: 9, media_type: 'person', poster_path: '/x.jpg' }], 1, 1))
      .mockResolvedValueOnce(page([movie(1), movie(2, { poster_path: null })], 1, 1));

    const items = await feed.loadNext(fetchJson);
    // movie 1 once (deduped), person dropped, posterless movie 2 dropped.
    expect(items.map(i => i.id)).toEqual([1]);
    // total summed across both sources.
    expect(feed.total).toBe(2);
  });

  it('honors the hidden set', async () => {
    const feed = new TmdbFeed([{ makeUrl: p => `/s?page=${p}` }]);
    const fetchJson = jest.fn().mockResolvedValue(page([movie(1), movie(2)], 2, 1));
    const items = await feed.loadNext(fetchJson, new Set(['1-movie']));
    expect(items.map(i => i.id)).toEqual([2]);
  });

  it('stops paging a source that errored instead of looping forever', async () => {
    const feed = new TmdbFeed([{ makeUrl: p => `/s?page=${p}` }]);
    const fetchJson = jest.fn().mockResolvedValue(null);
    expect(await feed.loadNext(fetchJson)).toEqual([]);
    expect(feed.exhausted).toBe(true);
    expect(await feed.loadNext(fetchJson)).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('propagates an AbortError out of loadNext', async () => {
    const feed = new TmdbFeed([{ makeUrl: p => `/s?page=${p}` }]);
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchJson = jest.fn().mockRejectedValue(abort);
    await expect(feed.loadNext(fetchJson)).rejects.toBe(abort);
  });
});
