import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useAppContext } from '../store/AppContext';
import { TMDB_TOKEN, GROQ_KEY } from '../constants/api';
const { width } = Dimensions.get('window');
const cardWidth = (width - 48) / 2;

const ALL_SUGGESTIONS = [
  'Молодёжные комедии с пляжем и тусовками',
  'Грустный фильм чтобы поплакать',
  'Что-то напряжённое и непредсказуемое',
  'Лёгкий сериал чтобы фоном смотреть',
  'Что-то про космос или будущее',
  'Классика которую все видели кроме меня',
  'Криминальная драма как Breaking Bad',
  'Романтика с хэппи эндом',
  'Ужасы которые реально пугают',
  'Смешной сериал для вечера с друзьями',
  'Что-то вдохновляющее про спорт',
  'Исторический фильм про войну',
  'Аниме с глубоким сюжетом',
  'Детектив где надо думать',
  'Что-то про путешествия и приключения',
  'Фэнтези как Игра Престолов',
  'Документалка про природу или животных',
  'Триллер где не знаешь чем закончится',
  'Семейный фильм на вечер',
  'Биография реального человека',
  'Мафия и организованная преступность',
  'Постапокалипсис или выживание',
  'Психологический триллер',
  'Супергерои и комиксы',
  'Романтическая комедия',
  'Фантастика про искусственный интеллект',
  'Что-то как Stranger Things',
  'Корейская дорама',
  'Фильм про месть',
  'Сериал про врачей или полицейских',
];

function getRandomSuggestions(count = 6) {
  return [...ALL_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, count);
}

async function askGroq(mood: string) {
  const prompt = `Ты эксперт по кино и сериалам. Пользователь описал что хочет посмотреть: "${mood}".

ВАЖНО: Сначала определи - пользователь явно просит ФИЛЬМ, СЕРИАЛ, или не уточняет.
- Если в запросе есть слова "фильм", "кино", "movie" → mediaTypeFilter = "movie" (только фильмы)
- Если в запросе есть слова "сериал", "шоу", "series", "сезон" → mediaTypeFilter = "tv" (только сериалы)
- Если тип не указан явно → mediaTypeFilter = "mixed" (можно вперемешку)

Подбери 40 конкретных названий которые МАКСИМАЛЬНО точно соответствуют запросу.

Критерии:
- Соблюдай mediaTypeFilter строго
- Подбирай по атмосфере, вайбу, элементам которые упомянул пользователь
- Только реально существующие фильмы/сериалы
- Разнообразие годов
- Без повторений

Ответь ТОЛЬКО в формате JSON без markdown:
{
  "mediaTypeFilter": "movie" | "tv" | "mixed",
  "reason": "1-2 предложения почему эти тайтлы подходят",
  "titles": ["English Title 1", "English Title 2", ...]
}

Все названия на английском. Ровно 40 уникальных названий.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 1500,
    }),
  });

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';

  if (!text) {
    throw new Error('Пустой ответ');
  }

  const match = text.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error('JSON не найден');
  }

  return JSON.parse(match[0]);
}

async function searchTitle(title: string, adultContent: boolean, mediaTypeFilter: string) {
  const res = await fetch(
    `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(title)}&language=ru-RU&include_adult=${adultContent}`,
    { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }
  );
  const data = await res.json();

  const results = (data.results || []).filter((m: any) => {
    if (!m.poster_path) return false;
    if (mediaTypeFilter === 'movie') return m.media_type === 'movie';
    if (mediaTypeFilter === 'tv') return m.media_type === 'tv';
    return m.media_type === 'movie' || m.media_type === 'tv';
  });

  return results[0] || null;
}

async function fetchDetails(id: number, type: string) {
  const [ruRes, enRes] = await Promise.all([
    fetch(`https://api.themoviedb.org/3/${type}/${id}?language=ru-RU`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    }),
    fetch(`https://api.themoviedb.org/3/${type}/${id}?language=en-US`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    }),
  ]);

  const ruData = await ruRes.json();
  const enData = await enRes.json();

  const resRu = await fetch(`https://api.themoviedb.org/3/${type}/${id}/videos?language=ru-RU`, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
  });
  const dataRu = await resRu.json();
  let trailer = dataRu.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');

  if (!trailer) {
    const resEn = await fetch(`https://api.themoviedb.org/3/${type}/${id}/videos?language=en-US`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    });
    const dataEn = await resEn.json();
    trailer = dataEn.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
  }

  return {
    id,
    titleRu: ruData.title || ruData.name,
    titleEn: enData.title || enData.name,
    overview: ruData.overview || enData.overview,
    poster: `https://image.tmdb.org/t/p/w500${ruData.poster_path}`,
    trailerKey: trailer?.key || null,
    genreId: null,
    mediaType: type,
    rating: ruData.vote_average ? ruData.vote_average.toFixed(1) : null,
    year: (ruData.release_date || ruData.first_air_date || '').slice(0, 4),
    country: ruData.production_countries?.[0]?.name || null,
    genres: ruData.genres?.map((g: any) => g.name).join(', ') || null,
  };
}

