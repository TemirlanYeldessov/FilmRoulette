import { Ionicons } from '@expo/vector-icons';
import { Component, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
        <Ionicons name="bug-outline" size={48} color="#e50914" />
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
  container: { flex: 1, backgroundColor: '#0f0f1a', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 8 },
  text: { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  detail: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 4 },
  btn: { backgroundColor: '#e50914', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30, marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
