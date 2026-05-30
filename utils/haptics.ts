import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Thin, crash-safe wrapper around expo-haptics. Calls are best-effort: if the
// native module is missing (e.g. an older installed build before this dep was
// added) or the platform has no haptics, we swallow the error instead of
// crashing the interaction. Web has no haptics at all.
const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

export function tapLight() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function tapMedium() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function notifySuccess() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function notifyError() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
