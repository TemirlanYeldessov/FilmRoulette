import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useAppContext } from '../store/AppContext';

// Corner marker on grid cards so the user can tell at a glance what they've
// already dealt with — a green check for anything seen/graded, a red heart for
// saved-but-unwatched. Keeps roulette/AI/search from feeling like they keep
// surfacing the same titles.
export default function CardMark({ id, mediaType }: { id: number; mediaType: string }) {
  const { isInWatchlist, getUserStatus } = useAppContext();
  const status = getUserStatus(id, mediaType);
  const fav = isInWatchlist(id, mediaType);

  const seen = status === 'watched' || status === 'liked' || status === 'disliked';
  if (!seen && !fav && status !== 'want') return null;

  const icon = seen ? 'checkmark' : 'heart';
  const bg = seen ? '#1f8a4c' : '#e50914';

  return (
    <View style={[styles.mark, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={11} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
  },
});
