// Shared filter option lists used by the Catalog and Top screens. Kept in one
// place so the same filter offers the same choices everywhere — previously the
// country/language lists had silently diverged between the two screens.

export const MOVIE_GENRES = [
  { id: 0, name: 'Все жанры' },
  { id: 28, name: 'Боевик' },
  { id: 12, name: 'Приключения' },
  { id: 16, name: 'Анимация' },
  { id: 35, name: 'Комедия' },
  { id: 80, name: 'Криминал' },
  { id: 99, name: 'Документальный' },
  { id: 18, name: 'Драма' },
  { id: 10751, name: 'Семейный' },
  { id: 14, name: 'Фэнтези' },
  { id: 36, name: 'История' },
  { id: 27, name: 'Ужасы' },
  { id: 10402, name: 'Музыка' },
  { id: 9648, name: 'Мистика' },
  { id: 10749, name: 'Романтика' },
  { id: 878, name: 'Фантастика' },
  { id: 10770, name: 'Телефильм' },
  { id: 53, name: 'Триллер' },
  { id: 10752, name: 'Военный' },
  { id: 37, name: 'Вестерн' },
];

export const TV_GENRES = [
  { id: 0, name: 'Все жанры' },
  { id: 10759, name: 'Боевик' },
  { id: 16, name: 'Анимация' },
  { id: 35, name: 'Комедия' },
  { id: 80, name: 'Криминал' },
  { id: 99, name: 'Документальный' },
  { id: 18, name: 'Драма' },
  { id: 10751, name: 'Семейный' },
  { id: 10762, name: 'Детский' },
  { id: 9648, name: 'Мистика' },
  { id: 10763, name: 'Новости' },
  { id: 10764, name: 'Реалити' },
  { id: 10765, name: 'Фантастика' },
  { id: 10766, name: 'Мелодрама' },
  { id: 10767, name: 'Ток-шоу' },
  { id: 10768, name: 'Война и политика' },
  { id: 37, name: 'Вестерн' },
];

export const COUNTRIES = [
  { code: '', name: 'Любая' },
  { code: 'US', name: 'США' },
  { code: 'GB', name: 'Великобритания' },
  { code: 'RU', name: 'Россия' },
  { code: 'KR', name: 'Корея' },
  { code: 'JP', name: 'Япония' },
  { code: 'FR', name: 'Франция' },
  { code: 'DE', name: 'Германия' },
  { code: 'IT', name: 'Италия' },
  { code: 'ES', name: 'Испания' },
  { code: 'IN', name: 'Индия' },
  { code: 'CN', name: 'Китай' },
  { code: 'TR', name: 'Турция' },
];

export const LANGUAGES = [
  { code: '', name: 'Любой' },
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'Английский' },
  { code: 'ko', name: 'Корейский' },
  { code: 'ja', name: 'Японский' },
  { code: 'fr', name: 'Французский' },
  { code: 'de', name: 'Немецкий' },
  { code: 'es', name: 'Испанский' },
  { code: 'it', name: 'Итальянский' },
  { code: 'hi', name: 'Хинди' },
  { code: 'tr', name: 'Турецкий' },
  { code: 'zh', name: 'Китайский' },
];

export const RATINGS = [0, 5, 6, 7, 8, 9];
export const MAX_RATINGS = [10, 9, 8, 7, 6, 5];

export const SORT_OPTIONS = [
  { key: 'popularity.desc', name: 'По популярности' },
  { key: 'vote_average.desc', name: 'По рейтингу' },
  { key: 'release_date.desc', name: 'Сначала новые' },
  { key: 'release_date.asc', name: 'Сначала старые' },
];
