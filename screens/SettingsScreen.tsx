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

export default function SettingsScreen() {
  const { adultContent, toggleAdultContent, watchlist, recentRandomIds, clearRecentRandom } = useAppContext();

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

  return (
    <LinearGradient colors={['#0f0f1a', '#1a1a2e']} style={styles.container}>
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
              trackColor={{ false: '#333', true: '#e50914' }}
              thumbColor={adultContent ? '#fff' : '#aaa'}
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
            <Ionicons name="trash-outline" size={20} color={recentRandomIds.length === 0 ? '#444' : '#e50914'} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>О приложении</Text>
          <View style={styles.infoBlock}>
            <View style={styles.infoRow}>
              <Ionicons name="phone-portrait-outline" size={16} color="#888" />
              <Text style={styles.infoText}>MediaRoulette v1.0</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="film-outline" size={16} color="#888" />
              <Text style={styles.infoText}>Данные: The Movie Database</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="sparkles-outline" size={16} color="#888" />
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
  header: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 28 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 13, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e30', borderRadius: 16, padding: 16, gap: 12 },
  rowDisabled: { opacity: 0.5 },
  rowInfo: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  rowSubtitle: { color: '#888', fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, backgroundColor: '#1e1e30', borderRadius: 16, padding: 16 },
  statValue: { color: '#fff', fontSize: 24, fontWeight: '800' },
  statLabel: { color: '#888', fontSize: 12, marginTop: 2 },
  infoBlock: { backgroundColor: '#1e1e30', borderRadius: 16, padding: 16, gap: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { color: '#aaa', fontSize: 14 },
});
