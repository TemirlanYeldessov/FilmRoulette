import { Ionicons } from '@expo/vector-icons';
import { Component, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii } from '../constants/theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

// Top-level safety net: an unexpected render throw (e.g. an API payload in an
// unforeseen shape) would otherwise blank the whole app. Here we catch it and
// offer a recovery screen instead of a white screen.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, message: error?.message || 'Неизвестная ошибка' };
  }

  componentDidCatch(error: any) {
    // Keep a breadcrumb in the dev console; no external crash reporter wired up.
    console.error('Unhandled UI error:', error);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Ionicons name="bug-outline" size={48} color={colors.primary} />
        <Text style={styles.title}>Что-то пошло не так</Text>
        <Text style={styles.text}>
          Произошёл сбой при отображении экрана. Можно попробовать продолжить.
        </Text>
        {!!this.state.message && <Text style={styles.detail}>{this.state.message}</Text>}
        <TouchableOpacity style={styles.btn} onPress={this.handleReset}>
          <Text style={styles.btnText}>Продолжить</Text>
        </TouchableOpacity>
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
