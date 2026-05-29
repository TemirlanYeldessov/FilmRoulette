export const TMDB_TOKEN = process.env.EXPO_PUBLIC_TMDB_TOKEN ?? '';
export const GROQ_KEY = process.env.EXPO_PUBLIC_GROQ_KEY ?? '';
// Optional. When set, the AI picker uses Gemini with Google Search grounding
// (knows fresh releases). Falls back to Groq automatically when empty.
export const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_KEY ?? '';
