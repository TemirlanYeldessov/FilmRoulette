import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, gradients, radii } from '../constants/theme';

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

  // Arm the watchdog for the initial load and clear it on unmount.
  useEffect(() => {
    armLoadTimer();
    return clearLoadTimer;
  }, [armLoadTimer, clearLoadTimer]);

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
    <LinearGradient colors={gradients.app} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={handleBack} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={20} color={colors.textSoft} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Сейчас в кино</Text>
          <Text style={styles.headerSubtitle}>Актобе · kino.kz</Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={openExternal} accessibilityRole="button" accessibilityLabel="Открыть в браузере">
          <Ionicons name="open-outline" size={18} color={colors.accent} />
        </TouchableOpacity>
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
  web: { flex: 1, backgroundColor: colors.bg },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  errorText: { color: colors.textSoft, fontSize: 15, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: radii.pill, marginTop: 4 },
  retryText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  linkText: { color: colors.accent, fontSize: 14, marginTop: 4, fontWeight: '700' },
});
