import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

// Poster grids were hardcoded to 2 columns with `(width - 48) / 2`, which makes
// cards huge on tablets and in landscape. This derives the column count from the
// available width and returns the matching card width, so every grid scales the
// same way. The 2-column phone case stays pixel-identical to the old formula.
const PAGE_PADDING = 16; // horizontal padding on each side of the list
const GAP = 16; // space between columns

export function useGridColumns() {
  const { width } = useWindowDimensions();
  return useMemo(() => {
    const columns = width >= 1000 ? 5 : width >= 740 ? 4 : width >= 540 ? 3 : 2;
    const available = width - PAGE_PADDING * 2 - GAP * (columns - 1);
    const cardWidth = Math.floor(available / columns);
    return { columns, cardWidth };
  }, [width]);
}
