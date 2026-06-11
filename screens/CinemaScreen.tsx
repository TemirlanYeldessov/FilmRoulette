import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, gradients, radii } from '../constants/theme';

// Sites behind DDoS-Guard (kino.kz) can hang without ever firing onLoadEnd /
// onError, leaving an infinite spinner. Bail to the error state after this long.
const LOAD_TIMEOUT_MS = 15000;

// Showtime aggregators per city. kino.kz keeps the selected city in a cookie
// (city=4 = Aktobe), not the URL — we force it two ways: a Cookie header on the
// first (SSR) request, and a document.cookie before content loads so the
// client-side schedule calls also resolve to Aktobe. Loading in a real WebView
// also clears DDoS-Guard naturally, which a cold fetch from the app would not.
// kinoafisha.info pins the city in the subdomain, so Orenburg needs no cookie.
const CITIES = [
  {
    key: 'aktobe',
    label: 'Актобе',
    source: 'kino.kz',
    url: 'https://kino.kz/ru/movie',
    cookie: 'city=4' as string | undefined,
  },
  {
    key: 'orenburg',
    label: 'Оренбург',
    source: 'kinoafisha.info',
    url: 'https://orenburg.kinoafisha.info/',
    cookie: undefined as string | undefined,
  },
];
type City = (typeof CITIES)[number];

const CITY_STORAGE_KEY = 'cinemaCity';

export default function CinemaScreen({ navigation }: any) {
  const webRef = useRef<WebView>(null);
  const timerRef = useRef<any>(null);
  // Once the first load finishes, later in-page navigations must not trip the
  // watchdog — otherwise browsing the site could flip us to the error screen.
  const loadedRef = useRef(false);
  const [city, setCity] = useState<City>(CITIES[0]);
  // Don't mount the WebView until the saved city is read — otherwise it starts
  // loading the default city and immediately remounts when the choice arrives.
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);

  const clearLoadTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armLoadTimer = useCallback(() => {
    clearLoadTimer();
    timerRef.current = setTimeout(() => {
      if (loadedRef.current) return;
      setError(true);
      setLoading(false);
    }, LOAD_TIMEOUT_MS);
  }, [clearLoadTimer]);

  // Restore the last chosen city, then arm the watchdog for the initial load.
  useEffect(() => {
    AsyncStorage.getItem(CITY_STORAGE_KEY)
      .then(saved => {
        const found = CITIES.find(c => c.key === saved);
        if (found) setCity(found);
      })
      .catch(() => {})
      .finally(() => {
        setHydrated(true);
        armLoadTimer();
      });
    return clearLoadTimer;
  }, [armLoadTimer, clearLoadTimer]);

  const switchCity = (next: City) => {
    if (next.key === city.key) return;
    AsyncStorage.setItem(CITY_STORAGE_KEY, next.key).catch(() => {});
    // Fresh site → fresh load lifecycle. The WebView remounts via key={city.key}.
    loadedRef.current = false;
    setError(false);
    setLoading(true);
    setCanGoBack(false);
    armLoadTimer();
    setCity(next);
  };

  const openExternal = () => Linking.openURL(city.url).catch(() => {});

  const reload = () => {
    loadedRef.current = false;
    setError(false);
    setLoading(true);
    armLoadTimer();
    webRef.current?.reload();
  };

  const handleBack = () => {
    if (canGoBack) webRef.current?.goBack();
    else navigation.goBack();
  };

  return (
    <LinearGradient colors={gradients.app} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={handleBack} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={20} color={colors.textSoft} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Сейчас в кино</Text>
          <Text style={styles.headerSubtitle}>{city.label} · {city.source}</Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={openExternal} accessibilityRole="button" accessibilityLabel="Открыть в браузере">
          <Ionicons name="open-outline" size={18} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <View style={styles.cityBar}>
        {CITIES.map(c => (
          <TouchableOpacity
            key={c.key}
            style={[styles.cityChip, city.key === c.key && styles.cityChipActive]}
            onPress={() => switchCity(c)}
            accessibilityRole="button"
            accessibilityLabel={`Расписание: ${c.label}`}
          >
            <Ionicons name="location-outline" size={13} color={city.key === c.key ? colors.text : colors.accent} />
            <Text style={[styles.cityChipText, city.key === c.key && styles.cityChipTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.faint} />
          <Text style={styles.errorText}>Не удалось загрузить расписание</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reload}>
            <Text style={styles.retryText}>Повторить</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openExternal}>
            <Text style={styles.linkText}>Открыть в браузере</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {hydrated && (
            <WebView
              key={city.key}
              ref={webRef}
              source={{ uri: city.url, ...(city.cookie ? { headers: { Cookie: city.cookie } } : {}) }}
              injectedJavaScriptBeforeContentLoaded={
                city.cookie ? `document.cookie = '${city.cookie}; path=/'; true;` : 'true;'
              }
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              onLoadStart={() => { setError(false); armLoadTimer(); }}
              onLoadEnd={() => { loadedRef.current = true; setLoading(false); clearLoadTimer(); }}
              onError={() => { setError(true); setLoading(false); clearLoadTimer(); }}
              onNavigationStateChange={(s) => setCanGoBack(s.canGoBack)}
              style={styles.web}
            />
          )}
          {loading && (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: colors.bg,
    gap: 8,
  },
  headerBtn: { width: 38, height: 38, borderRadius: radii.md, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  headerSubtitle: { color: colors.muted, fontSize: 12, marginTop: 1 },
  cityBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10, backgroundColor: colors.bg },
  cityChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.borderSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill },
  cityChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  cityChipText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  cityChipTextActive: { color: colors.text },
  web: { flex: 1, backgroundColor: colors.bg },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  errorText: { color: colors.textSoft, fontSize: 15, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: radii.pill, marginTop: 4 },
  retryText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  linkText: { color: colors.accent, fontSize: 14, marginTop: 4, fontWeight: '700' },
});
