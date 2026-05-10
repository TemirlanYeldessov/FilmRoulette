import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ActorScreen from './screens/ActorScreen';
import CatalogScreen from './screens/CatalogScreen';
import MoodScreen from './screens/MoodScreen';
import MovieScreen from './screens/MovieScreen';
import SettingsScreen from './screens/SettingsScreen';
import TopScreen from './screens/TopScreen';
import { AppProvider, useAppContext } from './store/AppContext';

const Tab = createBottomTabNavigator();
const CatalogStack = createStackNavigator();
const TopStack = createStackNavigator();
const MoodStack = createStackNavigator();
const SettingsStack = createStackNavigator();

function CatalogStackScreen() {
  return (
    <CatalogStack.Navigator screenOptions={{ headerShown: false }}>
      <CatalogStack.Screen name="CatalogHome" component={CatalogScreen} />
      <CatalogStack.Screen name="Card" component={MovieScreen} />
      <CatalogStack.Screen name="Actor" component={ActorScreen} />
    </CatalogStack.Navigator>
  );
}

function TopStackScreen() {
  return (
    <TopStack.Navigator screenOptions={{ headerShown: false }}>
      <TopStack.Screen name="TopHome" component={TopScreen} />
      <TopStack.Screen name="Card" component={MovieScreen} />
      <TopStack.Screen name="Actor" component={ActorScreen} />
    </TopStack.Navigator>
  );
}

function MoodStackScreen() {
  return (
    <MoodStack.Navigator screenOptions={{ headerShown: false }}>
      <MoodStack.Screen name="MoodHome" component={MoodScreen} />
      <MoodStack.Screen name="Card" component={MovieScreen} />
      <MoodStack.Screen name="Actor" component={ActorScreen} />
    </MoodStack.Navigator>
  );
}

function SettingsStackScreen() {
  return (
    <SettingsStack.Navigator screenOptions={{ headerShown: false }}>
      <SettingsStack.Screen name="SettingsHome" component={SettingsScreen} />
      <SettingsStack.Screen name="Card" component={MovieScreen} />
      <SettingsStack.Screen name="Actor" component={ActorScreen} />
    </SettingsStack.Navigator>
  );
}

function TabIcon({
  name,
  focused,
  color,
  badge,
}: {
  name: any;
  focused: boolean;
  color: string;
  badge?: number;
}) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
      <Ionicons name={name} size={22} color={color} />

      {!!badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </View>
  );
}

const ONBOARDING_SLIDES = [
  {
    icon: 'shuffle' as const,
    iconBg: '#e50914',
    title: 'FilmRoulette',
    text: 'Подбирай случайные фильмы и сериалы одним нажатием. Настраивай жанр, год, рейтинг и страну — рулетка сама найдёт что-то интересное.',
    items: [
      { icon: 'film-outline' as const, label: 'Каталог с жанрами и фильтрами' },
      { icon: 'shuffle-outline' as const, label: 'Случайный подбор за секунду' },
      { icon: 'play-circle-outline' as const, label: 'Трейлер прямо в приложении' },
    ],
  },
  {
    icon: 'sparkles' as const,
    iconBg: '#5533cc',
    title: 'ИИ-подборщик',
    text: 'Опиши настроение или вайб словами — ИИ на базе Groq проанализирует запрос и выдаст до 40 релевантных тайтлов специально для тебя.',
    items: [
      { icon: 'mic-outline' as const, label: 'Голосовой ввод запроса' },
      { icon: 'sparkles-outline' as const, label: 'Анализ вайба через Groq AI' },
      { icon: 'grid-outline' as const, label: 'До 40 уникальных результатов' },
    ],
  },
  {
    icon: 'heart' as const,
    iconBg: '#e50914',
    title: 'Избранное и оценки',
    text: 'Сохраняй находки в избранное, ставь оценки и следи за своей коллекцией. Все данные хранятся локально на устройстве.',
    items: [
      { icon: 'bookmark-outline' as const, label: 'Хочу / Смотрел / Понравилось' },
      { icon: 'heart-outline' as const, label: 'Избранное с поиском и фильтрами' },
      { icon: 'phone-portrait-outline' as const, label: 'Всё хранится на устройстве' },
    ],
  },
];

