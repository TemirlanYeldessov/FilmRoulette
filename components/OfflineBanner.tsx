import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsOffline } from '../utils/useNetworkStatus';
import { colors } from '../constants/theme';

// Thin global bar shown only while the device is offline. Mounted once at the
// app root so every screen gets it for free, instead of each screen discovering
// the dead connection through a 10-30s request timeout. pointerEvents none so it
// never intercepts taps on the content beneath it.
export default function OfflineBanner() {
  const offline = useIsOffline();
  const insets = useSafeAreaInsets();
  if (!offline) return null;

  return (
    <View style={[styles.banner, { paddingTop: insets.top + 6 }]} pointerEvents="none">
      <Ionicons name="cloud-offline-outline" size={15} color={colors.text} />
      <Text style={styles.text}>Нет подключения к интернету</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 8,
    backgroundColor: colors.primaryDark,
  },
  text: { color: colors.text, fontSize: 13, fontWeight: '700' },
});
