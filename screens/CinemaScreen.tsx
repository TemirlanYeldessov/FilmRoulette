import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';

// kino.kz behind DDoS-Guard can hang without ever firing onLoadEnd/onError,
// leaving an infinite spinner. Bail to the error state after this long.
const LOAD_TIMEOUT_MS = 15000;

// kino.kz keeps the selected city in a cookie (city=4 = Aktobe), not the URL.
// We force it two ways: a Cookie header on the first (SSR) request, and a
// document.cookie before content loads so the client-side schedule calls also
// resolve to Aktobe. Loading in a real WebView also clears DDoS-Guard naturally,
// which a cold fetch from the app would not.
const KINO_URL = 'https://kino.kz/ru/movie';
const AKTOBE_COOKIE = 'city=4';

export default function CinemaScreen({ navigation }: any) {
  const webRef = useRef<WebView>(null);
  const timerRef = useRef<any>(null);
  // Once the first load finishes, later in-page navigations must not trip the
  // watchdog — otherwise browsing the site could flip us to the error screen.
  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);

  const clearLoadTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const armLoadTimer = () => {
    clearLoadTimer();
    timerRef.current = setTimeout(() => {
      if (loadedRef.current) return;
      setError(true);
      setLoading(false);
    }, LOAD_TIMEOUT_MS);
  };

  // Arm the watchdog for the initial load and clear it on unmount.
  useEffect(() => {
    armLoadTimer();
    return clearLoadTimer;
  }, []);

  const openExternal = () => Linking.openURL(KINO_URL).catch(() => {});

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
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={handleBack}>
          <Ionicons name="chevron-back" size={20} color="#aaa" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Сейчас в кино</Text>
          <Text style={styles.headerSubtitle}>Актобе · kino.kz</Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={openExternal}>
          <Ionicons name="open-outline" size={18} color="#8888ff" />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color="#555" />
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
          <WebView
            ref={webRef}
            source={{ uri: KINO_URL, headers: { Cookie: AKTOBE_COOKIE } }}
            injectedJavaScriptBeforeContentLoaded={`document.cookie = '${AKTOBE_COOKIE}; path=/'; true;`}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            onLoadStart={() => { setError(false); armLoadTimer(); }}
            onLoadEnd={() => { loadedRef.current = true; setLoading(false); clearLoadTimer(); }}
            onError={() => { setError(true); setLoading(false); clearLoadTimer(); }}
            onNavigationStateChange={(s) => setCanGoBack(s.canGoBack)}
            style={styles.web}
          />
          {loading && (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="#e50914" />
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
    backgroundColor: '#0f0f1a',
    gap: 8,
  },
  headerBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#1e1e30', alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSubtitle: { color: '#888', fontSize: 12, marginTop: 1 },
  web: { flex: 1, backgroundColor: '#0f0f1a' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f0f1a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  errorText: { color: '#aaa', fontSize: 15, textAlign: 'center' },
  retryBtn: { backgroundColor: '#e50914', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, marginTop: 4 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  linkText: { color: '#8888ff', fontSize: 14, marginTop: 4 },
});
