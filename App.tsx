import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ActorScreen from './screens/ActorScreen';
import CatalogScreen from './screens/CatalogScreen';
import CinemaScreen from './screens/CinemaScreen';
import FavoritesScreen from './screens/FavoritesScreen';
import MoodScreen from './screens/MoodScreen';
import MovieScreen from './screens/MovieScreen';
import SettingsScreen from './screens/SettingsScreen';
import TopScreen from './screens/TopScreen';
import { AppProvider, useAppContext } from './store/AppContext';
import ErrorBoundary from './components/ErrorBoundary';
import OfflineBanner from './components/OfflineBanner';
import { colors, radii, shadow } from './constants/theme';

const Tab = createBottomTabNavigator();
const CatalogStack = createStackNavigator();
const TopStack = createStackNavigator();
const MoodStack = createStackNavigator();
const FavoritesStack = createStackNavigator();
const SettingsStack = createStackNavigator();

function CatalogStackScreen() {
  return (
    <CatalogStack.Navigator screenOptions={{ headerShown: false }}>
      <CatalogStack.Screen name="CatalogHome" component={CatalogScreen} />
      <CatalogStack.Screen name="Card" component={MovieScreen} />
      <CatalogStack.Screen name="Actor" component={ActorScreen} />
      <CatalogStack.Screen name="Cinema" component={CinemaScreen} />
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

function FavoritesStackScreen() {
  return (
    <FavoritesStack.Navigator screenOptions={{ headerShown: false }}>
      <FavoritesStack.Screen name="FavoritesHome" component={FavoritesScreen} />
      <FavoritesStack.Screen name="Card" component={MovieScreen} />
      <FavoritesStack.Screen name="Actor" component={ActorScreen} />
    </FavoritesStack.Navigator>
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
    icon: 'sparkles' as const,
    iconBg: colors.primary,
    title: 'MediaRoulette',
    text: 'Опиши настроение, выбери случайный тайтл или открой топы. Главная идея простая: быстрее решить, что смотреть сегодня.',
    items: [
      { icon: 'sparkles-outline' as const, label: 'ИИ-подбор по вайбу и свежим релизам' },
      { icon: 'shuffle-outline' as const, label: 'Рулетка, когда не хочется выбирать' },
      { icon: 'heart-outline' as const, label: 'Избранное и личные отметки' },
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
            <Ionicons name={current.icon} size={28} color={colors.text} />
          </View>

          <Text style={styles.onboardingTitle}>{current.title}</Text>
          <Text style={styles.onboardingText}>{current.text}</Text>

          <View style={styles.onboardingList}>
            {current.items.map(item => (
              <View key={item.label} style={styles.onboardingItem}>
                <Ionicons name={item.icon} size={18} color={colors.accent} />
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
            <Text style={styles.onboardingBtnText}>{isLast ? 'Начать подбор' : 'Далее'}</Text>
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
  const { watchlist, hydrated } = useAppContext();

  // Hold the UI back until AsyncStorage resolves — prevents the brief flash
  // where the main screen renders before the onboarding modal pops in.
  if (!hydrated) {
    return <View style={styles.splash} />;
  }

  return (
    <>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.muted2,
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tab.Screen
          name="Mood"
          component={MoodStackScreen}
          options={{
            tabBarLabel: 'Подбор',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name={focused ? 'sparkles' : 'sparkles-outline'} focused={focused} color={color} />
            ),
          }}
        />

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
          name="Favorites"
          component={FavoritesStackScreen}
          options={{
            tabBarLabel: 'Избранное',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon
                name={focused ? 'heart' : 'heart-outline'}
                focused={focused}
                color={color}
                badge={watchlist.length}
              />
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
      <SafeAreaProvider>
        <ErrorBoundary>
          <AppProvider>
            <NavigationContainer>
              <AppTabs />
            </NavigationContainer>
            <OfflineBanner />
          </AppProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg },
  tabBar: {
    backgroundColor: colors.bg,
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    height: 70,
    paddingBottom: 10,
    paddingTop: 8,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0,
  },
  iconContainer: {
    width: 44,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  iconContainerActive: {
    backgroundColor: colors.primary,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.bg,
  },
  badgeText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: '800',
  },
  onboardingOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  onboardingCard: {
    width: '100%',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.xl,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  onboardingIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  onboardingTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  onboardingText: {
    color: colors.textSoft,
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
    color: colors.textSoft,
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
    backgroundColor: colors.border,
  },
  onboardingDotActive: {
    backgroundColor: colors.primary,
    width: 20,
  },
  onboardingBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  onboardingBtnText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  onboardingSkip: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  onboardingSkipText: {
    color: colors.muted2,
    fontSize: 14,
  },
});