export default function MoodScreen({ navigation }: any) {
  const { adultContent } = useAppContext();
  const [mood, setMood] = useState('');
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showInput, setShowInput] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [suggestions] = useState(() => getRandomSuggestions(6));
  const restartTimerRef = useRef<any>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript || '';
    if (transcript) setMood(transcript);
  });

  useSpeechRecognitionEvent('end', () => {
    if (isListening) {
      restartTimerRef.current = setTimeout(() => {
        ExpoSpeechRecognitionModule.start({
          lang: 'ru-RU',
          interimResults: true,
          continuous: true,
          addsPunctuation: true,
        });
      }, 200);
    } else {
      setIsListening(false);
    }
  });

  useSpeechRecognitionEvent('error', () => {
    setIsListening(false);
  });

  useEffect(() => {
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    };
  }, []);

  const startListening = async () => {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

    if (!result.granted) {
      return;
    }

    setIsListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: 'ru-RU',
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
    });
  };

  const stopListening = () => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    setIsListening(false);
    ExpoSpeechRecognitionModule.stop();
  };

  const find = async (text: string) => {
    if (!text.trim()) return;

    if (isListening) stopListening();

    setLoading(true);
    setResults([]);
    setReason('');
    setShowInput(false);

    try {
      const groqResult = await askGroq(text);
      setReason(groqResult.reason);

      const seenIds = new Set<string>();
      const found: any[] = [];

      for (const title of groqResult.titles) {
        const item = await searchTitle(title, adultContent, groqResult.mediaTypeFilter);

        if (!item) continue;

        const key = `${item.id}-${item.media_type}`;

        if (seenIds.has(key)) continue;

        seenIds.add(key);
        found.push(item);
      }

      setResults(found);
    } catch (e) {
      console.error(e);
      setShowInput(true);
    }

    setLoading(false);
  };

  const openCard = async (item: any) => {
    const details = await fetchDetails(item.id, item.media_type);
    navigation.navigate('Card', { movie: details });
  };

  const reset = () => {
    setShowInput(true);
    setResults([]);
    setReason('');
    setMood('');
  };

  if (!showInput) {
    return (
      <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
        <View style={styles.resultsHeader}>
          <TouchableOpacity onPress={reset} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color="#8888ff" />
            <Text style={styles.backBtnText}>Новый запрос</Text>
          </TouchableOpacity>

          {reason ? (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonText}>💡 {reason}</Text>
            </View>
          ) : null}

          {!loading && results.length > 0 && (
            <Text style={styles.countText}>Найдено: {results.length} уникальных тайтлов</Text>
          )}
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#e50914" />
            <Text style={styles.loadingText}>ИИ анализирует запрос и собирает подборку...</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item, index) => `${item.id}-${item.media_type}-${index}`}
            numColumns={2}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.row}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.card} onPress={() => openCard(item)}>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeBadgeText}>{item.media_type === 'tv' ? 'Сериал' : 'Фильм'}</Text>
                </View>

                <Image
                  source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
                  style={styles.poster}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory-disk"
                />

                <Text style={styles.cardTitle} numberOfLines={2}>{item.title || item.name}</Text>

                {item.vote_average > 0 && (
                  <Text style={styles.cardRating}>★ {item.vote_average.toFixed(1)}</Text>
                )}
              </TouchableOpacity>
            )}
          />
        )}
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <FlatList
          data={suggestions}
          keyExtractor={(s) => s}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.inputArea}>
              <Text style={styles.header}>✨ ИИ-подборщик</Text>

              <View style={styles.aiBadge}>
                <Ionicons name="sparkles" size={12} color="#8888ff" />
                <Text style={styles.aiBadgeText}>Powered by Groq AI</Text>
              </View>

              <Text style={styles.subtitle}>
                Опиши вайб, настроение или конкретный запрос — ИИ подберёт релевантные фильмы и сериалы
              </Text>

              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Например: хочу посмотреть фильм про..."
                  placeholderTextColor="#555"
                  value={mood}
                  onChangeText={setMood}
                  multiline
                  numberOfLines={3}
                />

                <TouchableOpacity
                  style={[styles.micBtn, isListening && styles.micBtnActive]}
                  onPress={isListening ? stopListening : startListening}
                >
                  <Ionicons
                    name={isListening ? 'stop-circle' : 'mic'}
                    size={24}
                    color={isListening ? '#e50914' : '#aaa'}
                  />
                </TouchableOpacity>
              </View>

              {isListening && (
                <View style={styles.listeningBadge}>
                  <View style={styles.listeningDot} />
                  <Text style={styles.listeningText}>Слушаю, говорите...</Text>
                </View>
              )}

              <TouchableOpacity style={styles.findBtn} onPress={() => find(mood)}>
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={styles.findText}>Подобрать</Text>
              </TouchableOpacity>

              <Text style={styles.suggestTitle}>Идеи для поиска:</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chip}
              onPress={() => {
                setMood(item);
                find(item);
              }}
            >
              <Text style={styles.chipText}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inputArea: { padding: 20, paddingTop: 60 },
  header: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a1a40', borderWidth: 1, borderColor: '#4444aa', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 12 },
  aiBadgeText: { color: '#8888ff', fontSize: 12, fontWeight: '600' },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 24, lineHeight: 20 },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  input: { flex: 1, backgroundColor: '#1e1e30', borderRadius: 16, padding: 16, color: '#fff', fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  micBtn: { backgroundColor: '#1e1e30', borderRadius: 16, width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333' },
  micBtnActive: { backgroundColor: '#1a0505', borderColor: '#e50914' },
  listeningBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  listeningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e50914' },
  listeningText: { color: '#e50914', fontSize: 13, fontWeight: '600' },
  findBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#e50914', paddingVertical: 16, borderRadius: 30, marginBottom: 24, marginTop: 8 },
  findText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  suggestTitle: { fontSize: 15, color: '#aaa', marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: '#333', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, marginHorizontal: 20, marginBottom: 10 },
  chipText: { color: '#ccc', fontSize: 13 },
  resultsHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  backBtnText: { color: '#8888ff', fontSize: 14 },
  reasonBox: { backgroundColor: '#1e1e30', borderRadius: 12, padding: 14, marginBottom: 8 },
  reasonText: { color: '#ccc', fontSize: 14, lineHeight: 20 },
  countText: { color: '#666', fontSize: 12, marginTop: 4 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 },
  loadingText: { color: '#aaa', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  grid: { padding: 12 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: { width: cardWidth },
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#1a1a40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  typeBadgeText: { color: '#8888ff', fontSize: 11, fontWeight: '600' },
  poster: { width: cardWidth, height: cardWidth * 1.5, borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  cardRating: { color: '#aaa', fontSize: 11 },
});
