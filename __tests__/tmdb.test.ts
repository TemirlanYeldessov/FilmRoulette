import {
  dedup,
  sanitizeYearRange,
  areFiltersEqual,
  applyDiscoverFilters,
  itemToMovie,
  pickTrailerKey,
} from '../utils/tmdb';

describe('dedup', () => {
  it('collapses duplicates by media_type + id', () => {
    const items = [
      { id: 1, media_type: 'movie' },
      { id: 1, media_type: 'movie' },
      { id: 1, media_type: 'tv' },
      { id: 2, media_type: 'movie' },
    ];
    expect(dedup(items)).toEqual([
      { id: 1, media_type: 'movie' },
      { id: 1, media_type: 'tv' },
      { id: 2, media_type: 'movie' },
    ]);
  });

  it('uses the fallback type when an item omits media_type', () => {
    const items = [{ id: 5 }, { id: 5, media_type: 'movie' }];
    // First gets key "movie-5" via fallback, second is the same → deduped.
    expect(dedup(items, 'movie')).toEqual([{ id: 5 }]);
  });
});

describe('sanitizeYearRange', () => {
  it('passes through a valid range', () => {
    expect(sanitizeYearRange('1990', '2000')).toEqual({ yearFrom: '1990', yearTo: '2000' });
  });

  it('drops non-numeric and out-of-bounds values', () => {
    expect(sanitizeYearRange('abc', '1800')).toEqual({ yearFrom: '', yearTo: '' });
  });

  it('swaps a reversed range', () => {
    expect(sanitizeYearRange('2010', '1995')).toEqual({ yearFrom: '1995', yearTo: '2010' });
  });

  it('keeps one side when the other is empty', () => {
    expect(sanitizeYearRange('2015', '')).toEqual({ yearFrom: '2015', yearTo: '' });
  });
});

describe('areFiltersEqual', () => {
  it('is true for structurally equal objects', () => {
    expect(areFiltersEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it('is false when a value differs', () => {
    expect(areFiltersEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('applyDiscoverFilters', () => {
  it('maps year + rating fields for movies', () => {
    const out = applyDiscoverFilters({}, { yearFrom: '2000', yearTo: '2010', minRating: 7, maxRating: 9 }, 'movie');
    expect(out['primary_release_date.gte']).toBe('2000-01-01');
    expect(out['primary_release_date.lte']).toBe('2010-12-31');
    expect(out['vote_average.gte']).toBe('7');
    expect(out['vote_average.lte']).toBe('9');
  });

  it('uses air-date fields for tv', () => {
    const out = applyDiscoverFilters({}, { yearFrom: '2018' }, 'tv');
    expect(out['first_air_date.gte']).toBe('2018-01-01');
    expect(out['primary_release_date.gte']).toBeUndefined();
  });

  it('omits rating bounds at their defaults', () => {
    const out = applyDiscoverFilters({}, { minRating: 0, maxRating: 10 }, 'movie');
    expect(out['vote_average.gte']).toBeUndefined();
    expect(out['vote_average.lte']).toBeUndefined();
  });
});

describe('itemToMovie', () => {
  it('maps a raw movie item to the slim card model', () => {
    const movie = itemToMovie({
      id: 42,
      media_type: 'movie',
      title: 'Test',
      overview: 'x',
      poster_path: '/p.jpg',
      vote_average: 7.84,
      release_date: '1999-03-31',
    });
    expect(movie).toMatchObject({
      id: 42,
      mediaType: 'movie',
      titleEn: 'Test',
      poster: 'https://image.tmdb.org/t/p/w500/p.jpg',
      rating: '7.8',
      year: '1999',
    });
  });

  it('falls back to the given type and null poster', () => {
    const tv = itemToMovie({ id: 7, name: 'Show', first_air_date: '2020-01-01' }, 'tv');
    expect(tv.mediaType).toBe('tv');
    expect(tv.poster).toBeNull();
    expect(tv.year).toBe('2020');
  });

  it('leaves rating null when no votes', () => {
    expect(itemToMovie({ id: 1, vote_average: 0 }, 'movie').rating).toBeNull();
  });
});

describe('pickTrailerKey', () => {
  it('prefers the RU YouTube trailer', () => {
    const ru = { videos: { results: [{ type: 'Trailer', site: 'YouTube', key: 'RU1' }] } };
    const en = { videos: { results: [{ type: 'Trailer', site: 'YouTube', key: 'EN1' }] } };
    expect(pickTrailerKey(ru, en)).toBe('RU1');
  });

  it('falls back to EN when RU has none', () => {
    const ru = { videos: { results: [] } };
    const en = { videos: { results: [{ type: 'Trailer', site: 'YouTube', key: 'EN1' }] } };
    expect(pickTrailerKey(ru, en)).toBe('EN1');
  });

  it('returns null when no YouTube trailer exists', () => {
    const ru = { videos: { results: [{ type: 'Teaser', site: 'YouTube', key: 'T' }] } };
    expect(pickTrailerKey(ru, {})).toBeNull();
  });
});
