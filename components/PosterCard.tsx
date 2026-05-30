import { Image } from 'expo-image';
import { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import CardMark from './CardMark';
import { itemToMovie } from '../utils/tmdb';

interface Props {
  item: any;
  cardWidth: number;
  onPress: () => void;
  // Forwarded to itemToMovie for the save/seen mark when the raw item lacks
  // media_type (e.g. catalog discover rows carry it via the active tab).
  mediaTypeFallback?: string;
  // Screen-specific metadata footer (rating / year), rendered under the title.
  children?: ReactNode;
}

// Shared poster card used in every result/credits grid (AI picks, catalog
// search, actor filmography). The shell — type badge, save mark, poster and
// title — is identical across screens; only the metadata footer differs, so
// callers pass it as children.
export default function PosterCard({ item, cardWidth, onPress, mediaTypeFallback, children }: Props) {
  return (
    <TouchableOpacity style={[styles.card, { width: cardWidth }]} onPress={onPress}>
      <View style={styles.typeBadge}>
        <Text style={styles.typeBadgeText}>{item.media_type === 'tv' ? 'Сериал' : 'Фильм'}</Text>
      </View>
      <CardMark movie={itemToMovie(item, mediaTypeFallback)} />
      <Image
        source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
        style={[styles.poster, { width: cardWidth, height: cardWidth * 1.5 }]}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
      />
      <Text style={styles.cardTitle} numberOfLines={2}>{item.title || item.name}</Text>
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {},
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#1a1a40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 1 },
  typeBadgeText: { color: '#8888ff', fontSize: 11, fontWeight: '600' },
  poster: { borderRadius: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 3 },
});
