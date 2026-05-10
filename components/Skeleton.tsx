import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';

interface SkeletonProps {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width, height, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[{ width: width as any, height, borderRadius, backgroundColor: '#2a2a3a', opacity }, style]}
    />
  );
}

export function MovieCardSkeleton({ cardWidth }: { cardWidth: number }) {
  return (
    <View style={{ width: cardWidth }}>
      <Skeleton width={cardWidth} height={cardWidth * 1.5} borderRadius={10} style={{ marginBottom: 8 }} />
      <Skeleton width={cardWidth * 0.8} height={14} borderRadius={6} style={{ marginBottom: 4 }} />
      <Skeleton width={cardWidth * 0.4} height={12} borderRadius={6} />
    </View>
  );
}

export function HorizontalCardSkeleton() {
  return (
    <View style={{ width: 120, marginRight: 12 }}>
      <Skeleton width={120} height={180} borderRadius={10} style={{ marginBottom: 6 }} />
      <Skeleton width={90} height={12} borderRadius={6} />
    </View>
  );
}

export function MovieDetailSkeleton() {
  return (
    <View style={styles.detailContainer}>
      <Skeleton width={220} height={330} borderRadius={16} style={{ marginBottom: 24, alignSelf: 'center' }} />
      <Skeleton width={280} height={22} borderRadius={6} style={{ marginBottom: 8, alignSelf: 'center' }} />
      <Skeleton width={200} height={16} borderRadius={6} style={{ marginBottom: 16, alignSelf: 'center' }} />
      <View style={styles.badgeRow}>
        <Skeleton width={70} height={28} borderRadius={12} />
        <Skeleton width={50} height={28} borderRadius={12} />
        <Skeleton width={80} height={28} borderRadius={12} />
      </View>
      <Skeleton width="100%" height={14} borderRadius={6} style={{ marginBottom: 6 }} />
      <Skeleton width="100%" height={14} borderRadius={6} style={{ marginBottom: 6 }} />
      <Skeleton width="80%" height={14} borderRadius={6} style={{ marginBottom: 6 }} />
      <Skeleton width="90%" height={14} borderRadius={6} style={{ marginBottom: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  detailContainer: { width: '100%', alignItems: 'flex-start', paddingHorizontal: 0 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 16, alignSelf: 'center' },
});