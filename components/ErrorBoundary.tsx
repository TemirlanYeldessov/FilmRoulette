import { Ionicons } from '@expo/vector-icons';
import { Component, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { logError } from '../utils/logger';
import { colors, radii } from '../constants/theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  // How many times the user pressed "Продолжить" only to hit the error again.
  // After a couple of tries the throw is clearly deterministic, so we stop
  // offering a retry that just loops and tell them to restart instead.
  retries: number;
}

const MAX_RETRIES = 2;

// Top-level safety net: an unexpected render throw (e.g. an API payload in an
// unforeseen shape) would otherwise blank the whole app. Here we catch it and
// offer a recovery screen instead of a white screen.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '', retries: 0 };

  static getDerivedStateFromError(error: any): Partial<State> {
    return { hasError: true, message: error?.message || 'Неизвестная ошибка' };
  }

  componentDidCatch(error: any, info: any) {
    // Route through the central sink so a crash reporter can be wired in one place.
    logError(error, { scope: 'ErrorBoundary', componentStack: info?.componentStack });
  }

  handleReset = () => {
    this.setState(prev => ({ hasError: false, message: '', retries: prev.retries + 1 }));
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const exhausted = this.state.retries >= MAX_RETRIES;

    return (
      <View style={styles.container}>
        <Ionicons name="bug-outline" size={48} color={colors.primary} />
        <Text style={styles.title}>Что-то пошло не так</Text>
        <Text style={styles.text}>
          {exhausted
            ? 'Сбой повторяется. Закрой и открой приложение заново — это обычно помогает.'
            : 'Произошёл сбой при отображении экрана. Можно попробовать продолжить.'}
        </Text>
        {!!this.state.message && <Text style={styles.detail}>{this.state.message}</Text>}
        {!exhausted && (
          <TouchableOpacity style={styles.btn} onPress={this.handleReset}>
            <Text style={styles.btnText}>Продолжить</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 8 },
  text: { color: colors.textSoft, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  detail: { color: colors.muted2, fontSize: 12, textAlign: 'center', marginTop: 4 },
  btn: { backgroundColor: colors.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: radii.pill, marginTop: 12 },
  btnText: { color: colors.text, fontWeight: '800', fontSize: 16 },
});
