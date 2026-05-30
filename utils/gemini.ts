import { GEMINI_KEY } from '../constants/api';

type GeminiResponse = {
  text: string;
  raw?: any;
};

// JS fetch-based implementation for Expo / React Native managed workflow.
// Uses the public API via a simple POST and returns an object with `text`.
export async function askGemini(prompt: string, model = 'gemini-2.5-flash'): Promise<GeminiResponse> {
  const key = GEMINI_KEY;
  if (!key) throw new Error('Gemini API key is not set (EXPO_PUBLIC_GEMINI_KEY)');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateText?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [
      { parts: [{ text: prompt }] }
    ],
    tools: [{ googleSearch: {} }]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${txt}`);
  }

  const data = await res.json();

  // Per scenario: result at data.candidates[0].content.parts[0].text
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? data?.candidates?.[0]?.output?.[0]?.text ?? '';
  if (!text) {
    // If shape differs, keep raw data for debugging.
    return { text: JSON.stringify(data), raw: data };
  }
  return { text, raw: data };
}
