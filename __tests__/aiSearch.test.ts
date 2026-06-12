import {
  extractJsonObject,
  normalizeGeminiResult,
  isLikelyTitleMatch,
  parseDirectIntent,
  friendlyAiError,
  isFreshnessQuery,
  isAdultQuery,
  isGenericAdultQuery,
  adultSearchTerms,
} from '../utils/aiSearch';
import { AiError } from '../utils/gemini';

describe('extractJsonObject', () => {
  it('returns a clean object unchanged', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('unwraps a markdown code fence', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('ignores prose before and after', () => {
    expect(extractJsonObject('Вот ответ: {"a":1} — готово')).toBe('{"a":1}');
  });

  it('handles braces inside string literals', () => {
    expect(extractJsonObject('{"a":"}{"}')).toBe('{"a":"}{"}');
  });

  it('returns null for a truncated object (the MAX_TOKENS case)', () => {
    expect(extractJsonObject('{"titles":["A","B"')).toBeNull();
  });
});

describe('normalizeGeminiResult', () => {
  it('coerces a bare string array to {title, year:null}', () => {
    const r = normalizeGeminiResult({ mediaTypeFilter: 'movie', titles: ['Heat', 'Drive'] });
    expect(r.mediaTypeFilter).toBe('movie');
    expect(r.titles).toEqual([
      { title: 'Heat', year: null },
      { title: 'Drive', year: null },
    ]);
  });

  it('keeps a valid year and drops an implausible one', () => {
    const r = normalizeGeminiResult({
      mediaTypeFilter: 'mixed',
      titles: [{ title: 'Dune', year: 2021 }, { title: 'X', year: 3000 }],
    });
    expect(r.titles).toEqual([
      { title: 'Dune', year: 2021 },
      { title: 'X', year: null },
    ]);
  });

  it('dedupes case-insensitively and skips junk entries', () => {
    const r = normalizeGeminiResult({ titles: ['Heat', 'heat', '', 42, { title: '  ' }] });
    expect(r.titles).toEqual([{ title: 'Heat', year: null }]);
  });

  it('falls back to mixed for an unknown mediaTypeFilter', () => {
    expect(normalizeGeminiResult({ mediaTypeFilter: 'banana', titles: ['A'] }).mediaTypeFilter).toBe('mixed');
  });

  it('throws titles_empty when nothing is usable', () => {
    expect(() => normalizeGeminiResult({ titles: [] })).toThrow(AiError);
    try {
      normalizeGeminiResult({ titles: [123, ''] });
    } catch (e: any) {
      expect(e.kind).toBe('titles_empty');
    }
  });
});

describe('isLikelyTitleMatch', () => {
  it('matches an exact title', () => {
    expect(isLikelyTitleMatch('Heat', { title: 'Heat' })).toBe(true);
  });

  it('does not match unrelated short titles (Her vs Heat)', () => {
    expect(isLikelyTitleMatch('Her', { title: 'Heat' })).toBe(false);
  });

  it('matches a longer title by substring', () => {
    expect(isLikelyTitleMatch('The Matrix', { title: 'The Matrix Reloaded' })).toBe(true);
  });

  it('tolerates a small typo on a long title', () => {
    expect(isLikelyTitleMatch('Interstellar', { title: 'Interstelar' })).toBe(true);
  });

  it('checks original_title / name fields too', () => {
    expect(isLikelyTitleMatch('Parasite', { title: 'Паразиты', original_title: 'Parasite' })).toBe(true);
  });
});

describe('parseDirectIntent', () => {
  it('routes "новинки" to a recent-release discover', () => {
    const intent = parseDirectIntent('новинки', false);
    expect(intent?.type).toBe('movie');
    expect(intent?.params.sort_by).toBe('popularity.desc');
    expect(intent?.params['primary_release_date.gte']).toBeDefined();
  });

  it('routes a bare genre to with_genres', () => {
    expect(parseDirectIntent('комедии', false)?.params.with_genres).toBe('35');
  });

  it('routes "лучшие фильмы" to a top-rated sort', () => {
    expect(parseDirectIntent('лучшие фильмы', false)?.params.sort_by).toBe('vote_average.desc');
  });

  it('defers a semantic ("как X") query to the LLM', () => {
    expect(parseDirectIntent('как Breaking Bad', false)).toBeNull();
  });

  it('defers when meaningful words survive stripping', () => {
    expect(parseDirectIntent('что-то про космос', false)).toBeNull();
  });

  it('maps a movie genre to its TV bucket for series queries', () => {
    // "фантастика" (878) → TV sci-fi/fantasy bucket 10765.
    const intent = parseDirectIntent('фантастика сериалы', false);
    expect(intent?.type).toBe('tv');
    expect(intent?.params.with_genres).toBe('10765');
  });
});

describe('isAdultQuery / adultSearchTerms', () => {
  it('detects Russian and English adult intent', () => {
    expect(isAdultQuery('порно новинки')).toBe(true);
    expect(isAdultQuery('хочу хентай')).toBe(true);
    expect(isAdultQuery('pornhub')).toBe(true);
    expect(isAdultQuery('фильмы 18+')).toBe(true);
  });

  it('stays quiet on normal queries', () => {
    expect(isAdultQuery('комедии для всей семьи')).toBe(false);
    expect(isAdultQuery('Sussex murders documentary')).toBe(false);
  });

  it('leads a generic porn ask with big studios', () => {
    const terms = adultSearchTerms('порно');
    expect(terms.slice(0, 4)).toEqual(['blacked', 'brazzers', 'tushy', 'naughty america']);
    expect(terms).toContain('porn');
  });

  it('treats pornhub as a generic ask (studios) too', () => {
    expect(adultSearchTerms('pornhub')).toContain('blacked');
  });

  it('searches a non-porn adult keyword by itself, no studios', () => {
    expect(adultSearchTerms('хентай')).toEqual(['hentai']);
  });

  it('searches a specific named query verbatim', () => {
    expect(adultSearchTerms('blacked raw')).toEqual(['blacked raw']);
    expect(adultSearchTerms('хентай аниме')).toEqual(['хентай аниме', 'hentai']);
  });
});

describe('isGenericAdultQuery', () => {
  it('is true for a bare adult ask', () => {
    expect(isGenericAdultQuery('порно')).toBe(true);
    expect(isGenericAdultQuery('хочу посмотреть порно')).toBe(true);
    expect(isGenericAdultQuery('18+')).toBe(true);
  });

  it('is false when a specific topic survives', () => {
    expect(isGenericAdultQuery('blacked raw')).toBe(false);
    expect(isGenericAdultQuery('эротический триллер с Шерон Стоун')).toBe(false);
  });
});

describe('friendlyAiError', () => {
  it('explains an overloaded service', () => {
    expect(friendlyAiError(new AiError('overloaded', 'x'))).toMatch(/перегружен/i);
  });

  it('does not blame the key for a 503', () => {
    expect(friendlyAiError(new AiError('overloaded', 'x'))).not.toMatch(/ключ/i);
  });

  it('points auth errors at availability, not the user', () => {
    expect(friendlyAiError(new AiError('auth', 'x'))).toMatch(/недоступен/i);
  });

  it('has a sane default for non-AiError throws', () => {
    expect(friendlyAiError(new Error('boom'))).toMatch(/Не удалось собрать подборку/i);
  });
});

describe('isFreshnessQuery', () => {
  it('detects an explicit recent year', () => {
    expect(isFreshnessQuery('что-то 2024 года')).toBe(true);
  });

  it('detects freshness wording', () => {
    expect(isFreshnessQuery('новинки этого месяца')).toBe(true);
  });

  it('is false for a classic query', () => {
    expect(isFreshnessQuery('классика 90-х')).toBe(false);
  });
});
