import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../store/AppContext';
import { colors } from '../constants/theme';

// Corner controls on grid cards: a passive green check for anything already
// graded (seen), plus a tappable heart to save/unsave a title without opening
// it — so saving from a long roulette/AI/search grid is one tap.
function CardMark({ movie }: { movie: any }) {
  const { isInWatchlist, getUserStatus, addToWatchlist, removeFromWatchlist } = useAppContext();
  const id = movie?.id;
  const mediaType = movie?.mediaType;
  if (!id || !mediaType) return null;

  const status = getUserStatus(id, mediaType);
  const fav = isInWatchlist(id, mediaType);
  const seen = status === 'watched' || status === 'liked' || status === 'disliked';

  const toggleFav = () => {
    if (fav) removeFromWatchlist(id, mediaType);
    else addToWatchlist(movie);
  };

  return (
    <View style={styles.row}>
      {seen && (
        <View style={[styles.mark, styles.check]}>
          <Ionicons name="checkmark" size={11} color={colors.text} />
        </View>
      )}
      <TouchableOpacity style={[styles.mark, fav ? styles.favOn : styles.favOff]} onPress={toggleFav} hitSlop={8}>
        <Ionicons name={fav ? 'heart' : 'heart-outline'} size={12} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

// A title's identity is its id+mediaType — the rest of the movie object is
// stable for a given title. Skipping re-renders on referentially-new-but-equal
// props avoids re-rendering every card while a grid streams in or re-sorts.
// (Watchlist/rating changes still re-render via the consumed context.)
export default memo(CardMark, (a, b) =>
  a.movie?.id === b.movie?.id && a.movie?.mediaType === b.movie?.mediaType);

const styles = StyleSheet.create({
  row: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 4, zIndex: 2 },
  mark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.whiteGlass,
  },
  check: { backgroundColor: colors.success },
  favOn: { backgroundColor: colors.primary },
  favOff: { backgroundColor: colors.blackGlass },
});
