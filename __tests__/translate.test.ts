import { isLikelyRussian } from '../utils/translate';

describe('isLikelyRussian', () => {
  it('treats predominantly Cyrillic text as Russian', () => {
    expect(isLikelyRussian('Драма о взрослении в маленьком городе.')).toBe(true);
  });

  it('treats English text as not Russian', () => {
    expect(isLikelyRussian('A coming-of-age drama set in a small town.')).toBe(false);
  });

  it('treats CJK / other scripts as not Russian (so they still get the option)', () => {
    expect(isLikelyRussian('小さな町で育つ少年の物語。')).toBe(false);
  });

  it('keeps the toggle off for Russian text sprinkled with Latin names', () => {
    expect(isLikelyRussian('Фильм режиссёра Christopher Nolan о времени.')).toBe(true);
  });

  it('is false for empty / letterless text', () => {
    expect(isLikelyRussian('')).toBe(false);
    expect(isLikelyRussian('2024 — 1999!')).toBe(false);
  });
});