function OnboardingModal() {
  const { onboardingSeen, markOnboardingSeen } = useAppContext();
  const [slide, setSlide] = useState(0);
  const current = ONBOARDING_SLIDES[slide];
  const isLast = slide === ONBOARDING_SLIDES.length - 1;

  const handleNext = () => {
    if (isLast) markOnboardingSeen();
    else setSlide((s: number) => s + 1);
  };

  return (
    <Modal visible={!onboardingSeen} transparent animationType="fade" onRequestClose={markOnboardingSeen}>
      <View style={styles.onboardingOverlay}>
        <View style={styles.onboardingCard}>
          <View style={[styles.onboardingIcon, { backgroundColor: current.iconBg }]}>
            <Ionicons name={current.icon} size={28} color="#fff" />
          </View>

          <Text style={styles.onboardingTitle}>{current.title}</Text>
          <Text style={styles.onboardingText}>{current.text}</Text>

          <View style={styles.onboardingList}>
            {current.items.map(item => (
              <View key={item.label} style={styles.onboardingItem}>
                <Ionicons name={item.icon} size={18} color="#8888ff" />
                <Text style={styles.onboardingItemText}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.onboardingDots}>
            {ONBOARDING_SLIDES.map((_, i) => (
              <View key={i} style={[styles.onboardingDot, i === slide && styles.onboardingDotActive]} />
            ))}
          </View>

          <TouchableOpacity style={styles.onboardingBtn} onPress={handleNext}>
            <Text style={styles.onboardingBtnText}>{isLast ? 'Начать' : 'Далее →'}</Text>
          </TouchableOpacity>

          {!isLast && (
            <TouchableOpacity style={styles.onboardingSkip} onPress={markOnboardingSeen}>
              <Text style={styles.onboardingSkipText}>Пропустить</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function AppTabs() {
  const { watchlist } = useAppContext();

  return (
    <>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: '#fff',
          tabBarInactiveTintColor: '#555',
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tab.Screen
          name="Catalog"
          component={CatalogStackScreen}
          options={{
            tabBarLabel: 'Каталог',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name={focused ? 'film' : 'film-outline'} focused={focused} color={color} />
            ),
          }}
        />

        <Tab.Screen
          name="Top"
          component={TopStackScreen}
          options={{
            tabBarLabel: 'Топ',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name={focused ? 'trophy' : 'trophy-outline'} focused={focused} color={color} />
            ),
          }}
        />

        <Tab.Screen
          name="Mood"
          component={MoodStackScreen}
          options={{
            tabBarLabel: 'ИИ',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name={focused ? 'sparkles' : 'sparkles-outline'} focused={focused} color={color} />
            ),
          }}
        />

        <Tab.Screen
          name="Settings"
          component={SettingsStackScreen}
          options={{
            tabBarLabel: 'Настройки',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon
                name={focused ? 'settings' : 'settings-outline'}
                focused={focused}
                color={color}
                badge={watchlist.length}
              />
            ),
          }}
        />
      </Tab.Navigator>

      <OnboardingModal />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <NavigationContainer>
          <AppTabs />
        </NavigationContainer>
      </AppProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0f0f1a',
    borderTopColor: '#1e1e30',
    borderTopWidth: 1,
    height: 70,
    paddingBottom: 10,
    paddingTop: 8,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  iconContainer: {
    width: 44,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  iconContainerActive: {
    backgroundColor: '#e50914',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e50914',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#0f0f1a',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  onboardingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  onboardingCard: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2a2a44',
  },
  onboardingIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#e50914',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  onboardingTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  onboardingText: {
    color: '#aaa',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
  },
  onboardingList: {
    gap: 12,
    marginBottom: 24,
  },
  onboardingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  onboardingItemText: {
    color: '#ccc',
    fontSize: 14,
    flex: 1,
  },
  onboardingDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  onboardingDotActive: {
    backgroundColor: '#e50914',
    width: 20,
  },
  onboardingBtn: {
    backgroundColor: '#e50914',
    borderRadius: 28,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  onboardingBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  onboardingSkip: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  onboardingSkipText: {
    color: '#555',
    fontSize: 14,
  },
});
