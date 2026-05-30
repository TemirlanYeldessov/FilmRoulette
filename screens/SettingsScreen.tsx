import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppContext } from '../store/AppContext';
import { colors, gradients, radii } from '../constants/theme';

export default function SettingsScreen() {
  const {
    adultContent, toggleAdultContent, watchlist, recentRandomIds,
    clearRecentRandom, clearWatchlist, resetOnboarding,
  } = useAppContext();

  const confirmClearHistory = () => {
    if (recentRandomIds.length === 0) return;
    Alert.alert(
      'Очистить историю случайных?',
      'Рулетка снова сможет показывать тайтлы, которые уже попадались.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Очистить', style: 'destructive', onPress: clearRecentRandom },
      ]
    );
  };

  const confirmClearWatchlist = () => {
    if (watchlist.length === 0) return;
    Alert.alert(
      'Очистить избранное?',
      'Все сохранённые тайтлы и оценки будут удалены без возможности восстановить.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Очистить', style: 'destructive', onPress: clearWatchlist },
      ]
    );
  };

  return (
    <LinearGradient colors={gradients.app} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>Настройки</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Контент</Text>
          <View style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Взрослый контент 18+</Text>
              <Text style={styles.rowSubtitle}>Влияет на все разделы приложения</Text>
            </View>
            <Switch
              value={adultContent}
              onValueChange={toggleAdultContent}
              trackColor={{ false: colors.borderSoft, true: colors.primary }}
              thumbColor={adultContent ? colors.text : colors.textSoft}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Статистика</Text>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{watchlist.length}</Text>
              <Text style={styles.statLabel}>в избранном</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recentRandomIds.length}</Text>
              <Text style={styles.statLabel}>последних случайных</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Данные</Text>
          <TouchableOpacity
            style={[styles.row, recentRandomIds.length === 0 && styles.rowDisabled]}
            onPress={confirmClearHistory}
            disabled={recentRandomIds.length === 0}
          >
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Очистить историю случайных</Text>
              <Text style={styles.rowSubtitle}>
                {recentRandomIds.length > 0
                  ? `Сейчас запомнено ${recentRandomIds.length}`
                  : 'История пуста'}
              </Text>
            </View>
            <Ionicons name="trash-outline" size={20} color={recentRandomIds.length === 0 ? colors.faint : colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.row, { marginTop: 12 }, watchlist.length === 0 && styles.rowDisabled]}
            onPress={confirmClearWatchlist}
            disabled={watchlist.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Очистить избранное"
          >
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Очистить избранное</Text>
              <Text style={styles.rowSubtitle}>
                {watchlist.length > 0
                  ? `Удалить ${watchlist.length} и все оценки`
                  : 'Избранное пусто'}
              </Text>
            </View>
            <Ionicons name="heart-dislike-outline" size={20} color={watchlist.length === 0 ? colors.faint : colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.row, { marginTop: 12 }]}
            onPress={resetOnboarding}
            accessibilityRole="button"
            accessibilityLabel="Показать вступление снова"
          >
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Показать вступление снова</Text>
              <Text style={styles.rowSubtitle}>Откроется при следующем запуске</Text>
            </View>
            <Ionicons name="refresh-outline" size={20} color={colors.accent} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>О приложении</Text>
          <View style={styles.infoBlock}>
            <View style={styles.infoRow}>
              <Ionicons name="phone-portrait-outline" size={16} color={colors.muted} />
              <Text style={styles.infoText}>MediaRoulette v1.0</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="film-outline" size={16} color={colors.muted} />
              <Text style={styles.infoText}>Данные: The Movie Database</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="sparkles-outline" size={16} color={colors.muted} />
              <Text style={styles.infoText}>ИИ-подборщик: Gemini</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  header: { fontSize: 28, fontWeight: '900', color: colors.text, marginBottom: 28 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 13, color: colors.muted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.borderSoft },
  rowDisabled: { opacity: 0.5 },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  rowSubtitle: { color: colors.muted, fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: 16, borderWidth: 1, borderColor: colors.borderSoft },
  statValue: { color: colors.text, fontSize: 24, fontWeight: '900' },
  statLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },
  infoBlock: { backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.borderSoft },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { color: colors.textSoft, fontSize: 14 },
});
